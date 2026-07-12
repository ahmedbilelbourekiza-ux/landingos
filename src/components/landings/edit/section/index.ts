// Barrel export for the section editing pattern. Future sections import from
// here: `import { SectionShell, useSectionState } from "@/components/landings/edit/section"`.

export { SectionShell } from "./section-shell";
export { SectionHeader } from "./section-header";
export { SectionFooter } from "./section-footer";
export { SectionStatus as SectionStatusBadge } from "./section-status";
export { UnsavedIndicator } from "./unsaved-indicator";
export { SaveButton } from "./save-button";
export { CancelButton } from "./cancel-button";
export { useSectionState } from "./use-section-state";
export type { SectionStatus, SectionState } from "./use-section-state";
