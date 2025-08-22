import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const searches = sqliteTable('searches', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});
