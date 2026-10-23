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
 * ONE RULE (PX.1): a page reports to the integrations ticked here and to
 * nothing else. LB.35b offered a third mode, "All of your tracking" (a NULL
 * column), and made it the default — which is how one brand's Purchases
 * reached another brand's dataset in a store that runs two. That mode is
 * gone: NULL now reads as nothing ticked, exactly like `[]`, and the
 * storefront and every server event treat both as NONE. The warning below is
 * what keeps "nothing ticked" from being a silent loss of reporting.
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
  /** The column verbatim. `null` (pre-PX.1 rows) is shown as nothing ticked. */
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

  const [selected, setSelected] = React.useState<readonly string[]>(
    initialValues.selected ?? [],
  );

  const section = useSectionState({
    save: async () => {
      const res = await fetch(api(`/landings/${landingId}/general`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Always an array (PX.1): saving turns a legacy NULL into the explicit
        // list the merchant sees, so the column says what the page does.
        body: JSON.stringify({ trackingIntegrationIds: selected }),
      });
      refuseIfFailed(await res.json());
    },
  });

  const toggle = (id: string) => {
    setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
    section.markDirty();
  };

  const chosen = selected;

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
            <p className="text-xs text-muted-foreground" data-testid="tracking-strict-hint">
              {t("builder.editor.trackingStrictHint")}
            </p>

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
                /* Not an error — it is a legal, honoured state. Since PX.1 it
                   is also what every pre-PX.1 page shows until its pixels are
                   ticked, so it wears the warning colour: a merchant must see
                   it here rather than discover it in their ad account. */
                <p
                  className="text-xs font-medium"
                  style={{ color: "var(--warning-fg)" }}
                  data-testid="tracking-none-warning"
                >
                  {t("builder.editor.trackingNoneChosen")}
                </p>
              )}
            </div>

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
