"use client";

import { useId, useRef, useState } from "react";
import { Upload, X } from "lucide-react";

import { ProductThumb } from "./product-thumb";

/* =============================================================================
 * Putting a photograph on a product — PM.2.
 *
 * WHAT IT CLOSES. `CatalogProduct.image` and every variant's `image` have been
 * writable through the API since Phase 5 and there has never been a way to put
 * a FILE into either — the products screen offered a text box for a URL, and
 * its own comment said so: "what still has no control is uploading a file".
 * Nobody photographs a product and then hosts it somewhere else first, so in
 * practice the column stayed empty and every screen that could have shown a
 * photograph showed nothing.
 *
 * THE URL BOX STAYS, and that is deliberate rather than leftover. A tenant
 * migrating from the legacy CRM arrives with `data:` URLs in the column; a
 * tenant selling through Shopify already has a CDN URL for every product. Both
 * are legitimate values, and an uploader that could only produce its own keys
 * would refuse them.
 *
 * IT UPLOADS ON SELECTION, NOT ON SAVE. The alternative is holding a `File` in
 * component state until the form is submitted, which means the parent's payload
 * stops being JSON and every caller learns about multipart. Uploading first and
 * carrying a STRING keeps `POST /api/erp/products` exactly the request it
 * already was — and it is what makes the preview real rather than a
 * `URL.createObjectURL` that lies about what was stored.
 *
 * D-06.1 holds: it calls `POST /api/erp/uploads`, which is gated on
 * `erp:products:write` — the permission the routes that STORE this string
 * check. It is not a server action.
 * ========================================================================== */

export interface ImageInputStrings {
  readonly label: string;
  readonly upload: string;
  readonly uploading: string;
  readonly remove: string;
  readonly urlHint: string;
  readonly failed: string;
}

export function ImageInput({
  value,
  onChange,
  s,
  alt = "",
  size = "md",
  testId,
  /** Rendered without its own label — inside a variant row, for instance. */
  compact = false,
  buttonOnly = false,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly s: ImageInputStrings;
  readonly alt?: string;
  readonly size?: "sm" | "md" | "lg";
  readonly testId?: string;
  readonly compact?: boolean;
  /**
   * Just the picker.
   *
   * For a place that has no single value to display — the "apply one photograph
   * to every variant in this group" control, where a thumbnail and a URL box
   * would both be lying about what the control holds.
   */
  readonly buttonOnly?: boolean;
}) {
  const id = useId();
  const file = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const send = async (chosen: File) => {
    setBusy(true);
    setFailed(null);
    try {
      const body = new FormData();
      body.append("file", chosen);
      const res = await fetch("/api/erp/uploads", {
        method: "POST",
        credentials: "same-origin",
        body,
      });
      const envelope = await res.json().catch(() => null);
      if (!res.ok || !envelope?.success) {
        // The route's own message names the reason — too large, wrong format —
        // and it is more useful than a generic sentence, which is why it is
        // preferred over the fallback rather than replaced by it.
        setFailed(envelope?.error?.message || s.failed);
        return;
      }
      onChange(envelope.data.url as string);
    } catch {
      setFailed(s.failed);
    } finally {
      setBusy(false);
      // Cleared so choosing the SAME file twice still fires `change` — the
      // second attempt after a failed upload is exactly when that matters.
      if (file.current) file.current.value = "";
    }
  };

  /* A label wrapping a visually hidden input, not a button that clicks one: the
     label IS the file picker's control, so it is keyboard-reachable and
     announced without any JavaScript forwarding a click. */
  const picker = (
    <label
      className={`ui-btn ui-btn-default ui-btn-sm tap cursor-pointer ${
        busy ? "pointer-events-none opacity-70" : ""
      }`}
      title={buttonOnly ? s.upload : undefined}
    >
      <Upload aria-hidden="true" className="size-3.5" />
      {busy ? s.uploading : s.upload}
      <input
        ref={file}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="sr-only"
        disabled={busy}
        data-testid={testId ? `${testId}-file` : undefined}
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          if (chosen) void send(chosen);
        }}
      />
    </label>
  );

  const failure = failed && (
    <p role="alert" className="text-xs font-medium text-(--danger-fg)">
      {failed}
    </p>
  );

  if (buttonOnly) {
    return (
      <span data-testid={testId} className="shrink-0">
        {picker}
        {failure}
      </span>
    );
  }

  return (
    <div data-testid={testId}>
      {!compact && (
        <span className="ui-label block" id={`${id}-label`}>
          {s.label}
        </span>
      )}

      <div className={compact ? "flex items-start gap-2" : "mt-1.5 flex items-start gap-3"}>
        <ProductThumb src={value || null} alt={alt} size={size} />

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {picker}
            {value && (
              <button
                type="button"
                onClick={() => onChange("")}
                data-testid={testId ? `${testId}-clear` : undefined}
                aria-label={s.remove}
                title={s.remove}
                className="ui-btn ui-btn-ghost ui-btn-sm tap size-8 px-0"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            )}
          </div>

          {/* The URL box is not offered in a variant row: forty-five of them
              would be forty-five text boxes carrying a string nobody types. It
              stays on the product-level control, where a migrated `data:` URL
              or a Shopify CDN link is a real thing somebody pastes. */}
          {!compact && (
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={s.urlHint}
              dir="ltr"
              aria-label={s.label}
              data-testid={testId ? `${testId}-url` : undefined}
              className="ui-control w-full text-xs"
            />
          )}

          {failure}
        </div>
      </div>
    </div>
  );
}
