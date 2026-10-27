import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { syncShoppingCatalog } from "@/serverFunctions/shopping";

/** Reads the catalogue again from the connected shop. */
export function ShoppingSyncButton({
  projectId,
  primary = false,
}: {
  projectId: string;
  primary?: boolean;
}) {
  const queryClient = useQueryClient();
  const sync = useMutation({
    mutationFn: () => syncShoppingCatalog({ data: { projectId } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["shopping", projectId] }),
  });
  return (
    <span className="inline-flex flex-col items-center gap-1">
      <Button
        size="sm"
        variant={primary ? "default" : "outline"}
        pending={sync.isPending}
        onClick={() => sync.mutate()}
      >
        <RefreshCw data-icon="inline-start" />
        Sync catalogue
      </Button>
      {sync.error && (
        <QueryError error={sync.error} fallback="The catalogue sync failed." />
      )}
    </span>
  );
}

export function ShoppingStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="min-w-28 rounded-lg border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone ?? ""}`}>
        {value}
      </p>
    </div>
  );
}
