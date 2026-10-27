import { sort } from "remeda";

// Shopping price tracking: compares the project's own product prices with the
// offers Google Shopping lists for the same products.

export enum ShoppingStatus {
  Queued = "queued",
  Running = "running",
  Completed = "completed",
  Partial = "partial",
  Failed = "failed",
}

export enum ShoppingOfferMatch {
  /** Same product: brand and every size/volume in our title agree. */
  Match = "match",
  /** Likely the same product, but the title differs enough to show apart. */
  Probable = "probable",
  /** Another product (other size, accessory, other brand…). */
  Other = "other",
}

export const SHOPPING_SCHEDULE_INTERVALS = [
  "manual",
  "weekly",
  "monthly",
] as const;
export type ShoppingScheduleInterval =
  (typeof SHOPPING_SCHEDULE_INTERVALS)[number];

/** Google Shopping results bought per product (one SERP of up to 40). */
export const SHOPPING_DEPTH = 40;
/** DataForSEO standard-queue price per Google Shopping SERP (≤ 40 results). */
export const SHOPPING_TASK_COST_USD = 0.001;
export const MAX_SHOPPING_PRODUCTS = 1000;

/** Within ±5 % of the market median counts as aligned. */
const SHOPPING_ALIGNED_GAP_PCT = 5;

export function isShoppingCheckActive(status: ShoppingStatus) {
  return status === ShoppingStatus.Queued || status === ShoppingStatus.Running;
}

export function nextShoppingCheckAt(
  interval: ShoppingScheduleInterval,
  from: Date,
): string | null {
  if (interval === "manual") return null;
  const next = new Date(from);
  if (interval === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString();
}

// ---------------------------------------------------------------------------
// Title matching
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "et",
  "en",
  "pour",
  "avec",
  "un",
  "une",
  "a",
  "au",
  "aux",
  "the",
  "and",
  "for",
  "with",
  "of",
  "x",
  "pack",
  "lot",
  "eau",
  "mer",
  "aquarium",
  "recifal",
  "marin",
  "marine",
  "reef",
  "nouveau",
  "new",
  "version",
]);

// Base unit and factor for the sizes that tell product variants apart.
const UNITS: Record<string, [string, number]> = {
  ml: ["ml", 1],
  cl: ["ml", 10],
  l: ["ml", 1000],
  litre: ["ml", 1000],
  litres: ["ml", 1000],
  liter: ["ml", 1000],
  g: ["g", 1],
  gr: ["g", 1],
  kg: ["g", 1000],
  w: ["w", 1],
  watt: ["w", 1],
  watts: ["w", 1],
  mm: ["mm", 1],
  cm: ["mm", 10],
  m: ["mm", 1000],
  lh: ["lh", 1],
  pcs: ["pcs", 1],
  pieces: ["pcs", 1],
  tests: ["tests", 1],
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/l\/h/g, "lh")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^a-z0-9.+]+/g, " ")
    .trim();
}

/** Sizes in a title, as "unit:value" in base units (500 ml and 0,5 L agree). */
function extractQuantities(value: string) {
  const quantities = new Set<string>();
  const pattern = /(\d+(?:\.\d+)?)\s?([a-z]+)\b/g;
  for (const [, amount, unit] of normalizeText(value).matchAll(pattern)) {
    const known = UNITS[unit];
    if (!known) continue;
    const base = Math.round(Number(amount) * known[1] * 100) / 100;
    quantities.add(`${known[0]}:${base}`);
  }
  return quantities;
}

function significantTokens(value: string, brand: string | null) {
  const brandTokens = new Set(brand ? normalizeText(brand).split(" ") : []);
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter(
        (token) =>
          token.length > 1 &&
          !STOPWORDS.has(token) &&
          !brandTokens.has(token) &&
          // Sizes are compared separately, with their units.
          !/^\d+(\.\d+)?[a-z]*$/.test(token),
      ),
  );
}

export function matchShoppingOffer(
  product: { title: string; brand: string | null },
  offerTitle: string,
): { match: ShoppingOfferMatch; score: number } {
  const offer = normalizeText(offerTitle);
  if (product.brand) {
    const brand = normalizeText(product.brand);
    if (brand && !` ${offer} `.includes(` ${brand} `))
      return { match: ShoppingOfferMatch.Other, score: 0 };
  }

  const ours = extractQuantities(product.title);
  const theirs = extractQuantities(offerTitle);
  for (const quantity of ours) {
    if (theirs.has(quantity)) continue;
    // Our size is missing; a different size of the same unit is another
    // variant, an offer that names no size at all may still be ours.
    const unit = quantity.split(":")[0];
    if ([...theirs].some((other) => other.startsWith(`${unit}:`)))
      return { match: ShoppingOfferMatch.Other, score: 0 };
  }

  const ourTokens = significantTokens(product.title, product.brand);
  const offerTokens = significantTokens(offerTitle, product.brand);
  if (ourTokens.size === 0)
    return { match: ShoppingOfferMatch.Probable, score: 0.5 };
  let shared = 0;
  for (const token of ourTokens) if (offerTokens.has(token)) shared++;
  // Share of our words found in the offer: sellers often add words of
  // their own, so the offer's extra words weigh less than our missing ones.
  const score = shared / ourTokens.size;
  const sizesAgree = [...ours].every((quantity) => theirs.has(quantity));
  if (score >= 0.75 && sizesAgree)
    return { match: ShoppingOfferMatch.Match, score };
  if (score >= 0.5) return { match: ShoppingOfferMatch.Probable, score };
  return { match: ShoppingOfferMatch.Other, score };
}

// ---------------------------------------------------------------------------
// Sellers and price statistics
// ---------------------------------------------------------------------------

/** "Récif at Home" and recifathome.com both read as "recifathome". */
function sellerKey(value: string) {
  return normalizeText(value)
    .replace(/^www\./, "")
    .replace(/\.(com|fr|net|org|eu|de|be|es|it|co\.uk|shop|store)$/, "")
    .replace(/[^a-z0-9]/g, "");
}

export function isSameSeller(
  offer: { seller: string | null; domain: string | null },
  site: { domain: string; name?: string | null },
) {
  const keys = [
    sellerKey(site.domain),
    site.name ? sellerKey(site.name) : "",
  ].filter((key) => key.length >= 4);
  const offerKeys = [offer.seller, offer.domain]
    .filter((value): value is string => !!value)
    .map(sellerKey);
  return offerKeys.some((offerKey) =>
    keys.some((key) => offerKey === key || offerKey.startsWith(key)),
  );
}

export type ShoppingPosition = "cheaper" | "aligned" | "pricier";

export function median(values: number[]) {
  const sorted = sort(values, (a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Market prices of one product: matched offers from other sellers, with
 * outliers (accessories, bundles that slipped through matching) left out.
 */
export function shoppingPriceStats(ourPrice: number, prices: number[]) {
  if (prices.length === 0) return null;
  const rough = median(prices);
  const kept = prices.filter(
    (price) => price >= rough * 0.4 && price <= rough * 2.5,
  );
  const marketMedian = median(kept);
  const gapPct = round2(((ourPrice - marketMedian) / marketMedian) * 100);
  const position: ShoppingPosition =
    gapPct < -SHOPPING_ALIGNED_GAP_PCT
      ? "cheaper"
      : gapPct > SHOPPING_ALIGNED_GAP_PCT
        ? "pricier"
        : "aligned";
  return {
    offers: kept.length,
    min: round2(Math.min(...kept)),
    median: round2(marketMedian),
    average: round2(kept.reduce((sum, price) => sum + price, 0) / kept.length),
    max: round2(Math.max(...kept)),
    gapPct,
    position,
    cheaperOffers: kept.filter((price) => price < ourPrice).length,
  };
}
