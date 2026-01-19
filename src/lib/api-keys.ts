import { randomBytes, createHash } from 'crypto';
import { db, apiKeys } from '@/lib/prisma';
import { eq, desc, isNull, and, lt } from 'drizzle-orm';

// Generate a new API key
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  // Generate 32 random bytes -> 64 hex chars
  const rawKey = randomBytes(32).toString('hex');

  // Key format: ak_<prefix>_<rest>
  const prefix = rawKey.substring(0, 8);
  const key = `ak_${rawKey}`;

  // Hash the key for storage
  const hash = hashApiKey(key);

  return { key, hash, prefix };
}

// Hash an API key for storage
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// Create a new API key for a user
export async function createApiKey(userId: string, name: string): Promise<{
  id: string;
  key: string;
  prefix: string;
  name: string;
  createdAt: Date;
}> {
  const { key, hash, prefix } = generateApiKey();

  const [apiKey] = await db.insert(apiKeys).values({
    id: crypto.randomUUID(),
    userId,
    name,
    key: hash,
    prefix,
  }).returning();

  // Return the raw key only once - it cannot be retrieved later
  return {
    id: apiKey.id,
    key,
    prefix: apiKey.prefix,
    name: apiKey.name,
    createdAt: apiKey.createdAt,
  };
}

// Validate an API key and return the associated user
export async function validateApiKey(key: string): Promise<{
  valid: boolean;
  userId?: string;
  apiKeyId?: string;
  error?: string;
}> {
  if (!key || !key.startsWith('ak_')) {
    return { valid: false, error: 'Invalid API key format' };
  }

  const hash = hashApiKey(key);

  const apiKey = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.key, hash),
    with: {
      user: {
        columns: {
          id: true,
          plan: true,
          trialEndsAt: true,
        },
      },
    },
  });

  if (!apiKey) {
    return { valid: false, error: 'Invalid API key' };
  }

  // Check if key is revoked
  if (apiKey.revokedAt) {
    return { valid: false, error: 'API key has been revoked' };
  }

  // Check if key is expired
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return { valid: false, error: 'API key has expired' };
  }

  // Check if user has API access
  const plan = apiKey.user.plan;
  const hasApiAccess = plan !== 'free';

  // Check trial expiry
  if (plan === 'trial' && apiKey.user.trialEndsAt && apiKey.user.trialEndsAt < new Date()) {
    return { valid: false, error: 'Trial has expired. Please upgrade to continue using the API.' };
  }

  if (!hasApiAccess) {
    return { valid: false, error: 'API access requires a Pro or Team subscription' };
  }

  // Update last used timestamp
  await db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, apiKey.id));

  return {
    valid: true,
    userId: apiKey.userId,
    apiKeyId: apiKey.id,
  };
}

// List API keys for a user (without the actual key)
export async function listApiKeys(userId: string) {
  const keys = await db.query.apiKeys.findMany({
    where: and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)),
    columns: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: [desc(apiKeys.createdAt)],
  });

  return keys;
}

// Revoke an API key
export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  const result = await db.update(apiKeys)
    .set({
      revokedAt: new Date(),
    })
    .where(
      and(
        eq(apiKeys.id, keyId),
        eq(apiKeys.userId, userId),
        isNull(apiKeys.revokedAt)
      )
    )
    .returning();

  return result.length > 0;
}

// API 认证结果类型
export type ApiAuthResult =
  | {
      success: true;
      userId: string;
      apiKeyId: string;
    }
  | {
      success: false;
      error: string;
      status: number;
    };

// 从请求中验证 API Key 的辅助函数
export async function authenticateApiRequest(req: Request): Promise<ApiAuthResult> {
  const authHeader = req.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      success: false,
      error: 'Missing or invalid Authorization header',
      status: 401,
    };
  }

  const apiKey = authHeader.substring(7);
  const validation = await validateApiKey(apiKey);

  if (!validation.valid || !validation.userId) {
    return {
      success: false,
      error: validation.error || 'Invalid API key',
      status: 401,
    };
  }

  return {
    success: true,
    userId: validation.userId,
    apiKeyId: validation.apiKeyId!,
  };
}
