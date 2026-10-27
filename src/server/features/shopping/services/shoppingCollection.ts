import {
  createDataforseoClient,
  fetchShoppingProductTaskResult,
  MAX_TASKS_PER_POST,
} from "@/server/lib/dataforseo";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import {
  isShoppingCheckActive,
  matchShoppingOffer,
  SHOPPING_DEPTH,
  ShoppingStatus,
} from "@/shared/shopping";
import {
  ShoppingRepository as repo,
  type ShoppingCheckRow,
  type ShoppingProductRow,
} from "../repositories/ShoppingRepository";

const POST_FAILED = "Google Shopping did not accept this search.";
const SEARCH_FAILED = "Google Shopping could not complete this search.";
const TIMED_OUT =
  "This search did not finish in time. It may still have used credits.";
// Queued Google Shopping tasks usually finish within minutes; a check still
// waiting after this long is closed with what it has.
const CHECK_TIMEOUT_MS = 6 * 60 * 60_000;
const UNPOSTED_TIMEOUT_MS = 15 * 60_000;
// Collections per check per tick, six at a time like the other Worker calls.
const COLLECT_PER_TICK = 120;
const COLLECT_CONCURRENCY = 6;

/** The Google Shopping search for one product. */
export function shoppingQuery(product: ShoppingProductRow) {
  if (product.searchQuery?.trim()) return product.searchQuery.trim();
  const title = product.title.trim();
  const brand = product.brand?.trim();
  return brand && !title.toLowerCase().includes(brand.toLowerCase())
    ? `${brand} ${title}`
    : title;
}

/**
 * Posts every queued search of a check (charged at post time) and marks the
 * check running. Rejected entries fail their lookup instead of being bought
 * again.
 */
export async function submitShoppingCheck(
  check: ShoppingCheckRow,
  location: { locationCode: number; languageCode: string },
  customer: BillingCustomerContext,
) {
  const lookups = (await repo.getLookups(check.id)).filter(
    (lookup) => lookup.status === ShoppingStatus.Queued && !lookup.taskId,
  );
  const client = createDataforseoClient(customer);
  for (let offset = 0; offset < lookups.length; offset += MAX_TASKS_PER_POST) {
    const group = lookups.slice(offset, offset + MAX_TASKS_PER_POST);
    let taskIds = new Map<string, string>();
    try {
      taskIds = await client.merchant.shoppingTaskPost({
        tasks: group.map((lookup) => ({
          tag: lookup.id,
          keyword: lookup.query,
        })),
        locationCode: location.locationCode,
        languageCode: location.languageCode,
        depth: SHOPPING_DEPTH,
      });
    } catch (error) {
      console.error(
        `[shopping] task_post for check ${check.id} failed:`,
        error,
      );
    }
    await Promise.all(
      group.map((lookup) => {
        const taskId = taskIds.get(lookup.id);
        return taskId
          ? repo.updateLookup(lookup.id, {
              taskId,
              status: ShoppingStatus.Running,
            })
          : repo.updateLookup(lookup.id, {
              status: ShoppingStatus.Failed,
              error: POST_FAILED,
              completedAt: new Date().toISOString(),
            });
      }),
    );
  }
  await repo.updateCheck(check.projectId, check.id, {
    status: ShoppingStatus.Running,
  });
}

/**
 * Collects the finished searches of a running check and closes it once none
 * is left. Safe to call repeatedly: collection is free and idempotent.
 */
export async function collectShoppingCheck(check: ShoppingCheckRow) {
  const [lookups, products] = await Promise.all([
    repo.getLookups(check.id),
    repo.listAllProducts(check.projectId),
  ]);
  const byId = new Map(products.map((product) => [product.id, product]));
  const running = lookups.filter(
    (lookup) => lookup.status === ShoppingStatus.Running && lookup.taskId,
  );
  const batch = running.slice(0, COLLECT_PER_TICK);
  for (let offset = 0; offset < batch.length; offset += COLLECT_CONCURRENCY) {
    await Promise.all(
      batch.slice(offset, offset + COLLECT_CONCURRENCY).map(async (lookup) => {
        const product = byId.get(lookup.productId);
        try {
          const outcome = await fetchShoppingProductTaskResult(lookup.taskId!);
          if (outcome.status === "pending") return;
          if (outcome.status === "failed" || !product) {
            await repo.updateLookup(lookup.id, {
              status: ShoppingStatus.Failed,
              error: SEARCH_FAILED,
              completedAt: new Date().toISOString(),
            });
            return;
          }
          await repo.completeLookup(
            lookup.id,
            outcome.offers.map((offer) => {
              const { match, score } = matchShoppingOffer(product, offer.title);
              return {
                id: `${lookup.id}:${offer.rank}`,
                lookupId: lookup.id,
                ...offer,
                match,
                matchScore: score,
              };
            }),
          );
        } catch (error) {
          // A transient task_get failure is retried on the next tick.
          console.warn(`[shopping] lookup ${lookup.id} not collected:`, error);
        }
      }),
    );
  }

  const age = Date.now() - Date.parse(check.createdAt);
  let left = (await repo.getLookups(check.id)).filter((lookup) =>
    isShoppingCheckActive(lookup.status),
  );
  // Searches never posted (the request that started the check died) are not
  // bought later: the check closes with what it has.
  const unposted = left.filter((lookup) => !lookup.taskId);
  if (unposted.length && age > UNPOSTED_TIMEOUT_MS) {
    await repo.failLookups(
      check.id,
      unposted.map((lookup) => lookup.id),
      POST_FAILED,
    );
    left = left.filter((lookup) => lookup.taskId);
  }
  if (left.length && age < CHECK_TIMEOUT_MS) return;
  if (left.length)
    await repo.failLookups(
      check.id,
      left.map((lookup) => lookup.id),
      TIMED_OUT,
    );
  await finalizeShoppingCheck(check);
}

async function finalizeShoppingCheck(check: ShoppingCheckRow, error?: string) {
  const lookups = await repo.getLookups(check.id);
  const completed = lookups.filter(
    (lookup) => lookup.status === ShoppingStatus.Completed,
  ).length;
  await repo.updateCheck(check.projectId, check.id, {
    status:
      completed > 0 && completed === lookups.length
        ? ShoppingStatus.Completed
        : completed > 0
          ? ShoppingStatus.Partial
          : ShoppingStatus.Failed,
    error: error ?? null,
    completedAt: new Date().toISOString(),
  });
}
