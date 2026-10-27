import { readFileSync } from "node:fs";
import type { Client, InValue } from "@libsql/client";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ShoppingService } from "./ShoppingService";
import { ShoppingStatus } from "@/shared/shopping";

const mocks = vi.hoisted(() => ({
  client: null as Client | null,
  database: null as LibSQLDatabase | null,
  taskPost: vi.fn(),
  taskResult: vi.fn(),
}));

vi.mock("@/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  mocks.client = createClient({ url: "file::memory:" });
  mocks.database = drizzle(mocks.client);
  return { db: mocks.database };
});
vi.mock("@/db/runBatch", () => ({
  DB_BATCH_SIZE: 100,
  runBatch: async (
    build: (
      tx: Pick<LibSQLDatabase, "insert" | "update" | "delete">,
    ) => { toSQL: () => { sql: string; params: InValue[] } }[],
  ) => {
    if (!mocks.database || !mocks.client)
      throw new Error("Database not initialized");
    await mocks.client.batch(
      build(mocks.database).map((query) => {
        const { sql, params } = query.toSQL();
        return { sql, args: params };
      }),
      "write",
    );
  },
}));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/lib/dataforseo", () => ({
  MAX_TASKS_PER_POST: 100,
  createDataforseoClient: () => ({
    merchant: { shoppingTaskPost: mocks.taskPost },
  }),
  fetchShoppingProductTaskResult: mocks.taskResult,
}));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: async () => false,
}));
vi.mock("@/server/billing/subscription", () => ({}));

const project = {
  id: "project-a",
  name: "Créati'Récif",
  domain: "creati-recif.com",
  locationCode: 2250,
  languageCode: "fr",
};
const customer = {
  organizationId: "org-a",
  userId: "user-a",
  userEmail: "test@example.com",
};
const foundation = {
  sku: "12",
  title: "Foundation A 500ml",
  brand: "Red Sea",
  price: 22,
  currency: "EUR",
};
const offer = (rank: number, title: string, seller: string, price: number) => ({
  rank,
  title,
  seller,
  domain: null,
  price,
  oldPrice: null,
  currency: "EUR",
  googleProductId: null,
  shoppingUrl: null,
});
const client = mocks.client;
if (!client) throw new Error("Database not initialized");

beforeAll(async () => {
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, archived_at TEXT);
    CREATE TABLE project_competitors (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, domain TEXT NOT NULL, name TEXT, notes TEXT, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
    ${readFileSync("drizzle/sqlite/0063_shopping_prices.sql", "utf8")}
  `);
});
afterAll(() => client.close());
beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM shopping_products; DELETE FROM project_competitors; DELETE FROM projects;
    INSERT INTO projects VALUES ('project-a', 'org-a', NULL);
    INSERT INTO project_competitors VALUES ('c1', 'project-a', 'recifathome.com', 'Récif at Home', NULL, '2026-10-27', 'user');
  `);
  mocks.taskPost.mockImplementation(
    async (input: { tasks: { tag: string }[] }) =>
      new Map(input.tasks.map((task) => [task.tag, `task-${task.tag}`])),
  );
});

describe("ShoppingService", () => {
  it("compares our price with matched Google Shopping offers", async () => {
    await ShoppingService.importProducts(project.id, {
      projectId: project.id,
      products: [{ ...foundation, gtin: null, category: null, url: null }],
      archiveMissing: true,
    });
    const check = await ShoppingService.startCheck(project, customer);
    expect(mocks.taskPost).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [
          expect.objectContaining({ keyword: "Red Sea Foundation A 500ml" }),
        ],
        locationCode: 2250,
      }),
    );
    mocks.taskResult.mockResolvedValue({
      status: "completed",
      offers: [
        offer(1, "Red Sea Foundation A 500 ml", "Récif at Home", 19),
        offer(2, "Red Sea Foundation A - 500ml", "Masterfisch", 21),
        offer(3, "Red Sea Foundation A 500ml", "Créati'Récif", 22),
        offer(4, "Red Sea Foundation A 1L", "Masterfisch", 35),
      ],
    });

    const overview = await ShoppingService.getOverview(project);

    expect(overview.activeCheck).toBeNull();
    expect(overview.shownCheck).toMatchObject({
      id: check.id,
      status: ShoppingStatus.Completed,
    });
    // Our own listing and the 1 L variant stay out of the market price.
    expect(overview.rows[0]).toMatchObject({
      confidence: "match",
      market: { offers: 2, median: 20, gapPct: 10, position: "pricier" },
      ourListingPrice: 22,
      competitors: [{ domain: "recifathome.com", price: 19 }],
    });
    expect(overview.brands).toEqual([
      expect.objectContaining({ key: "Red Sea", compared: 1, pricier: 1 }),
    ]);
  });

  it("updates known products and stops tracking the ones a new import drops", async () => {
    const base = { gtin: null, category: null, url: null };
    await ShoppingService.importProducts(project.id, {
      projectId: project.id,
      products: [
        { ...foundation, ...base },
        { ...foundation, ...base, sku: "13", title: "Foundation B 500ml" },
      ],
      archiveMissing: true,
    });
    expect(
      await ShoppingService.importProducts(project.id, {
        projectId: project.id,
        products: [{ ...foundation, ...base, price: 24 }],
        archiveMissing: true,
      }),
    ).toEqual({ added: 0, updated: 1, archived: 1 });
    const overview = await ShoppingService.getOverview(project);
    expect(overview.rows).toMatchObject([{ sku: "12", ourPrice: 24 }]);
  });
});
