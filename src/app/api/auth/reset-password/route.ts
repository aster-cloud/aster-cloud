import { NextRequest, NextResponse } from 'next/server';
import { db, passwordResetTokens, users } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { eq } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { error: 'Invalid reset token' },
        { status: 400 }
      );
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    // Find the token
    const resetToken = await db.query.passwordResetTokens.findFirst({
      where: eq(passwordResetTokens.token, token),
    });

    if (!resetToken) {
      return NextResponse.json(
        { error: 'Invalid or expired reset token' },
        { status: 400 }
      );
    }

    // Check if token has expired
    if (resetToken.expires < new Date()) {
      // Clean up expired token
      await db.delete(passwordResetTokens).where(eq(passwordResetTokens.id, resetToken.id));
      return NextResponse.json(
        { error: 'Reset token has expired' },
        { status: 400 }
      );
    }

    // Find the user
    const user = await db.query.users.findFirst({
      where: eq(users.email, resetToken.email),
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 400 }
      );
    }

    // Hash the new password
    const passwordHash = await hashPassword(password);

    // Update user password
    await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));

    // Delete the used token
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.id, resetToken.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
