CREATE TABLE `shopping_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`external_id` text NOT NULL,
	`parent_external_id` text,
	`name` text NOT NULL,
	`excluded` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_categories_project_external_idx` ON `shopping_categories` (`project_id`,`external_id`);--> statement-breakpoint
ALTER TABLE `shopping_products` ADD `category_external_id` text;