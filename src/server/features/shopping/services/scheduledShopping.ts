import { nextShoppingCheckAt } from "@/shared/shopping";
import { ShoppingRepository as repo } from "../repositories/ShoppingRepository";
import { collectShoppingCheck } from "./shoppingCollection";
import { ShoppingService } from "./ShoppingService";

/**
 * Cron body: collects the searches of running checks, then starts the checks
 * that are due. Google Shopping tasks are queued at DataForSEO, so the
 * five-minute cron is what waits for them; no Workflow is needed.
 */
export async function runScheduledShopping() {
  for (const { check } of await repo.listActiveChecks()) {
    try {
      await collectShoppingCheck(check);
    } catch (error) {
      console.error(`[shopping] collecting check ${check.id} failed:`, error);
    }
  }

  const now = new Date();
  for (const { settings, project } of await repo.listDueSettings(
    now.toISOString(),
  )) {
    try {
      const claimed = await repo.claimDueSettings(
        settings.projectId,
        settings.nextCheckAt!,
        nextShoppingCheckAt(settings.scheduleInterval, now),
      );
      if (!claimed) continue;
      const products = await repo.listProducts(project.id);
      if (!products.length) continue;
      await ShoppingService.startCheck(project, {
        organizationId: project.organizationId,
        userId: "system",
        userEmail: "system@openseo.so",
      });
    } catch (error) {
      console.error(
        `[shopping] scheduled check for ${settings.projectId} failed:`,
        error,
      );
    }
  }
}
