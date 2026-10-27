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

  it("rejects other models, variants, parts and multipacks", () => {
    const cases: [string | null, string, string][] = [
      ["SICCE", "SICCE Syncra 1.0", "Sicce Syncra ADV 5.5"],
      [
        "MAXSPECT",
        "MAXSPECT Gyre 330 Cloud Edition",
        "MAXSPECT Gyre 350 Cloud Edition",
      ],
      [
        "FAUNA MARIN",
        "FAUNA MARIN V trace 250ml",
        "Fauna Marin Elementals Trace F 250 ml",
      ],
      ["Salifert", "Salifert test Calcium", "Salifert Test Magnésium"],
      [
        "SICCE",
        "SICCE Syncra 3.5",
        "SICCE Rotor complet pour pompes syncra 3.5/4.0/5.0",
      ],
      ["SICCE", "SICCE 1000 l/h Voyager nano", "Sicce Voyager Nano 2000"],
      [null, "Colle PVC Gel 500ml", "Colle tuyaux pvc gel 500ml - lot de 12"],
    ];
    for (const [brand, title, offer] of cases)
      expect(matchShoppingOffer({ title, brand }, offer).match).toBe(
        ShoppingOfferMatch.Other,
      );
    expect(
      matchShoppingOffer(
        { title: "Hanna HI774 Phosphates ULR", brand: "Hanna" },
        "HANNA HI774 Mini-photomètre Phosphate ULR",
      ).match,
    ).toBe(ShoppingOfferMatch.Match);
    expect(
      matchShoppingOffer(
        { title: "SICCE Syncra 2.5", brand: "SICCE" },
        "Pompe SICCE Syncra 2.5",
      ).match,
    ).toBe(ShoppingOfferMatch.Match);
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
