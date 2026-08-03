import assert from 'node:assert/strict';
import { after, describe } from 'node:test';

import { asPlatform, withTenant } from '@landingos/db';
import { createSession, SESSION_COOKIE } from '@landingos/auth';

import {
  BASE,
  anon,
  cleanup,
  contractTest,
  makeAgent,
  makeMember,
  makeTenant,
  uid,
  type Caller,
} from '../erp/helpers.ts';

/* =============================================================================
 * Team management — Phase 7.1. The contract for `/api/platform/team/*`.
 *
 * WHY THIS IMPORTS `../erp/helpers.ts`. That file is the app's contract-test
 * harness, not the ERP's — tenants, members, sessions and the skip-with-a-reason
 * machinery are all product-agnostic, and the directory name is historical in the
 * same way `apps/website-builder` is. A second copy of the fixtures is a second
 * thing to keep in step with the platform's identity model, which is exactly the
 * drift these suites exist to catch.
 *
 * The tests attack boundaries rather than confirm happy paths, and the boundaries
 * here are unusually sharp: this is the surface that decides who else has access,
 * so every one of the seven rules in NEXT_STEPS §7.1 gets a test that VIOLATES it
 * rather than a test that exercises it.
 * ========================================================================== */

after(cleanup);

/** Put an existing person into a second company — the consultant's shape. */
async function addMembership(
  tenantId: string,
  userId: string,
  opts: { role?: string; permissions?: readonly string[] } = {},
) {
  await withTenant(tenantId, (tx) =>
    (tx as any).membership.create({
      data: {
        tenantId,
        userId,
        role: opts.role ?? 'MEMBER',
        permissions: [...(opts.permissions ?? [])],
      },
    }),
  );
  const { token } = await createSession(userId, tenantId);
  return token;
}

/** A team: an owner, an admin, and somebody to act on. */
async function makeTeam(label: string, entitlements?: string[]) {
  const tenantId = await makeTenant(label, entitlements);
  const [owner, admin, member] = await Promise.all([
    makeMember(tenantId, { role: 'OWNER' }),
    makeMember(tenantId, { role: 'ADMIN' }),
    makeMember(tenantId, { role: 'MEMBER' }),
  ]);
  return { tenantId, owner, admin, member };
}

const invite = (caller: Caller, email: string, role = 'MEMBER') =>
  caller.api('POST', '/api/platform/team/invitations', { email, role });

const newEmail = () => `invitee-${uid()}@landingos.test`;

/* -----------------------------------------------------------------------------
 * Who reaches the surface at all
 * -------------------------------------------------------------------------- */

describe('the team surface is SENSITIVE, and no role glob reaches it', () => {
  contractTest('a signed-out caller is refused before anything else', async () => {
    const res = await anon('GET', '/api/platform/team/members');
    assert.equal(res.status, 401);
  });

  contractTest('a MEMBER cannot read the team, though *:*:read would grant it', async () => {
    const { member } = await makeTeam('gate-member');
    const res = await member.api('GET', '/api/platform/team/members');
    assert.equal(res.status, 403);
  });

  contractTest('neither can a MANAGER — running the day is not deciding who works here', async () => {
    const tenantId = await makeTenant('gate-manager');
    const manager = await makeMember(tenantId, { role: 'MANAGER' });
    const res = await manager.api('GET', '/api/platform/team/members');
    assert.equal(res.status, 403);
  });

  contractTest('an ADMIN can, and the list names the roles the API will accept', async () => {
    const { admin } = await makeTeam('gate-admin');
    const res = await admin.api('GET', '/api/platform/team/members');
    assert.equal(res.status, 200);
    // The vocabulary comes from the server, so a screen cannot go stale against
    // the routes that validate it — and OWNER is deliberately not in it.
    assert.deepEqual(res.body.data.assignableRoles, ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER']);
  });

  contractTest('the permission is grantable by name, and read does not imply write', async () => {
    const tenantId = await makeTenant('gate-granted');
    const reader = await makeMember(tenantId, {
      role: 'MEMBER',
      permissions: ['platform:team:read'],
    });

    const list = await reader.api('GET', '/api/platform/team/members');
    assert.equal(list.status, 200);

    const attempt = await invite(reader, newEmail());
    assert.equal(attempt.status, 403);
  });

  contractTest('a company with no subscription still manages its own people', async () => {
    // `productOf("platform:…")` is null, so this surface is not entitlement-gated.
    // Losing the team screen when the invoice bounces is how a company loses the
    // ability to remove whoever stopped paying.
    const { admin } = await makeTeam('gate-unentitled', []);
    const res = await admin.api('GET', '/api/platform/team/members');
    assert.equal(res.status, 200);
  });
});

/* -----------------------------------------------------------------------------
 * The list
 * -------------------------------------------------------------------------- */

describe('the member list is this company and only this company', () => {
  contractTest('everybody in the tenant, with the role and the suspension state', async () => {
    const { admin, owner, member } = await makeTeam('list-all');
    const res = await admin.api('GET', '/api/platform/team/members');
    assert.equal(res.status, 200);

    const byId = new Map<string, any>(res.body.data.items.map((m: any) => [m.userId, m]));
    assert.equal(byId.size, 3);
    assert.equal(byId.get(owner.userId).role, 'OWNER');
    assert.equal(byId.get(member.userId).role, 'MEMBER');
    assert.equal(byId.get(member.userId).suspended, false);
    assert.ok(byId.get(member.userId).email.includes('@'));
  });

  contractTest('another company’s people are not in it', async () => {
    const [a, b] = await Promise.all([makeTeam('list-a'), makeTeam('list-b')]);
    const res = await a.admin.api('GET', '/api/platform/team/members');
    const ids = res.body.data.items.map((m: any) => m.userId);
    assert.ok(!ids.includes(b.member.userId));
    assert.ok(ids.includes(a.member.userId));
  });
});

/* -----------------------------------------------------------------------------
 * Rule 1 — the owner
 * -------------------------------------------------------------------------- */

describe('the owner cannot be demoted, suspended or removed by anybody', () => {
  contractTest('an ADMIN cannot demote them', async () => {
    const { admin, owner } = await makeTeam('owner-demote');
    const res = await admin.api('PATCH', `/api/platform/team/members/${owner.userId}`, {
      role: 'MEMBER',
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'OWNER_IMMUTABLE');
  });

  contractTest('an ADMIN cannot suspend them', async () => {
    const { admin, owner } = await makeTeam('owner-suspend');
    const res = await admin.api('POST', `/api/platform/team/members/${owner.userId}/suspend`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'OWNER_IMMUTABLE');
  });

  contractTest('an ADMIN cannot remove them', async () => {
    const { admin, owner } = await makeTeam('owner-remove');
    const res = await admin.api('DELETE', `/api/platform/team/members/${owner.userId}`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'OWNER_IMMUTABLE');
  });

  contractTest('and neither can the owner, to themselves', async () => {
    const { owner } = await makeTeam('owner-self');
    const demote = await owner.api('PATCH', `/api/platform/team/members/${owner.userId}`, {
      role: 'ADMIN',
    });
    assert.equal(demote.status, 409);
    assert.equal(demote.body.error.code, 'OWNER_IMMUTABLE');

    const remove = await owner.api('DELETE', `/api/platform/team/members/${owner.userId}`);
    assert.equal(remove.status, 409);
  });

  contractTest('the owner is still there afterwards', async () => {
    const { admin, owner } = await makeTeam('owner-intact');
    await admin.api('DELETE', `/api/platform/team/members/${owner.userId}`);
    const res = await admin.api('GET', '/api/platform/team/members');
    const row = res.body.data.items.find((m: any) => m.userId === owner.userId);
    assert.equal(row?.role, 'OWNER');
    assert.equal(row?.suspended, false);
  });

  contractTest('OWNER is not a role this API hands out — not by invitation', async () => {
    const { owner } = await makeTeam('owner-invite');
    const res = await invite(owner, newEmail(), 'OWNER');
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
  });

  contractTest('nor by promotion, even by the owner themselves', async () => {
    const { owner, member } = await makeTeam('owner-promote');
    const res = await owner.api('PATCH', `/api/platform/team/members/${member.userId}`, {
      role: 'OWNER',
    });
    assert.equal(res.status, 422);
    // A tenant has exactly one owner. Two would both hold `*`, neither could be
    // removed, and there is no way back without a database edit.
    assert.ok(['INVALID_INPUT', 'UNASSIGNABLE_ROLE'].includes(res.body.error.code));
  });
});

/* -----------------------------------------------------------------------------
 * Rule 2 — the ceiling
 * -------------------------------------------------------------------------- */

describe('nobody may hand out more access than they hold', () => {
  contractTest('a MANAGER granted the permission by name cannot make an ADMIN', async () => {
    const tenantId = await makeTenant('ceiling-up');
    const [manager, target] = await Promise.all([
      makeMember(tenantId, { role: 'MANAGER', permissions: ['platform:team:read', 'platform:team:write'] }),
      makeMember(tenantId, { role: 'MEMBER' }),
    ]);

    const res = await manager.api('PATCH', `/api/platform/team/members/${target.userId}`, {
      role: 'ADMIN',
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'ROLE_ABOVE_SELF');
  });

  contractTest('...nor invite one, which would be the same escalation by another door', async () => {
    const tenantId = await makeTenant('ceiling-invite');
    const manager = await makeMember(tenantId, {
      role: 'MANAGER',
      permissions: ['platform:team:write'],
    });
    const res = await invite(manager, newEmail(), 'ADMIN');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'ROLE_ABOVE_SELF');
  });

  contractTest('but may grant their own level, and everything below it', async () => {
    const tenantId = await makeTenant('ceiling-equal');
    const [manager, target] = await Promise.all([
      makeMember(tenantId, { role: 'MANAGER', permissions: ['platform:team:write'] }),
      makeMember(tenantId, { role: 'VIEWER' }),
    ]);

    const equal = await manager.api('PATCH', `/api/platform/team/members/${target.userId}`, {
      role: 'MANAGER',
    });
    assert.equal(equal.status, 200);
    assert.equal(equal.body.data.role, 'MANAGER');

    const below = await manager.api('PATCH', `/api/platform/team/members/${target.userId}`, {
      role: 'MEMBER',
    });
    assert.equal(below.status, 200);
  });

  contractTest('nobody changes their own role — the promotion nobody has to ask for', async () => {
    const { admin } = await makeTeam('ceiling-self');
    const res = await admin.api('PATCH', `/api/platform/team/members/${admin.userId}`, {
      role: 'MEMBER',
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'SELF_TARGET');
  });

  contractTest('a role that is not a role is refused before any of that', async () => {
    const { admin, member } = await makeTeam('ceiling-bogus');
    const res = await admin.api('PATCH', `/api/platform/team/members/${member.userId}`, {
      role: 'SUPERADMIN',
    });
    assert.equal(res.status, 422);
  });

  contractTest('somebody who is not on this team is a 404, never a 403', async () => {
    const [a, b] = await Promise.all([makeTeam('ceiling-cross-a'), makeTeam('ceiling-cross-b')]);
    const res = await a.admin.api('PATCH', `/api/platform/team/members/${b.member.userId}`, {
      role: 'VIEWER',
    });
    assert.equal(res.status, 404);

    // And the other company's member is untouched.
    const theirs = await b.admin.api('GET', '/api/platform/team/members');
    const row = theirs.body.data.items.find((m: any) => m.userId === b.member.userId);
    assert.equal(row.role, 'MEMBER');
  });
});

/* -----------------------------------------------------------------------------
 * Rule 3 — suspension, and the whole reason sessions are server-side
 * -------------------------------------------------------------------------- */

describe('suspension takes effect on the very next request (M-09)', () => {
  contractTest('the same token that worked a moment ago is refused, and comes back', async () => {
    const tenantId = await makeTenant('suspend-live');
    const [admin, agent] = await Promise.all([
      makeMember(tenantId, { role: 'ADMIN' }),
      makeAgent(tenantId),
    ]);

    const before = await agent.api('GET', '/api/erp/orders');
    assert.equal(before.status, 200);

    const suspend = await admin.api('POST', `/api/platform/team/members/${agent.userId}/suspend`);
    assert.equal(suspend.status, 200);

    // No new sign-in, no new cookie: the SAME session token.
    const during = await agent.api('GET', '/api/erp/orders');
    assert.equal(during.status, 403);

    const back = await admin.api('POST', `/api/platform/team/members/${agent.userId}/reactivate`);
    assert.equal(back.status, 200);

    const after = await agent.api('GET', '/api/erp/orders');
    assert.equal(after.status, 200);
  });

  contractTest('and it is per company, not per person', async () => {
    // One human, two employers — the seeded consultant's case. Suspending them
    // here must not sign them out there, which is what destroying every session
    // for the user id would do.
    const [a, b] = await Promise.all([makeTeam('suspend-a'), makeTeam('suspend-b')]);
    const elsewhere = await addMembership(b.tenantId, a.member.userId, {
      role: 'MEMBER',
      permissions: ['platform:team:read'],
    });

    await a.admin.api('POST', `/api/platform/team/members/${a.member.userId}/suspend`);

    const res = await fetch(`${BASE}/api/platform/team/members`, {
      headers: { cookie: `${SESSION_COOKIE}=${elsewhere}` },
    });
    assert.equal(res.status, 200);
  });

  contractTest('suspending twice is the state that was asked for, not an error', async () => {
    const { admin, member } = await makeTeam('suspend-twice');
    const first = await admin.api('POST', `/api/platform/team/members/${member.userId}/suspend`);
    const second = await admin.api('POST', `/api/platform/team/members/${member.userId}/suspend`);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    const list = await admin.api('GET', '/api/platform/team/members');
    assert.equal(list.body.data.items.find((m: any) => m.userId === member.userId).suspended, true);
  });

  contractTest('nobody suspends themselves', async () => {
    const { admin } = await makeTeam('suspend-self');
    const res = await admin.api('POST', `/api/platform/team/members/${admin.userId}/suspend`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'SELF_TARGET');
  });
});

/* -----------------------------------------------------------------------------
 * Removal
 * -------------------------------------------------------------------------- */

describe('removing somebody takes the membership, never the person', () => {
  contractTest('their next request no longer reaches this company', async () => {
    const tenantId = await makeTenant('remove-access');
    const [admin, agent] = await Promise.all([
      makeMember(tenantId, { role: 'ADMIN' }),
      makeAgent(tenantId),
    ]);

    assert.equal((await agent.api('GET', '/api/erp/orders')).status, 200);

    const removed = await admin.api('DELETE', `/api/platform/team/members/${agent.userId}`);
    assert.equal(removed.status, 200);

    // 403 with no active tenant rather than 401: the session is still valid, it
    // just no longer names a company this person belongs to.
    const after = await agent.api('GET', '/api/erp/orders');
    assert.equal(after.status, 403);
    assert.equal(after.body.error.code, 'NO_ACTIVE_TENANT');
  });

  contractTest('the account survives, because one person has many employers', async () => {
    const { admin, member } = await makeTeam('remove-account');
    await admin.api('DELETE', `/api/platform/team/members/${member.userId}`);

    const user = await asPlatform().user.findUnique({ where: { id: member.userId } });
    assert.ok(user, 'the User row must outlive the membership');
    assert.equal(user!.deletedAt, null);

    const list = await admin.api('GET', '/api/platform/team/members');
    assert.ok(!list.body.data.items.some((m: any) => m.userId === member.userId));
  });

  contractTest('somebody who was never here is a 404', async () => {
    const [a, b] = await Promise.all([makeTeam('remove-cross-a'), makeTeam('remove-cross-b')]);
    const res = await a.admin.api('DELETE', `/api/platform/team/members/${b.member.userId}`);
    assert.equal(res.status, 404);

    const theirs = await b.admin.api('GET', '/api/platform/team/members');
    assert.ok(theirs.body.data.items.some((m: any) => m.userId === b.member.userId));
  });

  contractTest('nobody removes themselves from here', async () => {
    const { admin } = await makeTeam('remove-self');
    const res = await admin.api('DELETE', `/api/platform/team/members/${admin.userId}`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'SELF_TARGET');
  });
});

/* -----------------------------------------------------------------------------
 * Invitations
 * -------------------------------------------------------------------------- */

describe('an invitation carries a role, states its delivery, and shows its token once', () => {
  contractTest('inviting returns the link and says no mail is configured', async () => {
    const { admin } = await makeTeam('invite-link');
    const email = newEmail();
    const res = await invite(admin, email, 'VIEWER');

    assert.equal(res.status, 201);
    assert.equal(res.body.data.email, email);
    assert.equal(res.body.data.role, 'VIEWER');
    assert.equal(res.body.data.state, 'open');
    // Stated, not simulated — the same stance the AI surface takes with its 501.
    assert.equal(res.body.data.delivery, 'none');
    assert.equal(res.body.data.path, `/console/join/${res.body.data.token}`);
    assert.ok(res.body.data.url.endsWith(res.body.data.path));
    assert.ok(res.body.data.token.length >= 32);
  });

  contractTest('and the list never carries a token again', async () => {
    const { admin } = await makeTeam('invite-once');
    const email = newEmail();
    const created = await invite(admin, email);

    const list = await admin.api('GET', '/api/platform/team/invitations');
    assert.equal(list.status, 200);
    const row = list.body.data.items.find((i: any) => i.email === email);
    assert.ok(row, 'the invitation must be listed');
    assert.equal(row.state, 'open');
    assert.equal(row.token, undefined);
    // Nothing in the row is the secret, under any key.
    assert.ok(!JSON.stringify(row).includes(created.body.data.token));
  });

  contractTest('an address is compared without regard to case', async () => {
    const { admin } = await makeTeam('invite-case');
    const email = newEmail();
    const first = await invite(admin, email.toUpperCase());
    assert.equal(first.status, 201);
    assert.equal(first.body.data.email, email.toLowerCase());

    const second = await invite(admin, email);
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'ALREADY_INVITED');
  });

  contractTest('somebody already on the team is refused, however they are spelled', async () => {
    const { admin, member } = await makeTeam('invite-member');
    const existing = await asPlatform().user.findUnique({ where: { id: member.userId } });
    const res = await invite(admin, existing!.email.toUpperCase());
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'ALREADY_MEMBER');
  });

  contractTest('revoking retires the link, and a fresh invitation issues a new one', async () => {
    const { admin } = await makeTeam('invite-revoke');
    const email = newEmail();
    const first = await invite(admin, email);

    const revoked = await admin.api(
      'POST',
      `/api/platform/team/invitations/${first.body.data.id}/revoke`,
    );
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.data.state, 'revoked');

    // Not a second row — `@@unique([tenantId, email])` — and not the old token.
    const second = await invite(admin, email, 'MANAGER');
    assert.equal(second.status, 201);
    assert.notEqual(second.body.data.token, first.body.data.token);
    assert.equal(second.body.data.state, 'open');
    assert.equal(second.body.data.role, 'MANAGER');

    const list = await admin.api('GET', '/api/platform/team/invitations');
    assert.equal(list.body.data.items.filter((i: any) => i.email === email).length, 1);
  });

  contractTest('revoking twice is the state that was asked for', async () => {
    const { admin } = await makeTeam('invite-revoke-twice');
    const created = await invite(admin, newEmail());
    const path = `/api/platform/team/invitations/${created.body.data.id}/revoke`;
    assert.equal((await admin.api('POST', path)).status, 200);
    const again = await admin.api('POST', path);
    assert.equal(again.status, 200);
    assert.equal(again.body.data.state, 'revoked');
  });

  contractTest('an accepted invitation is not revocable — the membership is the thing now', async () => {
    const { tenantId, admin } = await makeTeam('invite-accepted');
    const created = await invite(admin, newEmail());
    await withTenant(tenantId, (tx) =>
      (tx as any).invitation.update({
        where: { id: created.body.data.id },
        data: { acceptedAt: new Date() },
      }),
    );

    const res = await admin.api(
      'POST',
      `/api/platform/team/invitations/${created.body.data.id}/revoke`,
    );
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'ALREADY_ACCEPTED');
  });

  contractTest('an expired invitation says so without anybody sweeping it', async () => {
    const { tenantId, admin } = await makeTeam('invite-expired');
    const created = await invite(admin, newEmail());
    await withTenant(tenantId, (tx) =>
      (tx as any).invitation.update({
        where: { id: created.body.data.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      }),
    );

    const list = await admin.api('GET', '/api/platform/team/invitations');
    const row = list.body.data.items.find((i: any) => i.id === created.body.data.id);
    assert.equal(row.state, 'expired');
  });

  contractTest('another company’s invitation does not exist', async () => {
    const [a, b] = await Promise.all([makeTeam('invite-cross-a'), makeTeam('invite-cross-b')]);
    const theirs = await invite(b.admin, newEmail());

    const list = await a.admin.api('GET', '/api/platform/team/invitations');
    assert.equal(list.body.data.items.length, 0);

    const res = await a.admin.api(
      'POST',
      `/api/platform/team/invitations/${theirs.body.data.id}/revoke`,
    );
    assert.equal(res.status, 404);
  });

  contractTest('an address that is not an address is refused', async () => {
    const { admin } = await makeTeam('invite-bogus');
    for (const email of ['', 'not-an-address', 'a@', '@b.test']) {
      const res = await invite(admin, email);
      assert.equal(res.status, 422, `expected 422 for ${JSON.stringify(email)}`);
    }
  });
});
