import { describe, expect, it } from "vitest";
import {
  isSameSeller,
  matchShoppingOffer,
  ShoppingOfferMatch,
  shoppingPriceStats,
} from "./shopping";
import { parseShoppingProducts } from "./shopping-import";

const foundation = { title: "Red Sea Foundation A 500ml", brand: "Red Sea" };

describe("matchShoppingOffer", () => {
  it("matches the same product written differently", () => {
    expect(
      matchShoppingOffer(foundation, "RED SEA - Foundation A (Calcium) 0,5 L")
        .match,
    ).toBe(ShoppingOfferMatch.Match);
  });

  it("rejects another size or another brand", () => {
    expect(
      matchShoppingOffer(foundation, "Red Sea Foundation A 1L").match,
    ).toBe(ShoppingOfferMatch.Other);
    expect(
      matchShoppingOffer(foundation, "Tropic Marin Foundation A 500 ml").match,
    ).toBe(ShoppingOfferMatch.Other);
  });

  it("keeps an offer without size as probable", () => {
    expect(
      matchShoppingOffer(foundation, "Red Sea Reef Foundation A calcium").match,
    ).toBe(ShoppingOfferMatch.Probable);
  });
});

describe("isSameSeller", () => {
  it("reads a seller name and a domain as the same shop", () => {
    expect(
      isSameSeller(
        { seller: "Récif at Home", domain: null },
        { domain: "recifathome.com" },
      ),
    ).toBe(true);
    expect(
      isSameSeller(
        { seller: "Amazon.fr", domain: "amazon.fr" },
        { domain: "recifathome.com" },
      ),
    ).toBe(false);
  });
});

describe("shoppingPriceStats", () => {
  it("compares our price with the market median, without outliers", () => {
    expect(shoppingPriceStats(22, [20, 20, 21, 4.9, 19])).toMatchObject({
      offers: 4,
      median: 20,
      gapPct: 10,
      position: "pricier",
      cheaperOffers: 4,
    });
    expect(shoppingPriceStats(10, [])).toBeNull();
  });
});

describe("parseShoppingProducts", () => {
  it("reads a French shop export and skips unusable rows", () => {
    const csv = [
      "id_product;nom;marque;reference;ean13;categorie;prix_ttc;active;url",
      '12;"Red Sea Foundation A 500ml";Red Sea;RS-A;7290101761234;Additifs;22,90;1;https://shop.test/12',
      "13;Pompe Vectra M2;Ecotech;;0;Matériels;499.00;0;",
      "14;Sans prix;;;;;;1;",
    ].join("\n");
    expect(parseShoppingProducts(csv)).toEqual({
      products: [
        {
          sku: "12",
          title: "Red Sea Foundation A 500ml",
          brand: "Red Sea",
          gtin: "7290101761234",
          category: "Additifs",
          price: 22.9,
          currency: "EUR",
          url: "https://shop.test/12",
        },
      ],
      skipped: 2,
      missingColumns: [],
    });
  });
});
