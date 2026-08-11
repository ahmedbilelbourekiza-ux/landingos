"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Settings2, Check } from "lucide-react";

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

export interface GeneralPreviewValues {
  title: string;
  description: string;
  buttonText: string;
  announcement: string;
  categoryId: string | null;
  themeId: string | null;
}

const generalSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters").max(120, "Title must be at most 120 characters"),
  slug: z.string().min(2, "Slug must be at least 2 characters").regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
  description: z.string().max(300, "Description must be at most 300 characters").optional().or(z.literal("")),
  buttonText: z.string().min(1, "Button text is required"),
  announcement: z.string().optional().or(z.literal("")),
  categoryId: z.string().nullable().optional(),
  themeId: z.string().nullable().optional(),
});

type GeneralFormValues = z.infer<typeof generalSchema>;

export function GeneralSection({
  landingId,
  initialValues,
  onPreviewChange,
}: {
  landingId: string;
  initialValues: GeneralPreviewValues;
  onPreviewChange: (values: GeneralPreviewValues) => void;
}) {
  // Where this editor sends its requests. The legacy dashboard and the
  // console mount the same components against different bases.
  const api = useBuilderApi();
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

  const form = useForm<GeneralFormValues>({
    resolver: zodResolver(generalSchema),
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
      title="General"
      description="Title, slug, description, and button text."
      icon={Settings2}
      state={section.state}
      onSave={handleSave}
      onCancel={handleCancel}
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
        <Field label="Landing title" error={form.formState.errors.title?.message} htmlFor="title" required>
          <Input id="title" placeholder="e.g. Lumière Vitamin C Serum" aria-invalid={!!form.formState.errors.title} {...register("title")} />
        </Field>

        <Field label="Slug" error={form.formState.errors.slug?.message} htmlFor="slug" required hint="The URL of your landing page">
          <div className="flex items-stretch overflow-hidden rounded-md border focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
            <span className="grid select-none place-items-center bg-muted px-3 text-sm text-muted-foreground">/</span>
            <Input id="slug" className="rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0" placeholder="lumiere-vitamin-c-serum" aria-invalid={!!form.formState.errors.slug} value={slugValue ?? ""} onChange={onSlugChange} />
          </div>
        </Field>

        <Field label="Short description" error={form.formState.errors.description?.message} htmlFor="description" hint={`${descLength}/300`}>
          <Textarea id="description" rows={3} maxLength={300} placeholder="A short product description shown on the landing page." {...register("description")} />
        </Field>

        <Field label="Category" htmlFor="categoryId" hint="Optional">
          <select
            id="categoryId"
            value={categoryIdValue ?? ""}
            onChange={(e) => setValue("categoryId", e.target.value || null, { shouldValidate: true })}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>

        {/* Theme selector */}
        <Field label="Theme" htmlFor="themeId" hint="Visual identity for this landing page">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {themes.map((t) => {
              const isSelected = themeIdValue === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setValue("themeId", t.id, { shouldValidate: true })}
                  className={cn(
                    "relative flex flex-col gap-2 rounded-xl border p-3 text-left transition-all",
                    isSelected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40",
                  )}
                >
                  {/* Color palette */}
                  <div className="flex gap-1">
                    <span className="size-5 rounded-full border" style={{ backgroundColor: t.primary }} />
                    <span className="size-5 rounded-full border" style={{ backgroundColor: t.accent }} />
                    <span className="size-5 rounded-full border" style={{ backgroundColor: t.background }} />
                  </div>
                  <span className="truncate text-xs font-medium">{t.name}</span>
                  {/* Sample button */}
                  <span
                    className="rounded-md px-2 py-1 text-center text-[10px] font-bold text-white"
                    style={{ backgroundColor: t.primary }}
                  >
                    عرض المنتج
                  </span>
                  {isSelected && (
                    <span className="absolute right-2 top-2 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="CTA button text" error={form.formState.errors.buttonText?.message} htmlFor="buttonText" required>
            <Input id="buttonText" dir="auto" placeholder="اشتر الآن" aria-invalid={!!form.formState.errors.buttonText} {...register("buttonText")} />
          </Field>
          <Field label="Announcement bar" error={form.formState.errors.announcement?.message} htmlFor="announcement" hint="Optional">
            <Input id="announcement" placeholder="Free delivery nationwide · Cash on Delivery available" {...register("announcement")} />
          </Field>
        </div>
      </form>
    </SectionShell>
  );
}
