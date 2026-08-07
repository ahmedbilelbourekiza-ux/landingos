import { LogOut } from "lucide-react";

import { signOutAction } from "@/app/console/actions";

/**
 * Leaving.
 *
 * It sat directly under "Settings" in identical weight and colour, so the
 * routine action and the one that ends the session read as the same kind of
 * thing. The icon and the hover tint are what separate them now — deliberately
 * not a danger tone, because signing out is not destructive and colouring it
 * red is how people learn to ignore red.
 */
export function SignOutButton({ label }: { label: string }) {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-start text-sm text-muted-foreground transition-colors duration-(--duration-fast) hover:bg-sidebar-accent/60 hover:text-foreground tap"
      >
        <LogOut aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/70" />
        {label}
      </button>
    </form>
  );
}
