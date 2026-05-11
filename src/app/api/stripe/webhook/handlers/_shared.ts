import { and, eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { db, users, teams, teamMembers } from '@/lib/prisma';
import { lookupPriceId, type PlanType } from '@/lib/plans';

export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'unpaid'
  | 'paused';

/**
 * v1.1 PM grandfather：把 Stripe priceId 反查得到的档位映射为内部 plan
 *
 * - team priceId → plan='pro' + legacyTier='team'（v3 dead-code path：DB 已无老 Team 客户）
 * - pro priceId  → plan='pro'
 * - 未识别        → null
 */
export function resolvePlanFromPriceId(
  priceId: string | null | undefined
): { plan: PlanType; legacyTier: string | null } | null {
  const info = lookupPriceId(priceId);
  if (!info) return null;
  if (info.plan === 'team') {
    return { plan: 'pro', legacyTier: 'team' };
  }
  return { plan: info.plan, legacyTier: null };
}

const MAX_SLUG_LENGTH = 256;
const USER_ID_SUFFIX_LENGTH = 12;

/**
 * Build a URL-safe, deterministic slug for a personal team workspace.
 *
 * - Unicode-friendly: NFKD + diacritic stripping handles ä/ö/ü/é/ñ/å
 * - CJK fallback: pure CJK names fall back to 'workspace' (baseLabel keeps original)
 * - Collision-resistant: 12-char userId suffix (UUID v4 collision ≈ 5.4e-15)
 * - Bounded length: 256 chars max
 */
export function buildPersonalTeamSlug(opts: {
  name?: string | null;
  email?: string | null;
  userId: string;
}): { baseLabel: string; slug: string } {
  const baseLabel =
    opts.name?.trim() || opts.email?.split('@')[0]?.trim() || 'workspace';

  const stripped = baseLabel
    .normalize('NFKD')
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[̀-ͯ]/g, '');

  const safeBase =
    stripped
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .replace(/-+/g, '-') || 'workspace';

  const suffix = opts.userId.slice(0, USER_ID_SUFFIX_LENGTH);
  const fullSlug = `${safeBase}-${suffix}`;
  const slug =
    fullSlug.length > MAX_SLUG_LENGTH ? fullSlug.slice(0, MAX_SLUG_LENGTH) : fullSlug;

  return { baseLabel, slug };
}

/**
 * PM v1.1: when a user upgrades to Pro/Enterprise, ensure they own at least one team
 * workspace.
 *
 * **Concurrency-safe** (Phase 2 hardening per codex audit Info-4):
 * 1. Read-check optimizes the common case (no team exists → insert).
 * 2. Slug is deterministic from userId — concurrent inserts collide on the
 *    `Team_slug_key` unique constraint instead of creating duplicates.
 * 3. Unique-violation is caught and logged; the race-loser then re-reads to
 *    discover the team the winner created.
 *
 * The `teams.ownerId` column is NOT unique (users may own multiple teams),
 * so we rely on `slug` uniqueness as the natural idempotency key.
 */
export async function ensurePersonalTeam(userId: string): Promise<void> {
  if (await ownsAnyTeam(userId)) return;

  const owner = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { name: true, email: true },
  });
  if (!owner) return;

  const { baseLabel, slug } = buildPersonalTeamSlug({
    name: owner.name,
    email: owner.email,
    userId,
  });

  const teamId = globalThis.crypto.randomUUID();
  try {
    await db.insert(teams).values({
      id: teamId,
      name: `${baseLabel}'s workspace`,
      slug,
      ownerId: userId,
    });
    await db.insert(teamMembers).values({
      id: globalThis.crypto.randomUUID(),
      teamId,
      userId,
      role: 'owner',
    });
  } catch (err) {
    if (isUniqueViolation(err) && (await ownsAnyTeam(userId))) {
      // Concurrent webhook won the race; idempotency preserved
      console.log(`[ensurePersonalTeam] race resolved for user ${userId}, slug=${slug}`);
      return;
    }
    throw err;
  }
}

async function ownsAnyTeam(userId: string): Promise<boolean> {
  const existing = await db.query.teamMembers.findFirst({
    where: and(eq(teamMembers.userId, userId), eq(teamMembers.role, 'owner')),
    columns: { teamId: true },
  });
  return existing != null;
}

function isUniqueViolation(err: unknown): boolean {
  // Postgres error code 23505 = unique_violation (pg-style errors via drizzle / postgres.js)
  if (typeof err === 'object' && err !== null) {
    const candidate = err as { code?: unknown; message?: unknown };
    if (candidate.code === '23505') return true;
    if (typeof candidate.message === 'string') {
      return candidate.message.toLowerCase().includes('unique')
        || candidate.message.toLowerCase().includes('duplicate');
    }
  }
  return false;
}

export type WebhookHandlerCtx = {
  // Reserved for future DI; handlers currently import directly from @/lib/prisma & @/lib/stripe
};

export type WebhookHandler<T extends Stripe.Event.Data.Object> = (
  data: T,
  ctx: WebhookHandlerCtx
) => Promise<void>;
