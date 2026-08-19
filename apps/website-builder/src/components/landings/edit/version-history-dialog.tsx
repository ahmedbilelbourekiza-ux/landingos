"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { History, Loader2, RotateCcw, TriangleAlert } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBuilderApi } from "@/lib/builder/api-base";

/* =============================================================================
 * LB.14b — the way back, as a screen.
 *
 * A version is taken before the first edit of each sitting, so this list reads
 * as "how the page looked when you sat down on Tuesday" rather than as a save
 * log. That is the whole reason the trigger is session-start: a list with an
 * entry per section save would have eleven rows for one afternoon and none of
 * them would mean anything.
 *
 * THE CONFIRMATION IS NOT CEREMONY. Restoring lands the page as a DRAFT
 * (decision 3), which for a live page means it leaves the storefront until it
 * is published again — a real, visible consequence that a merchant must not
 * discover afterwards. The dialog says it in those words, and says the other
 * thing they will wonder about in the same breath: orders already taken keep
 * the prices they were taken at.
 * ========================================================================== */

interface VersionRow {
  id: string;
  reason: string;
  actorName: string | null;
  createdAt: string;
}

export function VersionHistoryDialog({
  open,
  onOpenChange,
  landingId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  landingId: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const api = useBuilderApi();

  const [state, setState] = React.useState<"loading" | "ready" | "failed">("loading");
  const [versions, setVersions] = React.useState<VersionRow[]>([]);
  const [chosen, setChosen] = React.useState<VersionRow | null>(null);
  const [restoring, setRestoring] = React.useState(false);

  const load = React.useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(api(`/landings/${landingId}/versions`));
      const json = await res.json();
      if (!json.success) {
        setState("failed");
        return;
      }
      setVersions(json.data.versions ?? []);
      setState("ready");
    } catch {
      setState("failed");
    }
  }, [api, landingId]);

  // Loaded when the dialog opens, not on mount: most editing sessions never
  // ask for history, and a page that is never opened here should cost nothing.
  React.useEffect(() => {
    if (open) {
      setChosen(null);
      load();
    }
  }, [open, load]);

  const formatWhen = React.useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(iso)),
    [locale],
  );

  const handleRestore = async () => {
    if (!chosen) return;
    setRestoring(true);
    try {
      const res = await fetch(api(`/landings/${landingId}/versions/${chosen.id}/restore`), {
        method: "POST",
      });
      const json = await res.json();
      if (!json.success) {
        setRestoring(false);
        setState("failed");
        return;
      }
      /* A hard reload, deliberately. The restore rewrote the page and all seven
         of its owned relations on the server, and this editor holds that state
         across a dozen section components that seeded themselves from props at
         mount. `router.refresh()` re-renders the server component but does not
         re-seed that state, so the merchant would be looking at the OLD values
         over the restored row — the exact confusion this feature exists to
         end. Restoring is a rare, deliberate act; paying a page load for it is
         the right trade. */
      window.location.reload();
    } catch {
      setRestoring(false);
      setState("failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={restoring ? () => {} : onOpenChange}>
      <DialogContent className="max-w-lg">
        {chosen ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <TriangleAlert className="size-5 text-amber-600 dark:text-amber-500" />
                {t("builder.editor.historyConfirmTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("builder.editor.historyConfirmBody", { when: formatWhen(chosen.createdAt) })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="ghost" onClick={() => setChosen(null)} disabled={restoring}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleRestore} disabled={restoring}>
                {restoring && <Loader2 className="size-4 animate-spin" />}
                {restoring
                  ? t("builder.editor.historyRestoring")
                  : t("builder.editor.historyConfirm")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <History className="size-5" />
                {t("builder.editor.history")}
              </DialogTitle>
              <DialogDescription>{t("builder.editor.historyDesc")}</DialogDescription>
            </DialogHeader>

            <div className="max-h-80 overflow-y-auto">
              {state === "loading" && (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t("common.loading")}
                </div>
              )}

              {state === "failed" && (
                <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
                  {t("builder.editor.historyFailed")}
                  <Button variant="outline" size="sm" onClick={load}>
                    {t("common.retry")}
                  </Button>
                </div>
              )}

              {state === "ready" && versions.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t("builder.editor.historyEmpty")}
                </p>
              )}

              {state === "ready" && versions.length > 0 && (
                <ul className="divide-y">
                  {versions.map((version) => (
                    <li
                      key={version.id}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {formatWhen(version.createdAt)}
                        </p>
                        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="border-transparent bg-muted">
                            {version.reason === "restore"
                              ? t("builder.editor.historyReasonRestore")
                              : t("builder.editor.historyReasonEdit")}
                          </Badge>
                          {version.actorName && (
                            <span className="truncate">
                              {t("builder.editor.historyBy", { name: version.actorName })}
                            </span>
                          )}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => setChosen(version)}
                      >
                        <RotateCcw className="size-4 rtl:-scale-x-100" />
                        <span className="hidden sm:inline">
                          {t("builder.editor.historyRestore")}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {t("common.close")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
