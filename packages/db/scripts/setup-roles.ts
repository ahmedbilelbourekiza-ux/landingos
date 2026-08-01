/* =============================================================================
 * Provision the application database role.
 *
 * The preflight found that Neon's default role, neondb_owner, carries
 * BYPASSRLS. A role with that attribute ignores row-level security entirely:
 * FORCE ROW LEVEL SECURITY does nothing, policies are never consulted, and an
 * isolation suite run as that role passes while enforcing nothing. That is the
 * exact false-confidence failure R-01 exists to prevent.
 *
 * So the platform uses two roles, which is what it would need in production
 * anyway:
 *
 *   neondb_owner    migrations and DDL. Owns the tables. Keeps BYPASSRLS,
 *                   which is harmless because it never serves a request.
 *
 *   landingos_app   everything the application does. NOBYPASSRLS, and NOT the
 *                   owner of any table, so row-level security genuinely
 *                   applies to it. This is the connection Prisma Client uses.
 *
 * Both facts matter independently. Dropping BYPASSRLS is not enough on its own
 * — a table's OWNER also bypasses RLS unless the table is FORCEd — so the app
 * role is deliberately not an owner, and Phase 3.3 will FORCE every
 * tenant-scoped table as well. Two independent reasons the policy holds.
 *
 * Idempotent. Safe to re-run; pass --rotate to issue a fresh password.
 *
 * Run:  npm run setup:roles --workspace @landingos/db
 * ========================================================================== */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '../prisma/client/index.js';

const APP_ROLE = 'landingos_app';
const ENV_PATH = path.join(import.meta.dirname, '..', '.env');
const ROTATE = process.argv.includes('--rotate');

/** Read a key out of .env without printing anything. */
function readEnvValue(key: string): string | null {
  if (!fs.existsSync(ENV_PATH)) return null;
  const m = fs
    .readFileSync(ENV_PATH, 'utf8')
    .match(new RegExp(`^${key}\\s*=\\s*"?([^"\\n\\r]+)"?`, 'm'));
  return m ? m[1] : null;
}

function writeEnvValue(key: string, value: string) {
  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const line = `${key}="${value}"`;
  const re = new RegExp(`^${key}\\s*=.*$`, 'm');
  const next = re.test(existing)
    ? existing.replace(re, line)
    : existing.trimEnd() + '\n' + line + '\n';
  fs.writeFileSync(ENV_PATH, next, 'utf8');
}

/**
 * Neon serves a pooled and a direct endpoint. Migrations should use the direct
 * one — the pooler multiplexes sessions, which breaks advisory locks and
 * long-running DDL.
 */
const toDirect = (url: string) => url.replace('-pooler.', '.');

/** Swap the credentials in a connection string, keeping everything else. */
function withCredentials(url: string, user: string, password: string) {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

async function main() {
  const ownerUrl = readEnvValue('MIGRATE_DATABASE_URL') ?? readEnvValue('DATABASE_URL');
  if (!ownerUrl) throw new Error('No DATABASE_URL in packages/db/.env');

  // Connect explicitly as the owner — DATABASE_URL may already point at the
  // app role by the time this is re-run.
  const prisma = new PrismaClient({ datasources: { db: { url: ownerUrl } } });

  const [who] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT current_user AS role, current_database() AS db,
            (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user) AS can_create_role`,
  );
  console.log(`connected as ${who.role}@${who.db}`);
  if (!who.can_create_role) {
    throw new Error(`${who.role} cannot CREATE ROLE — provision ${APP_ROLE} manually`);
  }

  const [existing] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT rolname FROM pg_roles WHERE rolname = $1`,
    APP_ROLE,
  );

  let password = readEnvValue('APP_DB_PASSWORD');
  if (!existing || ROTATE || !password) {
    password = crypto.randomBytes(24).toString('base64url');
  }

  if (existing) {
    console.log(`role ${APP_ROLE} exists`);
    if (ROTATE || !readEnvValue('APP_DB_PASSWORD')) {
      await prisma.$executeRawUnsafe(
        `ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${password!.replace(/'/g, "''")}'`,
      );
      console.log('  password reissued');
    }
  } else {
    await prisma.$executeRawUnsafe(
      `CREATE ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${password!.replace(/'/g, "''")}'`,
    );
    console.log(`role ${APP_ROLE} created`);
  }

  // NOT asserted with ALTER ROLE, deliberately. Postgres lets only a superuser
  // change SUPERUSER or BYPASSRLS — even to turn them OFF — so an ALTER here
  // fails with "permission denied to alter role" against any managed provider.
  //
  // It is also unnecessary: CREATE ROLE defaults to NOSUPERUSER, NOBYPASSRLS,
  // NOCREATEDB and NOCREATEROLE. The attributes are therefore VERIFIED below
  // rather than set, and the script refuses to continue if they are wrong —
  // which is the behaviour that actually matters, since a role that bypasses
  // RLS would make every policy decorative.

  // Enough to run the application, and nothing more. No CREATE on the schema:
  // the app must not be able to define tables, only use them.
  await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await prisma.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
  );
  await prisma.$executeRawUnsafe(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`,
  );
  // Tables created by a LATER migration would otherwise be invisible to the app
  // until someone remembered to grant them — a failure that shows up as
  // "permission denied" on the one new feature, in production.
  await prisma.$executeRawUnsafe(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${who.role} IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${who.role} IN SCHEMA public
       GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}`,
  );
  console.log('  granted DML on existing and future tables');

  const [check] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT rolbypassrls, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = $1`,
    APP_ROLE,
  );
  if (check.rolbypassrls || check.rolsuper) {
    throw new Error(
      `${APP_ROLE} has ${check.rolsuper ? 'SUPERUSER' : 'BYPASSRLS'} — row-level security would not apply to it, ` +
        `which makes every policy decorative. Recreate it without that attribute (a superuser must do this).`,
    );
  }
  console.log(
    `  verified: NOBYPASSRLS, NOSUPERUSER` +
      `${check.rolcreatedb ? ', WARNING: has CREATEDB' : ''}` +
      `${check.rolcreaterole ? ', WARNING: has CREATEROLE' : ''}`,
  );

  // MIGRATE_DATABASE_URL keeps the owner, on the direct endpoint.
  // DATABASE_URL becomes the app role — so every ordinary Prisma call, and
  // every test, runs under the role that RLS actually applies to.
  writeEnvValue('MIGRATE_DATABASE_URL', toDirect(ownerUrl));
  writeEnvValue('DATABASE_URL', withCredentials(ownerUrl, APP_ROLE, password!));
  writeEnvValue('APP_DB_PASSWORD', password!);

  console.log('\npackages/db/.env updated (values not printed):');
  console.log('  DATABASE_URL          → ' + APP_ROLE + '  (runtime; RLS applies)');
  console.log('  MIGRATE_DATABASE_URL  → ' + who.role + '  (DDL, direct endpoint)');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('setup-roles failed:', e.message);
  process.exitCode = 1;
});
