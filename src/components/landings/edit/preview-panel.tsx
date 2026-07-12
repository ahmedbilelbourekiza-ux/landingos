"use client";

import * as React from "react";
import { RefreshCw, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PreviewDeviceToggle, type PreviewDevice } from "./preview-device-toggle";
import { PreviewPlaceholder } from "./preview-placeholder";

// Sticky right-column preview panel. Owns only one piece of state — the
// selected device — which swaps the placeholder frame. The Refresh and
// Open buttons are disabled today; they activate when live preview lands.
// The panel is sticky so it stays in view while scrolling the section cards
// on the left, mimicking the Framer/Webflow editor feel.
export function PreviewPanel() {
  const [device, setDevice] = React.useState<PreviewDevice>("desktop");

  return (
    <aside className="lg:sticky lg:top-32 lg:self-start">
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Preview</h2>
          <PreviewDeviceToggle value={device} onChange={setDevice} />
        </div>

        <PreviewPlaceholder device={device} />

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
