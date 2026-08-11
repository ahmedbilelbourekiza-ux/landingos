"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  SectionShell,
  useSectionState,
  refuseIfFailed,
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
  const t = useTranslations();
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
      refuseIfFailed(json);
    },
  });

  const update = (patch: Partial<SeoValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    section.markDirty();
  };

  // Under budget the hint is two numbers, which need no translation; over it,
  // the warning is a sentence and comes from the catalogue with the numbers
  // interpolated, so the clause can sit wherever the language puts it.
  const counter = (length: number, budget: number) =>
    length > budget
      ? t("builder.editor.seoCounterOver", { length, budget })
      : `${length}/${budget}`;

  return (
    <SectionShell
      id="seo"
      title={t("builder.editor.seo")}
      description={t("builder.editor.seoDesc")}
      icon={Search}
      state={section.state}
      onSave={section.save}
      onCancel={section.reset}
    >
      <div className="flex flex-col gap-4">
        <Field
          label={t("builder.editor.seoTitleLabel")}
          // NOT `seo-title`. SectionShell gives its heading `id={`${id}-title`}`,
          // and this section's id is `seo` — so the input and the <h2> claimed
          // the same id, `document.getElementById` returned the heading, and
          // this label pointed at it instead of at the field. Found by
          // querying the running page, not by reading.
          htmlFor="seo-search-title"
          hint={counter(values.seoTitle.length, TITLE_BUDGET)}
        >
          <Input
            id="seo-search-title"
            value={values.seoTitle}
            onChange={(e) => update({ seoTitle: e.target.value })}
            maxLength={200}
            placeholder={pageTitle}
            dir="auto"
          />
        </Field>
        <Field
          label={t("builder.editor.seoDescriptionLabel")}
          htmlFor="seo-description"
          hint={counter(values.seoDescription.length, DESCRIPTION_BUDGET)}
        >
          <Textarea
            id="seo-description"
            value={values.seoDescription}
            onChange={(e) => update({ seoDescription: e.target.value })}
            maxLength={500}
            rows={3}
            placeholder={t("builder.editor.seoDescriptionPlaceholder")}
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
            {values.seoDescription.trim() || t("builder.editor.seoEmptyPreview")}
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          {t("builder.editor.seoShareImage")}
        </p>
      </div>
    </SectionShell>
  );
}
