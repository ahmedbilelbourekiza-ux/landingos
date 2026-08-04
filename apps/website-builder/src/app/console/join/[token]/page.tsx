import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { previewOrRefuse, type InvitationPreview } from "@/lib/platform/team";
import { getConsoleSession } from "@/lib/console/session";
import { JoinForm } from "@/components/console/join-form";

export const dynamic = "force-dynamic";

/* =============================================================================
 * /console/join/[token] — accepting an invitation (Phase 7.1b).
 *
 * 7.1a issues links whose target led here and answered 404. This page is what
 * the link now resolves to: it shows who is inviting, to which company, in what
 * role, and accepts on submit.
 *
 * NOT A `tenantRoute`, and not behind a server action. The page renders GET for
 * everyone (the link is followed from an email before any session exists), and
 * the accept button calls the API route `POST /api/platform/invitations/[token]/
 * accept` — D-06.1: a control calls the API route, it does not get its own write
 * path. A server action would be a second path no contract test can reach
 * (server actions are not HTTP-addressable), and every other write surface on
 * this platform is an API route with contract tests in front of it.
 *
 * THE ADDRESS IS NOT PROOF OF IDENTITY. Whoever holds the token is whoever
 * received the link; the 32-byte token IS the claim. This slice does NOT create
 * a `User` for an address that has none — that is self-serve signup (7.3) and is
 * refused with `ACCOUNT_REQUIRED` rather than half-built.
 *
 * Every non-open state refuses IDENTICALLY. Unknown, expired, revoked and
 * deleted-tenant tokens all render the same `notFound` message, because telling
 * them apart turns the page into an oracle for which addresses have been
 * invited. `ALREADY_ACCEPTED`, `ACCOUNT_REQUIRED` and `ALREADY_MEMBER` are
 * distinct because by the time they apply the caller holds the token.
 * ========================================================================== */

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const t = await getTranslations();

  // A signed-in visitor sees who they are. This never blocks: the link is
  // followed from an email before any session exists, and a signed-in user
  // accepting an invite to a second company is exactly the seeded consultant's
  // case and must keep working.
  const session = await getConsoleSession();

  const result = await previewOrRefuse(token);

  // Map a POST refusal code (carried in ?error=) to its message, falling back
  // to the generic not-found message for any code the page does not name. The
  // set of codes is owned by the helper; the page must not invent its own.
  const errorMessage = error
    ? error === "ALREADY_ACCEPTED"
      ? t("join.alreadyAccepted")
      : error === "ACCOUNT_REQUIRED"
        ? t("join.accountRequired")
        : error === "ALREADY_MEMBER"
          ? t("join.alreadyMember")
          : t("join.notFound")
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6">
        <div>
          <h1 className="text-lg font-semibold">{t("join.title")}</h1>
        </div>

        {session ? (
          <p className="text-sm text-muted-foreground">
            {t("join.signedInAs", { email: session.user.email })}
          </p>
        ) : null}

        {errorMessage ? (
          <p
            role="alert"
            className="rounded-md border px-3 py-2 text-sm"
            style={{
              color: "var(--danger-fg)",
              backgroundColor: "var(--danger-bg)",
              borderColor: "var(--danger-border)",
            }}
          >
            {errorMessage}
          </p>
        ) : null}

        {result.kind === "open" ? (
          <OpenInvitation preview={result.preview} token={token} t={t} />
        ) : (
          // The preview refusal collapses every non-open state into one
          // message; the POST-time error (if any) is shown above. If both are
          // absent we are here because the token resolved to nothing on GET.
          errorMessage ? null : <p className="text-sm">{t("join.notFound")}</p>
        )}
      </div>
    </main>
  );
}

function OpenInvitation({
  preview,
  token,
  t,
}: {
  preview: InvitationPreview;
  token: string;
  t: (k: string, p?: Record<string, unknown>) => string;
}) {
  const roleLabel = t(`join.role.${preview.role}`);
  return (
    <>
      <p className="text-sm">
        {t("join.invitedBy", { tenant: preview.tenantName, email: preview.email, role: roleLabel })}
      </p>
      {/*
       * The button calls the API route directly. It needs JavaScript, which is
       * the stated cost of every write control on this platform (D-06.1) — and
       * here it is the only way to keep acceptance on the ONE write path the
       * contract tests cover. A plain POST form would hit a server action, and
       * a server action is not HTTP-addressable, so it could not be tested.
       */}
      <JoinForm token={token} acceptLabel={t("join.accept")} />
    </>
  );
}
