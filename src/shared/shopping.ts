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
export const MAX_SHOPPING_PRODUCTS = 5000;

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
  "au",
  "aux",
  "the",
  "and",
  "for",
  "with",
  "of",
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

// Single letters that are elisions or separators, not variant names.
const NON_VARIANT_LETTERS = new Set([
  "a",
  "c",
  "d",
  "j",
  "l",
  "m",
  "n",
  "s",
  "x",
]);

// Words that make an offer a part or an accessory of the product, unless our
// own title has them too.
const ACCESSORY_WORDS = new Set([
  "support",
  "stand",
  "rotor",
  "helice",
  "axe",
  "cartouche",
  "recharge",
  "rechange",
  "remplacement",
  "replacement",
  "spare",
  "piece",
  "pieces",
  "adaptateur",
  "adapter",
  "robinet",
  "deflecteur",
  "fixation",
  "bracket",
  "mount",
  "cable",
  "joint",
  "ventouse",
  "couvercle",
  "housse",
  "ersatz",
  "ersatzteil",
  "zubehor",
]);

// "lot de 12", "x24", "24 x", "pack de 6": several units in one offer.
const MULTIPACK =
  /\b(lot|pack|set) de \d+\b|\bx ?\d+\b|\b\d+ ?x\b|\b\d+ ?(pz|pcs|pieces)\b/;

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
  metre: ["mm", 1000],
  metres: ["mm", 1000],
  lh: ["lh", 1],
  micron: ["um", 1],
  microns: ["um", 1],
  um: ["um", 1],
  tests: ["tests", 1],
};
const QUANTITY = /(\d+(?:\.\d+)?)\s?([a-z]+)\b/g;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/l\/h/g, "lh")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^a-z0-9.+]+/g, " ")
    .replace(/(^|\s)\.+|\.+(?=\s|$)/g, " ")
    .trim();
}

/** Sizes in a title, as "unit:value" in base units (500 ml and 0,5 L agree). */
function extractQuantities(normalized: string) {
  const quantities = new Set<string>();
  for (const [, amount, unit] of normalized.matchAll(QUANTITY)) {
    const known = UNITS[unit];
    if (!known) continue;
    const base = Math.round(Number(amount) * known[1] * 100) / 100;
    quantities.add(`${known[0]}:${base}`);
  }
  return quantities;
}

/** "1.0" and "1" are the same model number; "phosphates" is "phosphate". */
function canonicalToken(token: string) {
  if (/^\d+(\.\d+)?$/.test(token)) return String(Number(token));
  return token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token;
}

/**
 * A title's words without its sizes: `required` holds the model numbers and
 * variant letters that must appear in the offer (Syncra 1.0, Trace V, 4K,
 * 9004), `words` the others, compared by share.
 */
function titleTokens(normalized: string, brand: string | null) {
  const brandTokens = new Set(brand ? normalizeText(brand).split(" ") : []);
  const withoutSizes = normalized.replace(
    QUANTITY,
    (whole, _n, unit: string) => (UNITS[unit] ? " " : whole),
  );
  const required = new Set<string>();
  const words = new Set<string>();
  for (const raw of withoutSizes.split(" ")) {
    const token = canonicalToken(raw);
    if (!token || brandTokens.has(token) || STOPWORDS.has(token)) continue;
    if (/\d/.test(token)) required.add(token);
    else if (token.length === 1) {
      if (!NON_VARIANT_LETTERS.has(token)) required.add(token);
    } else words.add(token);
  }
  return { required, words, all: new Set([...required, ...words]) };
}

export function matchShoppingOffer(
  product: { title: string; brand: string | null },
  offerTitle: string,
): { match: ShoppingOfferMatch; score: number } {
  const other = { match: ShoppingOfferMatch.Other, score: 0 };
  const ourText = normalizeText(product.title);
  const offerText = normalizeText(offerTitle);
  if (product.brand) {
    const brand = normalizeText(product.brand);
    if (brand && !` ${offerText} `.includes(` ${brand} `)) return other;
  }

  const ours = extractQuantities(ourText);
  const theirs = extractQuantities(offerText);
  const ourTokens = titleTokens(ourText, product.brand);
  const offerTokens = titleTokens(offerText, product.brand);
  for (const quantity of ours) {
    if (theirs.has(quantity)) continue;
    // Our size is missing: a different size of the same unit, or a bare
    // number of its own ("Voyager Nano 2000" for our 1000 l/h), is another
    // variant. An offer that names no size at all may still be ours.
    const unit = quantity.split(":")[0];
    if ([...theirs].some((value) => value.startsWith(`${unit}:`))) return other;
    for (const token of offerTokens.required)
      if (/^\d/.test(token) && !ourTokens.all.has(token)) return other;
  }

  // Another model number or variant letter is another product.
  for (const token of ourTokens.required)
    if (!offerTokens.all.has(token)) return other;
  // A part, an accessory or a multipack of the product is not the product.
  for (const token of offerTokens.words)
    if (ACCESSORY_WORDS.has(token) && !ourTokens.words.has(token)) return other;
  if (MULTIPACK.test(offerText) && !MULTIPACK.test(ourText)) return other;

  // A brandless title of one generic word ("pack pvc") cannot be matched.
  if (!product.brand && ourTokens.all.size < 2) return other;
  if (ourTokens.words.size === 0)
    return { match: ShoppingOfferMatch.Probable, score: 0.5 };
  let shared = 0;
  for (const token of ourTokens.words)
    if (offerTokens.words.has(token)) shared++;
  // Share of our words found in the offer: sellers often add words of
  // their own, so the offer's extra words weigh less than our missing ones.
  const score = shared / ourTokens.words.size;
  if (score < 0.75) return { match: ShoppingOfferMatch.Other, score };
  const sizesAgree = [...ours].every((quantity) => theirs.has(quantity));
  return {
    match: sizesAgree ? ShoppingOfferMatch.Match : ShoppingOfferMatch.Probable,
    score,
  };
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
