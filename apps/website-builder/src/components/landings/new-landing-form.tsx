"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CURRENCIES, slugify } from "@/lib/landing/create";
import type { LandingPageStatus } from "@/types/landing";

// Slug uniqueness is validated server-side during the POST. The client-side
// schema only checks format. oldPrice, when provided, must be greater than
// price (a discount going the wrong way would be a bug, not a feature).
const createSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters"),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
  price: z.coerce.number().positive("Price must be greater than 0"),
  oldPrice: z.coerce
    .number()
    .positive("Old price must be greater than 0")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  currency: z.string().min(1),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
}).superRefine((data, ctx) => {
  if (data.oldPrice !== undefined && data.oldPrice <= data.price) {
    ctx.addIssue({
      path: ["oldPrice"],
      code: z.ZodIssueCode.custom,
      message: "Old price must be higher than the current price",
    });
  }
});

type CreateFormValues = z.infer<typeof createSchema>;

const STATUS_OPTIONS: { value: LandingPageStatus; label: string }[] = [
  { value: "DRAFT", label: "Draft" },
  { value: "PUBLISHED", label: "Published" },
  { value: "ARCHIVED", label: "Archived" },
];

export function NewLandingForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Tracks whether the user has manually edited the slug. Until they do,
  // the slug auto-generates from the title on every change. Once touched,
  // we stop overriding — fighting the user's manual entry is worse UX than
  // a slightly stale auto-slug.
  const slugTouched = React.useRef(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors },
  } = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      title: "",
      slug: "",
      price: 0,
      oldPrice: undefined,
      currency: "DZD",
      status: "DRAFT",
    },
  });

  const title = watch("title");
  const slug = watch("slug");
  const currency = watch("currency");
  const status = watch("status");

  // Auto-generate slug from title. Runs on every title change but only
  // writes if the user hasn't manually edited the slug field.
  React.useEffect(() => {
    if (slugTouched.current) return;
    setValue("slug", slugify(title), { shouldValidate: false });
  }, [title, setValue]);

  const onSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    slugTouched.current = true;
    setValue("slug", e.target.value, { shouldValidate: true });
  };

  const onSubmit = handleSubmit(async (values) => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/landings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (!json.success) {
        setError("root", {
          message: json.error?.message || "Failed to create landing page",
        });
        setIsSubmitting(false);
        return;
      }
      router.push(`/dashboard/landings/${json.data.id}/edit`);
    } catch {
      setError("root", { message: "Network error — please try again" });
      setIsSubmitting(false);
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8" noValidate>
      {/* Title + Slug — the identity of the page */}
      <div className="flex flex-col gap-6">
        <Field
          label="Landing title"
          error={errors.title?.message}
          htmlFor="title"
        >
          <Input
            id="title"
            placeholder="e.g. Lumière Vitamin C Serum"
            autoFocus
            aria-invalid={!!errors.title}
            {...register("title")}
          />
        </Field>

        <Field
          label="Slug"
          error={errors.slug?.message}
          hint="The URL of your landing page"
          htmlFor="slug"
        >
          <div className="flex items-stretch overflow-hidden rounded-md border focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
            <span className="grid select-none place-items-center bg-muted px-3 text-sm text-muted-foreground">
              /
            </span>
            <Input
              id="slug"
              className="rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              placeholder="lumiere-vitamin-c-serum"
              aria-invalid={!!errors.slug}
              value={slug}
              onChange={onSlugChange}
            />
          </div>
        </Field>
      </div>

      {/* Pricing */}
      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="Price"
          error={errors.price?.message}
          htmlFor="price"
        >
          <Input
            id="price"
            type="number"
            step="0.01"
            min="0"
            placeholder="4900"
            aria-invalid={!!errors.price}
            {...register("price")}
          />
        </Field>

        <Field
          label="Old price"
          error={errors.oldPrice?.message as string | undefined}
          hint="Optional — shown struck-through"
          htmlFor="oldPrice"
        >
          <Input
            id="oldPrice"
            type="number"
            step="0.01"
            min="0"
            placeholder="79.00"
            aria-invalid={!!errors.oldPrice}
            {...register("oldPrice")}
          />
        </Field>

        <Field
          label="Currency"
          error={errors.currency?.message}
          htmlFor="currency"
        >
          <Select
            value={currency}
            onValueChange={(v) => setValue("currency", v, { shouldValidate: true })}
          >
            <SelectTrigger id="currency" className="w-full">
              <SelectValue placeholder="Select currency" />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Status" error={errors.status?.message} htmlFor="status">
          <div
            className="flex h-9 items-center gap-1 rounded-md border bg-muted/40 p-1"
            role="radiogroup"
            aria-label="Status"
          >
            {STATUS_OPTIONS.map((opt) => {
              const isSelected = status === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() =>
                    setValue("status", opt.value, { shouldValidate: true })
                  }
                  className={cn(
                    "flex-1 rounded px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>
      </div>

      {/* Actions */}
      <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/dashboard/landings")}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating…" : "Create Landing"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint && (
          <span className="text-xs text-muted-foreground">{hint}</span>
        )}
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
