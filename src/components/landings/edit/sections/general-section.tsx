"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Settings2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { slugify } from "@/lib/landing/create";
import {
  SectionShell,
  useSectionState,
} from "@/components/landings/edit/section";
import { Field } from "./field";

export interface GeneralPreviewValues {
  title: string;
  description: string;
  buttonText: string;
  announcement: string;
}

const generalSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters").max(120, "Title must be at most 120 characters"),
  slug: z.string().min(2, "Slug must be at least 2 characters").regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
  description: z.string().max(300, "Description must be at most 300 characters").optional().or(z.literal("")),
  buttonText: z.string().min(1, "Button text is required"),
  announcement: z.string().optional().or(z.literal("")),
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
  const section = useSectionState({
    save: async () => {
      const values = form.getValues();
      const res = await fetch(`/api/landings/${landingId}/general`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          slug: values.slug,
          description: values.description || null,
          ctaButtonText: values.buttonText,
          announcement: values.announcement || null,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Save failed");
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
