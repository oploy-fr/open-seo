CREATE TABLE "shopping_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"external_id" text NOT NULL,
	"parent_external_id" text,
	"name" text NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shopping_products" ADD COLUMN "category_external_id" text;--> statement-breakpoint
ALTER TABLE "shopping_categories" ADD CONSTRAINT "shopping_categories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_categories_project_external_idx" ON "shopping_categories" USING btree ("project_id","external_id");