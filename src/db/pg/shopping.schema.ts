import { sql } from "drizzle-orm";
import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
import { ShoppingOfferMatch, ShoppingStatus } from "@/shared/shopping";

const STATUSES = [
  ShoppingStatus.Queued,
  ShoppingStatus.Running,
  ShoppingStatus.Completed,
  ShoppingStatus.Partial,
  ShoppingStatus.Failed,
] as const;

// The project's own catalogue, imported from the shop. `sku` is the shop's
// own product id, so a new import updates the same rows.
export const shoppingProducts = pgTable(
  "shopping_products",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    title: text("title").notNull(),
    brand: text("brand"),
    gtin: text("gtin"),
    category: text("category"),
    price: doublePrecision("price").notNull(),
    currency: text("currency").notNull(),
    url: text("url"),
    // Overrides the Google Shopping search built from brand and title.
    searchQuery: text("search_query"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("shopping_products_project_sku_idx").on(t.projectId, t.sku),
  ],
);

// One row per project once the schedule is set.
export const shoppingSettings = pgTable("shopping_settings", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  scheduleInterval: text("schedule_interval", {
    enum: ["manual", "weekly", "monthly"],
  }).notNull(),
  nextCheckAt: text("next_check_at"),
  updatedAt: text("updated_at").notNull(),
});

export const shoppingChecks = pgTable(
  "shopping_checks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status", { enum: STATUSES }).notNull(),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (t) => [
    index("shopping_checks_project_created_idx").on(t.projectId, t.createdAt),
    uniqueIndex("shopping_checks_one_active_idx")
      .on(t.projectId)
      .where(sql`${t.status} IN ('queued', 'running')`),
  ],
);

// One Google Shopping search per product per check. Our price is copied so
// a later import does not rewrite past comparisons.
export const shoppingLookups = pgTable(
  "shopping_lookups",
  {
    id: text("id").primaryKey(),
    checkId: text("check_id")
      .notNull()
      .references(() => shoppingChecks.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => shoppingProducts.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    ourPrice: doublePrecision("our_price").notNull(),
    taskId: text("task_id"),
    status: text("status", { enum: STATUSES }).notNull(),
    error: text("error"),
    completedAt: text("completed_at"),
  },
  (t) => [
    uniqueIndex("shopping_lookups_check_product_idx").on(
      t.checkId,
      t.productId,
    ),
    index("shopping_lookups_product_idx").on(t.productId),
  ],
);

export const shoppingOffers = pgTable(
  "shopping_offers",
  {
    id: text("id").primaryKey(),
    lookupId: text("lookup_id")
      .notNull()
      .references(() => shoppingLookups.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    title: text("title").notNull(),
    seller: text("seller"),
    domain: text("domain"),
    price: doublePrecision("price").notNull(),
    oldPrice: doublePrecision("old_price"),
    currency: text("currency"),
    googleProductId: text("google_product_id"),
    shoppingUrl: text("shopping_url"),
    match: text("match", {
      enum: [
        ShoppingOfferMatch.Match,
        ShoppingOfferMatch.Probable,
        ShoppingOfferMatch.Other,
      ],
    }).notNull(),
    matchScore: doublePrecision("match_score").notNull(),
  },
  (t) => [
    uniqueIndex("shopping_offers_lookup_rank_idx").on(t.lookupId, t.rank),
  ],
);
