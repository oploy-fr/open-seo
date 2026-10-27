import { z } from "zod";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

const PAGE_SIZE = 100;
const MAX_PAGES = 100;

// Multilingual fields come back as [{ id, value }] unless the request names a
// language; the shop's default language is listed first.
const localized = z
  .union([z.string(), z.array(z.object({ value: z.string() }))])
  .transform((value) =>
    typeof value === "string" ? value : (value[0]?.value ?? ""),
  );

// Empty optional fields can come back as `false` instead of a string.
const optionalText = z
  .union([z.string(), z.literal(false)])
  .nullish()
  .transform((value) => value || null);

const categorySchema = z.object({
  id: z.coerce.string(),
  id_parent: z.coerce.string(),
  name: localized,
  is_root_category: z.coerce.string().optional(),
});

const productSchema = z.object({
  id: z.coerce.string(),
  name: localized,
  manufacturer_name: optionalText,
  reference: optionalText,
  ean13: optionalText,
  id_category_default: z.coerce.string(),
  link_rewrite: localized,
  // The price with tax, asked for with price[price_ttc][use_tax]=1.
  price_ttc: z.coerce.number(),
});

/** The shop the PrestaShop Webservice points at, when it is configured. */
export async function getPrestashopConfig() {
  const url = await getOptionalEnvValue("PRESTASHOP_URL");
  const apiKey = await getOptionalEnvValue("PRESTASHOP_API_KEY");
  if (!url || !apiKey) return null;
  // A self-hosted OpenSEO next to the shop can read the Webservice over the
  // local network when a CDN challenges requests from the server itself.
  const apiUrl = (await getOptionalEnvValue("PRESTASHOP_API_URL")) ?? url;
  return {
    url: url.replace(/\/+$/, ""),
    apiUrl: apiUrl.replace(/\/+$/, ""),
    apiKey,
  };
}

type PrestashopConfig = NonNullable<
  Awaited<ReturnType<typeof getPrestashopConfig>>
>;

/** Reads every page of one Webservice resource (JSON, read-only key). */
async function readAll<T>(
  config: PrestashopConfig,
  resource: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
) {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const search = new URLSearchParams({
      url: resource,
      ...params,
      output_format: "JSON",
      sort: "[id_ASC]",
      limit: `${page * PAGE_SIZE},${PAGE_SIZE}`,
    });
    const response = await fetch(
      // The dispatcher works whether or not the shop rewrites /api.
      `${config.apiUrl}/webservice/dispatcher.php?${search.toString()}`,
      {
        headers: {
          Authorization: `Basic ${btoa(`${config.apiKey}:`)}`,
          Accept: "application/json",
        },
      },
    );
    if (!response.ok)
      throw new Error(
        `PrestaShop ${resource} answered HTTP ${response.status}.`,
      );
    // An empty page is an empty array instead of { [resource]: [] }.
    const body = z
      .union([z.array(z.unknown()), z.record(z.string(), z.unknown())])
      .parse(await response.json());
    const items = Array.isArray(body) ? [] : body[resource];
    const parsed = z.array(schema).parse(items ?? []);
    rows.push(...parsed);
    if (parsed.length < PAGE_SIZE) return rows;
  }
  throw new Error(`PrestaShop ${resource}: more than ${MAX_PAGES} pages.`);
}

/** The shop's category tree and its active products, with tax-included prices. */
export async function readPrestashopCatalog(config: PrestashopConfig) {
  const [categories, products] = await Promise.all([
    readAll(
      config,
      "categories",
      { display: "[id,id_parent,name,is_root_category]" },
      categorySchema,
    ),
    readAll(
      config,
      "products",
      {
        display:
          "[id,name,manufacturer_name,reference,ean13,id_category_default,link_rewrite,price_ttc]",
        "filter[active]": "1",
        "price[price_ttc][use_tax]": "1",
      },
      productSchema,
    ),
  ]);
  return {
    categories,
    products: products.map((product) => ({
      ...product,
      url: `${config.url}/${product.id}-${product.link_rewrite}.html`,
    })),
  };
}
