"use client";

import * as React from "react";

import type { LandingListItem } from "@/lib/landing/mock-landings";
import { mockGeneralData } from "@/lib/landing/mock-landings";
import { EditWorkspaceHeader } from "./edit-workspace-header";
import { EditSections } from "./edit-sections";
import { PreviewPanel } from "./preview-panel";
import type { GeneralPreviewValues } from "./sections/general-section";

// Client wrapper for the edit workspace. The page (server component) resolves
// params and mock data, then renders this. The workspace holds the lifted
// preview state — the 4 display values the General section and the Preview
// panel both need. This is the minimum state lifted to the nearest common
// ancestor; no global store.
export function EditWorkspace({ landing }: { landing: LandingListItem }) {
  const [previewValues, setPreviewValues] = React.useState<GeneralPreviewValues>({
    title: mockGeneralData.title,
    description: mockGeneralData.description,
    buttonText: mockGeneralData.buttonText,
    announcement: mockGeneralData.announcement,
  });

  // Memoized so the General section's useEffect dependency stays stable —
  // without this, the effect would refire on every parent render.
  const handleValuesChange = React.useCallback(
    (values: GeneralPreviewValues) => setPreviewValues(values),
    [],
  );

  return (
    <div className="flex flex-col">
      <EditWorkspaceHeader landing={landing} />

      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:gap-8">
          <EditSections onGeneralValuesChange={handleValuesChange} />
          <div className="hidden lg:block">
            <PreviewPanel values={previewValues} />
          </div>
        </div>
      </div>
    </div>
  );
}
