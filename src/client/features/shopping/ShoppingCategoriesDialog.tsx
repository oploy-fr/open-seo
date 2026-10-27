import { useMemo } from "react";
import { groupBy, sortBy } from "remeda";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FormDialog } from "@/client/components/FormDialog";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import type { getShoppingOverview } from "@/serverFunctions/shopping";
import { setShoppingCategoryExcluded } from "@/serverFunctions/shopping";

type Category = Awaited<
  ReturnType<typeof getShoppingOverview>
>["categories"][number];
type Line = Category & { depth: number; total: number; inherited: boolean };

/** Flattens the category tree, parents first, with subtree product counts. */
function flattenTree(categories: Category[]) {
  const ids = new Set(categories.map((category) => category.externalId));
  const children = groupBy(categories, (category) =>
    category.parentExternalId && ids.has(category.parentExternalId)
      ? category.parentExternalId
      : "",
  );
  const lines: Line[] = [];
  const visit = (parentKey: string, depth: number, inherited: boolean) => {
    let total = 0;
    for (const category of sortBy(children[parentKey] ?? [], (c) => c.name)) {
      const line: Line = { ...category, depth, total: 0, inherited };
      lines.push(line);
      // Depth guard against a parent loop in imported data.
      line.total =
        category.products +
        (depth < 20
          ? visit(
              category.externalId,
              depth + 1,
              inherited || category.excluded,
            )
          : 0);
      total += line.total;
    }
    return total;
  };
  visit("", 0, false);
  return lines;
}

export function ShoppingCategoriesDialog({
  projectId,
  categories,
  onClose,
}: {
  projectId: string;
  categories: Category[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const lines = useMemo(() => flattenTree(categories), [categories]);
  const toggle = useMutation({
    mutationFn: (values: { categoryId: string; excluded: boolean }) =>
      setShoppingCategoryExcluded({ data: { projectId, ...values } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["shopping", projectId] }),
  });
  return (
    <FormDialog
      title="Categories to compare"
      onClose={onClose}
      actions={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Unchecked categories, and everything inside them, are left out of the
          price checks.
        </p>
        <div className="max-h-96 overflow-y-auto rounded-md border border-border py-1">
          {lines
            .filter((line) => line.total > 0 || line.excluded)
            .map((line) => (
              <label
                key={line.id}
                className="flex items-center gap-2 px-2 py-1 hover:bg-muted"
                style={{ paddingLeft: `${0.5 + line.depth}rem` }}
              >
                <Checkbox
                  checked={!line.excluded && !line.inherited}
                  disabled={line.inherited || toggle.isPending}
                  onCheckedChange={(checked) =>
                    toggle.mutate({ categoryId: line.id, excluded: !checked })
                  }
                />
                <span
                  className={
                    line.excluded || line.inherited
                      ? "text-muted-foreground"
                      : undefined
                  }
                >
                  {line.name}
                </span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {line.total}
                </span>
              </label>
            ))}
        </div>
        {toggle.error && (
          <QueryError error={toggle.error} fallback="Could not save." />
        )}
      </div>
    </FormDialog>
  );
}
