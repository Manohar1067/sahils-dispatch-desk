/**
 * Terms & Conditions — the SEVEN conditions printed on the original physical
 * Sahil Road Lines Conditions document.
 *
 * Wording is reproduced verbatim from that document (including its original
 * spelling) and must NOT be silently rewritten into generic legal text,
 * shortened, merged or de-duplicated. It is the default print content used
 * whenever the company has not stored its own edited list, and it is the value
 * pre-loaded into Settings → Printed Terms & Conditions so an administrator can
 * still edit it (edits are stored in `settings.terms` and always win).
 */

/** The seven original conditions, in document order. */
export const DEFAULT_TERMS: string[] = [
  "Subject to Visakhapatnam Jurisdiction.",
  "The Owner of the Lorry is liable to compensate fully for any shortage or damage to goods due to the failure to Truck or accident or while in transit.",
  "In the event the goods are wrongly delivered to the third part of delivered in the wrong place the Owner of Lorry is responsible for the value or the goods and he has to compensate it.",
  "The driver has checked counted and taken delivery of all the goods as mentioned in the G.C. Notes given to him.",
  "The Owner is fully responsible for any shortage or damages done goods by any cause by the driver, cleaner or any of his assistant.",
  "If the party/Transporter has not paid the Balance hire at the destination, concerned Proof / Written cause should produce for payment at the Booking place.",
  "Our responsibility bound for shortage of the material only up to the quantity allowed in the G.C. Note. If so we are not responsible, if it will exceeds more than the allowed quantity.",
];

/** The same seven conditions as the newline-separated text held in Settings. */
export const DEFAULT_TERMS_TEXT: string = DEFAULT_TERMS.join("\n");

/**
 * How many conditions print in a single Terms column.
 *
 * The receipt lays the conditions out in newspaper columns so a long list stays
 * compact instead of running the memo onto a second page:
 *   1–5 conditions  → 1 column
 *   6–10 conditions → 2 columns
 *  11–15 conditions → 3 columns
 */
export const TERMS_PER_COLUMN = 5;

/**
 * Splits a stored/newline-separated terms blob into individual conditions.
 * Leading list markers ("1.", "-", "\u2022") are stripped so the receipt controls
 * its own numbering. No other content is altered.
 *
 * Repeated markers are consumed too: lists saved by older versions of the app
 * are commonly double-numbered ("1. 1. Freight to be paid\u2026"), which would
 * otherwise print as "1. 1. Freight to be paid\u2026" next to the numbering the
 * receipt renders itself. Only leading markers are touched \u2014 a number that
 * appears mid-sentence is ordinary prose and is left intact.
 */
const LEADING_MARKER = /^\s*(?:\d+[.)]\s*|[\u2013\u2014\u2022*-]\s*)+/;

export function parseTerms(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/\r?\n/)
    .map((t) => t.replace(LEADING_MARKER, "").trim())
    .filter(Boolean);
}

/**
 * The conditions to print for a memo: the company's stored/edited list when it
 * has one, otherwise the seven original conditions. Never empty, so the Terms
 * block is always present on the receipt.
 */
export function resolveTerms(raw: string | null | undefined): string[] {
  const stored = parseTerms(raw);
  return stored.length > 0 ? stored : [...DEFAULT_TERMS];
}

/** Groups conditions into receipt columns of {@link TERMS_PER_COLUMN}. */
export function chunkTerms(terms: string[]): string[][] {
  const cols: string[][] = [];
  for (let i = 0; i < terms.length; i += TERMS_PER_COLUMN) {
    cols.push(terms.slice(i, i + TERMS_PER_COLUMN));
  }
  return cols;
}
