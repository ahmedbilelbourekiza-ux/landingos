"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Settings2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/landing/create";
import { mockLandings, mockGeneralData, currentEditSlug } from "@/lib/landing/mock-landings";
import {
  SectionShell,
  useSectionState,
} from "@/components/landings/edit/section";

// The 4 display values the preview panel needs. Lifted to the parent via
// onValuesChange — no global store, just the minimum state lifted to the
// nearest common ancestor (EditWorkspace).
export interface GeneralPreviewValues {
  title: string;
  description: string;
  buttonText: string;
  announcement: string;
}

// Slug uniqueness check — mocks the server query. Excludes the current
// landing's own slug so the user can keep it without a false error.
const otherSlugs = new Set(
  mockLandings.map((l) => l.slug).filter((s) => s !== currentEditSlug),
);

const generalSchema = z.object({
  title: z
    .string()
    .min(2, "Title must be at least 2 characters")
    .max(120, "Title must be at most 120 characters"),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only")
    .refine((v) => !otherSlugs.has(v), "This slug is already taken"),
  description: z
    .string()
    .max(300, "Description must be at most 300 characters")
    .optional()
    .or(z.literal("")),
  buttonText: z.string().min(1, "Button text is required"),
  announcement: z.string().optional().or(z.literal("")),
});

type GeneralFormValues = z.infer<typeof generalSchema>;

export function GeneralSection({
  onValuesChange,
}: {
  onValuesChange: (values: GeneralPreviewValues) => void;
}) {
  const section = useSectionState();

  const form = useForm<GeneralFormValues>({
    resolver: zodResolver(generalSchema),
    defaultValues: mockGeneralData,
    mode: "onBlur",
  });

  const { register, control, setValue, trigger, reset } = form;

  // --- Slug auto-generation ---
  // Same pattern as the create form: auto-generate from title until the user
  // manually edits the slug field, then stop overriding.
  const slugTouched = React.useRef(false);
  const titleValue = useWatch({ control, name: "title" });

  React.useEffect(() => {
    if (slugTouched.current) return;
    setValue("slug", slugify(titleValue ?? ""), { shouldValidate: false });
  }, [titleValue, setValue]);

  // --- Mark dirty on any field change ---
  React.useEffect(() => {
    const sub = form.watch(() => section.markDirty());
    return () => sub.unsubscribe();
  }, [form, section]);

  // --- Lift preview values to parent ---
  // Individual useWatch calls so the effect only fires when a primitive
  // actually changes — not on every render.
  const descriptionValue = useWatch({ control, name: "description" });
  const buttonValue = useWatch({ control, name: "buttonText" });
  const announcementValue = useWatch({ control, name: "announcement" });

  React.useEffect(() => {
    onValuesChange({
      title: titleValue ?? "",
      description: descriptionValue ?? "",
      buttonText: buttonValue ?? "",
      announcement: announcementValue ?? "",
    });
  }, [
    titleValue,
    descriptionValue,
    buttonValue,
    announcementValue,
    onValuesChange,
  ]);

  // --- Save / Cancel ---
  const handleSave = async () => {
    const valid = await trigger();
    if (!valid) return;
    await section.save();
  };

  const handleCancel = () => {
    reset(mockGeneralData);
    slugTouched.current = false;
    section.reset();
  };

  const onSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    slugTouched.current = true;
    setValue("slug", e.target.value, { shouldValidate: true });
  };

  const slugValue = useWatch({ control, name: "slug" });
  const descLength = (descriptionValue ?? "").length;

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
          <Input
            id="title"
            placeholder="e.g. Lumière Vitamin C Serum"
            aria-invalid={!!form.formState.errors.title}
            {...register("title")}
          />
        </Field>

        <Field label="Slug" error={form.formState.errors.slug?.message} htmlFor="slug" required hint="The URL of your landing page">
          <div className="flex items-stretch overflow-hidden rounded-md border focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
            <span className="grid select-none place-items-center bg-muted px-3 text-sm text-muted-foreground">
              /
            </span>
            <Input
              id="slug"
              className="rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              placeholder="lumiere-vitamin-c-serum"
              aria-invalid={!!form.formState.errors.slug}
              value={slugValue ?? ""}
              onChange={onSlugChange}
            />
          </div>
        </Field>

        <Field
          label="Short description"
          error={form.formState.errors.description?.message}
          htmlFor="description"
          hint={`${descLength}/300`}
        >
          <Textarea
            id="description"
            rows={3}
            maxLength={300}
            placeholder="A short product description shown on the landing page."
            {...register("description")}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="CTA button text" error={form.formState.errors.buttonText?.message} htmlFor="buttonText" required>
            <Input
              id="buttonText"
              dir="auto"
              placeholder="اشتر الآن"
              aria-invalid={!!form.formState.errors.buttonText}
              {...register("buttonText")}
            />
          </Field>

          <Field label="Announcement bar" error={form.formState.errors.announcement?.message} htmlFor="announcement" hint="Optional">
            <Input
              id="announcement"
              placeholder="Free delivery nationwide · Cash on Delivery available"
              {...register("announcement")}
            />
          </Field>
        </div>
      </form>
    </SectionShell>
  );
}

function Field({
  label,
  error,
  hint,
  htmlFor,
  required,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </Label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
