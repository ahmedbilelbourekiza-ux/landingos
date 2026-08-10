import { notFound } from "next/navigation";

import { getConsoleSession } from "@/lib/console/session";
import { ConsoleShell } from "@/components/console/console-shell";

/* UI.6 — see console/erp/layout.tsx for the full rationale, including why the
 * entitlement gate is here and why there is no `loading.tsx`. This layout
 * lives in a route GROUP because two builder screens must stay outside the
 * shell: the editor (`pages/[id]/edit`) is a full-bleed workspace whose
 * canvas a sidebar would halve, and `delivery-prices` is a bare redirect.
 * Everything inside `(shell)` shares this frame; the group adds no URL
 * segment. */

export default async function BuilderConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getConsoleSession();
  if (!session) return <>{children}</>;
  if (!session.products.some((p) => p.id === "website-builder")) notFound();

  return (
    <ConsoleShell session={session} productId="website-builder">
      {children}
    </ConsoleShell>
  );
}
