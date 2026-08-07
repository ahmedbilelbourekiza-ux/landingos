import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";

import { requireConsoleSession } from "@/lib/console/session";
import { getTranslations } from "next-intl/server";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Per-wilaya delivery prices.
 *
 * Was GlobalDeliveryPrice — "global" meaning global to the one store that
 * existed. These are one company's prices now; the wilaya list itself stays
 * shared platform reference data that every tenant reads and none owns.
 *
 * A wilaya left blank is UNPRICED, not free. Checkout refuses a destination
 * with no price rather than shipping it for nothing, so an empty field is a
 * meaningful state and the form does not coerce it to zero.
 * ========================================================================== */

async function save(formData: FormData) {
  "use server";
  const session = await requireConsoleSession("/console/settings/delivery-prices");
  if (!session.auth || !can(session.auth, "website-builder:settings:write")) notFound();

  const tenantId = session.auth.tenantId;
  const rows: { wilayaId: number; homePrice: number; deskPrice: number | null }[] = [];

  for (const [key, value] of formData.entries()) {
    const m = key.match(/^home_(\d+)$/);
    if (!m) continue;
    const wilayaId = Number(m[1]);
    const home = String(value).trim();
    if (home === "") continue; // left unpriced on purpose

    const desk = String(formData.get(`desk_${wilayaId}`) ?? "").trim();
    const homeNum = Number(home);
    if (!Number.isFinite(homeNum) || homeNum < 0) continue;

    rows.push({
      wilayaId,
      homePrice: homeNum,
      deskPrice: desk === "" ? null : Number.isFinite(Number(desk)) ? Number(desk) : null,
    });
  }

  await withTenant(tenantId, async (db) => {
    // Upsert per row rather than replace: a wilaya the form did not submit
    // keeps its price instead of silently becoming undeliverable.
    for (const row of rows) {
      await (db as any).tenantDeliveryPrice.upsert({
        where: { tenantId_wilayaId: { tenantId, wilayaId: row.wilayaId } },
        update: { homePrice: row.homePrice, deskPrice: row.deskPrice },
        create: { tenantId, ...row },
      });
    }
  });

  revalidatePath("/console/settings/delivery-prices");
  redirect("/console/settings/delivery-prices?saved=" + rows.length);
}

export default async function DeliveryPricesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const t = await getTranslations();
  const session = await requireConsoleSession("/console/settings/delivery-prices");
  if (!session.auth || !can(session.auth, "website-builder:settings:write")) notFound();

  const { saved } = await searchParams;
  const tenantId = session.auth.tenantId;

  const [wilayas, prices] = await withTenant(tenantId, async (db) => [
    await (db as any).wilaya.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, nameAr: true },
    }),
    await (db as any).tenantDeliveryPrice.findMany(),
  ]);

  const byWilaya = new Map(prices.map((p: any) => [p.wilayaId, p]));
  const priced = prices.length;

  return (
    <ConsoleShell session={session} productId={null}>
      <PageBody>
      <PageHeader title={t("settings.deliveryPrices")} />
      <p className="mt-1 text-sm text-muted-foreground">
        {priced} of {wilayas.length} wilayas priced. A blank field means this wilaya cannot be
        delivered to — not that delivery is free.
      </p>

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
          Saved {saved} wilayas.
        </p>
      ) : null}

      <form action={save} data-testid="delivery-prices-form" className="mt-6">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2.5 text-start font-medium">{t("settings.wilaya")}</th>
                <th scope="col" className="px-3 py-2.5 text-end font-medium">{t("settings.homeDelivery")}</th>
                <th scope="col" className="px-3 py-2.5 text-end font-medium">{t("settings.stopDesk")}</th>
              </tr>
            </thead>
            <tbody>
              {wilayas.map((w: any) => {
                const p: any = byWilaya.get(w.id);
                return (
                  <tr key={w.id} data-wilaya={w.code} className="border-t border-border">
                    <td className="px-4 py-2">
                      <span className="font-mono text-xs text-muted-foreground">{w.code}</span>{" "}
                      {w.name}
                    </td>
                    <td className="px-4 py-2 text-end">
                      <input
                        name={`home_${w.id}`}
                        type="number"
                        min="0"
                        step="1"
                        defaultValue={p?.homePrice != null ? String(p.homePrice) : ""}
                        className="ui-control tap w-28 px-2 py-1 text-end tabular-nums"
                      />
                    </td>
                    <td className="px-4 py-2 text-end">
                      <input
                        name={`desk_${w.id}`}
                        type="number"
                        min="0"
                        step="1"
                        defaultValue={p?.deskPrice != null ? String(p.deskPrice) : ""}
                        className="ui-control tap w-28 px-2 py-1 text-end tabular-nums"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button
          type="submit"
          className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
        >
          Save
        </button>
      </form>
      </PageBody>
    </ConsoleShell>
  );
}
