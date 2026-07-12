"use client";

import * as React from "react";
import { RefreshCw, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PreviewDeviceToggle, type PreviewDevice } from "./preview-device-toggle";
import { PreviewContent } from "./preview-content";
import type { GeneralPreviewValues } from "./sections/general-section";

// Sticky right-column preview panel. Owns one piece of state — the selected
// device — which swaps the preview frame size. The preview values come from
// the parent (lifted state from the General section). Refresh and Open are
// disabled until live iframe preview lands.
export function PreviewPanel({
  values,
}: {
  values: GeneralPreviewValues;
}) {
  const [device, setDevice] = React.useState<PreviewDevice>("desktop");

  return (
    <aside className="lg:sticky lg:top-32 lg:self-start">
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Preview</h2>
          <PreviewDeviceToggle value={device} onChange={setDevice} />
        </div>

        <PreviewContent device={device} values={values} />

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="flex-1" disabled>
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" className="flex-1" disabled>
            <ExternalLink className="size-3.5" />
            Open
          </Button>
        </div>
      </div>
    </aside>
  );
}
