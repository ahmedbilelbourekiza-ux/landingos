"use client";

import * as React from "react";
import { Plug } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import {
  SectionShell,
  useSectionState,
  refuseIfFailed,
} from "@/components/landings/edit/section";
import { useBuilderApi } from "@/lib/builder/api-base";

/* =============================================================================
 * Which of the company's pixels fire on THIS page — LB.35b.
 *
 * LB.35 built every part of this except the part a merchant can reach: the
 * column, the PATCH that validates it, and the storefront read path all
 * shipped and were verified in production, while `trackingIntegrationIds`
 * appeared in no component anywhere. The section sitting here rendered a
 * signpost saying tracking is "configured once per company" — true before
 * LB.35, and left in place after it stopped being the whole truth. So the
 * feature existed and the answer to "where do I set it?" was "you cannot".
 *
 * THREE STATES, AND THEY ARE GENUINELY DIFFERENT — which is why the column is
 * nullable rather than defaulted, and why this is a mode switch rather than a
 * list of checkboxes:
 *
 *   null   every active integration the company owns. The default, and what
 *          every page did before the column existed.
 *   [ids]  an explicit subset — the merchant running two ad accounts who
 *          wants this product reported to one of them.
 *   []     none. A merchant who unticks everything means it, and the
 *          storefront honours it rather than falling back to "all".
 *
 * A plain checkbox list could not say all three: "nothing ticked" would have
 * to mean either "all" or "none" and could not mean both. The mode switch
 * makes the difference the merchant's choice instead of a guess.
 *
 * INACTIVE INTEGRATIONS ARE LISTED, not hidden. An inactive row fires nothing
 * today, but a page linked to it stays linked, and hiding it would quietly
 * drop that link the next time this section saved — the page would come back
 * different from how the merchant left it. It is shown, marked, and preserved.
 * ========================================================================== */

export interface TrackingIntegrationOption {
  readonly id: string;
  readonly provider: string;
  readonly label: string;
  readonly publicId: string;
  readonly isActive: boolean;
}

export interface TrackingValues {
  /** The column verbatim: `null` means "all", an array means exactly itself. */
  readonly selected: readonly string[] | null;
}

export function TrackingSection({
  landingId,
  integrations,
  initialValues,
}: {
  landingId: string;
  integrations: readonly TrackingIntegrationOption[];
  initialValues: TrackingValues;
}) {
  const api = useBuilderApi();
  const t = useTranslations();

  const [selected, setSelected] = React.useState<readonly string[] | null>(
    initialValues.selected,
  );

  const section = useSectionState({
    save: async () => {
      const res = await fetch(api(`/landings/${landingId}/general`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // `null` and `[]` are both sent as themselves. The route's schema is
        // `.optional().nullable()`, so absent means "leave alone" and neither
        // of these is absent — that distinction is the whole feature.
        body: JSON.stringify({ trackingIntegrationIds: selected }),
      });
      refuseIfFailed(await res.json());
    },
  });

  const setMode = (mode: "all" | "choose") => {
    // Switching to "choose" starts from what is already firing — every active
    // integration — rather than from nothing. Starting empty would read as
    // "turn everything off", which is the opposite of what picking "choose"
    // means, and one careless save would silently stop a merchant's reporting.
    setSelected(mode === "all" ? null : integrations.filter((i) => i.isActive).map((i) => i.id));
    section.markDirty();
  };

  const toggle = (id: string) => {
    setSelected((current) => {
      const list = current ?? [];
      return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    });
    section.markDirty();
  };

  const choosing = selected !== null;
  const chosen = selected ?? [];

  return (
    <SectionShell
      id="integrations"
      title={t("builder.editor.integrations")}
      description={t("builder.editor.integrationsDesc")}
      icon={Plug}
      state={section.state}
      onSave={section.save}
      onCancel={section.reset}
    >
      <div className="flex flex-col gap-4">
        {integrations.length === 0 ? (
          /* Nothing to choose between. This is the signpost this section used
             to be, kept for exactly the case it was right about: a company
             that has not connected anything yet configures that once, at the
             workspace level, not per page. */
          <div className="rounded-xl border bg-muted/20 p-3">
            <p className="text-sm text-muted-foreground">
              {t("builder.editor.trackingNoneConnected")}
            </p>
            <a
              href="/console/settings/integrations"
              className="mt-2 inline-block text-sm underline"
            >
              {t("builder.editor.integrationsLink")}
            </a>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("builder.editor.trackingModeLabel")}>
              {(["all", "choose"] as const).map((mode) => {
                const active = mode === "choose" ? choosing : !choosing;
                return (
                  <label
                    key={mode}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                      active ? "border-primary/40 bg-primary/5" : "bg-muted/20 hover:bg-muted/40",
                    )}
                  >
                    <input
                      type="radio"
                      name="tracking-mode"
                      data-testid={`tracking-mode-${mode}`}
                      checked={active}
                      onChange={() => setMode(mode)}
                      className="mt-1 size-4 accent-primary"
                    />
                    <span className="flex flex-col gap-0.5">
                      {/* The ternary sits OUTSIDE `t(...)`, not inside it, and
                          that is deliberate rather than stylistic. LB.13's
                          guard masks a direct `t("literal")` and the key-exists
                          scan only reads one, so `t(cond ? a : b)` is invisible
                          to the second check and looks like hardcoded English
                          to the first — it failed exactly that way once. Two
                          literal calls are covered by both. */}
                      <span className="text-sm font-medium">
                        {mode === "all"
                          ? t("builder.editor.trackingAll")
                          : t("builder.editor.trackingChoose")}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {mode === "all"
                          ? t("builder.editor.trackingAllHint")
                          : t("builder.editor.trackingChooseHint")}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            {choosing && (
              <div className="flex flex-col gap-2" data-testid="tracking-choices">
                {integrations.map((integration) => {
                  const checked = chosen.includes(integration.id);
                  return (
                    <label
                      key={integration.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                        checked ? "border-primary/40 bg-primary/5" : "bg-muted/20 hover:bg-muted/40",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(integration.id)}
                        data-testid={`tracking-option-${integration.id}`}
                        className="mt-1 size-4 accent-primary"
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium" dir="auto">
                          {integration.label}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {/* `dir="ltr"` on the id: a pixel id is digits, and
                              an Arabic paragraph would otherwise reorder them
                              — the same money-island rule LB.15 applies. */}
                          {integration.provider}
                          {" · "}
                          <span dir="ltr">{integration.publicId}</span>
                          {!integration.isActive && (
                            <> {" · "}{t("builder.editor.trackingInactive")}</>
                          )}
                        </span>
                      </span>
                    </label>
                  );
                })}

                {chosen.length === 0 && (
                  /* Not an error — it is a legal, honoured state. It is called
                     out because it is the one selection that silently stops a
                     merchant's reporting, and they should see that they chose
                     it rather than discover it in their ad account. */
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="tracking-none-warning"
                  >
                    {t("builder.editor.trackingNoneChosen")}
                  </p>
                )}
              </div>
            )}

            <a
              href="/console/settings/integrations"
              className="inline-block text-sm underline"
            >
              {t("builder.editor.integrationsLink")}
            </a>
          </>
        )}
      </div>
    </SectionShell>
  );
}
