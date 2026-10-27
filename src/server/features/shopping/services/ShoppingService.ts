import { groupBy, groupByProp, sortBy } from "remeda";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import {
  getOrCreateOrganizationCustomer,
  getUsageCreditsRemaining,
} from "@/server/billing/subscription";
import { creditsForProviderUsd } from "@/shared/billing";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import {
  isSameSeller,
  isShoppingCheckActive,
  matchShoppingOffer,
  median,
  nextShoppingCheckAt,
  SHOPPING_TASK_COST_USD,
  ShoppingOfferMatch,
  shoppingPriceStats,
  ShoppingStatus,
  type ShoppingPosition,
  type ShoppingScheduleInterval,
} from "@/shared/shopping";
import {
  ShoppingRepository as repo,
  type ShoppingCheckRow,
  type ShoppingProductRow,
} from "../repositories/ShoppingRepository";
import {
  collectShoppingCheck,
  shoppingQuery,
  submitShoppingCheck,
} from "./shoppingCollection";
import {
  catalogSource,
  hostOf,
  importProducts,
  listTrackedProducts,
  syncCatalog,
} from "./shoppingCatalog";

type ProjectLike = {
  id: string;
  name: string;
  domain: string | null;
  locationCode: number;
  languageCode: string;
};

function checkCostCredits(products: number) {
  return creditsForProviderUsd(products * SHOPPING_TASK_COST_USD);
}

async function setSchedule(
  projectId: string,
  scheduleInterval: ShoppingScheduleInterval,
) {
  await repo.saveSettings({
    projectId,
    scheduleInterval,
    nextCheckAt: nextShoppingCheckAt(scheduleInterval, new Date()),
    updatedAt: new Date().toISOString(),
  });
}

/** Creates a check for every active product and posts its searches. */
async function startCheck(
  project: ProjectLike,
  customer: BillingCustomerContext,
  requestId: string = crypto.randomUUID(),
) {
  const existing = await repo.getCheck(project.id, requestId);
  if (existing) return existing;
  const active = await repo.getActiveCheck(project.id);
  if (active) return active;
  if (await catalogSource(project))
    await syncCatalog(project).catch((error: unknown) => {
      // Prices are checked against the last synced catalogue.
      console.warn(
        `[shopping] catalogue sync for ${project.id} failed:`,
        error,
      );
    });
  const products = (await listTrackedProducts(project.id)).tracked;
  if (!products.length)
    throw new AppError(
      "VALIDATION_ERROR",
      "No product to check: import or sync your catalogue, or include a category.",
    );
  if (await isHostedServerAuthMode()) {
    const { id } = await getOrCreateOrganizationCustomer(customer);
    const credits = await getUsageCreditsRemaining(id);
    if (
      Math.max(credits.monthlyRemaining, 0) +
        Math.max(credits.topupRemaining, 0) <
      checkCostCredits(products.length)
    )
      throw new AppError("INSUFFICIENT_CREDITS");
  }
  const check: ShoppingCheckRow = {
    id: requestId,
    projectId: project.id,
    status: ShoppingStatus.Queued,
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  await repo.createCheck(
    check,
    products.map((product) => ({
      id: crypto.randomUUID(),
      checkId: check.id,
      productId: product.id,
      query: shoppingQuery(product),
      ourPrice: product.price,
      taskId: null,
      status: ShoppingStatus.Queued,
      error: null,
      completedAt: null,
    })),
  );
  await submitShoppingCheck(check, project, {
    ...customer,
    projectId: project.id,
  });
  return (await repo.getCheck(project.id, check.id)) ?? check;
}

/**
 * Matches stored offers again with the current rules, so better matching
 * applies to past checks without buying the searches again.
 */
function rematchOffers<T extends { title: string }>(
  product: { title: string; brand: string | null },
  offers: T[],
) {
  return offers.map((offer) => {
    const { match, score } = matchShoppingOffer(product, offer.title);
    return { ...offer, match, matchScore: score };
  });
}

type CompetitorPrice = { domain: string; name: string | null; price: number };

type ShoppingProductComparison = {
  productId: string;
  sku: string;
  title: string;
  brand: string | null;
  category: string | null;
  url: string | null;
  query: string;
  ourPrice: number;
  currency: string;
  status: ShoppingStatus | null;
  /** Probable when no offer matched exactly and probable ones were used. */
  confidence: "match" | "probable" | null;
  market: ReturnType<typeof shoppingPriceStats>;
  ourListingPrice: number | null;
  competitors: CompetitorPrice[];
  lookupId: string | null;
};

type GroupSummary = {
  key: string;
  products: number;
  compared: number;
  medianGapPct: number | null;
  cheaper: number;
  aligned: number;
  pricier: number;
};

function medianOf(values: number[]) {
  return values.length ? Math.round(median(values) * 10) / 10 : null;
}

function summarize(key: string, rows: ShoppingProductComparison[]) {
  const compared = rows.filter((row) => row.market);
  const count = (position: ShoppingPosition) =>
    compared.filter((row) => row.market?.position === position).length;
  return {
    key,
    products: rows.length,
    compared: compared.length,
    medianGapPct: medianOf(compared.map((row) => row.market!.gapPct)),
    cheaper: count("cheaper"),
    aligned: count("aligned"),
    pricier: count("pricier"),
  } satisfies GroupSummary;
}

async function buildComparison(
  project: ProjectLike,
  check: ShoppingCheckRow | null,
) {
  const [{ tracked: products }, competitors, lookups] = await Promise.all([
    listTrackedProducts(project.id),
    repo.listCompetitors(project.id),
    check ? repo.getLookups(check.id) : Promise.resolve([]),
  ]);
  const offers = await repo.getOffers(lookups.map((lookup) => lookup.id));
  const own = project.domain
    ? { domain: project.domain, name: project.name }
    : null;
  const lookupByProduct = new Map(
    lookups.map((lookup) => [lookup.productId, lookup]),
  );
  const offersByLookup = groupByProp(offers, "lookupId");

  const rows = products.map((product: ShoppingProductRow) => {
    const lookup = lookupByProduct.get(product.id);
    const productOffers = lookup
      ? rematchOffers(product, offersByLookup[lookup.id] ?? [])
      : [];
    const isOwn = (offer: (typeof productOffers)[number]) =>
      own ? isSameSeller(offer, own) : false;
    const usable = (match: ShoppingOfferMatch) =>
      productOffers.filter((offer) => offer.match === match && !isOwn(offer));
    const exact = usable(ShoppingOfferMatch.Match);
    const pool = exact.length ? exact : usable(ShoppingOfferMatch.Probable);
    const ourPrice = lookup?.ourPrice ?? product.price;
    const ownListing = productOffers.find(
      (offer) => offer.match !== ShoppingOfferMatch.Other && isOwn(offer),
    );
    return {
      productId: product.id,
      sku: product.sku,
      title: product.title,
      brand: product.brand,
      category: product.category,
      url: product.url,
      query: lookup?.query ?? shoppingQuery(product),
      ourPrice,
      currency: product.currency,
      status: lookup?.status ?? null,
      confidence: pool.length ? (exact.length ? "match" : "probable") : null,
      market: shoppingPriceStats(
        ourPrice,
        pool.map((offer) => offer.price),
      ),
      ourListingPrice: ownListing?.price ?? null,
      competitors: competitors.flatMap((competitor) => {
        const prices = pool
          .filter((offer) => isSameSeller(offer, competitor))
          .map((offer) => offer.price);
        return prices.length
          ? [{ ...competitor, price: Math.min(...prices) }]
          : [];
      }),
      lookupId: lookup?.id ?? null,
    } satisfies ShoppingProductComparison;
  });

  return {
    rows,
    overall: summarize("all", rows),
    brands: sortBy(
      Object.entries(groupBy(rows, (row) => row.brand ?? "")).map(
        ([brand, group]) => summarize(brand, group),
      ),
      [(brand) => brand.products, "desc"],
    ),
    competitors,
  };
}

/** Everything the Shopping page shows: products, schedule, latest comparison. */
async function getOverview(project: ProjectLike) {
  let active = await repo.getActiveCheck(project.id);
  // The cron collects running checks; collecting on read as well shows
  // results as soon as they land.
  if (active?.status === ShoppingStatus.Running) {
    await collectShoppingCheck(active);
    active = await repo.getActiveCheck(project.id);
  }
  const [settings, checks, catalog, source] = await Promise.all([
    repo.getSettings(project.id),
    repo.listChecks(project.id),
    listTrackedProducts(project.id),
    catalogSource(project),
  ]);
  const shown =
    active ??
    checks.find(
      (check) =>
        check.status === ShoppingStatus.Completed ||
        check.status === ShoppingStatus.Partial,
    ) ??
    null;
  const comparison = await buildComparison(project, shown);
  const lookups = active ? await repo.getLookups(active.id) : [];
  return {
    settings: {
      scheduleInterval: settings?.scheduleInterval ?? "manual",
      nextCheckAt: settings?.nextCheckAt ?? null,
    },
    checkCostCredits: checkCostCredits(comparison.rows.length),
    activeCheck: active
      ? {
          ...active,
          total: lookups.length,
          done: lookups.filter(
            (lookup) => !isShoppingCheckActive(lookup.status),
          ).length,
        }
      : null,
    shownCheck: shown,
    checks,
    catalog: {
      shop: source ? hostOf(source.url) : null,
      syncedAt: source
        ? (catalog.products.reduce<string | null>(
            (latest, product) =>
              !latest || product.updatedAt > latest
                ? product.updatedAt
                : latest,
            null,
          ) ?? null)
        : null,
      excludedProducts: catalog.products.length - catalog.tracked.length,
    },
    categories: catalog.categories.map((category) => ({
      id: category.id,
      externalId: category.externalId,
      parentExternalId: category.parentExternalId,
      name: category.name,
      excluded: category.excluded,
      products: catalog.products.filter(
        (product) => product.categoryExternalId === category.externalId,
      ).length,
    })),
    ...comparison,
  };
}

async function getOffers(projectId: string, lookupId: string) {
  const lookup = await repo.getLookupInProject(projectId, lookupId);
  if (!lookup)
    throw new AppError("NOT_FOUND", "These results are no longer available.");
  return rematchOffers(lookup.product, await repo.getOffers([lookupId]));
}

export const ShoppingService = {
  importProducts,
  syncCatalog,
  setCategoryExcluded: repo.setCategoryExcluded,
  setSchedule,
  startCheck,
  getOverview,
  getOffers,
  setProductArchived: (
    projectId: string,
    productId: string,
    archived: boolean,
  ) =>
    repo.setProductArchived(
      projectId,
      productId,
      archived ? new Date().toISOString() : null,
    ),
  updateProductQuery: (
    projectId: string,
    productId: string,
    searchQuery: string | null,
  ) =>
    repo.updateProductQuery(projectId, productId, searchQuery?.trim() || null),
};
