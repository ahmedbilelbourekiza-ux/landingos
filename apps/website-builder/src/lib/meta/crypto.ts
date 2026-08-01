import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

// Encrypts Meta CAPI access tokens at rest (AES-256-GCM). The key is derived
// from AUTH_SECRET via scrypt rather than requiring a second secret — every
// deployment already has AUTH_SECRET set (the app refuses to boot without
// it), so there is nothing new to configure on the host.
//
// Stored format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>". The IV is random
// per encryption call, so encrypting the same token twice yields different
// output — this is expected and does not affect decryption.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended for GCM

function deriveKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.trim() === "") {
    throw new Error(
      "AUTH_SECRET is required to encrypt/decrypt Meta pixel access tokens.",
    );
  }
  // Fixed salt is fine here: the secret itself is the actual entropy source,
  // and scrypt is used only to stretch it into a 32-byte AES key, not to
  // protect a low-entropy password.
  return scryptSync(secret, "landingos-meta-pixel-token", 32);
}

export function encryptToken(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptToken(stored: string): string {
  const [ivHex, authTagHex, dataHex] = stored.split(":");
  if (!ivHex || !authTagHex || !dataHex) {
    throw new Error("Malformed encrypted token — expected iv:authTag:ciphertext");
  }
  const key = deriveKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

// Masked preview for the admin UI — shows only the last 4 characters so an
// admin can recognize which token is which without the full secret ever
// round-tripping back to the browser.
export function maskToken(plaintext: string): string {
  if (plaintext.length <= 4) return "••••";
  return `••••••••${plaintext.slice(-4)}`;
}
