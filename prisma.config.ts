import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Environment variables are automatically loaded by:
// - Vercel in production
// - Next.js during development (.env.local)

const databaseUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required');
}

export default defineConfig({
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  datasource: {
    url: databaseUrl,
  },
});
