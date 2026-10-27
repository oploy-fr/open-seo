// Reads a product export (CSV or a spreadsheet paste) into shopping products.
// Column names are matched loosely, in English or French, so a shop export
// can be pasted as it is.

const COLUMNS = {
  sku: ["sku", "id", "id_product", "product_id", "reference", "ref"],
  title: ["title", "name", "nom", "product", "produit", "designation"],
  brand: ["brand", "marque", "manufacturer", "fabricant"],
  gtin: ["gtin", "ean", "ean13", "upc", "barcode"],
  category: ["category", "categorie", "catégorie", "type"],
  price: ["price", "prix", "prix_ttc", "price_ttc", "sale_price"],
  currency: ["currency", "devise"],
  url: ["url", "link", "lien"],
  active: ["active", "actif", "enabled"],
} as const;

type Column = keyof typeof COLUMNS;

type ParsedShoppingProduct = {
  sku: string;
  title: string;
  brand: string | null;
  gtin: string | null;
  category: string | null;
  price: number;
  currency: string;
  url: string | null;
};

function splitLine(line: string, separator: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function detectSeparator(header: string) {
  return ["\t", ";", ","].reduce((best, separator) =>
    header.split(separator).length > header.split(best).length
      ? separator
      : best,
  );
}

function parsePrice(value: string | undefined) {
  if (!value) return null;
  const cleaned = value.replace(/[^\d.,-]/g, "");
  // "1 234,50" and "1,234.50" both read as 1234.5.
  const normalized =
    cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  const price = Number(normalized);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function parseShoppingProducts(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2)
    return { products: [], skipped: 0, missingColumns: ["title", "price"] };
  const separator = detectSeparator(lines[0]);
  const header = splitLine(lines[0], separator).map((name) =>
    name.toLowerCase().replace(/^﻿/, ""),
  );
  const find = (column: Column) =>
    header.findIndex((name) =>
      (COLUMNS[column] as readonly string[]).includes(name),
    );
  const index: Record<Column, number> = {
    sku: find("sku"),
    title: find("title"),
    brand: find("brand"),
    gtin: find("gtin"),
    category: find("category"),
    price: find("price"),
    currency: find("currency"),
    url: find("url"),
    active: find("active"),
  };
  const missingColumns = (["title", "price"] as const).filter(
    (column) => index[column] < 0,
  );
  if (missingColumns.length)
    return { products: [], skipped: 0, missingColumns };

  const products: ParsedShoppingProduct[] = [];
  let skipped = 0;
  for (const [row, line] of lines.slice(1).entries()) {
    const cells = splitLine(line, separator);
    const read = (column: Column) => {
      const value = index[column] >= 0 ? cells[index[column]]?.trim() : "";
      return value && value !== "NULL" ? value : null;
    };
    const title = read("title");
    const price = parsePrice(read("price") ?? undefined);
    const active = read("active");
    if (!title || title.length < 2 || !price || active === "0") {
      skipped++;
      continue;
    }
    const gtin = read("gtin");
    products.push({
      sku: read("sku") ?? `row-${row + 1}`,
      title,
      brand: read("brand"),
      gtin: gtin && /^\d{8,14}$/.test(gtin) && !/^0+$/.test(gtin) ? gtin : null,
      category: read("category"),
      price,
      currency: (read("currency") ?? "EUR").toUpperCase().slice(0, 3),
      url: read("url"),
    });
  }
  return { products, skipped, missingColumns };
}
