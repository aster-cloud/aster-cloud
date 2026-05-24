#!/usr/bin/env node
/**
 * E2E test helper: sign a v2 license payload locally for on-prem
 * dry-runs. NOT for production — production licenses are signed by
 * the Vault Transit ceremony described in
 * `aster-deploy/docs/license-key-ceremony.md`.
 *
 * Two modes:
 *
 *   - `keygen`        Generate a fresh Ed25519 keypair, print pubKey
 *                     (base64) + fingerprint (sha256 hex of pubKey
 *                     bytes) + privKey (PKCS#8 PEM). Use the pubKey
 *                     fields to extend ASTER_TRUST_BUNDLE; use the
 *                     PEM to sign payloads below.
 *
 *   - `sign`          Sign a payload supplied via flags or JSON
 *                     stdin. Outputs a complete LICENSE_KEY string
 *                     ready to paste into the on-prem container env.
 *
 * Usage examples:
 *
 *   # 1. Mint a keypair
 *   node sign-license.mjs keygen --key-id e2e-lic-2026 > e2e-lic.pem
 *
 *   # 2. Sign a happy-path license (90 days valid)
 *   node sign-license.mjs sign \
 *     --priv-key-file e2e-lic.pem \
 *     --key-id e2e-lic-2026 \
 *     --license-id e2e-001 \
 *     --customer "E2E Test Tenant" \
 *     --tier enterprise \
 *     --expires-in 90d \
 *     --deployment-id $(printf 'local-e2e' | shasum -a 256 | cut -d' ' -f1) \
 *     --deployment-label "Local E2E"
 *
 *   # 3. Sign a revocation manifest (stage 6)
 *   node sign-license.mjs sign-revocation \
 *     --priv-key-file e2e-rev.pem \
 *     --version 1 \
 *     --revoke "e2e-001:security"
 *
 * The keypair files contain raw PKCS#8 PEM and must be deleted after
 * the test session — this script never touches the file system except
 * via the user-provided flags.
 */

import { generateKeyPairSync, sign, createPrivateKey, createPublicKey, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';

const args = process.argv.slice(2);
const cmd = args.shift();

function flag(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx < 0) return fallback;
  return args[idx + 1];
}

function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function pubKeyRawBase64(publicKey) {
  // Ed25519 public key in raw 32-byte form, base64-encoded (standard, not url-safe)
  // matches what TrustBundleEntry.pubKey expects.
  const der = publicKey.export({ format: 'der', type: 'spki' });
  // SPKI prefix for Ed25519 is 12 bytes: 30 2A 30 05 06 03 2B 65 70 03 21 00
  const raw = der.subarray(der.length - 32);
  return Buffer.from(raw).toString('base64');
}

function fingerprintHex(rawPubB64) {
  const bytes = Buffer.from(rawPubB64, 'base64');
  return createHash('sha256').update(bytes).digest('hex');
}

function parseExpiresIn(spec) {
  // Accepts "Xd", "Xh", "Xm", or "-Xd" (past, for stage 5)
  const m = /^(-?\d+)([dhm])$/.exec(spec);
  if (!m) throw new Error(`bad --expires-in: ${spec} (use Xd/Xh/Xm)`);
  const n = Number(m[1]);
  const unit = m[2] === 'd' ? 86400 : m[2] === 'h' ? 3600 : 60;
  return n * unit * 1000;
}

function isoNow() {
  return new Date().toISOString();
}

function isoIn(ms) {
  return new Date(Date.now() + ms).toISOString();
}

if (cmd === 'keygen') {
  const keyId = flag('key-id', 'e2e-lic');
  const outFile = flag('out-file');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubB64 = pubKeyRawBase64(publicKey);
  const fp = fingerprintHex(pubB64);
  const pemPriv = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

  if (outFile) {
    // Atomic write + chmod 0600 so the private key never sits on disk
    // with default 644 readable by other users on a shared machine. The
    // previous interface used shell redirect (`> key.pem`), which
    // honored the user's umask — typically 022 → 644, leaving the
    // private key world-readable in /tmp on macOS. Setting --out-file
    // bypasses the shell and locks permissions before the file is
    // written.
    writeFileSync(outFile, pemPriv, { mode: 0o600, flag: 'w' });
    // chmod is redundant if open(2) honors mode, but some filesystems
    // (e.g. SMB mounts) ignore mode on creation. Belt-and-suspenders.
    chmodSync(outFile, 0o600);
    process.stderr.write(
      JSON.stringify({ keyId, pubKey: pubB64, fingerprint: fp, outFile, mode: '0600' }, null, 2) + '\n',
    );
    process.exit(0);
  }

  // Legacy stdout path. Print a security warning to stderr — shell
  // redirect (`> e2e.pem`) creates the file with umask-default perms
  // (typically 644 on macOS, world-readable in /tmp). Prefer --out-file
  // for production-shaped harnesses.
  process.stderr.write(
    '[sign-license] WARNING: PEM written to stdout — shell redirect creates the file with umask\n' +
      '                 default permissions. On a multi-user host this can leak the signing key.\n' +
      '                 Prefer: --out-file <path> (creates file with mode 0600 atomically).\n',
  );
  process.stderr.write(JSON.stringify({ keyId, pubKey: pubB64, fingerprint: fp }, null, 2) + '\n');
  process.stdout.write(pemPriv);
  process.exit(0);
}

if (cmd === 'sign') {
  const privPath = flag('priv-key-file');
  if (!privPath) throw new Error('--priv-key-file is required');
  const pem = readFileSync(privPath, 'utf8');
  const privateKey = createPrivateKey(pem);

  const keyId = flag('key-id', 'e2e-lic');
  const licenseId = flag('license-id', `e2e-${Date.now()}`);
  const customer = flag('customer', 'E2E Test Tenant');
  const tier = flag('tier', 'enterprise');
  const sku = flag('sku', 'standard');
  const term = flag('license-term', 'annual');
  const seatLimit = Number(flag('seat-limit', '50'));
  const features = (flag('features', '') || '').split(',').filter(Boolean);
  const expiresMs = parseExpiresIn(flag('expires-in', '90d'));
  const notBefore = flag('not-before'); // optional ISO
  const deploymentId = flag('deployment-id');
  if (!deploymentId || !/^[0-9a-f]{64}$/.test(deploymentId)) {
    throw new Error(
      '--deployment-id must be 64-char lowercase hex (sha256). ' +
        'Compute e.g.: printf "your-id" | shasum -a 256 | cut -d" " -f1',
    );
  }
  const deploymentLabel = flag('deployment-label', 'Local E2E');
  const deploymentUrl = flag('deployment-url');
  // license.ts requires https:// for the parse to accept the payload
  // (line 343 of license.ts). For local E2E we lie about the scheme —
  // the URL is only meaningful to the revocation-refresh loop, which
  // we drive separately by writing to the licenseCache DB row, so the
  // value here doesn't actually need to be reachable.
  const revocationCheckUrl = flag('revocation-check-url', 'https://localhost:7700/revocation.json');

  const payload = {
    schemaVersion: 2,
    licenseId,
    keyId,
    customer,
    issuedAt: isoNow(),
    expiresAt: isoIn(expiresMs),
    ...(notBefore ? { notBefore } : {}),
    seatLimit,
    tier,
    features,
    sku,
    licenseTerm: term,
    deploymentBinding: {
      deploymentId,
      deploymentLabel,
      ...(deploymentUrl ? { deploymentUrl } : {}),
    },
    ...(sku === 'air-gapped' ? {} : { revocationCheckUrl }),
  };

  const payloadJson = JSON.stringify(payload);
  const payloadBytes = Buffer.from(payloadJson, 'utf8');
  const sigBytes = sign(null, payloadBytes, privateKey);
  const payloadB64 = base64url(payloadBytes);
  const sigB64 = base64url(sigBytes);
  const licenseKey = `aster-ent-v2-${keyId}-${payloadB64}.${sigB64}`;

  process.stderr.write(JSON.stringify({ payload, len: licenseKey.length }, null, 2) + '\n');
  process.stdout.write(licenseKey);
  process.exit(0);
}

if (cmd === 'sign-revocation') {
  // Produces a SignedRevocationDoc that license-revocation.ts can verify.
  // Canonicalization rule from src/lib/license-revocation.ts: sortKeys
  // + JSON.stringify of doc-without-signature.
  const privPath = flag('priv-key-file');
  if (!privPath) throw new Error('--priv-key-file is required');
  const pem = readFileSync(privPath, 'utf8');
  const privateKey = createPrivateKey(pem);

  const version = Number(flag('version', '1'));
  const validForMs = parseExpiresIn(flag('valid-for', '7d'));
  const revokes = args
    .filter((a) => a.startsWith('--revoke'))
    .map((_, i) => args[args.indexOf('--revoke') + 1 + 2 * i])
    .filter(Boolean);
  // Simpler: collect all --revoke pairs via repeated extraction
  const revokeSpecs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--revoke') revokeSpecs.push(args[i + 1]);
  }

  const revoked = revokeSpecs.map((spec) => {
    const [licenseId, reason = 'security'] = spec.split(':');
    return { licenseId, revokedAt: isoNow(), reason };
  });

  const unsigned = {
    schemaVersion: 1,
    version,
    publishedAt: isoNow(),
    validUntil: isoIn(validForMs),
    revoked,
  };

  // Match canonicalization: deep-sort keys then JSON.stringify (no spaces)
  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
      return out;
    }
    return v;
  }
  const canonical = Buffer.from(JSON.stringify(sortKeys(unsigned)), 'utf8');
  const sigBytes = sign(null, canonical, privateKey);
  const signature = base64url(sigBytes);

  const doc = { ...unsigned, signature };
  process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
  process.exit(0);
}

process.stderr.write(
  'usage:\n' +
    '  sign-license.mjs keygen --key-id <id> > key.pem\n' +
    '  sign-license.mjs sign --priv-key-file key.pem --key-id <id> --license-id <id> ' +
    '--customer "..." --expires-in 90d --deployment-id <64-hex>\n' +
    '  sign-license.mjs sign-revocation --priv-key-file rev.pem --version 1 --revoke <licId>:<reason>\n',
);
process.exit(2);
