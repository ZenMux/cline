import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import ZenMuxModelPicker from "../ZenMuxModelPicker"

/**
 * Props for the ZenMuxProvider component
 */
interface ZenMuxProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The ZenMux provider configuration component
 */
export const ZenMuxProvider = ({ showModelOptions, isPopup, currentMode }: ZenMuxProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	return (
		<div>
			<div>
				<DebouncedTextField
					initialValue={apiConfiguration?.zenMuxApiKey || ""}
					onChange={(value) => handleFieldChange("zenMuxApiKey", value)}
					placeholder="Enter API Key..."
					style={{ width: "100%" }}
					type="password">
					<span style={{ fontWeight: 500 }}>ZenMux API Key</span>
				</DebouncedTextField>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					This key is stored locally and only used to make API requests from this extension.
				</p>
			</div>

			{showModelOptions && <ZenMuxModelPicker currentMode={currentMode} isPopup={isPopup} showProviderRouting={true} />}
		</div>
	)
}
