import { drizzle } from 'drizzle-orm/d1';
import { desc } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { searches } from './schema';

export function getDb() {
  return drizzle(env.SITE_PLANNER_DB);
}

export { searches };
export type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

// Type helpers
export type Search = InferSelectModel<typeof searches>;
export type NewSearch = InferInsertModel<typeof searches>;

// Query helpers
export async function getRecentSearches(limit = 10): Promise<Search[]> {
  const db = getDb();
  return await db.select().from(searches).orderBy(desc(searches.createdAt)).limit(limit);
}