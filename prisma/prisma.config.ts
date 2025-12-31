import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'schema.prisma'),
  migrate: {
    async adapter() {
      const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
      if (!connectionString) {
        throw new Error('DATABASE_URL or DIRECT_DATABASE_URL environment variable is required for migrations');
      }
      const { Pool } = await import('pg');
      const { PrismaPg } = await import('@prisma/adapter-pg');
      const pool = new Pool({ connectionString });
      return new PrismaPg(pool);
    },
  },
});
