/* The console route group. Auth is enforced by each page's call to
 * requireConsoleSession rather than by middleware, because resolving an opaque
 * session needs a database read and middleware runs on the Edge runtime — the
 * accepted consequence of choosing revocable sessions over a stateless JWT. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
