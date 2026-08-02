import crypto from 'node:crypto';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';

/* =============================================================================
 * Password hashing (M-10).
 *
 * argon2id, per the approved architecture. Verification also accepts the ERP's
 * existing scrypt hashes, because those accounts have to keep working through
 * the migration — an ERP agent whose password stops being accepted on cutover
 * is a call-centre that cannot log in on a Monday morning.
 *
 * Both formats are SELF-DESCRIBING: argon2 emits PHC (`$argon2id$v=19$m=...`)
 * and the ERP wrote `scrypt$N$r$p$salt$hash`. That is what lets the two coexist
 * without a flag column, and what will let argon2's parameters be raised later
 * without invalidating anything already stored.
 *
 * `needsRehash` reports when a stored hash is not current, so a login can
 * transparently upgrade it. Old scrypt hashes therefore disappear as people
 * sign in, rather than needing a forced reset.
 * ========================================================================== */

/* OWASP's second recommended argon2id configuration: 19 MiB, 2 iterations,
 * 1 degree of parallelism. Chosen over the 46 MiB variant because this runs on
 * modest container memory and several logins can land at once. */
const ARGON = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Nothing legitimate is longer, and every extra byte is work an unauthenticated
 *  caller can make the server do. The ERP capped this for the same reason: its
 *  JSON body limit is 25MB, so without a cap a login could hand the KDF a 25MB
 *  "password". */
const MAX_PASSWORD_BYTES = 1024;

function normalize(plain: string): string {
  const s = String(plain ?? '');
  return Buffer.byteLength(s, 'utf8') > MAX_PASSWORD_BYTES ? s.slice(0, MAX_PASSWORD_BYTES) : s;
}

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(normalize(plain), ARGON);
}

/** True when the stored value is one of the ERP's scrypt hashes. */
function isScrypt(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith('scrypt$');
}

function scryptDerive(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: crypto.ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // The async form, deliberately. scryptSync would spend its entire cost
    // blocking the event loop, so a handful of concurrent logins — or one
    // attacker in a loop — would stall every other request on the server.
    crypto.scrypt(password, salt, keylen, opts, (err, key) =>
      err ? reject(err) : resolve(key as Buffer),
    );
  });
}

async function verifyScrypt(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [, N, r, p, saltHex, keyHex] = parts;

  /* Reject a malformed hash BEFORE deriving anything.
   *
   * Without this, `scrypt$$$$$` authenticates any password: the empty salt and
   * key parse to zero-length buffers, keylen becomes 0, and the comparison
   * reduces to timingSafeEqual(empty, empty) — which is true. Any row whose
   * hash was truncated or blanked would accept every password sent to it.
   *
   * The ERP's own migration deliberately hashed EMPTY passwords rather than
   * locking staff out mid-shift, so rows with unusual hash content are a state
   * this codebase has actually produced. */
  const params = [Number(N), Number(r), Number(p)];
  if (!params.every((n) => Number.isInteger(n) && n > 0)) return false;
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(keyHex)) return false;
  // scrypt's own minimum useful output; anything shorter is not a real hash.
  if (keyHex.length < 32 || saltHex.length < 8) return false;

  try {
    const derived = await scryptDerive(plain, Buffer.from(saltHex, 'hex'), keyHex.length / 2, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      // scrypt's default maxmem is 32MB and these parameters exceed it, which
      // would throw rather than return false — indistinguishable from a wrong
      // password to the caller, and a lockout for every migrated account.
      maxmem: 256 * 1024 * 1024,
    });
    const expected = Buffer.from(keyHex, 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Verify a password against either format. Never throws — a malformed stored
 * value is a failed login, not a 500.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const candidate = normalize(plain);
  if (!stored) return false;
  if (isScrypt(stored)) return verifyScrypt(candidate, stored);
  try {
    return await argonVerify(stored, candidate);
  } catch {
    return false;
  }
}

/** True when a successful login should quietly re-hash with current settings. */
export function needsRehash(stored: string): boolean {
  if (!stored) return true;
  if (isScrypt(stored)) return true;
  const m = stored.match(/\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)/);
  if (!m) return true;
  return (
    Number(m[1]) < ARGON.memoryCost ||
    Number(m[2]) < ARGON.timeCost ||
    Number(m[3]) !== ARGON.parallelism
  );
}

/* A fixed hash to check against when the account does not exist, so a miss
 * costs the same one derivation a hit does.
 *
 * Built ONCE and cached. The ERP learned this the expensive way: generating a
 * fresh decoy per request cost TWO derivations (hash then verify), which made
 * unknown accounts measurably SLOWER than real ones — leaking exactly what the
 * uniform error message was meant to hide, only backwards. */
let decoy: Promise<string> | null = null;

/**
 * Burn the same work a real verification would, for an account that does not
 * exist. Always resolves false.
 */
export async function verifyAgainstDecoy(plain: string): Promise<boolean> {
  decoy ??= hashPassword(crypto.randomBytes(32).toString('hex'));
  await verifyPassword(plain, await decoy);
  return false;
}

export const PASSWORD_LIMITS = { maxBytes: MAX_PASSWORD_BYTES } as const;
