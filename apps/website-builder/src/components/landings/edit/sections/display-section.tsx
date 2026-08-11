"use client";

import * as React from "react";
import { Eye, Star, HelpCircle, Sparkles, MousePointerClick, MessageCircle } from "lucide-react";

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

const TOGGLES = [
  {
    key: "showFeatures" as const,
    icon: Sparkles,
    title: "Benefits",
    description: "The trust-badge strip under the price.",
  },
  {
    key: "showReviews" as const,
    icon: Star,
    title: "Reviews",
    description: "Customer testimonials, when any exist.",
  },
  {
    key: "showFAQ" as const,
    icon: HelpCircle,
    title: "FAQ",
    description: "The questions accordion, when any exist.",
  },
  {
    key: "stickyBuyButton" as const,
    icon: MousePointerClick,
    title: "Sticky buy button",
    description: "The order bar that follows the customer as they scroll.",
  },
  {
    key: "floatingWhatsapp" as const,
    icon: MessageCircle,
    title: "Floating WhatsApp",
    description: "A chat button — needs a WhatsApp number in Settings → Store.",
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
      title="Display"
      description="Which sections your page shows."
      icon={Eye}
      state={section.state}
      onSave={section.save}
      onCancel={handleCancel}
    >
      <div className="flex flex-col gap-3">
        {TOGGLES.map((t) => {
          const checked = values[t.key];
          const Icon = t.icon;
          return (
            <label
              key={t.key}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                checked ? "border-primary/40 bg-primary/5" : "bg-muted/20 hover:bg-muted/40",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(t.key)}
                className="mt-1 size-4 accent-primary"
              />
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  checked ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{t.title}</span>
                <span className="text-[11px] text-muted-foreground">{t.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </SectionShell>
  );
}
