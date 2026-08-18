"use client";

import * as React from "react";
import { Activity, Eye, Star, HelpCircle, Sparkles, MousePointerClick, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import {
  SectionShell,
  useSectionState,
  refuseIfFailed,
} from "@/components/landings/edit/section";
import type { DisplayPreviewValues } from "@/types/preview";
import { useBuilderApi } from "@/lib/builder/api-base";

/* The Display section — CAPABILITY_AUDIT B2.
 *
 * These five LandingSetting toggles have been stored and (since LB.12)
 * honoured by the template, but no control ever reached a merchant. The save
 * goes through the order-form route, which has accepted exactly these
 * booleans since the port — the route was the half that existed.
 *
 * The WhatsApp toggle names its dependency instead of failing silently: the
 * button renders only when Settings → Store also has a WhatsApp number. */

/* The first three name the SECTIONS they show, so they reuse those sections'
 * own keys — a toggle that said "Benefits" while the section above it said
 * something else would be describing two things. */
const TOGGLES = [
  {
    key: "showFeatures" as const,
    icon: Sparkles,
    titleKey: "builder.editor.benefits",
    descriptionKey: "builder.editor.displayBenefitsDesc",
  },
  {
    key: "showReviews" as const,
    icon: Star,
    titleKey: "builder.editor.reviews",
    descriptionKey: "builder.editor.displayReviewsDesc",
  },
  {
    key: "showFAQ" as const,
    icon: HelpCircle,
    titleKey: "builder.editor.faq",
    descriptionKey: "builder.editor.displayFaqDesc",
  },
  {
    key: "stickyBuyButton" as const,
    icon: MousePointerClick,
    titleKey: "builder.editor.stickyBuyButton",
    descriptionKey: "builder.editor.stickyBuyButtonDesc",
  },
  {
    key: "floatingWhatsapp" as const,
    icon: MessageCircle,
    titleKey: "builder.editor.floatingWhatsapp",
    descriptionKey: "builder.editor.floatingWhatsappDesc",
  },
  /* BH.1 — not a visual toggle like its five neighbours, but it IS a
   * LandingSetting flag saved by the same route, and "what this page does"
   * is what this section lists. Opt-in per page, default off (user
   * decision, §BH). */
  {
    key: "behaviorTracking" as const,
    icon: Activity,
    titleKey: "builder.editor.behaviorTracking",
    descriptionKey: "builder.editor.behaviorTrackingDesc",
  },
];

export function DisplaySection({
  landingId,
  initialValues,
  onPreviewChange,
}: {
  landingId: string;
  initialValues: DisplayPreviewValues;
  onPreviewChange: (values: DisplayPreviewValues) => void;
}) {
  const api = useBuilderApi();
  const t = useTranslations();
  const [values, setValues] = React.useState<DisplayPreviewValues>(initialValues);

  const section = useSectionState({
    save: async () => {
      const res = await fetch(api(`/landings/${landingId}/order-form`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      refuseIfFailed(json);
    },
  });

  React.useEffect(() => {
    onPreviewChange(values);
  }, [values, onPreviewChange]);

  const toggle = (key: keyof DisplayPreviewValues) => {
    setValues((prev) => ({ ...prev, [key]: !prev[key] }));
    section.markDirty();
  };

  const handleCancel = () => {
    setValues(initialValues);
    section.reset();
  };

  return (
    <SectionShell
      id="display"
      title={t("builder.editor.display")}
      description={t("builder.editor.displayDesc")}
      icon={Eye}
      state={section.state}
      onSave={section.save}
      onCancel={handleCancel}
    >
      <div className="flex flex-col gap-3">
        {/* The parameter was named `t`, which now shadows the translator
            inside the very block that has to call it. */}
        {TOGGLES.map((item) => {
          const checked = values[item.key];
          const Icon = item.icon;
          return (
            <label
              key={item.key}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                checked ? "border-primary/40 bg-primary/5" : "bg-muted/20 hover:bg-muted/40",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(item.key)}
                className="mt-1 size-4 accent-primary"
              />
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  checked ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{t(item.titleKey)}</span>
                <span className="text-[11px] text-muted-foreground">
                  {t(item.descriptionKey)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </SectionShell>
  );
}
