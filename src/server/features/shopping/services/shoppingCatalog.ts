import type { z } from "zod";
import { AppError } from "@/server/lib/errors";
import {
  getPrestashopConfig,
  readPrestashopCatalog,
} from "@/server/lib/prestashop";
import { MAX_SHOPPING_PRODUCTS } from "@/shared/shopping";
import type { importShoppingProductsSchema } from "@/types/schemas/shopping";
import {
  ShoppingRepository as repo,
  type ShoppingCategoryRow,
} from "../repositories/ShoppingRepository";

type ProjectLike = { id: string; domain: string | null };

type CatalogProduct = z.infer<
  typeof importShoppingProductsSchema
>["products"][number] & { categoryExternalId?: string | null };
type CatalogCategory = {
  externalId: string;
  parentExternalId: string | null;
  name: string;
};

/**
 * Saves the shop's catalogue: new products are added and known ones updated
 * on their sku. `keepArchived` leaves products the user stopped tracking
 * alone (shop sync); a manual import brings them back.
 */
async function saveCatalog(
  projectId: string,
  products: CatalogProduct[],
  categories: CatalogCategory[],
  options: { archiveMissing: boolean; keepArchived: boolean },
) {
  const rows = new Map(products.map((row) => [row.sku, row]));
  if (rows.size > MAX_SHOPPING_PRODUCTS)
    throw new AppError(
      "VALIDATION_ERROR",
      `Track at most ${MAX_SHOPPING_PRODUCTS} products.`,
    );
  const existing = new Map(
    (await repo.listAllProducts(projectId)).map((row) => [row.sku, row]),
  );
  const now = new Date().toISOString();
  await repo.saveCategories(
    categories.map((category) => ({
      id: crypto.randomUUID(),
      projectId,
      ...category,
      excluded: false,
      updatedAt: now,
    })),
  );
  const inserts = [];
  const updates = [];
  for (const row of rows.values()) {
    const known = existing.get(row.sku);
    const values = {
      title: row.title,
      brand: row.brand ?? null,
      gtin: row.gtin ?? null,
      category: row.category ?? null,
      categoryExternalId: row.categoryExternalId ?? row.category ?? null,
      price: row.price,
      currency: row.currency,
      url: row.url ?? null,
      archivedAt: options.keepArchived ? (known?.archivedAt ?? null) : null,
      updatedAt: now,
    };
    if (known) updates.push({ id: known.id, values });
    else
      inserts.push({
        id: crypto.randomUUID(),
        projectId,
        sku: row.sku,
        searchQuery: null,
        createdAt: now,
        ...values,
      });
  }
  const archiveIds = options.archiveMissing
    ? [...existing.values()]
        .filter((row) => !rows.has(row.sku) && !row.archivedAt)
        .map((row) => row.id)
    : [];
  await repo.saveProducts(inserts, updates, archiveIds, now);
  return {
    added: inserts.length,
    updated: updates.length,
    archived: archiveIds.length,
  };
}

/** CSV or spreadsheet import; its categories are the category names. */
export async function importProducts(
  projectId: string,
  input: z.infer<typeof importShoppingProductsSchema>,
) {
  const names = new Set(
    input.products.flatMap((row) => (row.category ? [row.category] : [])),
  );
  return saveCatalog(
    projectId,
    input.products,
    [...names].map((name) => ({
      externalId: name,
      parentExternalId: null,
      name,
    })),
    { archiveMissing: input.archiveMissing, keepArchived: false },
  );
}

export function hostOf(value: string) {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return null;
  }
}

/** The PrestaShop shop this project's catalogue syncs from, if any. */
export async function catalogSource(project: ProjectLike) {
  const config = await getPrestashopConfig();
  if (!config || !project.domain) return null;
  return hostOf(config.url) === hostOf(project.domain) ? config : null;
}

/** Reads the shop's active products and categories through its Webservice. */
export async function syncCatalog(project: ProjectLike) {
  const config = await catalogSource(project);
  if (!config)
    throw new AppError(
      "VALIDATION_ERROR",
      "No shop connection is set up for this project.",
    );
  const catalog = await readPrestashopCatalog(config);
  const names = new Map(
    catalog.categories.map((category) => [category.id, category.name]),
  );
  return saveCatalog(
    project.id,
    catalog.products
      .filter((product) => product.name.trim() && product.price_ttc > 0)
      .map((product) => ({
        sku: product.id,
        title: product.name.trim(),
        brand: product.manufacturer_name?.trim() || null,
        gtin: product.ean13?.trim() || null,
        category: names.get(product.id_category_default) ?? null,
        categoryExternalId: product.id_category_default,
        price: Math.round(product.price_ttc * 100) / 100,
        currency: "EUR",
        url: product.url,
      })),
    catalog.categories.map((category) => ({
      externalId: category.id,
      // The shop's root has itself or 0 as parent.
      parentExternalId:
        category.id_parent === "0" || category.id_parent === category.id
          ? null
          : category.id_parent,
      name: category.name,
    })),
    { archiveMissing: true, keepArchived: true },
  );
}

/** Ids of the categories inside an excluded category's subtree. */
function excludedCategoryIds(categories: ShoppingCategoryRow[]) {
  const byId = new Map(categories.map((row) => [row.externalId, row]));
  const excluded = new Set<string>();
  for (const category of categories) {
    let current: ShoppingCategoryRow | undefined = category;
    // Depth guard against a parent loop in imported data.
    for (let depth = 0; current && depth < 50; depth++) {
      if (current.excluded) {
        excluded.add(category.externalId);
        break;
      }
      current = current.parentExternalId
        ? byId.get(current.parentExternalId)
        : undefined;
    }
  }
  return excluded;
}

/** Active products outside the excluded categories. */
export async function listTrackedProducts(projectId: string) {
  const [products, categories] = await Promise.all([
    repo.listProducts(projectId),
    repo.listCategories(projectId),
  ]);
  const excluded = excludedCategoryIds(categories);
  return {
    categories,
    products,
    tracked: products.filter(
      (product) =>
        !product.categoryExternalId ||
        !excluded.has(product.categoryExternalId),
    ),
  };
}
