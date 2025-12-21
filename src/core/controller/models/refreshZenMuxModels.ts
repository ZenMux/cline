import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import type { ModelInfo } from "@shared/api"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { StateManager } from "@/core/storage/StateManager"
import { getAxiosSettings } from "@/shared/net"
import type { Controller } from ".."

/**
 * The raw model information returned by the ZenMux API to list models
 * This follows the OpenAI-compatible models list format
 */
interface ZenMuxRawModelInfo {
	id: string
	object: string
	created: number
	owned_by: string
}

/**
 * The response format from ZenMux models API
 */
interface ZenMuxModelsResponse {
	object: string
	data: ZenMuxRawModelInfo[]
}

/**
 * Core function: Refreshes the ZenMux models and returns application types
 * @param controller The controller instance
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshZenMuxModels(controller: Controller): Promise<Record<string, ModelInfo>> {
	const zenMuxModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.zenMuxModels)

	let models: Record<string, ModelInfo> = {}
	try {
		const response = await axios.get<ZenMuxModelsResponse>("https://zenmux.ai/api/v1/models", getAxiosSettings())

		if (response.data?.data) {
			const rawModels = response.data.data
			console.log(`ZenMux API returned ${rawModels.length} models`)

			for (const rawModel of rawModels) {
				// Store minimal model info - just the ID and name
				const modelInfo: ModelInfo = {
					name: rawModel.id,
					maxTokens: 0,
					contextWindow: 0,
					supportsPromptCache: false,
					supportsReasoning: true,
					inputPrice: 0,
					outputPrice: 0,
					description: `${rawModel.owned_by} model`,
				}

				models[rawModel.id] = modelInfo
			}
			console.log(`Processed ${Object.keys(models).length} ZenMux models`)
		} else {
			console.error("Invalid response from ZenMux API", response.data)
		}
		await fs.writeFile(zenMuxModelsFilePath, JSON.stringify(models))
		console.log("ZenMux models saved to cache:", Object.keys(models).slice(0, 10).join(", "))
	} catch (error) {
		console.error("Error fetching ZenMux models:", error)
		if (axios.isAxiosError(error)) {
			console.error("Axios error details:", {
				message: error.message,
				code: error.code,
				status: error.response?.status,
				statusText: error.response?.statusText,
				url: error.config?.url,
			})
		}

		// If we failed to fetch models, try to read cached models
		const cachedModels = await controller.readZenMuxModels()
		if (cachedModels) {
			models = cachedModels
		}
	}

	// Store in StateManager's in-memory cache
	StateManager.get().setModelsCache("zenMux", models)

	return models
}
