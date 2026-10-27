import { z } from "zod";
import { dataforseoGet, dataforseoPost } from "@/server/lib/dataforseo/core";
import { MAX_TASKS_PER_POST } from "@/server/lib/dataforseo/shared";
import {
  DataforseoChargedTaskError,
  failedResponseError,
  invalidFieldName,
  isNoResultsTask,
  isTaskInProgress,
  type DataforseoApiResponse,
  type DataforseoItemsTask,
  type DataforseoTaskLike,
} from "@/server/lib/dataforseo/envelope";
import { AppError } from "@/server/lib/errors";

// ---------------------------------------------------------------------------
// Google Shopping product searches (shopping price tracking). Merchant has no
// live endpoint: task_post (charged, one SERP of up to 40 results per task)
// then task_get (free) once the task is done, usually within minutes.
// ---------------------------------------------------------------------------

interface ShoppingTaskInput {
  /** Echoed back on the task, so ids map to lookups without relying on order. */
  tag: string;
  keyword: string;
}

/**
 * Posts one Google Shopping search per input and returns the task id per
 * tag, missing where DataForSEO rejected an entry. Not retried on a 5xx,
 * which does not prove the post went unbilled.
 */
export async function postShoppingProductTasks(input: {
  tasks: ShoppingTaskInput[];
  locationCode: number;
  languageCode: string;
  depth: number;
}): Promise<DataforseoApiResponse<Map<string, string>>> {
  if (input.tasks.length === 0 || input.tasks.length > MAX_TASKS_PER_POST) {
    throw new AppError(
      "INTERNAL_ERROR",
      `task_post accepts 1-${MAX_TASKS_PER_POST} tasks, got ${input.tasks.length}`,
    );
  }
  const response = await dataforseoPost<
    DataforseoTaskLike & { id?: string; data?: Record<string, unknown> }
  >(
    "/v3/merchant/google/products/task_post",
    input.tasks.map((task) => ({
      keyword: task.keyword.slice(0, 700),
      location_code: input.locationCode,
      language_code: input.languageCode,
      depth: input.depth,
      tag: task.tag,
    })),
    { maxServerErrorRetries: 0 },
  );
  if (!response || response.status_code !== 20000) {
    throw failedResponseError(response, "DataForSEO task_post failed");
  }

  // Cost is summed over every entry, accepted or not, so anything DataForSEO
  // charged is metered.
  const taskIds = new Map<string, string>();
  let costUsd = 0;
  for (const entry of response.tasks ?? []) {
    costUsd += entry.cost ?? 0;
    const tag = entry.data?.tag;
    if (entry.status_code === 20100 && entry.id && typeof tag === "string") {
      taskIds.set(tag, entry.id);
    } else {
      console.warn(
        `dataforseo.task_post.rejected-entry (${entry.status_code}): ${entry.status_message}`,
      );
    }
  }
  const billing = {
    path: ["v3", "merchant", "google", "products", "task_post"],
    costUsd,
  };
  if (taskIds.size === 0) {
    const message =
      response.tasks?.[0]?.status_message || "DataForSEO created no tasks";
    throw new DataforseoChargedTaskError(
      message,
      billing,
      invalidFieldName(message) !== null,
    );
  }
  return { data: taskIds, billing };
}

const shoppingItemSchema = z.object({
  type: z.string().nullish(),
  title: z.string().nullish(),
  seller: z.string().nullish(),
  domain: z.string().nullish(),
  price: z.number().nullish(),
  old_price: z.number().nullish(),
  currency: z.string().nullish(),
  product_id: z.string().nullish(),
  shopping_url: z.string().nullish(),
  items: z.array(z.unknown()).nullish(),
});

type ShoppingOfferItem = {
  rank: number;
  title: string;
  seller: string | null;
  domain: string | null;
  price: number;
  oldPrice: number | null;
  currency: string | null;
  googleProductId: string | null;
  shoppingUrl: string | null;
};

/**
 * The priced product listings of a Google Shopping SERP, in page order.
 * Carousels nest their products one level down; related searches and other
 * blocks carry no price and drop out.
 */
function parseShoppingItems(items: unknown[]): ShoppingOfferItem[] {
  const offers: ShoppingOfferItem[] = [];
  const visit = (raw: unknown) => {
    const parsed = shoppingItemSchema.safeParse(raw);
    if (!parsed.success) return;
    const item = parsed.data;
    item.items?.forEach(visit);
    if (item.price == null || item.price <= 0 || !item.title) return;
    offers.push({
      rank: offers.length + 1,
      title: item.title,
      seller: item.seller ?? null,
      domain: item.domain ?? null,
      price: item.price,
      oldPrice: item.old_price ?? null,
      currency: item.currency ?? null,
      googleProductId: item.product_id ?? null,
      shoppingUrl: item.shopping_url ?? null,
    });
  };
  items.forEach(visit);
  return offers;
}

type ShoppingTaskOutcome =
  | { status: "pending" }
  | { status: "failed"; message: string }
  | { status: "completed"; offers: ShoppingOfferItem[] };

/** Collects one queued search. Not metered: the task was charged at task_post. */
export async function fetchShoppingProductTaskResult(
  taskId: string,
): Promise<ShoppingTaskOutcome> {
  const response = await dataforseoGet<DataforseoItemsTask<unknown>>(
    `/v3/merchant/google/products/task_get/advanced/${encodeURIComponent(taskId)}`,
  );
  const task = response?.tasks?.[0];
  if (!response || response.status_code !== 20000 || !task) {
    throw failedResponseError(response, "DataForSEO task_get failed");
  }
  if (isTaskInProgress(task)) return { status: "pending" };
  if (task.status_code !== 20000) {
    if (isNoResultsTask(task)) return { status: "completed", offers: [] };
    return {
      status: "failed",
      message:
        task.status_message || `DataForSEO task failed (${task.status_code})`,
    };
  }
  return {
    status: "completed",
    offers: parseShoppingItems(task.result?.[0]?.items ?? []),
  };
}
