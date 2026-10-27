import { z } from "zod";
import {
  MAX_SHOPPING_PRODUCTS,
  SHOPPING_SCHEDULE_INTERVALS,
} from "@/shared/shopping";

const projectId = z.string().min(1);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const shoppingProjectSchema = z.object({ projectId });

const shoppingProductInputSchema = z.object({
  sku: z.string().trim().min(1).max(100),
  title: z.string().trim().min(2).max(300),
  brand: optionalText(100),
  gtin: optionalText(20),
  category: optionalText(200),
  price: z.number().positive().max(1_000_000),
  currency: z.string().trim().length(3).default("EUR"),
  url: optionalText(1000),
});

export const importShoppingProductsSchema = shoppingProjectSchema.extend({
  products: z
    .array(shoppingProductInputSchema)
    .min(1)
    .max(MAX_SHOPPING_PRODUCTS),
  /** Archive the products this import no longer lists. */
  archiveMissing: z.boolean().default(true),
});

export const shoppingScheduleSchema = shoppingProjectSchema.extend({
  scheduleInterval: z.enum(SHOPPING_SCHEDULE_INTERVALS),
});

export const startShoppingCheckSchema = shoppingProjectSchema.extend({
  requestId: z.uuid(),
});

export const shoppingLookupSchema = shoppingProjectSchema.extend({
  lookupId: z.uuid(),
});

export const shoppingProductUpdateSchema = shoppingProjectSchema.extend({
  productId: z.uuid(),
  archived: z.boolean().optional(),
  searchQuery: z.string().trim().max(300).nullish(),
});
