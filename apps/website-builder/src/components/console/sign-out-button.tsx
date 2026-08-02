import { signOutAction } from "@/app/console/actions";

export function SignOutButton({ label }: { label: string }) {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="w-full rounded-md px-3 py-2 text-start text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {label}
      </button>
    </form>
  );
}
