import { useMemo, useState } from "react";
import { sortBy } from "remeda";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  FolderTree,
  Play,
  ShoppingBag,
  Upload,
} from "lucide-react";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError, QueryState } from "@/client/components/QueryState";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  getShoppingOverview,
  setShoppingSchedule,
  startShoppingCheck,
} from "@/serverFunctions/shopping";
import {
  isShoppingCheckActive,
  ShoppingStatus,
  type ShoppingScheduleInterval,
} from "@/shared/shopping";
import { formatGap, formatPrice, gapClassName } from "./format";
import { ShoppingBrandTable } from "./ShoppingBrandTable";
import { ShoppingCategoriesDialog } from "./ShoppingCategoriesDialog";
import { ShoppingStat as Stat, ShoppingSyncButton } from "./ShoppingSyncButton";
import { ShoppingImportDialog } from "./ShoppingImportDialog";
import { ShoppingOffersDialog } from "./ShoppingOffersDialog";

type Overview = Awaited<ReturnType<typeof getShoppingOverview>>;
type Row = Overview["rows"][number];
type Filter = "all" | "pricier" | "cheaper" | "missing";

const SCHEDULES: { value: ShoppingScheduleInterval; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

export function ShoppingPage({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ["shopping", projectId],
    queryFn: () => getShoppingOverview({ data: { projectId } }),
    refetchInterval: (state) =>
      state.state.data?.activeCheck ? 15_000 : false,
  });
  return (
    <QueryState query={query} errorFallback="Failed to load shopping prices">
      {(data) => <ShoppingContent projectId={projectId} data={data} />}
    </QueryState>
  );
}

function filterRows(rows: Row[], filter: Filter) {
  const filtered = rows.filter((row) =>
    filter === "all"
      ? true
      : filter === "missing"
        ? !row.market
        : row.market?.position === filter,
  );
  // Biggest gaps first; products without market data last.
  return sortBy(filtered, [(row) => row.market?.gapPct ?? -Infinity, "desc"]);
}

function ShoppingContent({
  projectId,
  data,
}: {
  projectId: string;
  data: Overview;
}) {
  const queryClient = useQueryClient();
  const { overall, rows, brands, competitors, activeCheck, shownCheck } = data;
  const { catalog } = data;
  const [importing, setImporting] = useState(false);
  const [editingCategories, setEditingCategories] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [offersFor, setOffersFor] = useState<Row | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["shopping", projectId] });
  const start = useMutation({
    mutationFn: (requestId: string) =>
      startShoppingCheck({ data: { projectId, requestId } }),
    onSuccess: async () => {
      setConfirm(null);
      await refresh();
    },
  });
  const schedule = useMutation({
    mutationFn: (scheduleInterval: ShoppingScheduleInterval) =>
      setShoppingSchedule({ data: { projectId, scheduleInterval } }),
    onSuccess: refresh,
  });

  const visible = useMemo(() => filterRows(rows, filter), [rows, filter]);

  if (!rows.length && !catalog.excludedProducts)
    return (
      <>
        <EmptyState
          variant="card"
          icon={ShoppingBag}
          title="No products yet"
          description={
            catalog.shop
              ? `Sync your catalogue from ${catalog.shop} to compare your prices with Google Shopping.`
              : "Import your catalogue (CSV export of your shop) to compare your prices with Google Shopping."
          }
          action={
            catalog.shop ? (
              <ShoppingSyncButton projectId={projectId} primary />
            ) : (
              <Button size="sm" onClick={() => setImporting(true)}>
                <Upload data-icon="inline-start" />
                Import products
              </Button>
            )
          }
        />
        {importing && (
          <ShoppingImportDialog
            projectId={projectId}
            onClose={() => setImporting(false)}
          />
        )}
      </>
    );

  return (
    <div className="space-y-3">
      <Card className="gap-3 px-4 py-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Price position</h2>
            <p className="text-xs text-muted-foreground">
              {rows.length} products tracked
              {catalog.excludedProducts > 0 &&
                ` (${catalog.excludedProducts} in excluded categories)`}
              {catalog.syncedAt &&
                ` · synced from ${catalog.shop} ${new Date(catalog.syncedAt).toLocaleString()}`}
              {" · "}
              {shownCheck
                ? `results from ${new Date(shownCheck.createdAt).toLocaleDateString()}`
                : "no check yet"}
              {data.settings.nextCheckAt &&
                ` · next check ${new Date(data.settings.nextCheckAt).toLocaleDateString()}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedToggle
              items={SCHEDULES.map((item) => ({ ...item, icon: null }))}
              value={data.settings.scheduleInterval}
              onChange={(value) => schedule.mutate(value)}
              showLabels
            />
            {data.categories.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditingCategories(true)}
              >
                <FolderTree data-icon="inline-start" />
                Categories
              </Button>
            )}
            {catalog.shop ? (
              <ShoppingSyncButton projectId={projectId} />
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setImporting(true)}
              >
                <Upload data-icon="inline-start" />
                Import
              </Button>
            )}
            <Button
              size="sm"
              disabled={Boolean(activeCheck)}
              onClick={() => setConfirm(crypto.randomUUID())}
            >
              <Play data-icon="inline-start" />
              {activeCheck
                ? `Checking ${activeCheck.done}/${activeCheck.total}`
                : "Check prices"}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Stat
            label="Compared"
            value={`${overall.compared}/${overall.products}`}
          />
          <Stat
            label="Median gap"
            value={formatGap(overall.medianGapPct)}
            tone={gapClassName(overall.medianGapPct)}
          />
          <Stat
            label="Cheaper"
            value={String(overall.cheaper)}
            tone="text-success"
          />
          <Stat label="Aligned ±5 %" value={String(overall.aligned)} />
          <Stat
            label="Pricier"
            value={String(overall.pricier)}
            tone="text-destructive"
          />
        </div>
        {data.checks[0]?.status === ShoppingStatus.Failed && (
          <p className="text-xs text-destructive">
            The last check on{" "}
            {new Date(data.checks[0].createdAt).toLocaleDateString()} found no
            results: Google Shopping did not answer.
            {shownCheck && " The results below are from an earlier check."}
          </p>
        )}
        {schedule.error && (
          <QueryError
            error={schedule.error}
            fallback="Could not save the schedule."
          />
        )}
      </Card>

      {brands.length > 1 && <ShoppingBrandTable brands={brands} />}

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2">
          <h3 className="text-sm font-semibold">Products</h3>
          <SegmentedToggle
            items={[
              { value: "all" as const, label: "All", icon: null },
              { value: "pricier" as const, label: "Pricier", icon: null },
              { value: "cheaper" as const, label: "Cheaper", icon: null },
              { value: "missing" as const, label: "Not found", icon: null },
            ]}
            value={filter}
            onChange={setFilter}
            showLabels
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Our price</TableHead>
              <TableHead className="text-right">Market median</TableHead>
              <TableHead className="text-right">Gap</TableHead>
              <TableHead className="text-right">Cheapest</TableHead>
              {competitors.map((competitor) => (
                <TableHead key={competitor.domain} className="text-right">
                  {competitor.name ?? competitor.domain}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow
                key={row.productId}
                className={row.lookupId ? "cursor-pointer" : undefined}
                onClick={() => row.lookupId && setOffersFor(row)}
              >
                <TableCell className="max-w-96 whitespace-normal">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{row.title}</span>
                    {row.url && (
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Open the product page"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                    {row.confidence === "probable" && (
                      <Badge variant="warning">Probable</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[row.brand, row.category].filter(Boolean).join(" · ")}
                  </p>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPrice(row.ourPrice, row.currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.market ? (
                    <>
                      {formatPrice(row.market.median, row.currency)}
                      <p className="text-xs text-muted-foreground">
                        {row.market.offers} offers
                      </p>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {row.status && isShoppingCheckActive(row.status)
                        ? "Checking…"
                        : row.status
                          ? "Not found"
                          : "—"}
                    </span>
                  )}
                </TableCell>
                <TableCell
                  className={`text-right font-medium tabular-nums ${gapClassName(row.market?.gapPct ?? null)}`}
                >
                  {formatGap(row.market?.gapPct ?? null)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.market ? formatPrice(row.market.min, row.currency) : "—"}
                </TableCell>
                {competitors.map((competitor) => {
                  const price = row.competitors.find(
                    (item) => item.domain === competitor.domain,
                  )?.price;
                  return (
                    <TableCell
                      key={competitor.domain}
                      className="text-right tabular-nums"
                    >
                      {price != null ? formatPrice(price, row.currency) : "—"}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {importing && (
        <ShoppingImportDialog
          projectId={projectId}
          onClose={() => setImporting(false)}
        />
      )}
      {editingCategories && (
        <ShoppingCategoriesDialog
          projectId={projectId}
          categories={data.categories}
          onClose={() => setEditingCategories(false)}
        />
      )}
      {offersFor?.lookupId && (
        <ShoppingOffersDialog
          projectId={projectId}
          productId={offersFor.productId}
          lookupId={offersFor.lookupId}
          title={offersFor.title}
          query={offersFor.query}
          ourPrice={offersFor.ourPrice}
          onClose={() => setOffersFor(null)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title="Check prices on Google Shopping"
          confirmLabel="Check prices"
          pending={start.isPending}
          onConfirm={() => start.mutate(confirm)}
          onClose={() => setConfirm(null)}
        >
          One Google Shopping search per product ({rows.length} searches, about{" "}
          {data.checkCostCredits} credits). Results arrive within a few minutes.
          {start.error && (
            <QueryError
              error={start.error}
              fallback="The check could not start."
            />
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
