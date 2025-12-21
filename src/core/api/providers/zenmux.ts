import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import { StateManager } from "@core/storage/StateManager"
import { ModelInfo, zenMuxDefaultModelId, zenMuxDefaultModelInfo } from "@shared/api"
import { shouldSkipReasoningForModel } from "@utils/model-utils"
import axios from "axios"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch, getAxiosSettings } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { ToolCallProcessor } from "../transform/tool-call-processor"
import { createZenMuxStream } from "../transform/zenmux-stream"
import { OpenRouterErrorResponse } from "./types"

interface ZenMuxHandlerOptions extends CommonApiHandlerOptions {
	zenMuxApiKey?: string
	zenMuxModelId?: string
	zenMuxModelInfo?: ModelInfo
	zenMuxProviderSorting?: string
	reasoningEffort?: string
	thinkingBudgetTokens?: number
	geminiThinkingLevel?: string
}

export class ZenMuxHandler implements ApiHandler {
	private options: ZenMuxHandlerOptions
	private client: OpenAI | undefined
	lastGenerationId?: string

	constructor(options: ZenMuxHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.zenMuxApiKey) {
				throw new Error("ZenMux API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://zenmux.ai/api/v1",
					apiKey: this.options.zenMuxApiKey,
					defaultHeaders: {
						"HTTP-Referer": "https://cline.bot",
						"X-Title": "Cline",
					},
					fetch, // Use configured fetch with proxy support
				})
			} catch (error: any) {
				throw new Error(`Error creating ZenMux client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		this.lastGenerationId = undefined

		const stream = await createZenMuxStream(
			client,
			systemPrompt,
			messages,
			this.getModel(),
			this.options.reasoningEffort,
			this.options.thinkingBudgetTokens,
			this.options.zenMuxProviderSorting,
			tools,
			this.options.geminiThinkingLevel,
		)

		let didOutputUsage: boolean = false
		const toolCallProcessor = new ToolCallProcessor()

		for await (const chunk of stream) {
			// Check for error field directly on chunk
			if ("error" in chunk) {
				const error = chunk.error as OpenRouterErrorResponse["error"]
				console.error(`ZenMux API Error: ${error?.code} - ${error?.message}`)
				const metadataStr = error.metadata ? `\nMetadata: ${JSON.stringify(error.metadata, null, 2)}` : ""
				throw new Error(`ZenMux API Error ${error.code}: ${error.message}${metadataStr}`)
			}

			// Check for error in choices[0].finish_reason
			const choice = chunk.choices?.[0]
			if ((choice?.finish_reason as string) === "error") {
				const choiceWithError = choice as any
				if (choiceWithError.error) {
					const error = choiceWithError.error
					console.error(`ZenMux Mid-Stream Error: ${error?.code || "Unknown"} - ${error?.message || "Unknown error"}`)
					const errorDetails = typeof error === "object" ? JSON.stringify(error, null, 2) : String(error)
					throw new Error(`ZenMux Mid-Stream Error: ${errorDetails}`)
				} else {
					throw new Error(`ZenMux Mid-Stream Error: Stream terminated with error status but no error details provided`)
				}
			}

			if (!this.lastGenerationId && chunk.id) {
				this.lastGenerationId = chunk.id
			}

			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			// Reasoning tokens are returned separately from the content
			if (delta && "reasoning" in delta && delta.reasoning && !shouldSkipReasoningForModel(this.options.zenMuxModelId)) {
				yield {
					type: "reasoning",
					reasoning: typeof delta.reasoning === "string" ? delta.reasoning : JSON.stringify(delta.reasoning),
				}
			}

			// Handle reasoning details
			if (
				delta &&
				"reasoning_details" in delta &&
				delta.reasoning_details &&
				// @ts-ignore-next-line
				delta.reasoning_details.length &&
				!shouldSkipReasoningForModel(this.options.zenMuxModelId)
			) {
				yield {
					type: "reasoning",
					reasoning: "",
					details: delta.reasoning_details,
				}
			}

			if (!didOutputUsage && chunk.usage) {
				yield {
					type: "usage",
					cacheWriteTokens: 0,
					cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
					inputTokens: (chunk.usage.prompt_tokens || 0) - (chunk.usage.prompt_tokens_details?.cached_tokens || 0),
					outputTokens: chunk.usage.completion_tokens || 0,
					// @ts-ignore-next-line
					totalCost: (chunk.usage.cost || 0) + (chunk.usage.cost_details?.upstream_inference_cost || 0),
				}
				didOutputUsage = true
			}
		}

		// Fallback to generation endpoint if usage chunk not returned
		if (!didOutputUsage) {
			const apiStreamUsage = await this.getApiStreamUsage()
			if (apiStreamUsage) {
				yield apiStreamUsage
			}
		}
	}

	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		if (this.lastGenerationId) {
			await setTimeoutPromise(500)
			try {
				const generationIterator = this.fetchGenerationDetails(this.lastGenerationId)
				const generation = (await generationIterator.next()).value
				return {
					type: "usage",
					cacheWriteTokens: 0,
					cacheReadTokens: generation?.native_tokens_cached || 0,
					inputTokens: (generation?.native_tokens_prompt || 0) - (generation?.native_tokens_cached || 0),
					outputTokens: generation?.native_tokens_completion || 0,
					totalCost: generation?.total_cost || 0,
				}
			} catch (error) {
				console.error("Error fetching ZenMux generation details:", error)
			}
		}
		return undefined
	}

	@withRetry({ maxRetries: 4, baseDelay: 250, maxDelay: 1000, retryAllErrors: true })
	async *fetchGenerationDetails(genId: string) {
		try {
			const response = await axios.get(`https://zenmux.ai/api/v1/generation?id=${genId}`, {
				headers: {
					Authorization: `Bearer ${this.options.zenMuxApiKey}`,
				},
				timeout: 15_000,
				...getAxiosSettings(),
			})
			yield response.data?.data
		} catch (error) {
			console.error("Error fetching ZenMux generation details:", error)
			throw error
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.zenMuxModelId || zenMuxDefaultModelId
		const cachedModelInfo = StateManager.get().getModelInfo("zenMux", modelId)
		return {
			id: modelId,
			info: cachedModelInfo || zenMuxDefaultModelInfo,
		}
	}
}
