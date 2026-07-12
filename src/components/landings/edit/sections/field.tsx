import * as React from "react";
import { Label } from "@/components/ui/label";

// Shared form field wrapper used by every edit section. Extracted because
// General and Pricing both had identical copies — keeping it in one place
// means future sections import it instead of duplicating again.
export function Field({
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
