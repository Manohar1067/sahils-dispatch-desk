/**
 * Unit tests for the completion business rules + pending-payment predicate.
 * Run with: node --experimental-strip-types tests/completion-rules.test.ts
 *
 * Business rules (single source of truth in src/lib/completionRules.ts):
 *  R1: status === "Completed"   => balance forced to 0.
 *  R2: finalPaymentDate set     => status becomes "Completed" (and so balance 0).
 *  R3: clearing finalPaymentDate NEVER reverses a Completed status.
 *  R4: finalPayable is never modified by the completion rules.
 *  Pending = balance > 0 AND status !== "Completed" (not the workflow label).
 */
import assert from "node:assert/strict";
import {
  applyCompletionRules,
  buildEnforcedPatch,
  hasOutstandingBalance,
} from "../src/lib/completionRules.ts";

const row = (over: Record<string, unknown>) => ({
  status: "Dispatched",
  balance: 10000,
  finalPaymentDate: undefined as string | undefined,
  finalPayable: 7500,
  ...over,
});

// --- T1: R1 — Completed forces balance 0 -----------------------------------
const t1 = applyCompletionRules(row({ status: "Completed", balance: 16250 }));
assert.equal(t1.balance, 0, "T1: Completed => balance 0");
assert.equal(t1.status, "Completed", "T1: status unchanged");

// --- T2: R1 — Completed with balance already 0 stays 0 ----------------------
const t2 = applyCompletionRules(row({ status: "Completed", balance: 0 }));
assert.equal(t2.balance, 0, "T2: already 0 stays 0");
assert.equal(t2.status, "Completed", "T2: status unchanged");

// --- T3: R4 — finalPayable preserved when balance is zeroed -----------------
const t3 = applyCompletionRules(row({ status: "Completed", balance: 50000, finalPayable: 32000 }));
assert.equal(t3.balance, 0, "T3: balance zeroed");
assert.equal(t3.finalPayable, 32000, "T3: finalPayable untouched");

// --- T4: R2 — final payment date promotes status ----------------------------
const t4 = applyCompletionRules(
  row({ status: "Dispatched", balance: 12500, finalPaymentDate: "2026-09-10" }),
);
assert.equal(t4.status, "Completed", "T4: fpd set => Completed");
assert.equal(t4.balance, 0, "T4: fpd set => balance 0");

// --- T5: real production case SRL-2026-000016 (LR Submitted + fpd) ----------
const t5 = applyCompletionRules(
  row({ status: "LR Submitted", balance: 12500, finalPaymentDate: "2026-09-10" }),
);
assert.equal(t5.status, "Completed", "T5: LR Submitted + fpd => Completed");
assert.equal(t5.balance, 0, "T5: balance 0");

// --- T6: fpd set + already Completed => no-op -------------------------------
const t6 = applyCompletionRules(
  row({ status: "Completed", balance: 0, finalPaymentDate: "2026-09-21" }),
);
assert.equal(t6.status, "Completed", "T6: status unchanged");
assert.equal(t6.balance, 0, "T6: balance unchanged");

// --- T7: R3 — clearing fpd never reverses Completed -------------------------
const t7 = applyCompletionRules(
  row({ status: "Completed", balance: 0, finalPaymentDate: undefined }),
);
assert.equal(t7.status, "Completed", "T7: Completed stays Completed without fpd");
assert.equal(t7.balance, 0, "T7: balance stays 0");

// --- T8: empty-string fpd counts as "not set" -------------------------------
const t8 = applyCompletionRules(row({ status: "Dispatched", balance: 5000, finalPaymentDate: "" }));
assert.equal(t8.status, "Dispatched", "T8: empty fpd does not promote");
assert.equal(t8.balance, 5000, "T8: balance unchanged");

// --- T9: non-settled memo keeps its outstanding balance ---------------------
const t9 = applyCompletionRules(row({ status: "Payment Pending", balance: 8750 }));
assert.equal(t9.balance, 8750, "T9: unpaid balance preserved");
assert.equal(t9.status, "Payment Pending", "T9: status preserved");

// --- T10: input object is never mutated -------------------------------------
const src = row({ status: "Completed", balance: 9999 });
applyCompletionRules(src);
assert.equal(src.balance, 9999, "T10: original untouched (pure function)");

// --- T11: merge semantics — bulk patch cannot violate R1 --------------------
// Simulates updateMemo's merged write: current Completed row + patch {balance:5000}
const current = row({ status: "Completed", balance: 0, finalPaymentDate: "2026-09-21" });
const merged = applyCompletionRules({ ...current, balance: 5000 });
assert.equal(merged.balance, 0, "T11: patch balance on Completed row still 0");
const merged2 = applyCompletionRules({ ...current, status: "Dispatched" });
assert.equal(merged2.status, "Completed", "T11: fpd still set => status back to Completed");

// --- T12: pending predicate — positive balance, unsettled -------------------
assert.equal(
  hasOutstandingBalance(row({ status: "Dispatched", balance: 100000 })),
  true,
  "T12: Dispatched + balance => pending",
);
assert.equal(
  hasOutstandingBalance(row({ status: "Payment Pending", balance: 12500 })),
  true,
  "T12: Payment Pending + balance => pending",
);

// --- T13: pending predicate — Completed never pending (even stale data) -----
assert.equal(
  hasOutstandingBalance(row({ status: "Completed", balance: 16250 })),
  false,
  "T13: Completed excluded",
);
assert.equal(
  hasOutstandingBalance(row({ status: "Completed", balance: 0 })),
  false,
  "T13: settled excluded",
);

// --- T14: pending predicate — zero / missing / negative balance -------------
assert.equal(
  hasOutstandingBalance(row({ status: "Payment Pending", balance: 0 })),
  false,
  "T14: zero balance not pending",
);
assert.equal(
  hasOutstandingBalance(row({ balance: undefined })),
  false,
  "T14: missing balance not pending",
);
assert.equal(
  hasOutstandingBalance(row({ balance: -500 })),
  false,
  "T14: negative balance not pending",
);

// --- T15: dashboard consistency — KPI filter, amount and scope all agree ----
const memos = [
  row({ status: "Dispatched", balance: 100000 }),
  row({ status: "Completed", balance: 16250 }),
  row({ status: "LR Submitted", balance: 12500, finalPaymentDate: "2026-09-10" }),
  row({ status: "Payment Pending", balance: 0 }),
  row({ status: "Delivered", balance: 8750 }),
].map(applyCompletionRules);
const pending = memos.filter(hasOutstandingBalance);
assert.equal(pending.length, 2, "T15: 2 pending (settled rows excluded)");
assert.equal(
  pending.reduce((s, x) => s + x.balance, 0),
  108750,
  "T15: outstanding total",
);
assert.equal(
  memos.filter((x) => x.status === "Completed").length,
  2,
  "T15: fpd row became Completed",
);

// ============================================================================
// buildEnforcedPatch — the save-time enforcement used by updateMemo().
// Simulates the EXACT patch the Supabase update would receive.
// ============================================================================

// --- T16: CASE 2 — re-save the inconsistent production row unchanged --------
// Stored: Completed + balance 16750 + fpd 2026-10-05 (the reported record).
// Form submits its full values (balance already zeroed by the edit form).
const curInconsistent = row({
  status: "Completed",
  balance: 16750,
  finalPaymentDate: "2026-10-05",
});
const t16 = buildEnforcedPatch(curInconsistent, {
  status: "Completed",
  balance: 0,
  finalPaymentDate: "2026-10-05",
});
assert.equal(t16.balance, 0, "T16: save writes balance 0");
assert.equal(t16.status, "Completed", "T16: save writes status Completed");
assert.equal(t16.finalPaymentDate, "2026-10-05", "T16: final pay date kept");

// --- T17: a stale nonzero balance in the patch never survives on a settled row ---
const curSettled = row({ status: "Completed", balance: 0, finalPaymentDate: "2026-09-21" });
const t17 = buildEnforcedPatch(curSettled, { balance: 5000 });
assert.equal(t17.balance, 0, "T17: stale patch balance corrected to 0");
assert.equal(t17.status, undefined, "T17: status column not written (stays Completed)");

// --- T18: a memo WITH a final payment date cannot be demoted by a patch -----
const curFpd = row({ status: "Completed", balance: 12500, finalPaymentDate: "2026-09-10" });
const t18 = buildEnforcedPatch(curFpd, { status: "Dispatched" });
assert.equal(t18.status, "Completed", "T18: fpd row stays Completed");
assert.equal(t18.balance, 0, "T18: balance written as 0");

// --- T19: CASE 4 — patch sets status Completed only (no balance key) --------
const curOpen = row({ status: "Dispatched", balance: 16750, finalPaymentDate: "" });
const t19 = buildEnforcedPatch(curOpen, { status: "Completed" });
assert.equal(t19.status, "Completed", "T19: status Completed written");
assert.equal(t19.balance, 0, "T19: balance forced to 0 by the patch");

// --- T20: CASE 1/3 — fpd entered while patch still carries stale values -----
const curActive = row({ status: "Dispatched", balance: 60000, finalPaymentDate: "" });
const t20 = buildEnforcedPatch(curActive, {
  status: "Dispatched",
  balance: 60000,
  finalPaymentDate: "2026-10-05",
});
assert.equal(t20.status, "Completed", "T20: fpd entered => status Completed");
assert.equal(t20.balance, 0, "T20: fpd entered => balance 0");

// --- T21: unreadable current row — rules still applied to the patch ---------
const t21 = buildEnforcedPatch(null, {
  status: "Completed",
  balance: 16750,
  finalPaymentDate: "2026-10-05",
});
assert.equal(t21.status, "Completed", "T21: status Completed");
assert.equal(t21.balance, 0, "T21: balance zeroed without a current row");
const t21b = buildEnforcedPatch(undefined, { status: "Dispatched", balance: 30000 });
assert.equal(t21b.balance, 30000, "T21: open memo balance preserved (fallback)");
assert.equal(t21b.status, "Dispatched", "T21: status preserved (fallback)");

// --- T22: normal active memo is NEVER auto-zeroed ---------------------------
// Total hire 100000, advance 40000, balance 60000, Dispatched, no fpd.
const t22 = buildEnforcedPatch(
  row({ status: "Dispatched", balance: 60000, finalPaymentDate: "" }),
  {
    status: "Dispatched",
    balance: 60000,
    finalPaymentDate: "",
    netFreight: 100000,
    advance: 40000,
  },
);
assert.equal(t22.balance, 60000, "T22: balance stays 60000");
assert.equal(t22.status, "Dispatched", "T22: status stays Dispatched");
assert.equal(t22.finalPaymentDate, "", "T22: no fpd invented");

console.log("completion-rules tests: ALL PASSED");
