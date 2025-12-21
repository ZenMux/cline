import { StringRequest } from "@shared/proto/cline/common"
import type { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeLink, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import type React from "react"
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { useMount } from "react-use"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import ThinkingBudgetSlider from "./ThinkingBudgetSlider"
import { getModeSpecificFields } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

// Styled dropdown list with scrolling
const DropdownList = styled.div`
	position: absolute;
	top: calc(100% + 2px);
	left: 0;
	width: 100%;
	max-height: 300px;
	overflow-y: auto;
	background-color: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-list-activeSelectionBackground);
	z-index: 1000;
	border-radius: 3px;
`

// Star icon for favorites
const StarIcon = ({ isFavorite, onClick }: { isFavorite: boolean; onClick: (e: React.MouseEvent) => void }) => {
	return (
		<div
			onClick={onClick}
			style={{
				cursor: "pointer",
				color: isFavorite ? "var(--vscode-terminal-ansiBlue)" : "var(--vscode-descriptionForeground)",
				marginLeft: "8px",
				fontSize: "16px",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				userSelect: "none",
				WebkitUserSelect: "none",
			}}>
			{isFavorite ? "★" : "☆"}
		</div>
	)
}

export interface ZenMuxModelPickerProps {
	isPopup?: boolean
	currentMode: Mode
	showProviderRouting?: boolean
}

const ZenMuxModelPicker: React.FC<ZenMuxModelPickerProps> = ({ isPopup, currentMode, showProviderRouting }) => {
	const { handleModeFieldChange, handleModeFieldsChange, handleFieldChange } = useApiConfigurationHandlers()
	const { apiConfiguration, favoritedModelIds, zenMuxModels, refreshZenMuxModels } = useExtensionState()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [searchTerm, setSearchTerm] = useState(modeFields.zenMuxModelId || "")
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const containerRef = useRef<HTMLDivElement>(null)

	useMount(() => {
		refreshZenMuxModels()
	})

	// Fuse search instance
	const fuse = useMemo(() => {
		if (!zenMuxModels) {
			return null
		}

		const modelList = Object.entries(zenMuxModels).map(([id, info]) => ({
			id,
			name: info.name || id,
			description: info.description || "",
		}))
		return new Fuse(modelList, {
			keys: ["id", "name", "description"],
			threshold: 0.3,
		})
	}, [zenMuxModels])

	// Filter models based on search and show favorites first
	const filteredModels = useMemo(() => {
		if (!zenMuxModels) {
			return []
		}

		let results: string[]
		if (searchTerm.trim()) {
			if (fuse) {
				results = fuse.search(searchTerm).map((result) => result.item.id)
			} else {
				results = Object.keys(zenMuxModels)
			}
		} else {
			results = Object.keys(zenMuxModels)
		}

		// Sort: favorites first, then alphabetically
		return results.sort((a, b) => {
			const aFavorited = favoritedModelIds?.includes(a) || false
			const bFavorited = favoritedModelIds?.includes(b) || false
			if (aFavorited && !bFavorited) return -1
			if (!aFavorited && bFavorited) return 1
			return a.localeCompare(b)
		})
	}, [zenMuxModels, searchTerm, fuse, favoritedModelIds])

	const selectedModel = modeFields.zenMuxModelId || ""
	const selectedModelInfo = zenMuxModels?.[selectedModel]

	// Check if the selected model supports reasoning/thinking
	const showBudgetSlider = useMemo(() => {
		return selectedModelInfo?.supportsReasoning || selectedModelInfo?.thinkingConfig
	}, [selectedModelInfo])

	const handleModelSelect = (modelId: string) => {
		const modelInfo = zenMuxModels?.[modelId]

		handleModeFieldsChange(
			{
				zenMuxModelId: { plan: "planModeZenMuxModelId", act: "actModeZenMuxModelId" },
				zenMuxModelInfo: { plan: "planModeZenMuxModelInfo", act: "actModeZenMuxModelInfo" },
			},
			{
				zenMuxModelId: modelId,
				zenMuxModelInfo: modelInfo,
			},
			currentMode,
		)
		setSearchTerm("") // Clear search term after selection
		setIsDropdownVisible(false)
		setSelectedIndex(-1)
	}

	const handleFavoriteClick = async (modelId: string, e: React.MouseEvent) => {
		e.stopPropagation()
		await StateServiceClient.toggleFavoriteModel(StringRequest.create({ value: modelId }))
	}

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (!isDropdownVisible) {
			if (e.key === "ArrowDown" || e.key === "Enter") {
				setIsDropdownVisible(true)
				setSelectedIndex(0)
				e.preventDefault()
			}
			return
		}

		switch (e.key) {
			case "ArrowDown":
				setSelectedIndex((prev) => (prev < filteredModels.length - 1 ? prev + 1 : prev))
				e.preventDefault()
				break
			case "ArrowUp":
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0))
				e.preventDefault()
				break
			case "Enter":
				if (selectedIndex >= 0 && selectedIndex < filteredModels.length) {
					handleModelSelect(filteredModels[selectedIndex])
				}
				e.preventDefault()
				break
			case "Escape":
				setIsDropdownVisible(false)
				setSelectedIndex(-1)
				e.preventDefault()
				break
		}
	}

	// Handle clicks outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
				setIsDropdownVisible(false)
				setSelectedIndex(-1)
			}
		}
		document.addEventListener("mousedown", handleClickOutside)
		return () => document.removeEventListener("mousedown", handleClickOutside)
	}, [])

	return (
		<div style={{ marginTop: "10px" }}>
			<div ref={containerRef} style={{ position: "relative" }}>
				<div style={{ marginBottom: "5px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
					<label style={{ fontWeight: 500 }}>Model</label>
					<VSCodeLink
						onClick={(e) => {
							e.preventDefault()
							refreshZenMuxModels()
						}}
						style={{ fontSize: "12px", cursor: "pointer" }}>
						Refresh Models
					</VSCodeLink>
				</div>
				<VSCodeTextField
					onFocus={() => {
						setSearchTerm("") // Clear search when focusing
						setIsDropdownVisible(true)
					}}
					onInput={(e: any) => {
						setSearchTerm(e.target?.value || "")
						setIsDropdownVisible(true)
						setSelectedIndex(-1)
					}}
					onKeyDown={handleKeyDown}
					placeholder="Search models..."
					style={{ width: "100%" }}
					value={searchTerm || selectedModel || ""}
				/>
				{isDropdownVisible && filteredModels.length > 0 && (
					<DropdownList>
						{filteredModels.map((modelId, index) => {
							const modelInfo = zenMuxModels?.[modelId]
							const isFavorited = favoritedModelIds?.includes(modelId) || false
							const isSelected = index === selectedIndex
							const isCurrentModel = modelId === selectedModel

							return (
								<div
									key={modelId}
									onClick={() => handleModelSelect(modelId)}
									onMouseEnter={() => setSelectedIndex(index)}
									style={{
										padding: "8px 12px",
										cursor: "pointer",
										backgroundColor: isSelected
											? "var(--vscode-list-hoverBackground)"
											: isCurrentModel
												? "var(--vscode-list-activeSelectionBackground)"
												: "transparent",
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
									}}>
									<div style={{ flex: 1 }}>
										<div
											style={{
												fontWeight: isCurrentModel ? 600 : 400,
											}}>
											{modelId}
										</div>
										{modelInfo?.description && (
											<div
												style={{
													fontSize: "11px",
													color: "var(--vscode-descriptionForeground)",
													marginTop: "2px",
												}}>
												{modelInfo.description.split("\n")[0]}
											</div>
										)}
									</div>
									<StarIcon isFavorite={isFavorited} onClick={(e) => handleFavoriteClick(modelId, e)} />
								</div>
							)
						})}
					</DropdownList>
				)}
			</div>

			{showBudgetSlider && <ThinkingBudgetSlider currentMode={currentMode} />}

			{showProviderRouting && (
				<div style={{ marginTop: "10px" }}>
					<label
						htmlFor="provider-sorting"
						style={{
							fontWeight: 500,
							display: "block",
							marginBottom: "5px",
						}}>
						Provider Routing
					</label>
					<VSCodeDropdown
						id="provider-sorting"
						onChange={(e: any) => handleFieldChange("zenMuxProviderSorting", e.target.value)}
						style={{ width: "100%" }}
						value={apiConfiguration?.zenMuxProviderSorting || ""}>
						<VSCodeOption value="">Default</VSCodeOption>
						<VSCodeOption value="throughput">Throughput</VSCodeOption>
						<VSCodeOption value="latency">Latency</VSCodeOption>
						<VSCodeOption value="cost">Cost</VSCodeOption>
					</VSCodeDropdown>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						Choose how ZenMux routes your requests to different providers.
					</p>
				</div>
			)}
		</div>
	)
}

export default ZenMuxModelPicker
