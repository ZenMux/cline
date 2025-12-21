import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

// Keep track of active ZenMux models subscriptions
const activeZenMuxModelsSubscriptions = new Set<StreamingResponseHandler<OpenRouterCompatibleModelInfo>>()

/**
 * Subscribe to ZenMux models events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToZenMuxModels(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<OpenRouterCompatibleModelInfo>,
	requestId?: string,
): Promise<void> {
	console.log("[DEBUG] set up ZenMux models subscription")

	// Add this subscription to the active subscriptions
	activeZenMuxModelsSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeZenMuxModelsSubscriptions.delete(responseStream)
		console.log("[DEBUG] Cleaned up ZenMux models subscription")
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "zenMuxModels_subscription" }, responseStream)
	}
}

/**
 * Send a ZenMux models event to all active subscribers
 * @param models The ZenMux models to send
 */
export async function sendZenMuxModelsEvent(models: OpenRouterCompatibleModelInfo): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeZenMuxModelsSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(
				models,
				false, // Not the last message
			)
			console.log("[DEBUG] sending ZenMux models event")
		} catch (error) {
			console.error("Error sending ZenMux models event:", error)
			// Remove the subscription if there was an error
			activeZenMuxModelsSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
