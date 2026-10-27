import { Card } from "@/client/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import type { getShoppingOverview } from "@/serverFunctions/shopping";
import { formatGap, gapClassName } from "./format";

type Brand = Awaited<ReturnType<typeof getShoppingOverview>>["brands"][number];

export function ShoppingBrandTable({ brands }: { brands: Brand[] }) {
  return (
    <Card className="gap-0 py-0">
      <h3 className="px-4 pt-3 pb-2 text-sm font-semibold">By brand</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Brand</TableHead>
            <TableHead className="text-right">Compared</TableHead>
            <TableHead className="text-right">Median gap</TableHead>
            <TableHead className="text-right">Cheaper</TableHead>
            <TableHead className="text-right">Aligned</TableHead>
            <TableHead className="text-right">Pricier</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {brands.map((brand) => (
            <TableRow key={brand.key}>
              <TableCell>{brand.key || "No brand"}</TableCell>
              <TableCell className="text-right tabular-nums">
                {brand.compared}/{brand.products}
              </TableCell>
              <TableCell
                className={`text-right tabular-nums ${gapClassName(brand.medianGapPct)}`}
              >
                {formatGap(brand.medianGapPct)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {brand.cheaper}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {brand.aligned}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {brand.pricier}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
