import { NextRequest, NextResponse } from 'next/server';
import { db, passwordResetTokens, users } from '@/lib/prisma';
import { sendPasswordResetEmail } from '@/lib/resend';
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

    // Generate a secure token
    const token = randomBytes(32);

    // Token expires in 1 hour
    const expires = new Date();
    expires.setHours(expires.getHours() + 1);

    // Save token to database
    await db.insert(passwordResetTokens).values({
      id: globalThis.crypto.randomUUID(),
      email: email.toLowerCase(),
      token,
      expires,
    });

    // Send reset email
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
