"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  SectionShell,
  useSectionState,
} from "@/components/landings/edit/section";
import { Field } from "./field";
import { useBuilderApi } from "@/lib/builder/api-base";

/* =============================================================================
 * SEO — the section that was "Coming Soon" while its columns shipped (LB.6).
 *
 * `seoTitle` and `seoDescription` have been READ by the public page's
 * generateMetadata since the platform port, with no writer anywhere — the
 * exact written-by-nothing shape this project keeps cataloguing, inverted
 * (BUILDER_AUDIT M-01). The save goes through the general route, which owns
 * the page's scalar columns.
 *
 * The length hints are guidance, not limits: search engines TRUNCATE rather
 * than reject, so the counter warns past the display budget and the API
 * enforces only the hard storage bound.
 * ========================================================================== */

export interface SeoValues {
  seoTitle: string;
  seoDescription: string;
}

const TITLE_BUDGET = 60;
const DESCRIPTION_BUDGET = 160;

export function SeoSection({
  landingId,
  pageTitle,
  initialValues,
}: {
  landingId: string;
  /** The page's own title — shown as what search results fall back to. */
  pageTitle: string;
  initialValues: SeoValues;
}) {
  const api = useBuilderApi();
  const [values, setValues] = React.useState<SeoValues>(initialValues);

  const section = useSectionState({
    save: async () => {
      const res = await fetch(api(`/landings/${landingId}/general`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seoTitle: values.seoTitle.trim() || null,
          seoDescription: values.seoDescription.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Save failed");
    },
  });

  const update = (patch: Partial<SeoValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    section.markDirty();
  };

  const counter = (length: number, budget: number) =>
    length > budget ? `${length}/${budget} — search engines will truncate` : `${length}/${budget}`;

  return (
    <SectionShell
      id="seo"
      title="SEO"
      description="Search and social meta tags."
      icon={Search}
      state={section.state}
      onSave={section.save}
      onCancel={section.reset}
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Search title"
          htmlFor="seo-title"
          hint={counter(values.seoTitle.length, TITLE_BUDGET)}
        >
          <Input
            id="seo-title"
            value={values.seoTitle}
            onChange={(e) => update({ seoTitle: e.target.value })}
            maxLength={200}
            placeholder={pageTitle}
            dir="auto"
          />
        </Field>
        <Field
          label="Search description"
          htmlFor="seo-description"
          hint={counter(values.seoDescription.length, DESCRIPTION_BUDGET)}
        >
          <Textarea
            id="seo-description"
            value={values.seoDescription}
            onChange={(e) => update({ seoDescription: e.target.value })}
            maxLength={500}
            rows={3}
            placeholder="What a customer sees under the title in search results and link previews."
            dir="auto"
          />
        </Field>

        {/* The result, as a search engine would draw it — a preview is what
            makes the budget hints concrete. */}
        <div className="rounded-lg border bg-muted/20 p-3 text-start" dir="auto">
          <p className="truncate text-sm font-medium text-primary">
            {values.seoTitle.trim() || pageTitle}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {values.seoDescription.trim() || "Add a description so search results and shared links say more than the title."}
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          The social share image is the page&apos;s hero image, set in Images &amp; Media.
        </p>
      </div>
    </SectionShell>
  );
}
