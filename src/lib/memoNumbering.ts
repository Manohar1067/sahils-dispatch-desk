/**
 * ============================================================================
 *  MEMO NUMBERING — Sahil Road Lines ERP
 * ----------------------------------------------------------------------------
 *  Memo numbers are `SRL-<year>-<6-digit sequence>` and MUST never be reused.
 *
 *  Some years have a physical baseline: memos already issued on paper before
 *  the app went live. The first app-generated number for such a year continues
 *  after the baseline (e.g. 2026 baseline 3500 -> first number SRL-2026-003501).
 *
 *  Kept free of any Supabase import so the rules can be unit-tested in plain
 *  Node (see tests/memo-numbering.test.ts).
 * ============================================================================
 */

/**
 * Per-year numbering baselines: the last physical memo number already issued
 * for that year. Used as a floor — counters are never allowed below it, so a
 * reset or an older backup restore can never cause a number to be reissued.
 * Extend for future years as needed.
 */
export const MEMO_NUMBER_BASELINES: Record<number, number> = { 2026: 3500 };

/**
 * Raises `counter` to the year's physical baseline when it is below it.
 * Never lowers a counter, so the sequence can only move forward.
 */
export function withMemoBaseline(year: number, counter: number): number {
  const baseline = MEMO_NUMBER_BASELINES[year];
  return baseline !== undefined && counter < baseline ? baseline : counter;
}

/**
 * Formats the NEXT memo number from the last-issued `counter` value. The
 * baseline is applied first so the preview matches what `next_memo_number()`
 * will actually allocate.
 */
export function nextMemoNumber(year: number, counter: number): string {
  const next = withMemoBaseline(year, counter) + 1;
  return `SRL-${year}-${String(next).padStart(6, "0")}`;
}
