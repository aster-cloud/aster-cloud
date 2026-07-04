import { NextRequest, NextResponse } from 'next/server';
import { db, passwordResetTokens, users } from '@/lib/prisma';
import { sendPasswordResetEmail } from '@/lib/resend';
import { hashResetToken } from '@/lib/password-reset-tokens';
import { checkRateLimit, RateLimitPresets, getClientIp } from '@/lib/rate-limit';
import { eq } from 'drizzle-orm';

// Generate secure random bytes using Web Crypto API (works in both Node.js and Cloudflare Workers)
function randomBytes(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Rate limit by IP + email to blunt reset-email bombing / user enumeration.
    const clientIp = getClientIp(request);
    const rl = checkRateLimit(
      `forgot-password:${clientIp}:${email.toLowerCase()}`,
      RateLimitPresets.PASSWORD_RESET,
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many password reset requests. Please try again later.' },
        { status: 429, headers: rl.retryAfterSeconds ? { 'Retry-After': String(rl.retryAfterSeconds) } : undefined },
      );
    }

    // Check if user exists with this email
    const user = await db.query.users.findFirst({
      where: eq(users.email, email.toLowerCase()),
    });

    // Always return success to prevent email enumeration attacks
    if (!user) {
      return NextResponse.json({ success: true });
    }

    // Delete any existing tokens for this email
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.email, email.toLowerCase()));

    // Generate a secure raw token (only ever shipped in the emailed link).
    const token = randomBytes(32);

    // Token expires in 1 hour
    const expires = new Date();
    expires.setHours(expires.getHours() + 1);

    // Persist only sha256(token): a read-only DB leak cannot reconstruct the
    // usable reset link (audit #168, mirrors lib/renewal-tokens.ts).
    await db.insert(passwordResetTokens).values({
      id: globalThis.crypto.randomUUID(),
      email: email.toLowerCase(),
      token: hashResetToken(token),
      expires,
    });

    // Send reset email with the raw token
    await sendPasswordResetEmail(email, token);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
