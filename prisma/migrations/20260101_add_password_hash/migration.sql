-- Add passwordHash field to User table for secure password authentication
-- This migration adds support for email/password login with bcrypt hashing

ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;

-- Note: This column is nullable because:
-- 1. Existing users (OAuth-only) don't have passwords
-- 2. Users can sign up with OAuth and later add a password
-- 3. The application code handles null passwordHash by rejecting credential login
