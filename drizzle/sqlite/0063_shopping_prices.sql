CREATE TABLE `shopping_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shopping_checks_project_created_idx` ON `shopping_checks` (`project_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_checks_one_active_idx` ON `shopping_checks` (`project_id`) WHERE "shopping_checks"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE TABLE `shopping_lookups` (
	`id` text PRIMARY KEY NOT NULL,
	`check_id` text NOT NULL,
	`product_id` text NOT NULL,
	`query` text NOT NULL,
	`our_price` real NOT NULL,
	`task_id` text,
	`status` text NOT NULL,
	`error` text,
	`completed_at` text,
	FOREIGN KEY (`check_id`) REFERENCES `shopping_checks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `shopping_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_lookups_check_product_idx` ON `shopping_lookups` (`check_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `shopping_lookups_product_idx` ON `shopping_lookups` (`product_id`);--> statement-breakpoint
CREATE TABLE `shopping_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`lookup_id` text NOT NULL,
	`rank` integer NOT NULL,
	`title` text NOT NULL,
	`seller` text,
	`domain` text,
	`price` real NOT NULL,
	`old_price` real,
	`currency` text,
	`google_product_id` text,
	`shopping_url` text,
	`match` text NOT NULL,
	`match_score` real NOT NULL,
	FOREIGN KEY (`lookup_id`) REFERENCES `shopping_lookups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_offers_lookup_rank_idx` ON `shopping_offers` (`lookup_id`,`rank`);--> statement-breakpoint
CREATE TABLE `shopping_products` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`sku` text NOT NULL,
	`title` text NOT NULL,
	`brand` text,
	`gtin` text,
	`category` text,
	`price` real NOT NULL,
	`currency` text NOT NULL,
	`url` text,
	`search_query` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_products_project_sku_idx` ON `shopping_products` (`project_id`,`sku`);--> statement-breakpoint
CREATE TABLE `shopping_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`schedule_interval` text NOT NULL,
	`next_check_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
