/**
 * Unit tests for memo-/transport-numbering rules.
 * Run with: node --experimental-strip-types tests/memo-numbering.test.ts
 *
 * Models the DATABASE contract:
 *   - Ordinary inserts cannot supply an explicit memo_number / entry_number.
 *     `assign_memo_number` rejects a nonempty memo_number unless a trusted
 *     restore has armed `app.allow_explicit_memo_number`. Transport additionally
 *     accepts an entry_number ONLY when it mirrors an existing memo number.
 *   - `restore_*` is ATOMIC and validate-first: the whole payload is validated,
 *     then (under the shared counter lock) the range is reserved forward-only
 *     and every row is inserted with ONLY its present columns so DEFAULTs apply.
 *     Any failure rolls the whole restore back.
 *   - `reset` restores only the active year's memo counter to its baseline.
 *   - Transport numbering is INDEPENDENT of memo numbering and never rewound.
 */
import assert from "node:assert/strict";
import {
  MEMO_NUMBER_BASELINES,
  nextMemoNumber,
  withMemoBaseline,
} from "../src/lib/memoNumbering.ts";

const baseline = (year: number): number => MEMO_NUMBER_BASELINES[year] ?? 0;
const memoNo = (year: number, seq: number): string => `SRL-${year}-${String(seq).padStart(6, "0")}`;
const trpNo = (year: number, seq: number): string => `TRP-${year}-${String(seq).padStart(6, "0")}`;

// --- F1: baseline is a floor; counters only ever move forward ---------------
assert.equal(withMemoBaseline(2026, 0), 3500, "F1: 2026 counter 0 -> baseline 3500");
assert.equal(withMemoBaseline(2026, 3500), 3500, "F1: 2026 counter stays at baseline");
assert.equal(withMemoBaseline(2026, 9999), 9999, "F1: 2026 counter above baseline is kept");
assert.equal(withMemoBaseline(2027, 0), 0, "F1: year without a baseline is unchanged");

// --- F2: formatting is SRL-<year>-<6 digits> --------------------------------
assert.equal(nextMemoNumber(2026, 0), "SRL-2026-003501", "F2: zero counter uses baseline");
assert.equal(nextMemoNumber(2026, 3501), "SRL-2026-003502", "F2: increments past baseline");
assert.equal(nextMemoNumber(2027, 0), "SRL-2027-000001", "F2: new year starts at 000001");
assert.equal(nextMemoNumber(2027, 41), "SRL-2027-000042", "F2: pads to six digits");

// --- F3 (req.1): memo assign trigger only accepts explicit in restore mode --
type MemoRow = { memo_number?: string | null };
function assignMemoNumber(row: MemoRow, alloc: () => string, restoreMode: boolean): MemoRow {
  if (row.memo_number == null || row.memo_number === "") {
    return { ...row, memo_number: alloc() };
  }
  if (!restoreMode) {
    throw new Error("42501: memo_number may not be supplied directly");
  }
  return row;
}
function protectMemoNumberUpdate(oldNo: string, newNo: string, restoreMode: boolean): void {
  if (oldNo !== newNo && !restoreMode) {
    throw new Error("42501: memo_number cannot be changed after creation");
  }
}
assert.equal(
  assignMemoNumber({ memo_number: null }, () => memoNo(2026, 3501), false).memo_number,
  "SRL-2026-003501",
  "F3: ordinary insert with no number is assigned",
);
assert.equal(
  assignMemoNumber({ memo_number: "" }, () => memoNo(2026, 3501), false).memo_number,
  "SRL-2026-003501",
  "F3: ordinary insert with empty number is assigned",
);
assert.throws(
  () => assignMemoNumber({ memo_number: "SRL-2026-999999" }, () => "x", false),
  /42501/,
  "F3: ordinary insert with an explicit number is REJECTED",
);
assert.equal(
  assignMemoNumber({ memo_number: memoNo(2026, 3510) }, () => "x", true).memo_number,
  "SRL-2026-003510",
  "F3: trusted restore may supply an explicit number",
);
assert.throws(
  () => protectMemoNumberUpdate(memoNo(2026, 3501), memoNo(2026, 999999), false),
  /42501/,
  "F3: ordinary UPDATE cannot change memo_number",
);
assert.doesNotThrow(
  () => protectMemoNumberUpdate(memoNo(2026, 3501), memoNo(2026, 3501), false),
  "F3: UPDATE that leaves memo_number unchanged is allowed",
);

// --- F3b (req.1): transport assign trigger ----------------------------------
// The BEFORE INSERT/UPDATE triggers accept an explicit entry_number only when
// the trusted restore flag is armed OR the write is nested inside another
// trigger (pg_trigger_depth() > 1, i.e. a memo->transport mirror trigger). A
// browser can do neither, so an ordinary client write of an arbitrary number
// fails. `triggerDepth` 1 = ordinary statement, >1 = nested trigger.
type TrRow = { entry_number?: string | null };
function assignTransportEntryNumber(
  row: TrRow,
  alloc: () => string,
  restoreMode: boolean,
  triggerDepth: number,
): TrRow {
  if (row.entry_number == null || row.entry_number === "") {
    return { ...row, entry_number: alloc() };
  }
  if (restoreMode || triggerDepth > 1) {
    return row;
  }
  throw new Error("42501: entry_number may not be supplied directly");
}
function protectTransportEntryNumberUpdate(
  oldNo: string,
  newNo: string,
  restoreMode: boolean,
  triggerDepth: number,
): void {
  if (oldNo !== newNo && !restoreMode && triggerDepth <= 1) {
    throw new Error("42501: entry_number cannot be changed to an arbitrary value");
  }
}
assert.equal(
  assignTransportEntryNumber({ entry_number: null }, () => trpNo(2026, 1), false, 1).entry_number,
  "TRP-2026-000001",
  "F3b: ordinary insert with no entry_number is assigned",
);
assert.throws(
  () => assignTransportEntryNumber({ entry_number: "TRP-2026-000001" }, () => "x", false, 1),
  /42501/,
  "F3b: ordinary insert with an arbitrary entry_number is REJECTED",
);
assert.equal(
  assignTransportEntryNumber({ entry_number: "SRL-2026-003501" }, () => "x", false, 2).entry_number,
  "SRL-2026-003501",
  "F3b: a nested (mirror-trigger) insert may carry an explicit entry_number",
);
assert.equal(
  assignTransportEntryNumber({ entry_number: "TRP-2026-000009" }, () => "x", true, 1).entry_number,
  "TRP-2026-000009",
  "F3b: trusted restore may supply an explicit entry_number",
);
assert.throws(
  () => protectTransportEntryNumberUpdate("TRP-2026-000001", "TRP-2026-999999", false, 1),
  /42501/,
  "F3b: ordinary UPDATE cannot change entry_number arbitrarily",
);
assert.doesNotThrow(
  () => protectTransportEntryNumberUpdate("TRP-2026-000001", "TRP-2026-000001", false, 1),
  "F3b: UPDATE that leaves entry_number unchanged is allowed",
);

// --- F3b-2 (req.1): trusted mirror RPC authorization ------------------------
// mirror_memo_to_transport() refuses any entry_number that is not an existing
// memo number, so even the trusted path can never mint an arbitrary value, and
// it is idempotent so a duplicate mirror is skipped rather than failing.
function mirrorMemoToTransport(
  entryNumber: string,
  memoNumbers: Set<string>,
  transportNumbers: Set<string>,
): { ok: boolean; skipped?: boolean } {
  if (!entryNumber) throw new Error("22023: entry_number is required");
  if (!memoNumbers.has(entryNumber)) {
    throw new Error("42501: entry_number must mirror an existing memo number");
  }
  if (transportNumbers.has(entryNumber)) return { ok: true, skipped: true };
  transportNumbers.add(entryNumber);
  return { ok: true };
}
const memoSet = new Set(["SRL-2026-003501"]);
assert.deepEqual(
  mirrorMemoToTransport("SRL-2026-003501", memoSet, new Set()),
  { ok: true },
  "F3b-2: mirroring an existing memo number succeeds",
);
assert.throws(
  () => mirrorMemoToTransport("TRP-2026-000009", memoSet, new Set()),
  /42501/,
  "F3b-2: mirroring a number that is not an existing memo is rejected",
);
assert.deepEqual(
  mirrorMemoToTransport("SRL-2026-003501", memoSet, new Set(["SRL-2026-003501"])),
  { ok: true, skipped: true },
  "F3b-2: mirroring is idempotent (skips an existing row)",
);

// --- F3c (req.3): only PRESENT columns are written, so DEFAULTs apply --------
function insertByPresentColumns(
  row: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...defaults };
  for (const k of Object.keys(row)) {
    if (k in defaults) out[k] = row[k];
  }
  return out;
}
function insertAllColumnsFromPopulateRecord(
  row: Record<string, unknown>,
  allColumns: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of allColumns) out[c] = c in row ? row[c] : null;
  return out;
}
const memoDefaults = { id: "GEN", memo_number: "", created_at: "now()" };
const present = insertByPresentColumns({ memo_number: "SRL-2026-003501" }, memoDefaults);
assert.equal(present.id, "GEN", "F3c: omitted id gets its DEFAULT (present-columns insert)");
assert.equal(present.created_at, "now()", "F3c: omitted created_at gets its DEFAULT");
const star = insertAllColumnsFromPopulateRecord({ memo_number: "SRL-2026-003501" }, [
  "id",
  "memo_number",
  "created_at",
]);
assert.equal(
  star.id,
  null,
  "F3c: the old SELECT * FROM jsonb_populate_record wrote NULL (the bug)",
);

// --- F3d: a present key carrying JSON null is rejected (NOT NULL) -----------
// `pg_attribute.attnotnull` + `v_elem ? attname` + `v_elem->attname = 'null'`
// catches a key that exists but is null, which a missing-key check would miss.
function nullNotNullColumn(row: Record<string, unknown>, notNullCols: string[]): string | null {
  for (const c of notNullCols) if (c in row && row[c] === null) return c;
  return null;
}
assert.equal(
  nullNotNullColumn({ memo_number: "SRL-2026-003501", dispatch_date: null }, [
    "memo_number",
    "dispatch_date",
  ]),
  "dispatch_date",
  "F3d: explicit JSON null on a NOT NULL column is detected",
);
assert.equal(
  nullNotNullColumn({ memo_number: "SRL-2026-003501" }, ["memo_number", "dispatch_date"]),
  null,
  "F3d: an omitted NOT NULL-with-default column is not a null violation",
);

// --- F4: forward-only restore reconciliation (req.7) ------------------------
function reconcile(year: number, highestRestored: number, current: number): number {
  return Math.max(baseline(year), highestRestored, current);
}
assert.equal(
  nextMemoNumber(2026, reconcile(2026, 3510, 3500)),
  "SRL-2026-003511",
  "F4: next is 003511",
);
assert.equal(reconcile(2026, 0, 3600), 3600, "F4: empty restore keeps the higher counter");
assert.equal(reconcile(2026, 0, 0), 3500, "F4: empty db reconciles to the baseline floor");

// --- Full DB model (atomic restore; single lock; independent transport lock) -
type Restore = { ok: boolean; inserted: number };

function makeDb(activeYear = 2026) {
  let memoCounters = new Map<number, number>([[activeYear, baseline(activeYear)]]);
  let transportCounters = new Map<number, number>([[activeYear, 0]]);
  let memos = new Map<string, { id: string; memo_number: string; created_at: string }>();
  let transports = new Map<string, { id: string; entry_number: string }>();
  let seq = 0;
  let chain: Promise<unknown> = Promise.resolve();
  const atomic = <T>(fn: () => T): Promise<T> => {
    const run = chain.then(fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const mCounter = (y: number): number => memoCounters.get(y) ?? baseline(y);
  const tCounter = (y: number): number => transportCounters.get(y) ?? 0;
  const snap = () => ({
    memoCounters: new Map(memoCounters),
    transportCounters: new Map(transportCounters),
    memos: new Map(memos),
    transports: new Map(transports),
  });
  type Snap = ReturnType<typeof snap>;
  const rollback = (s: Snap): void => {
    memoCounters = s.memoCounters;
    transportCounters = s.transportCounters;
    memos = s.memos;
    transports = s.transports;
  };

  return {
    createMemo(year = activeYear): Promise<string> {
      return atomic(() => {
        const next = mCounter(year) + 1;
        memoCounters.set(year, next);
        const num = memoNo(year, next);
        memos.set(num, { id: `id-${++seq}`, memo_number: num, created_at: "now()" });
        return num;
      });
    },
    restoreMemos(rows: MemoRow[]): Promise<Restore> {
      return atomic(() => {
        const s = snap();
        try {
          const seen = new Set<string>();
          for (const r of rows) {
            const n = r.memo_number;
            if (!n) throw new Error("validation failed: missing memo_number");
            if (seen.has(n)) throw new Error(`validation failed: duplicate ${n}`);
            seen.add(n);
          }
          const perYear = new Map<number, number>();
          for (const n of seen) {
            const m = /^SRL-(\d{4})-(\d+)$/.exec(n);
            if (m)
              perYear.set(Number(m[1]), Math.max(perYear.get(Number(m[1])) ?? 0, Number(m[2])));
          }
          for (const [y, mx] of perYear)
            memoCounters.set(y, Math.max(mCounter(y), baseline(y), mx));
          for (const n of seen) {
            if (memos.has(n)) throw new Error(`duplicate existing memo_number ${n}`);
            memos.set(n, { id: `id-${++seq}`, memo_number: n, created_at: "now()" });
          }
          return { ok: true, inserted: seen.size };
        } catch (e) {
          rollback(s);
          throw e;
        }
      });
    },
    reset(): Promise<void> {
      return atomic(() => {
        memos.clear();
        memoCounters.set(activeYear, baseline(activeYear));
      });
    },
    createTransport(year = activeYear): Promise<string> {
      return atomic(() => {
        const next = tCounter(year) + 1;
        transportCounters.set(year, next);
        const num = trpNo(year, next);
        transports.set(num, { id: `tid-${++seq}`, entry_number: num });
        return num;
      });
    },
    restoreTransport(rows: TrRow[]): Promise<Restore> {
      return atomic(() => {
        const s = snap();
        try {
          const seen = new Set<string>();
          for (const r of rows) {
            const n = r.entry_number;
            if (!n) throw new Error("validation failed: missing entry_number");
            if (seen.has(n)) throw new Error(`validation failed: duplicate ${n}`);
            seen.add(n);
          }
          const perYear = new Map<number, number>();
          for (const n of seen) {
            const m = /^TRP-(\d{4})-(\d+)$/.exec(n);
            if (m)
              perYear.set(Number(m[1]), Math.max(perYear.get(Number(m[1])) ?? 0, Number(m[2])));
          }
          for (const [y, mx] of perYear) transportCounters.set(y, Math.max(tCounter(y), mx));
          for (const n of seen) {
            if (transports.has(n)) throw new Error(`duplicate existing entry_number ${n}`);
            transports.set(n, { id: `tid-${++seq}`, entry_number: n });
          }
          return { ok: true, inserted: seen.size };
        } catch (e) {
          rollback(s);
          throw e;
        }
      });
    },
    // Explicit overwrite RPC: unlike restoreTransport it deliberately updates
    // an EXISTING row (never entry_number/id) instead of rejecting it.
    replaceTransport(rows: TrRow[]): Promise<Restore> {
      return atomic(() => {
        const s = snap();
        try {
          const seen = new Set<string>();
          for (const r of rows) {
            const n = r.entry_number;
            if (!n) throw new Error("validation failed: missing entry_number");
            if (seen.has(n)) throw new Error(`validation failed: duplicate ${n}`);
            seen.add(n);
          }
          const perYear = new Map<number, number>();
          for (const n of seen) {
            const m = /^TRP-(\d{4})-(\d+)$/.exec(n);
            if (m)
              perYear.set(Number(m[1]), Math.max(perYear.get(Number(m[1])) ?? 0, Number(m[2])));
          }
          for (const [y, mx] of perYear) transportCounters.set(y, Math.max(tCounter(y), mx));
          for (const n of seen) {
            const existing = transports.get(n);
            transports.set(n, { id: existing?.id ?? `tid-${++seq}`, entry_number: n });
          }
          return { ok: true, inserted: seen.size };
        } catch (e) {
          rollback(s);
          throw e;
        }
      });
    },
    hasMemo(n: string): boolean {
      return memos.has(n);
    },
    state() {
      return {
        memoCounter: (y = activeYear) => mCounter(y),
        transportCounter: (y = activeYear) => tCounter(y),
        memos: [...memos.keys()],
        transports: [...transports.keys()],
      };
    },
  };
}

function highestSeq(memos: string[], year: number): number {
  return memos.reduce((max, n) => {
    const m = new RegExp(`^SRL-${year}-(\\d+)$`).exec(n);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
}

// --- Case 1 (req.6): reset -> the first 2026 memo is SRL-2026-003501 --------
{
  const db = makeDb(2026);
  await db.createMemo();
  await db.createMemo();
  await db.reset();
  assert.equal(await db.createMemo(), "SRL-2026-003501", "Case 1: reset restarts at baseline");
}

// --- Case 2 (req.7): restored latest SRL-2026-003510 -> next 003511 ---------
{
  const db = makeDb(2026);
  const res = await db.restoreMemos([{ memo_number: memoNo(2026, 3510) }]);
  assert.equal(res.ok, true, "Case 2: restore ok");
  assert.equal(db.state().memoCounter(), 3510, "Case 2: counter reserved to 3510");
  assert.equal(await db.createMemo(), "SRL-2026-003511", "Case 2: next memo is 003511");
}

// --- Case 3: forward-only restore never lowers a protected counter ----------
assert.equal(reconcile(2026, 0, 3600), 3600, "Case 3a: empty restore keeps 3600");
assert.equal(reconcile(2026, 0, 0), 3500, "Case 3b: empty db reconciles to the floor");

// --- Case 4: normal allocation advances by exactly one ----------------------
{
  const db = makeDb(2026);
  assert.equal(await db.createMemo(), "SRL-2026-003501", "Case 4: first is +1 over baseline");
  assert.equal(await db.createMemo(), "SRL-2026-003502", "Case 4: second is +1");
}

// --- Case 5 (req.2/7): restore is atomic; no duplicate anywhere -------------
{
  const db = makeDb(2026);
  const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => ({
    memo_number: memoNo(2026, 3500 + i),
  }));
  const res = await db.restoreMemos(rows);
  assert.equal(res.inserted, 10, "Case 5: restore inserted all rows");
  // concurrent creates are serialized by the same lock (model: chained)
  const ops = [db.createMemo(), db.createMemo(), db.createMemo()];
  await Promise.all(ops);
  const st = db.state();
  assert.equal(new Set(st.memos).size, st.memos.length, "Case 5: no duplicate numbers");
  assert.equal(
    st.memoCounter(),
    Math.max(3500, highestSeq(st.memos, 2026)),
    "Case 5: counter consistent",
  );
}

// --- Case 5b (req.2): a colliding restore aborts ATOMICALLY ------------------
{
  const db = makeDb(2026);
  const first = await db.createMemo(); // SRL-2026-003501
  assert.equal(first, "SRL-2026-003501", "Case 5b: pre-existing number");
  const before = db.state().memoCounter();
  await assert.rejects(
    () =>
      db.restoreMemos([
        { memo_number: memoNo(2026, 3501) }, // collides with the existing memo
        { memo_number: memoNo(2026, 3502) },
      ]),
    /duplicate/,
    "Case 5b: restore with a collision is rejected",
  );
  const after = db.state();
  assert.equal(after.memoCounter(), before, "Case 5b: counter rolled back (no reservation leaked)");
  assert.deepEqual(after.memos, [first], "Case 5b: no partial rows were inserted");
}

// --- Case 5c (req.2): validation aborts before touching any state -----------
{
  const db = makeDb(2026);
  const before = db.state().memoCounter();
  await assert.rejects(
    () => db.restoreMemos([{ memo_number: "SRL-2026-003501" }, { memo_number: "" }]),
    /validation failed/,
    "Case 5c: an invalid row rejects the whole payload",
  );
  assert.equal(
    db.state().memoCounter(),
    before,
    "Case 5c: counter unchanged after validation failure",
  );
  assert.deepEqual(db.state().memos, [], "Case 5c: no rows inserted after validation failure");
}

// --- Case 6 (req.2): reset vs concurrent creation ---------------------------
{
  const db = makeDb(2026);
  const ops: Promise<unknown>[] = [];
  for (let i = 0; i < 20; i++) {
    ops.push(db.createMemo());
    if (i % 5 === 4) ops.push(db.reset());
  }
  await Promise.all(ops);
  const st = db.state();
  assert.equal(new Set(st.memos).size, st.memos.length, "Case 6: no duplicate numbers");
  assert.equal(
    st.memoCounter(),
    Math.max(3500, highestSeq(st.memos, 2026)),
    "Case 6: counter consistent after interleaved resets",
  );
}

// --- Case 7: preview never consumes a number --------------------------------
assert.equal(nextMemoNumber(2026, 3500), "SRL-2026-003501", "Case 7: preview shows 003501");
assert.equal(nextMemoNumber(2026, 3500), "SRL-2026-003501", "Case 7: preview is stable");

// --- Case 7b (req.1): ordinary creation cannot bypass numbering -------------
assert.throws(
  () => assignMemoNumber({ memo_number: "SRL-2026-000001" }, () => "x", false),
  /42501/,
  "Case 7b: ordinary create with an explicit memo number is rejected",
);

// --- Case 8 (req.1/7): transport numbering is independent -------------------
{
  const db = makeDb(2026);
  assert.equal(
    await db.createTransport(),
    "TRP-2026-000001",
    "Case 8: first transport is TRP-...000001",
  );
  await db.createMemo();
  await db.reset();
  assert.equal(db.state().memoCounter(), 3500, "Case 8: memo reset rewound the memo counter");
  assert.equal(
    db.state().transportCounter(),
    1,
    "Case 8: transport counter NOT rewound by memo reset",
  );
  assert.equal(
    await db.createTransport(),
    "TRP-2026-000002",
    "Case 8: transport continues independently",
  );
}

// --- Case 8b: transport restore reserves only TRP numbers -------------------
{
  const db = makeDb(2026);
  const res = await db.restoreTransport([
    { entry_number: trpNo(2026, 101) },
    { entry_number: trpNo(2026, 103) },
    { entry_number: memoNo(2026, 3505) }, // mirrored memo entry
  ]);
  assert.equal(res.ok, true, "Case 8b: transport restore ok");
  assert.equal(db.state().transportCounter(), 103, "Case 8b: transport reserved to 103");
  assert.equal(
    await db.createTransport(),
    "TRP-2026-000104",
    "Case 8b: next transport is ...000104",
  );
}

// --- Case 8c (req.3/5): restore NEVER overwrites an existing transport row ---
{
  const db = makeDb(2026);
  await db.createTransport(); // TRP-2026-000001
  const before = db.state().transportCounter();
  await assert.rejects(
    () =>
      db.restoreTransport([
        { entry_number: trpNo(2026, 1) }, // collides with the existing row
        { entry_number: trpNo(2026, 2) },
      ]),
    /duplicate existing entry_number/,
    "Case 8c: restore with a transport collision is rejected",
  );
  const after = db.state();
  assert.equal(after.transportCounter(), before, "Case 8c: transport counter rolled back");
  assert.deepEqual(after.transports, ["TRP-2026-000001"], "Case 8c: no partial rows, no overwrite");
}

// --- Case 8d (req.5): explicit replace DOES overwrite deliberately -----------
{
  const db = makeDb(2026);
  await db.createTransport(); // TRP-2026-000001
  const res = await db.replaceTransport([
    { entry_number: trpNo(2026, 1) },
    { entry_number: trpNo(2026, 7) },
  ]);
  assert.equal(res.ok, true, "Case 8d: replace overwrites deliberately");
  assert.deepEqual(
    db.state().transports,
    ["TRP-2026-000001", "TRP-2026-000007"],
    "Case 8d: existing row kept + new row added, no duplicates",
  );
  assert.equal(db.state().transportCounter(), 7, "Case 8d: counter reserved forward-only");
}

console.log("memo-numbering: all assertions passed");
