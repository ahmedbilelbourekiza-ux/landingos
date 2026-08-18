"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X } from "lucide-react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import { readTypedMoney, MONEY_PATTERN } from "@/lib/landing/money-field";

/* =============================================================================
 * "Generate with AI" — the LB.24 control on the create screen.
 *
 * The merchant's half is FACTS: product name, price, a few selling points,
 * their own product photos. The model's half is WORDS (and only words): the
 * page copy, written in Algerian dialect server-side. Photos upload through
 * the ordinary POST /api/builder/upload the editor already uses, then the
 * whole generation is one POST — on success the merchant lands in the editor
 * on a DRAFT, exactly where the plain create form would have put them.
 *
 * Same D-06.1 shape as NewLandingForm beside it: a control calls the API
 * route, no server action. Transport/permission refusals render through the
 * shared ActionError; field-level guidance comes from the translated
 * `messages` map.
 * ========================================================================== */

interface UploadedPhoto {
  readonly url: string;
  readonly name: string;
}

export function GenerateLandingPanel({
  labels,
  messages,
  errors,
  usageLine,
  quotaExhausted,
}: {
  /** AQ.1 — "{used} of {limit} this month", prebuilt server-side. */
  readonly usageLine?: string | null;
  /** Set when the month's allowance is spent: shown instead of the submit
   * button, so the refusal arrives before the form is filled, not after. */
  readonly quotaExhausted?: string | null;
  readonly labels: {
    heading: string;
    intro: string;
    productName: string;
    price: string;
    oldPrice: string;
    oldPriceHint: string;
    sellingPoints: string;
    sellingPointsHint: string;
    photos: string;
    photosHint: string;
    removePhoto: string;
    submit: string;
    generating: string;
  };
  readonly messages: {
    productName: string;
    price: string;
    oldPrice: string;
    sellingPoints: string;
    uploadFailed: string;
    photosLimit: string;
  };
  readonly errors: ActionErrors;
}) {
  const router = useRouter();
  const { run, pending, error } = useApiAction(errors);
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [photos, setPhotos] = React.useState<UploadedPhoto[]>([]);
  const [uploading, setUploading] = React.useState(false);

  const onPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setFieldError(null);
    // The route accepts 12 photos; refusing the excess here names the limit
    // instead of letting the server answer a generic invalid-input.
    const room = 12 - photos.length;
    if (files.length > room) {
      setFieldError(messages.photosLimit);
      files = files.slice(0, Math.max(room, 0));
      if (!files.length) return;
    }
    setUploading(true);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/builder/upload", { method: "POST", body: form });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          setFieldError(messages.uploadFailed);
          continue;
        }
        setPhotos((prev) => [...prev, { url: json.data.url as string, name: file.name }]);
      }
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFieldError(null);

    const form = new FormData(e.currentTarget);
    const productName = String(form.get("productName") ?? "").trim();
    /* LB.15's ONE reader on both boxes. `Number(raw.replace(",", "."))` read
       the French/Algerian «2,500» as 2.5 and would have generated a whole
       landing page — copy, theme, images — around a price a thousand times
       under the one the merchant typed. `readTypedMoney` refuses rather than
       guesses; `undefined` means the optional box was left empty. */
    const price = readTypedMoney(form.get("price"));
    const oldPriceRead = readTypedMoney(form.get("oldPrice"));
    const oldPrice = oldPriceRead === undefined ? null : oldPriceRead;
    const sellingPoints = String(form.get("sellingPoints") ?? "")
      .split("\n")
      .map((line) => line.trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 8);

    if (productName.length < 2) return setFieldError(messages.productName);
    if (price === null || price === undefined || price < 0) return setFieldError(messages.price);
    // `null` here is UNREADABLE (refuse); an empty box already became `null`
    // via `undefined` above and is allowed, since the old price is optional.
    if (oldPriceRead === null) return setFieldError(messages.oldPrice);
    if (oldPrice != null && oldPrice <= price) {
      return setFieldError(messages.oldPrice);
    }
    if (!sellingPoints.length) return setFieldError(messages.sellingPoints);

    const { ok, data } = await run("POST", "/api/builder/landings/generate", {
      productName,
      price,
      ...(oldPrice != null ? { oldPrice } : {}),
      sellingPoints,
      imageUrls: photos.map((p) => p.url),
    });
    if (ok && data && typeof data === "object" && "id" in data) {
      router.push(`/console/builder/pages/${(data as { id: string }).id}/edit`);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      data-testid="ai-generate-panel"
      className="mt-6 max-w-lg space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4" aria-hidden />
          {labels.heading}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{labels.intro}</p>
        {usageLine ? (
          <p className="mt-1 text-xs text-muted-foreground" data-testid="ai-usage-line">
            {usageLine}
          </p>
        ) : null}
      </div>

      {fieldError ? (
        <p
          role="alert"
          data-testid="ai-generate-error"
          className="rounded-md border px-3 py-2 text-sm"
          style={{
            color: "var(--danger-fg)",
            backgroundColor: "var(--danger-bg)",
            borderColor: "var(--danger-border)",
          }}
        >
          {fieldError}
        </p>
      ) : null}
      <ActionError message={error} />

      <label className="block text-sm">
        <span className="mb-1 block font-medium">{labels.productName}</span>
        <input
          name="productName"
          required
          maxLength={200}
          className="w-full rounded-md border border-border bg-background px-3 py-2"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{labels.price}</span>
          <input
            name="price"
            required
            type="text"
            inputMode="decimal"
            pattern={MONEY_PATTERN}
            className="w-full rounded-md border border-border bg-background px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{labels.oldPrice}</span>
          <input
            name="oldPrice"
            type="text"
            inputMode="decimal"
            pattern={MONEY_PATTERN}
            placeholder={labels.oldPriceHint}
            className="w-full rounded-md border border-border bg-background px-3 py-2"
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">{labels.sellingPoints}</span>
        <textarea
          name="sellingPoints"
          required
          rows={4}
          maxLength={2400}
          placeholder={labels.sellingPointsHint}
          className="w-full rounded-md border border-border bg-background px-3 py-2"
        />
      </label>

      <div className="text-sm">
        <span className="mb-1 block font-medium">{labels.photos}</span>
        <p className="mb-2 text-xs text-muted-foreground">{labels.photosHint}</p>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          onChange={onPhotos}
          disabled={uploading || pending}
          data-testid="ai-photo-input"
          className="block w-full text-sm"
        />
        {photos.length ? (
          <ul className="mt-2 space-y-1">
            {photos.map((p, i) => (
              <li key={p.url} className="flex items-center gap-2 text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className="h-8 w-8 rounded object-cover" />
                <span className="truncate">{p.name}</span>
                {i === 0 ? <span className="text-muted-foreground">★</span> : null}
                <button
                  type="button"
                  aria-label={`${labels.removePhoto} ${p.name}`}
                  onClick={() => setPhotos((prev) => prev.filter((x) => x.url !== p.url))}
                  className="ms-auto rounded p-1 hover:bg-muted"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {quotaExhausted ? (
        <p
          data-testid="ai-quota-exhausted"
          className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
        >
          {quotaExhausted}
        </p>
      ) : (
        <ActionButton
          type="submit"
          pending={pending || uploading}
          pendingLabel={labels.generating}
          data-testid="ai-generate-submit"
        >
          {labels.submit}
        </ActionButton>
      )}
    </form>
  );
}
