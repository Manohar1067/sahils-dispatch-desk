export interface CompletionFields {
  status?: string;
  balance?: number;
  finalPaymentDate?: string | null;
}

/**
 * Business rules for memo/transport completion (single source of truth):
 *  R1: status === "Completed"          => balance is forced to 0.
 *  R2: finalPaymentDate set            => status becomes "Completed" (and so balance 0).
 * Clearing finalPaymentDate never reverses a Completed status.
 * `finalPayable` is intentionally never touched here.
 */
export function applyCompletionRules<T extends CompletionFields>(row: T): T {
  const out: CompletionFields = { ...row };
  if (out.finalPaymentDate && out.status !== "Completed") out.status = "Completed";
  if (out.status === "Completed" && Number(out.balance ?? 0) !== 0) out.balance = 0;
  return out as T;
}

/**
 * A memo still owes money: positive balance and not settled.
 * This — not the workflow status — is what "Pending Payments" means
 * across Dashboard, AppShell notifications, Reports and Register.
 */
export function hasOutstandingBalance(row: CompletionFields): boolean {
  return Number(row.balance ?? 0) > 0 && row.status !== "Completed";
}

/**
 * Effective update patch for a memo save. Takes the row currently stored
 * (`current`) and what the caller wants to write (`patch`), applies the
 * completion rules to the merged row, and adds back ONLY the corrective keys
 * needed so the values that actually reach Supabase satisfy R1/R2.
 *
 * Correction compares the merged result against the exact values the update
 * would otherwise write — the patch's value when it defines the key, else the
 * stored value — NOT against `current`. A naive `merged !== current` check lets
 * a violating patch value slip through whenever the patch and the merged result
 * happen to agree on the stored row (e.g. a stale nonzero balance written onto
 * an already-settled row, or a bulk status change that would demote a memo that
 * has a final payment date). This helper closes that gap, so the rule holds for
 * full-form saves, partial patches, and the no-current fallback alike.
 */
export function buildEnforcedPatch<T extends CompletionFields>(
  current: T | null | undefined,
  patch: Partial<T>,
): Partial<T> {
  if (!current) return applyCompletionRules(patch as T) as Partial<T>;
  const defined: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v !== undefined) defined[k] = v;
  }
  const merged = applyCompletionRules({ ...current, ...defined } as T);
  const writtenStatus = defined.status !== undefined ? defined.status : current.status;
  const writtenBalance = defined.balance !== undefined ? defined.balance : current.balance;
  const out: Partial<T> = { ...patch };
  if (merged.status !== writtenStatus) out.status = merged.status;
  if (merged.balance !== writtenBalance) out.balance = merged.balance;
  return out;
}
