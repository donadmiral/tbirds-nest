/** The bank receives decimal text, never a rounded JavaScript money value. */
export function payoutPayload(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_COMMAND");
  const b = body as Record<string, unknown>;
  if (typeof b.partner_reference !== "string" || !b.partner_reference.trim() || b.partner_reference.length > 100) throw new Error("INVALID_PARTNER_REFERENCE");
  const amount = typeof b.amount === "number" && Number.isFinite(b.amount) ? String(b.amount) : b.amount;
  if (typeof amount !== "string" || !/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,2})?$/.test(amount)) throw new Error("INVALID_AMOUNT");
  const [whole, fraction = ""] = amount.split(".");
  const minor = BigInt(whole + fraction.padEnd(2, "0"));
  if (minor <= 0n || minor > 9007199254740991n) throw new Error("INVALID_AMOUNT");
  return {
    key: b.partner_reference,
    payload: {
      institution_code: typeof b.institution_code === "string" ? b.institution_code.trim().toUpperCase() : "",
      account_number: typeof b.account_number === "string" ? b.account_number.replace(/\s+/g, "") : "",
      currency: typeof b.currency === "string" ? b.currency.trim().toUpperCase() : "USD",
      amount: whole + "." + fraction.padEnd(2, "0"),
      reference: b.partner_reference,
      note: typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 140) : null,
    },
  };
}
