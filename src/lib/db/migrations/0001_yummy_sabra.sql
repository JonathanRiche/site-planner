PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO `__new_searches`("id", "url", "created_at") SELECT "id", "url", "created_at" FROM `searches`;--> statement-breakpoint
DROP TABLE `searches`;--> statement-breakpoint
ALTER TABLE `__new_searches` RENAME TO `searches`;--> statement-breakpoint
PRAGMA foreign_keys=ON;