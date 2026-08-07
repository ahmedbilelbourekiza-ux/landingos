import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { notFound } from "next/navigation";

import { requireConsoleSession } from "@/lib/console/session";
import { ConsoleShell } from "@/components/console/console-shell";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Store profile — the public identity of the tenant's storefront.
 *
 * Was a single row keyed by the literal string "singleton", because there was
 * only ever one store. It is keyed by tenantId now, and the word does not
 * appear anywhere in the platform.
 * ========================================================================== */

const FIELDS = [
  { name: "storeName", label: "Store name", required: true },
  { name: "storeDescription", label: "Description" },
  { name: "phone", label: "Phone" },
  { name: "email", label: "Email", type: "email" },
  { name: "address", label: "Address" },
  { name: "facebook", label: "Facebook" },
  { name: "instagram", label: "Instagram" },
  { name: "tiktok", label: "TikTok" },
  { name: "whatsapp", label: "WhatsApp" },
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
  const session = await requireConsoleSession("/console/settings/store");
  // Same answer as the API: no permission means the screen does not exist.
  if (!session.auth || !can(session.auth, "website-builder:settings:write")) notFound();

  const { saved, error } = await searchParams;
  const tenantId = session.auth.tenantId;

  const settings = await withTenant(tenantId, (db) =>
    (db as any).storeSettings.findUnique({ where: { tenantId } }),
  );

  return (
    <ConsoleShell session={session} productId={null}>
      <h1 className="text-xl font-semibold">Store profile</h1>

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
          Saved.
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
          A store name is required.
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
              {f.label}
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

        <div className="sm:col-span-2">
          <button
            type="submit"
            className="ui-btn ui-btn-primary tap"
          >
            Save
          </button>
        </div>
      </form>
    </ConsoleShell>
  );
}
