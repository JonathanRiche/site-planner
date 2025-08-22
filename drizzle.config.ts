import type { Config } from 'drizzle-kit';

export default {
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  strict: true,
  dialect: 'sqlite',
} satisfies Config;
