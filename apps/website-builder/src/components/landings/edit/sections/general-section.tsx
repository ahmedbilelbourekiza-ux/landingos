"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Settings2, Check, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { slugify } from "@/lib/landing/create";
import {
  SectionShell,
  useSectionState,
  refuseIfFailed,
} from "@/components/landings/edit/section";
import { Field } from "./field";
import { useBuilderApi } from "@/lib/builder/api-base";
import { actionErrors, FALLBACK } from "@/lib/console/action-errors";

export interface GeneralPreviewValues {
  title: string;
  description: string;
  buttonText: string;
  announcement: string;
  categoryId: string | null;
  themeId: string | null;
}

/* LB.13 — the schema is BUILT, not declared.
 *
 * A zod message is a sentence a merchant reads, so it has to come from the
 * catalogue like every other one. This was a module constant, which is
 * evaluated before any component exists and therefore before there is a `t`
 * to call; building it from `t` inside the component is what lets the refusal
 * arrive in the reader's language. Memoised on `t`, so the resolver identity
 * stays stable across renders and react-hook-form is not handed a new one
 * every time. */
function buildGeneralSchema(t: (key: string) => string) {
  return z.object({
    title: z
      .string()
      .min(2, t("builder.editor.titleMin"))
      .max(120, t("builder.editor.titleMax")),
    slug: z
      .string()
      .min(2, t("builder.editor.slugMin"))
      .regex(/^[a-z0-9-]+$/, t("builder.editor.slugCharset")),
    description: z
      .string()
      .max(300, t("builder.editor.descriptionMax"))
      .optional()
      .or(z.literal("")),
    buttonText: z.string().min(1, t("builder.editor.ctaRequired")),
    announcement: z.string().optional().or(z.literal("")),
    categoryId: z.string().nullable().optional(),
    themeId: z.string().nullable().optional(),
  });
}

type GeneralFormValues = z.infer<ReturnType<typeof buildGeneralSchema>>;

export function GeneralSection({
  landingId,
  initialValues,
  onPreviewChange,
  heroUrl,
}: {
  landingId: string;
  initialValues: GeneralPreviewValues;
  onPreviewChange: (values: GeneralPreviewValues) => void;
  /**
   * LB.22 — the page's hero image, to build a theme from.
   *
   * Passed down rather than read here: the hero belongs to the Images
   * section's slice of the preview, and the workspace already holds all of
   * them. A second fetch for something the page is holding would be a second
   * answer to one question — and it would go stale the moment the merchant
   * changed the image without saving.
   */
  heroUrl?: string | null;
}) {
  // Where this editor sends its requests. The legacy dashboard and the
  // console mount the same components against different bases.
  const api = useBuilderApi();
  const t = useTranslations();
  const section = useSectionState({
    save: async () => {
      const values = form.getValues();
      const res = await fetch(api(`/landings/${landingId}/general`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          slug: values.slug,
          description: values.description || null,
          ctaButtonText: values.buttonText,
          announcement: values.announcement || null,
          categoryId: values.categoryId || null,
          themeId: values.themeId || null,
        }),
      });
      const json = await res.json();
      refuseIfFailed(json);
    },
  });

  const schema = React.useMemo(() => buildGeneralSchema(t), [t]);
  const form = useForm<GeneralFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
    mode: "onBlur",
  });

  const { register, control, setValue, trigger, reset } = form;

  const slugTouched = React.useRef(false);
  const titleValue = useWatch({ control, name: "title" });

  React.useEffect(() => {
    if (slugTouched.current) return;
    setValue("slug", slugify(titleValue ?? ""), { shouldValidate: false });
  }, [titleValue, setValue]);

  React.useEffect(() => {
    const sub = form.watch(() => section.markDirty());
    return () => sub.unsubscribe();
  }, [form, section]);

  const descriptionValue = useWatch({ control, name: "description" });
  const buttonValue = useWatch({ control, name: "buttonText" });
  const announcementValue = useWatch({ control, name: "announcement" });

  React.useEffect(() => {
    onPreviewChange({
      title: titleValue ?? "",
      description: descriptionValue ?? "",
      buttonText: buttonValue ?? "",
      announcement: announcementValue ?? "",
    });
  }, [titleValue, descriptionValue, buttonValue, announcementValue, onPreviewChange]);

  const handleSave = async () => {
    const valid = await trigger();
    if (!valid) return;
    await section.save();
  };

  const handleCancel = () => {
    reset(initialValues);
    slugTouched.current = false;
    section.reset();
  };

  const onSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    slugTouched.current = true;
    setValue("slug", e.target.value, { shouldValidate: true });
  };

  const slugValue = useWatch({ control, name: "slug" });
  const categoryIdValue = useWatch({ control, name: "categoryId" });
  const themeIdValue = useWatch({ control, name: "themeId" });
  const descLength = (descriptionValue ?? "").length;

  /* LB.22 — generating a theme from the hero image.
   *
   * Its own small state rather than `useApiAction`: this is not a section
   * save, it creates a sibling resource, and it must NOT mark the section
   * dirty — a merchant who generates a theme and navigates away has not
   * edited the page. On success the new theme is prepended and selected, so
   * the result is visible without a reload; `router.refresh()` would rebuild
   * the whole workspace and lose every other section's unsaved state. */
  const [generating, setGenerating] = React.useState(false);
  const [themeError, setThemeError] = React.useState<string | null>(null);
  const errorMessages = React.useMemo(() => actionErrors(t), [t]);

  const generateTheme = async () => {
    if (!heroUrl) return;
    setGenerating(true);
    setThemeError(null);
    try {
      const res = await fetch(api("/themes/from-image"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: heroUrl,
          // The page's own title, so the theme is findable later by the thing
          // it was built from. Falls back rather than sending an empty name,
          // which the route would refuse.
          name: (titleValue ?? "").trim() || t("builder.editor.previewUntitled"),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setThemeError(errorMessages[String(json.error?.code ?? "")] ?? errorMessages[FALLBACK]);
        return;
      }
      setThemes((prev) => [json.data, ...prev]);
      setValue("themeId", json.data.id, { shouldValidate: true });
    } catch {
      setThemeError(errorMessages.NETWORK ?? errorMessages[FALLBACK]);
    } finally {
      setGenerating(false);
    }
  };

  const [categories, setCategories] = React.useState<{ id: string; name: string }[]>([]);
  const [themes, setThemes] = React.useState<{ id: string; name: string; primary: string; accent: string; background: string }[]>([]);
  React.useEffect(() => {
    // Platform envelope: the list lives at data.items, not data (LB.2 — the
    // editor crashed on load reading it as the array, BUILDER_AUDIT B-05).
    fetch(api("/categories")).then((r) => r.json()).then((json) => {
      if (json.success && Array.isArray(json.data?.items))
        setCategories(json.data.items.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
    });
    fetch(api("/themes")).then((r) => r.json()).then((json) => {
      if (json.success && Array.isArray(json.data?.items)) setThemes(json.data.items);
    });
  }, []);

  return (
    <SectionShell
      id="general"
      // The same keys the section registry names, so the card the workspace
      // draws and the shell this section draws cannot disagree.
      title={t("builder.editor.general")}
      description={t("builder.editor.generalDesc")}
      icon={Settings2}
      state={section.state}
      onSave={handleSave}
      onCancel={handleCancel}
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
        <Field label={t("builder.editor.titleLabel")} error={form.formState.errors.title?.message} htmlFor="title" required>
          <Input id="title" dir="auto" placeholder={t("builder.editor.titlePlaceholder")} aria-invalid={!!form.formState.errors.title} {...register("title")} />
        </Field>

        <Field label={t("builder.editor.slugLabel")} error={form.formState.errors.slug?.message} htmlFor="slug" required hint={t("builder.editor.slugHint")}>
          <div className="flex items-stretch overflow-hidden rounded-md border focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
            <span className="grid select-none place-items-center bg-muted px-3 text-sm text-muted-foreground">/</span>
            {/* `dir="ltr"` for the same reason the categories screen sets it:
                the API's charset is latin, and an address typed inside an RTL
                paragraph reorders on screen while the stored value does not. */}
            <Input id="slug" dir="ltr" className="rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0" placeholder="lumiere-vitamin-c-serum" aria-invalid={!!form.formState.errors.slug} value={slugValue ?? ""} onChange={onSlugChange} />
          </div>
        </Field>

        <Field label={t("builder.editor.descriptionLabel")} error={form.formState.errors.description?.message} htmlFor="description" hint={`${descLength}/300`}>
          <Textarea id="description" dir="auto" rows={3} maxLength={300} placeholder={t("builder.editor.descriptionPlaceholder")} {...register("description")} />
        </Field>

        {/* `builder.pages.colCategory` rather than a second wording — the
            pages list already names this concept for the same rows. */}
        <Field label={t("builder.pages.colCategory")} htmlFor="categoryId" hint={t("common.optional")}>
          <select
            id="categoryId"
            value={categoryIdValue ?? ""}
            onChange={(e) => setValue("categoryId", e.target.value || null, { shouldValidate: true })}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">{t("builder.editor.uncategorized")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>

        {/* Theme selector */}
        <Field label={t("builder.editor.themeLabel")} htmlFor="themeId" hint={t("builder.editor.themeHint")}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {/* The callback parameter was named `t`, which now shadows the
                translator. Renamed rather than aliased — a swatch is a theme. */}
            {themes.map((theme) => {
              const isSelected = themeIdValue === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => setValue("themeId", theme.id, { shouldValidate: true })}
                  className={cn(
                    "relative flex flex-col gap-2 rounded-xl border p-3 text-start transition-all",
                    isSelected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40",
                  )}
                >
                  {/* Color palette */}
                  <div className="flex gap-1">
                    <span className="size-5 rounded-full border" style={{ backgroundColor: theme.primary }} />
                    <span className="size-5 rounded-full border" style={{ backgroundColor: theme.accent }} />
                    <span className="size-5 rounded-full border" style={{ backgroundColor: theme.background }} />
                  </div>
                  <span className="truncate text-xs font-medium">{theme.name}</span>
                  {/* Sample button. The SAME key the templates screen puts on
                      its identical swatch — the two screens draw the same
                      thing and must say the same thing about it. */}
                  <span
                    className="rounded-md px-2 py-1 text-center text-[10px] font-bold text-white"
                    style={{ backgroundColor: theme.primary }}
                  >
                    {t("builder.templates.buttonSample")}
                  </span>
                  {isSelected && (
                    // `end-2` rather than `right-2`: the tick belongs on the
                    // corner the reader's own text ends at.
                    <span className="absolute end-2 top-2 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* LB.22 — a theme taken from the product's own photograph.
           *
           * Here rather than on the Templates screen because this is where a
           * theme is CHOSEN, and the thing it is built from — the hero image —
           * belongs to this page. It saves a real `LandingTheme` row, so the
           * result appears in the grid above like any other and can be picked,
           * renamed or deleted afterwards.
           *
           * Disabled, with the reason said, when there is no hero yet: a
           * control that fails on press and explains afterwards is the shape
           * PM.6 exists to prevent. */}
          <div className="mt-3 flex flex-col gap-1">
            <button
              type="button"
              disabled={!heroUrl || generating}
              onClick={generateTheme}
              className="ui-btn ui-btn-default tap self-start"
              data-testid="theme-from-image"
            >
              <Wand2 className="size-4" aria-hidden />
              {generating
                ? t("builder.editor.themeGenerating")
                : t("builder.editor.themeFromImage")}
            </button>
            <span className="text-xs text-muted-foreground">
              {heroUrl
                ? t("builder.editor.themeFromImageHint")
                : t("builder.editor.themeFromImageNeedsHero")}
            </span>
            {themeError && (
              <p className="text-xs text-destructive" role="alert">
                {themeError}
              </p>
            )}
          </div>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("builder.editor.ctaLabel")} error={form.formState.errors.buttonText?.message} htmlFor="buttonText" required>
            {/* The placeholder is a SUGGESTION for the merchant's own
                storefront copy, so it follows the console's locale rather than
                staying hardcoded Arabic. The field is `dir="auto"`, so
                whatever they actually type still reads correctly. */}
            <Input id="buttonText" dir="auto" placeholder={t("builder.editor.ctaPlaceholder")} aria-invalid={!!form.formState.errors.buttonText} {...register("buttonText")} />
          </Field>
          <Field label={t("builder.editor.announcementLabel")} error={form.formState.errors.announcement?.message} htmlFor="announcement" hint={t("common.optional")}>
            <Input id="announcement" dir="auto" placeholder={t("builder.editor.announcementPlaceholder")} {...register("announcement")} />
          </Field>
        </div>
      </form>
    </SectionShell>
  );
}
