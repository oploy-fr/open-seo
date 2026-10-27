const priceFormat = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "EUR",
});

export function formatPrice(value: number, currency = "EUR") {
  return currency === "EUR"
    ? priceFormat.format(value)
    : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
        value,
      );
}

export function formatGap(value: number | null) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} %`;
}

/** Green when we are cheaper, red when pricier, neutral within ±5 %. */
export function gapClassName(value: number | null) {
  if (value == null || Math.abs(value) <= 5) return "text-muted-foreground";
  return value > 0 ? "text-destructive" : "text-success";
}
