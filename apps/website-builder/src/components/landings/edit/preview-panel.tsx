"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { PreviewDeviceToggle, type PreviewDevice } from "./preview-device-toggle";
import { PreviewContent } from "./preview-content";
import type { PreviewState } from "@/types/preview";

// Sticky right-column preview panel. Owns only the device toggle state.
// Reads everything else from the single preview object owned by the parent.
//
// The footer used to hold two permanently `disabled` buttons — "Refresh" and
// "Open" — which is exactly the shape PM.6 exists to prevent: a control that
// LOOKS like a capability and never does anything reads as a broken product.
// The preview is live state, so "Refresh" had nothing to refresh; "Open" is
// real, but only once the page is published, so it renders only then.
export function PreviewPanel({
  preview,
  publicPath,
  isPublished,
}: {
  preview: PreviewState;
  /** The page's public path on this platform, e.g. `/acme/winter-jacket`. */
  publicPath: string;
  isPublished: boolean;
}) {
  const t = useTranslations();
  const [device, setDevice] = React.useState<PreviewDevice>("desktop");

  return (
    <aside className="lg:sticky lg:top-32 lg:self-start">
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("builder.editor.preview")}</h2>
          <PreviewDeviceToggle value={device} onChange={setDevice} />
        </div>

        <PreviewContent device={device} preview={preview} />

        {isPublished && (
          <Button variant="outline" size="sm" asChild>
            <a href={publicPath} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              {t("builder.editor.openLive")}
            </a>
          </Button>
        )}
      </div>
    </aside>
  );
}
