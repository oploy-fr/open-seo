import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
} from "drizzle-orm";
import { db } from "@/db";
import { DB_BATCH_SIZE, runBatch } from "@/db/runBatch";
import {
  projectCompetitors,
  projects,
  shoppingChecks,
  shoppingLookups,
  shoppingOffers,
  shoppingProducts,
  shoppingSettings,
} from "@/db/schema";
import { ShoppingStatus } from "@/shared/shopping";

export type ShoppingProductRow = typeof shoppingProducts.$inferSelect;
export type ShoppingCheckRow = typeof shoppingChecks.$inferSelect;
type ProductInsert = typeof shoppingProducts.$inferInsert;
type OfferInsert = typeof shoppingOffers.$inferInsert;

const ACTIVE = [ShoppingStatus.Queued, ShoppingStatus.Running];

function chunks<T>(rows: T[], size = 6) {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

async function listProducts(projectId: string) {
  return db
    .select()
    .from(shoppingProducts)
    .where(
      and(
        eq(shoppingProducts.projectId, projectId),
        isNull(shoppingProducts.archivedAt),
      ),
    )
    .orderBy(asc(shoppingProducts.title));
}

async function listAllProducts(projectId: string) {
  return db
    .select()
    .from(shoppingProducts)
    .where(eq(shoppingProducts.projectId, projectId));
}

/** Inserts new products and updates known ones, matched on the shop's sku. */
async function saveProducts(
  inserts: ProductInsert[],
  updates: Array<{ id: string; values: Partial<ProductInsert> }>,
  archiveIds: string[],
  now: string,
) {
  // D1 binds ~100 parameters per statement and each row binds ~14, so rows
  // go in small groups.
  for (const group of chunks(inserts))
    await runBatch((tx) => [tx.insert(shoppingProducts).values(group)]);
  for (const group of chunks(updates, 50))
    await runBatch((tx) =>
      group.map(({ id, values }) =>
        tx
          .update(shoppingProducts)
          .set(values)
          .where(eq(shoppingProducts.id, id)),
      ),
    );
  for (const ids of chunks(archiveIds, DB_BATCH_SIZE))
    await db
      .update(shoppingProducts)
      .set({ archivedAt: now, updatedAt: now })
      .where(inArray(shoppingProducts.id, ids));
}

async function setProductArchived(
  projectId: string,
  productId: string,
  archivedAt: string | null,
) {
  await db
    .update(shoppingProducts)
    .set({ archivedAt, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(shoppingProducts.projectId, projectId),
        eq(shoppingProducts.id, productId),
      ),
    );
}

async function updateProductQuery(
  projectId: string,
  productId: string,
  searchQuery: string | null,
) {
  await db
    .update(shoppingProducts)
    .set({ searchQuery, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(shoppingProducts.projectId, projectId),
        eq(shoppingProducts.id, productId),
      ),
    );
}

async function getSettings(projectId: string) {
  return (
    (
      await db
        .select()
        .from(shoppingSettings)
        .where(eq(shoppingSettings.projectId, projectId))
        .limit(1)
    )[0] ?? null
  );
}

async function saveSettings(row: typeof shoppingSettings.$inferInsert) {
  await db
    .insert(shoppingSettings)
    .values(row)
    .onConflictDoUpdate({
      target: shoppingSettings.projectId,
      set: {
        scheduleInterval: row.scheduleInterval,
        nextCheckAt: row.nextCheckAt,
        updatedAt: row.updatedAt,
      },
    });
}

/** Moves the next run forward only if nobody else claimed it first. */
async function claimDueSettings(
  projectId: string,
  observedNextCheckAt: string,
  nextCheckAt: string | null,
) {
  const claimed = await db
    .update(shoppingSettings)
    .set({ nextCheckAt, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(shoppingSettings.projectId, projectId),
        eq(shoppingSettings.nextCheckAt, observedNextCheckAt),
      ),
    )
    .returning({ projectId: shoppingSettings.projectId });
  return claimed.length > 0;
}

async function listDueSettings(now: string) {
  return db
    .select({ settings: shoppingSettings, project: projects })
    .from(shoppingSettings)
    .innerJoin(projects, eq(projects.id, shoppingSettings.projectId))
    .where(
      and(
        isNotNull(shoppingSettings.nextCheckAt),
        lte(shoppingSettings.nextCheckAt, now),
        isNull(projects.archivedAt),
      ),
    )
    .orderBy(asc(shoppingSettings.nextCheckAt))
    .limit(20);
}

async function listCompetitors(projectId: string) {
  return db
    .select({
      domain: projectCompetitors.domain,
      name: projectCompetitors.name,
    })
    .from(projectCompetitors)
    .where(eq(projectCompetitors.projectId, projectId));
}

async function createCheck(
  check: typeof shoppingChecks.$inferInsert,
  lookups: (typeof shoppingLookups.$inferInsert)[],
) {
  await runBatch((tx) => [tx.insert(shoppingChecks).values(check)]);
  for (const group of chunks(lookups)) {
    await runBatch((tx) => [tx.insert(shoppingLookups).values(group)]);
  }
}

async function getCheck(projectId: string, checkId: string) {
  return (
    (
      await db
        .select()
        .from(shoppingChecks)
        .where(
          and(
            eq(shoppingChecks.projectId, projectId),
            eq(shoppingChecks.id, checkId),
          ),
        )
        .limit(1)
    )[0] ?? null
  );
}

async function listChecks(projectId: string) {
  return db
    .select()
    .from(shoppingChecks)
    .where(eq(shoppingChecks.projectId, projectId))
    .orderBy(desc(shoppingChecks.createdAt), desc(shoppingChecks.id))
    .limit(20);
}

async function getActiveCheck(projectId: string) {
  return (
    (
      await db
        .select()
        .from(shoppingChecks)
        .where(
          and(
            eq(shoppingChecks.projectId, projectId),
            inArray(shoppingChecks.status, ACTIVE),
          ),
        )
        .limit(1)
    )[0] ?? null
  );
}

async function listActiveChecks() {
  return db
    .select({ check: shoppingChecks })
    .from(shoppingChecks)
    .where(inArray(shoppingChecks.status, ACTIVE))
    .orderBy(asc(shoppingChecks.createdAt));
}

async function updateCheck(
  projectId: string,
  checkId: string,
  values: Partial<typeof shoppingChecks.$inferInsert>,
) {
  await db
    .update(shoppingChecks)
    .set(values)
    .where(
      and(
        eq(shoppingChecks.projectId, projectId),
        eq(shoppingChecks.id, checkId),
      ),
    );
}

async function getLookups(checkId: string) {
  return db
    .select()
    .from(shoppingLookups)
    .where(eq(shoppingLookups.checkId, checkId));
}

async function getLookupInProject(projectId: string, lookupId: string) {
  return (
    (
      await db
        .select({ id: shoppingLookups.id })
        .from(shoppingLookups)
        .innerJoin(
          shoppingChecks,
          eq(shoppingChecks.id, shoppingLookups.checkId),
        )
        .where(
          and(
            eq(shoppingChecks.projectId, projectId),
            eq(shoppingLookups.id, lookupId),
          ),
        )
        .limit(1)
    )[0] ?? null
  );
}

async function updateLookup(
  lookupId: string,
  values: Partial<typeof shoppingLookups.$inferInsert>,
) {
  await db
    .update(shoppingLookups)
    .set(values)
    .where(eq(shoppingLookups.id, lookupId));
}

async function failLookups(checkId: string, ids: string[], error: string) {
  const now = new Date().toISOString();
  for (const group of chunks(ids, DB_BATCH_SIZE)) {
    await db
      .update(shoppingLookups)
      .set({ status: ShoppingStatus.Failed, error, completedAt: now })
      .where(
        and(
          eq(shoppingLookups.checkId, checkId),
          inArray(shoppingLookups.id, group),
        ),
      );
  }
}

/** Saves one search's offers and completes its lookup in one batch. */
async function completeLookup(lookupId: string, offers: OfferInsert[]) {
  const groups = chunks(offers);
  await runBatch((tx) => [
    tx.delete(shoppingOffers).where(eq(shoppingOffers.lookupId, lookupId)),
    ...groups.map((group) => tx.insert(shoppingOffers).values(group)),
    tx
      .update(shoppingLookups)
      .set({
        status: ShoppingStatus.Completed,
        error: null,
        completedAt: new Date().toISOString(),
      })
      .where(eq(shoppingLookups.id, lookupId)),
  ]);
}

async function getOffers(lookupIds: string[]) {
  const rows: (typeof shoppingOffers.$inferSelect)[] = [];
  for (const group of chunks(lookupIds, DB_BATCH_SIZE)) {
    rows.push(
      ...(await db
        .select()
        .from(shoppingOffers)
        .where(inArray(shoppingOffers.lookupId, group))
        .orderBy(asc(shoppingOffers.lookupId), asc(shoppingOffers.rank))),
    );
  }
  return rows;
}

export const ShoppingRepository = {
  listProducts,
  listAllProducts,
  saveProducts,
  setProductArchived,
  updateProductQuery,
  getSettings,
  saveSettings,
  claimDueSettings,
  listDueSettings,
  listCompetitors,
  createCheck,
  getCheck,
  listChecks,
  getActiveCheck,
  listActiveChecks,
  updateCheck,
  getLookups,
  getLookupInProject,
  updateLookup,
  failLookups,
  completeLookup,
  getOffers,
};
