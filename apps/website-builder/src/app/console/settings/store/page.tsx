import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { notFound } from "next/navigation";

import { requireConsoleSession } from "@/lib/console/session";
import { storeImage } from "@/lib/image-upload";
import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Store profile — the public identity of the tenant's storefront.
 *
 * Was a single row keyed by the literal string "singleton", because there was
 * only ever one store. It is keyed by tenantId now, and the word does not
 * appear anywhere in the platform.
 * ========================================================================== */

/* The columns this form writes. LB.41 took the LABELS out of here: this was
 * the ONE console screen still holding user-facing English, so a merchant on
 * an Arabic or French account met a translated page frame wrapped around
 * twelve English field names — and on Arabic, English labels inside an RTL
 * form is what "this screen is broken" looks like. The catalogue owns the
 * words now; this array owns only the shape.
 *
 * It escaped LB.13's guard because that scan covers the EDITOR directories and
 * nothing else. Measured while fixing: this was the only console screen it
 * missed, so the guard now covers the console settings screens too. */
const FIELDS = [
  { name: "storeName", required: true },
  { name: "storeDescription" },
  { name: "phone" },
  { name: "email", type: "email" },
  { name: "address" },
  { name: "facebook" },
  { name: "instagram" },
  { name: "tiktok" },
  { name: "whatsapp" },
  // B4 — accepted by the API and rendered by the storefront footer since B4;
  // it simply had no field.
  { name: "telegram" },
] as const;

/* The two image identities (B4). File inputs handled INSIDE the server
 * action via the same storeImage the upload route uses — same size cap, same
 * format allow-list, same per-tenant prefix. A submitted file replaces; the
 * clear checkbox removes; neither means "keep what is there". */
const IMAGES = [
  { file: "logoFile", clear: "logoClear", column: "logo" },
  { file: "faviconFile", clear: "faviconClear", column: "favicon" },
] as const;

async function save(formData: FormData) {
  "use server";
  const session = await requireConsoleSession("/console/settings/store");
  if (!session.auth || !can(session.auth, "website-builder:settings:write")) notFound();

  const data: Record<string, string | null> = {};
  for (const f of FIELDS) {
    const raw = String(formData.get(f.name) ?? "").trim();
    data[f.name] = raw === "" ? null : raw.slice(0, 1000);
  }
  if (!data.storeName) redirect("/console/settings/store?error=name");

  const tenantId = session.auth.tenantId;

  for (const img of IMAGES) {
    const file = formData.get(img.file);
    if (file instanceof File && file.size > 0) {
      const result = await storeImage(file, tenantId);
      if (!result.ok) redirect("/console/settings/store?error=upload");
      data[img.column] = result.url;
    } else if (formData.get(img.clear)) {
      data[img.column] = null;
    }
    // Neither a file nor the clear box: the column stays untouched — it is
    // absent from `data`, and absent keys update nothing.
  }

  await withTenant(tenantId, (db) =>
    (db as any).storeSettings.upsert({
      where: { tenantId },
      update: data,
      create: { ...data, tenantId },
    }),
  );

  revalidatePath("/console/settings/store");
  redirect("/console/settings/store?saved=1");
}

export default async function StoreSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const t = await getTranslations();
  const session = await requireConsoleSession("/console/settings/store");
  // Same answer as the API: no permission means the screen does not exist.
  if (!session.auth || !can(session.auth, "website-builder:settings:write")) notFound();

  const { saved, error } = await searchParams;
  const tenantId = session.auth.tenantId;

  /* Twelve DIRECT `t("…")` calls rather than a `labelKey` on each FIELDS
   * entry, and the difference matters to the guards rather than to the reader:
   * the key-exists scan and LB.13's hardcoded-English scan both read literal
   * `t("…")` arguments only, so a key threaded through a variable is invisible
   * to both. LB.35b learned the same thing from the other side. */
  const LABEL: Record<string, string> = {
    storeName: t("settings.storeName"),
    storeDescription: t("settings.storeDescription"),
    phone: t("settings.storePhone"),
    email: t("settings.email"),
    address: t("settings.storeAddress"),
    facebook: t("settings.storeFacebook"),
    instagram: t("settings.storeInstagram"),
    tiktok: t("settings.storeTiktok"),
    whatsapp: t("settings.storeWhatsapp"),
    telegram: t("settings.storeTelegram"),
    logo: t("settings.storeLogo"),
    favicon: t("settings.storeFavicon"),
  };

  const settings = await withTenant(tenantId, (db) =>
    (db as any).storeSettings.findUnique({ where: { tenantId } }),
  );

  return (
    <>
      <PageBody>
      <PageHeader title={t("settings.store")} description={t("settings.storeHint")} />

      {saved ? (
        <p
          role="status"
          data-testid="saved"
          className="mt-4 rounded-md border px-3 py-2 text-sm"
          style={{
            color: "var(--success-fg)",
            backgroundColor: "var(--success-bg)",
            borderColor: "var(--success-border)",
          }}
        >
          {t("settings.saved")}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-md border px-3 py-2 text-sm"
          style={{
            color: "var(--danger-fg)",
            backgroundColor: "var(--danger-bg)",
            borderColor: "var(--danger-border)",
          }}
        >
          {error === "upload"
            ? t("settings.storeErrorUpload")
            : t("settings.storeErrorName")}
        </p>
      ) : null}

      <form
        action={save}
        data-testid="store-form"
        className="mt-6 grid max-w-2xl gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2"
      >
        {FIELDS.map((f) => (
          <div key={f.name} className="space-y-1">
            <label htmlFor={f.name} className="ui-label">
              {LABEL[f.name]}
            </label>
            <input
              id={f.name}
              name={f.name}
              type={"type" in f ? f.type : "text"}
              required={"required" in f ? f.required : false}
              defaultValue={
                settings?.[f.name] ??
                (f.name === "storeName" ? session.tenant?.name ?? "" : "")
              }
              className="ui-control tap w-full"
            />
          </div>
        ))}

        {IMAGES.map((img) => (
          <div key={img.column} className="space-y-1">
            <label htmlFor={img.file} className="ui-label">
              {LABEL[img.column]}
            </label>
            {settings?.[img.column] && (
              <span className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={settings[img.column]}
                  alt=""
                  data-testid={`current-${img.column}`}
                  className="h-8 w-auto max-w-24 rounded border border-border object-contain"
                />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" name={img.clear} className="size-3.5 accent-primary" />
                  {t("settings.storeRemoveImage")}
                </label>
              </span>
            )}
            <input
              id={img.file}
              name={img.file}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="ui-control tap w-full"
            />
          </div>
        ))}

        <div className="sm:col-span-2">
          <button
            type="submit"
            className="ui-btn ui-btn-primary tap"
          >
            {t("common.save")}
          </button>
        </div>
      </form>
      </PageBody>
    </>
  );
}
