/**
 * ============================================================================
 *  RESET POLICY — Sahil Road Lines ERP
 * ----------------------------------------------------------------------------
 *  "Reset All Data" is a destructive, Super-Admin-only operation that clears
 *  every OPERATIONAL record and restarts the ACTIVE YEAR's memo numbering at
 *  its physical baseline (2026 -> SRL-2026-003501).
 *
 *  It is executed atomically by the `reset_all_data()` database function, so
 *  the deletes and the counter reset either all commit or all roll back. See
 *  supabase/migrations/20261010000000_harden_counter_tables.sql.
 *
 *  Two guarantees this module documents and tests:
 *    1. Only the business tables below are cleared — never user accounts,
 *       authentication, settings, or the transport numbering counter.
 *    2. Only the ACTIVE calendar year's memo counter is reset; every other year
 *       keeps advancing, so a number can never be reused.
 *
 *  RESET vs RESTORE: reset is the ONLY operation that lowers the active year's
 *  memo counter (to its baseline). Backup restore is forward-only — see
 *  `reconcile_memo_counter()` — an empty restore keeps the existing counter and
 *  never rewinds it.
 *
 *  Kept free of any Supabase import so the policy can be unit-tested in plain
 *  Node (see tests/reset-policy.test.ts).
 * ============================================================================
 */

import { MEMO_NUMBER_BASELINES } from "./memoNumbering.ts";

/**
 * Business tables a "Reset All Data" operation clears, in deletion order.
 *
 * Order matches `reset_all_data()` exactly: rows that reference other rows
 * (status history, the transport mirror) are removed before their parent
 * tables, and `audit_log` is cleared LAST so audit/status rows written by the
 * deletes above are swept too. This is safe while `audit_log` has no foreign
 * key pointing into the wiped tables. UNVERIFIED: migration pre-flight (g) has
 * NOT been run, so this must be confirmed before relying on the order above.
 */
export const RESET_BUSINESS_TABLES = [
  "memo_status_history",
  "transport_list",
  "memos",
  "consignees",
  "fleet_trucks",
  "audit_log",
] as const;

/**
 * Persistent numbering tables. These are NOT cleared row-by-row: the counter
 * rows survive so numbering keeps advancing. `reset_all_data()` deliberately
 * rewrites ONLY the active year's `memo_counters` row (to its baseline) and
 * leaves every other counter untouched.
 */
export const NUMBERING_TABLES = ["memo_counters", "transport_list_counters"] as const;

/** True when `table` may be cleared by "Reset All Data". */
export function isResetClearedTable(table: string): boolean {
  return (RESET_BUSINESS_TABLES as readonly string[]).includes(table);
}

/** True for the persistent counter tables. */
export function isNumberingTable(table: string): boolean {
  return (NUMBERING_TABLES as readonly string[]).includes(table);
}

/**
 * True when "Reset All Data" restarts numbering for `year` — only the active
 * calendar year is reset, all other years are left as they are.
 */
export function resetsMemoCounterForYear(year: number, activeYear: number): boolean {
  return year === activeYear;
}

/**
 * The memo counter value after a reset for `year`, or `null` when the reset
 * leaves that year's counter untouched. The reset value is the year's physical
 * baseline (0 for a year that has none).
 */
export function memoCounterAfterReset(year: number, activeYear: number): number | null {
  if (!resetsMemoCounterForYear(year, activeYear)) return null;
  return MEMO_NUMBER_BASELINES[year] ?? 0;
}
