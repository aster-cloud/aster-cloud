// Password-reset token hashing — hash-at-rest, mirroring lib/renewal-tokens.ts.
//
// The raw token is 32 random bytes (hex) minted in forgot-password and shipped
// only in the emailed link. The DB stores sha256(raw) so that a read-only DB
// leak cannot yield directly-usable reset links (account takeover). reset-password
// hashes the incoming raw token and looks the row up by hash (audit #168).

import { createHash } from 'node:crypto';

/** sha256(raw) as lowercase hex — the value persisted in PasswordResetToken.token. */
export function hashResetToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
