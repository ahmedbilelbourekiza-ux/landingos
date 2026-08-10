import { getConsoleSession } from "@/lib/console/session";
import { ConsoleShell } from "@/components/console/console-shell";

/* UI.6 — see console/erp/layout.tsx for the full rationale. Settings are
 * platform-level screens, so the shell renders no product navigation. */

export default async function SettingsConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getConsoleSession();
  if (!session) return <>{children}</>;

  return (
    <ConsoleShell session={session} productId={null}>
      {children}
    </ConsoleShell>
  );
}
