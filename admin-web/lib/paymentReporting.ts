export type PaymentAmount = { amount: number | string; currency: string | null };

export function paymentCurrency(currency: string | null) {
  return currency?.trim().toUpperCase() || "Unknown currency";
}

export function isPaymentInFlight(status: string) {
  return status === "pending" || status === "processing";
}

// Reporting only: currencies are never converted or combined into one amount.
export function paymentTotals(rows: PaymentAmount[], average = false) {
  const totals = new Map<string, { amount: number; count: number }>();
  for (const row of rows) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) throw new Error("A payment amount could not be read.");
    const currency = paymentCurrency(row.currency);
    const total = totals.get(currency) ?? { amount: 0, count: 0 };
    total.amount += amount;
    total.count += 1;
    totals.set(currency, total);
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, total]) =>
    currency + " " + (average ? total.amount / total.count : total.amount).toLocaleString("en-US", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }),
  ).join(" · ") || "—";
}
