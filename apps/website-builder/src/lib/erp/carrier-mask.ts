/* =============================================================================
 * The carrier credential mask.
 *
 * DELIBERATELY NOT `server-only`, unlike the rest of `lib/erp/`. Both sides need
 * this exact string: the API replaces a stored credential with it on the way out
 * and `preserveSecrets` recognises it on the way back in, and the console form
 * must be able to tell "this is the placeholder, do not send it" from "this is a
 * new key the user typed". Two copies of four bullet characters is two things
 * that can silently stop matching, and the failure when they do is that a real
 * API key gets overwritten with the mask — which errors nowhere until the next
 * shipment fails to book.
 *
 * It is four bullets, not a credential, so nothing here is a secret. What is
 * load-bearing is that there is exactly ONE of it.
 * ========================================================================== */

export const CARRIER_SECRET_MASK = "••••";

/** The fields that are masked. Named once, for the same reason. */
export const CARRIER_SECRET_FIELDS = ["apiKey", "secretKey", "webhookSecret"] as const;
