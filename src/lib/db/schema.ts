import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const searches = sqliteTable('searches', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  createdAt: text('created_at').default("CURRENT_TIMESTAMP"),
});
