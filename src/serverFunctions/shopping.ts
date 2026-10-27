import { createServerFn } from "@tanstack/react-start";
import { ShoppingService } from "@/server/features/shopping/services/ShoppingService";
import { requireProjectContext } from "./middleware";
import {
  importShoppingProductsSchema,
  shoppingLookupSchema,
  shoppingProductUpdateSchema,
  shoppingProjectSchema,
  shoppingScheduleSchema,
  startShoppingCheckSchema,
} from "@/types/schemas/shopping";

export const getShoppingOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(shoppingProjectSchema)
  .handler(({ context }) => ShoppingService.getOverview(context.project));
export const importShoppingProducts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(importShoppingProductsSchema)
  .handler(({ data, context }) =>
    ShoppingService.importProducts(context.projectId, data),
  );
export const setShoppingSchedule = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(shoppingScheduleSchema)
  .handler(({ data, context }) =>
    ShoppingService.setSchedule(context.projectId, data.scheduleInterval),
  );
export const startShoppingCheck = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(startShoppingCheckSchema)
  .handler(({ data, context }) =>
    ShoppingService.startCheck(context.project, context, data.requestId),
  );
export const getShoppingOffers = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(shoppingLookupSchema)
  .handler(({ data, context }) =>
    ShoppingService.getOffers(context.projectId, data.lookupId),
  );
export const updateShoppingProduct = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(shoppingProductUpdateSchema)
  .handler(async ({ data, context }) => {
    if (data.archived !== undefined)
      await ShoppingService.setProductArchived(
        context.projectId,
        data.productId,
        data.archived,
      );
    if (data.searchQuery !== undefined)
      await ShoppingService.updateProductQuery(
        context.projectId,
        data.productId,
        data.searchQuery,
      );
  });
