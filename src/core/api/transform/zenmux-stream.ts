import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo } from "@shared/api"
import OpenAI from "openai"
import { ChatCompletionTool } from "openai/resources/chat/completions"
import { convertToOpenAiMessages } from "./openai-format"
import { getOpenAIToolParams } from "./tool-call-processor"

export async function createZenMuxStream(
	client: OpenAI,
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
	model: { id: string; info: ModelInfo },
	_reasoningEffort?: string,
	thinkingBudgetTokens?: number,
	zenMuxProviderSorting?: string,
	tools?: Array<ChatCompletionTool>,
	_geminiThinkingLevel?: string,
) {
	// Convert Anthropic messages to OpenAI format
	const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
		{ role: "system", content: systemPrompt },
		...convertToOpenAiMessages(messages),
	]

	// Build reasoning config if thinking budget is set
	let reasoning: { max_tokens: number } | undefined
	if (thinkingBudgetTokens && thinkingBudgetTokens > 0) {
		reasoning = { max_tokens: thinkingBudgetTokens }
	}

	// @ts-ignore-next-line
	const stream = await client.chat.completions.create({
		model: model.id,
		messages: openAiMessages,
		stream: true,
		stream_options: { include_usage: true },
		...(reasoning ? { reasoning } : {}),
		...(zenMuxProviderSorting && zenMuxProviderSorting !== ""
			? {
					provider: {
						routing: {
							type: "priority",
							primary_factor: zenMuxProviderSorting,
						},
					},
				}
			: {}),
		...getOpenAIToolParams(tools),
	})

	return stream
}
