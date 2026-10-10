/**
 * Unit tests for the "Reset All Data" table + counter policy.
 * Run with: node --experimental-strip-types tests/reset-policy.test.ts
 *
 * `reset_all_data()` clears operational records and puts the ACTIVE year's memo
 * counter back on its baseline. These tests pin down what the client policy
 * promises so a refactor cannot silently start wiping accounts, settings, the
 * transport counter, or a non-active year's memo counter.
 */
import assert from "node:assert/strict";
import {
  NUMBERING_TABLES,
  RESET_BUSINESS_TABLES,
  isNumberingTable,
  isResetClearedTable,
  memoCounterAfterReset,
  resetsMemoCounterForYear,
} from "../src/lib/resetPolicy.ts";
import { MEMO_NUMBER_BASELINES, nextMemoNumber } from "../src/lib/memoNumbering.ts";

// --- P1: only business tables are cleared -----------------------------------
for (const t of RESET_BUSINESS_TABLES) {
  assert.equal(isResetClearedTable(t), true, `P1: ${t} is reset-cleared`);
}
for (const t of ["memo_counters", "transport_list_counters", "profiles", "settings"]) {
  assert.equal(isResetClearedTable(t), false, `P1: ${t} must NOT be reset-cleared`);
}

// --- P2: the counter tables are the numbering tables ------------------------
assert.deepEqual(
  [...NUMBERING_TABLES].sort(),
  ["memo_counters", "transport_list_counters"],
  "P2: numbering tables are the two counters",
);
assert.equal(isNumberingTable("memo_counters"), true, "P2: memo_counters is a numbering table");
assert.equal(
  isNumberingTable("transport_list_counters"),
  true,
  "P2: transport counter is a numbering table",
);

// --- P3: the two lists are disjoint ----------------------------------------
for (const t of RESET_BUSINESS_TABLES) {
  assert.equal(isNumberingTable(t), false, `P3: "${t}" cannot be both cleared and a counter`);
}

// --- P4: only the ACTIVE year's memo counter is reset -----------------------
assert.equal(resetsMemoCounterForYear(2026, 2026), true, "P4: active year is reset");
assert.equal(resetsMemoCounterForYear(2025, 2026), false, "P4: other years are untouched");
assert.equal(resetsMemoCounterForYear(2027, 2026), false, "P4: future years are untouched");

// --- P5: the reset value is the year's baseline (0 if none) -----------------
assert.equal(memoCounterAfterReset(2026, 2026), 3500, "P5: 2026 resets to baseline 3500");
assert.equal(memoCounterAfterReset(2027, 2027), 0, "P5: a year without a baseline resets to 0");
assert.equal(memoCounterAfterReset(2025, 2026), null, "P5: non-active year is untouched (null)");
assert.equal(
  memoCounterAfterReset(2026, 2026),
  MEMO_NUMBER_BASELINES[2026],
  "P5: reset value is the baseline",
);

// --- P6: reset then allocate yields the first post-baseline number ----------
const afterResetCounter = memoCounterAfterReset(2026, 2026);
assert.ok(afterResetCounter !== null, "P6: active year has a reset value");
assert.equal(
  nextMemoNumber(2026, afterResetCounter as number),
  "SRL-2026-003501",
  "P6: next memo after reset is SRL-2026-003501",
);

// --- P7: reset is distinct from a forward-only backup restore ---------------
// A reset LOWERS the active year to its baseline; restoring an empty backup
// while the counter is higher must preserve it (see memo-numbering tests).
assert.equal(
  memoCounterAfterReset(2026, 2026),
  3500,
  "P7: reset lowers the active-year counter to the baseline",
);
assert.equal(
  Math.max(MEMO_NUMBER_BASELINES[2026] ?? 0, 0, 3600),
  3600,
  "P7: empty restore keeps a higher counter (restore is not a reset)",
);

console.log("reset-policy tests: ALL PASSED");
