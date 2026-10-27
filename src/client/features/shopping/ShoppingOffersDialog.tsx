import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QueryError, QueryState } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  getShoppingOffers,
  updateShoppingProduct,
} from "@/serverFunctions/shopping";
import { ShoppingOfferMatch } from "@/shared/shopping";
import { formatPrice } from "./format";

const MATCH_LABELS = {
  [ShoppingOfferMatch.Match]: { label: "Same product", variant: "success" },
  [ShoppingOfferMatch.Probable]: { label: "Probable", variant: "warning" },
  [ShoppingOfferMatch.Other]: { label: "Other product", variant: "outline" },
} as const;

/** Every Google Shopping listing found for one product, with its match. */
export function ShoppingOffersDialog({
  projectId,
  productId,
  lookupId,
  title,
  query: search,
  ourPrice,
  onClose,
}: {
  projectId: string;
  productId: string;
  lookupId: string;
  title: string;
  query: string;
  ourPrice: number;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["shopping", projectId, "offers", lookupId],
    queryFn: () => getShoppingOffers({ data: { projectId, lookupId } }),
  });
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState(search);
  const update = useMutation({
    mutationFn: (values: { archived?: boolean; searchQuery?: string | null }) =>
      updateShoppingProduct({ data: { projectId, productId, ...values } }),
    onSuccess: async (_, values) => {
      await queryClient.invalidateQueries({
        queryKey: ["shopping", projectId],
      });
      if (values.archived) onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Our price {formatPrice(ourPrice)}
          </p>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Google Shopping search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="h-8 min-w-60 flex-1 text-sm"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={searchQuery.trim() === search}
            pending={
              update.isPending && update.variables.searchQuery !== undefined
            }
            onClick={() => update.mutate({ searchQuery })}
          >
            Save search
          </Button>
          <Button
            size="sm"
            variant="ghost"
            pending={update.isPending && update.variables.archived === true}
            onClick={() => update.mutate({ archived: true })}
          >
            Stop tracking
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          A new search applies from the next check. Clear it to search by brand
          and title again.
        </p>
        {update.error && (
          <QueryError
            error={update.error}
            fallback="Could not save the product."
          />
        )}
        <QueryState query={query} errorFallback="Failed to load the listings">
          {(offers) =>
            offers.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Google Shopping listed no priced offer for this search.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Listing</TableHead>
                    <TableHead>Seller</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead>Match</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {offers.map((offer) => (
                    <TableRow key={offer.id}>
                      <TableCell className="max-w-80 whitespace-normal">
                        {offer.shoppingUrl ? (
                          <a
                            href={offer.shoppingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {offer.title}
                          </a>
                        ) : (
                          offer.title
                        )}
                      </TableCell>
                      <TableCell>
                        {offer.seller ?? offer.domain ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPrice(offer.price)}
                        {offer.oldPrice != null && (
                          <span className="ml-1 text-xs text-muted-foreground line-through">
                            {formatPrice(offer.oldPrice)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={MATCH_LABELS[offer.match].variant}>
                          {MATCH_LABELS[offer.match].label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          }
        </QueryState>
      </DialogContent>
    </Dialog>
  );
}
