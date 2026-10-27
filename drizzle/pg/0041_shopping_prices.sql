CREATE TABLE "shopping_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" text NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "shopping_lookups" (
	"id" text PRIMARY KEY NOT NULL,
	"check_id" text NOT NULL,
	"product_id" text NOT NULL,
	"query" text NOT NULL,
	"our_price" double precision NOT NULL,
	"task_id" text,
	"status" text NOT NULL,
	"error" text,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "shopping_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"lookup_id" text NOT NULL,
	"rank" integer NOT NULL,
	"title" text NOT NULL,
	"seller" text,
	"domain" text,
	"price" double precision NOT NULL,
	"old_price" double precision,
	"currency" text,
	"google_product_id" text,
	"shopping_url" text,
	"match" text NOT NULL,
	"match_score" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_products" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"sku" text NOT NULL,
	"title" text NOT NULL,
	"brand" text,
	"gtin" text,
	"category" text,
	"price" double precision NOT NULL,
	"currency" text NOT NULL,
	"url" text,
	"search_query" text,
	"archived_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_settings" (
	"project_id" text PRIMARY KEY NOT NULL,
	"schedule_interval" text NOT NULL,
	"next_check_at" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shopping_checks" ADD CONSTRAINT "shopping_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lookups" ADD CONSTRAINT "shopping_lookups_check_id_shopping_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."shopping_checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lookups" ADD CONSTRAINT "shopping_lookups_product_id_shopping_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."shopping_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_offers" ADD CONSTRAINT "shopping_offers_lookup_id_shopping_lookups_id_fk" FOREIGN KEY ("lookup_id") REFERENCES "public"."shopping_lookups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_products" ADD CONSTRAINT "shopping_products_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_settings" ADD CONSTRAINT "shopping_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shopping_checks_project_created_idx" ON "shopping_checks" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_checks_one_active_idx" ON "shopping_checks" USING btree ("project_id") WHERE "shopping_checks"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_lookups_check_product_idx" ON "shopping_lookups" USING btree ("check_id","product_id");--> statement-breakpoint
CREATE INDEX "shopping_lookups_product_idx" ON "shopping_lookups" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_offers_lookup_rank_idx" ON "shopping_offers" USING btree ("lookup_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_products_project_sku_idx" ON "shopping_products" USING btree ("project_id","sku");