import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FormDialog } from "@/client/components/FormDialog";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import { importShoppingProducts } from "@/serverFunctions/shopping";
import { parseShoppingProducts } from "@/shared/shopping-import";
import { MAX_SHOPPING_PRODUCTS } from "@/shared/shopping";

export function ShoppingImportDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [archiveMissing, setArchiveMissing] = useState(true);
  const parsed = parseShoppingProducts(text);
  const save = useMutation({
    mutationFn: () =>
      importShoppingProducts({
        data: { projectId, products: parsed.products, archiveMissing },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["shopping", projectId],
      });
      onClose();
    },
  });
  const tooMany = parsed.products.length > MAX_SHOPPING_PRODUCTS;
  return (
    <FormDialog
      title="Import products"
      onClose={onClose}
      actions={
        <>
          <Button variant="outline" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            pending={save.isPending}
            disabled={!parsed.products.length || tooMany}
            onClick={() => save.mutate()}
          >
            Import {parsed.products.length || ""} products
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Paste a CSV export or spreadsheet rows with a header. Needed columns:
          title (or nom) and price (or prix). Optional: sku/id_product,
          brand/marque, gtin/ean13, category, url.
        </p>
        <input
          type="file"
          accept=".csv,.tsv,.txt"
          className="block w-full text-xs"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void file.text().then(setText);
          }}
        />
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          className="field-sizing-fixed w-full font-mono text-xs"
          placeholder={
            "id_product;nom;marque;ean13;prix_ttc\n12;Red Sea Foundation A 500ml;Red Sea;7290101761234;22,90"
          }
        />
        {text.trim() && (
          <p className="text-xs text-muted-foreground">
            {parsed.missingColumns.length
              ? `Missing columns: ${parsed.missingColumns.join(", ")}.`
              : `${parsed.products.length} products ready${parsed.skipped ? `, ${parsed.skipped} rows skipped (no title, no price or inactive)` : ""}.`}
            {tooMany && ` Import at most ${MAX_SHOPPING_PRODUCTS}.`}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Checkbox
            id="shopping-archive-missing"
            checked={archiveMissing}
            onCheckedChange={(checked) => setArchiveMissing(checked)}
          />
          <Label htmlFor="shopping-archive-missing" className="font-normal">
            Stop tracking products missing from this import
          </Label>
        </div>
        {save.error && (
          <QueryError error={save.error} fallback="The import failed." />
        )}
      </div>
    </FormDialog>
  );
}
