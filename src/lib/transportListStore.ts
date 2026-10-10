/**
 * ============================================================================
 *  TRANSPORT LIST STORE — Sahil Road Lines ERP
 * ----------------------------------------------------------------------------
 *  Completely independent from dataStore.ts / the memos table.
 *  Backed only by the `transport_list` Supabase table.
 * ============================================================================
 */

import { supabase } from "./supabaseClient";
import { applyCompletionRules } from "./completionRules";

export type TransportStatus =
  "Dispatched" | "Delivered" | "Payment Pending" | "LR Received" | "LR Submitted" | "Completed";

export const ALL_TRANSPORT_STATUSES: TransportStatus[] = [
  "Dispatched",
  "Delivered",
  "Payment Pending",
  "LR Received",
  "LR Submitted",
  "Completed",
];

export interface TransportEntry {
  id: string;
  entryNumber: string;
  dispatchDate: string;
  fromLocation: string;
  toLocation: string;
  transportName: string;
  truckNumber: string;
  driverName: string;
  ownerName: string;
  ownerPhone: string;
  consigneeName: string;
  materialName: string;
  weightTons: number;
  ratePerTon: number;
  netFreight: number;
  advance: number;
  balance: number;
  unloadingDate?: string;
  haltingDate?: string;
  haltingCharge: number;
  lrReceivedDate?: string;
  lrSubmittedDate?: string;
  description?: string;
  gcNo?: string;
  totalHire: number;
  paidAt?: string;
  localDriverGuide: number;
  commission: number;
  loadingCharges: number;
  tds: number;
  goodsMamuli: number;
  totalExpenses: number;
  paidBy: string;
  paymentMethod: string;
  finalPayable: number;
  finalPaymentDate?: string;
  status: TransportStatus;
  remarks?: string;
  isDeleted: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  overriddenFields?: Record<string, boolean>;
}

export type TransportEntryInput = Omit<
  TransportEntry,
  "id" | "entryNumber" | "isDeleted" | "deletedAt" | "createdAt" | "updatedAt"
>;

const FIELD_MAP: Record<string, string> = {
  dispatchDate: "dispatch_date",
  fromLocation: "from_location",
  toLocation: "to_location",
  transportName: "transport_name",
  truckNumber: "truck_number",
  driverName: "driver_name",
  ownerName: "owner_name",
  ownerPhone: "owner_phone",
  consigneeName: "consignee_name",
  materialName: "material_name",
  weightTons: "weight_tons",
  ratePerTon: "rate_per_ton",
  netFreight: "net_freight",
  advance: "advance",
  balance: "balance",
  unloadingDate: "unloading_date",
  haltingDate: "halting_date",
  haltingCharge: "halting_charge",
  lrReceivedDate: "lr_received_date",
  lrSubmittedDate: "lr_submitted_date",
  description: "description",
  gcNo: "gc_no",
  totalHire: "total_hire",
  paidAt: "paid_at",
  localDriverGuide: "local_driver_guide",
  commission: "commission",
  loadingCharges: "loading_charges",
  tds: "tds",
  goodsMamuli: "goods_mamuli",
  totalExpenses: "total_expenses",
  paidBy: "paid_by",
  paymentMethod: "payment_method",
  finalPayable: "final_payable",
  finalPaymentDate: "final_payment_date",
  status: "status",
  remarks: "remarks",
  overriddenFields: "overridden_fields",
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToEntry(r: any): TransportEntry {
  return {
    id: r.id,
    entryNumber: r.entry_number,
    dispatchDate: r.dispatch_date,
    fromLocation: r.from_location ?? "",
    toLocation: r.to_location ?? "",
    transportName: r.transport_name ?? "",
    truckNumber: r.truck_number ?? "",
    driverName: r.driver_name ?? "",
    ownerName: r.owner_name ?? "",
    ownerPhone: r.owner_phone ?? "",
    consigneeName: r.consignee_name ?? "",
    materialName: r.material_name ?? "",
    weightTons: Number(r.weight_tons ?? 0),
    ratePerTon: Number(r.rate_per_ton ?? 0),
    netFreight: Number(r.net_freight ?? 0),
    advance: Number(r.advance ?? 0),
    balance: Number(r.balance ?? 0),
    unloadingDate: r.unloading_date ?? undefined,
    haltingDate: r.halting_date ?? undefined,
    haltingCharge: Number(r.halting_charge ?? 0),
    lrReceivedDate: r.lr_received_date ?? undefined,
    lrSubmittedDate: r.lr_submitted_date ?? undefined,
    description: r.description ?? undefined,
    gcNo: r.gc_no ?? undefined,
    totalHire: Number(r.total_hire ?? 0),
    paidAt: r.paid_at ?? undefined,
    localDriverGuide: r.local_driver_guide ?? undefined,
    commission: Number(r.commission ?? 0),
    loadingCharges: Number(r.loading_charges ?? 0),
    tds: Number(r.tds ?? 0),
    goodsMamuli: Number(r.goods_mamuli ?? 0),
    totalExpenses: Number(r.total_expenses ?? 0),
    paidBy: r.paid_by ?? "",
    paymentMethod: r.payment_method ?? "",
    finalPayable: Number(r.final_payable ?? 0),
    finalPaymentDate: r.final_payment_date ?? undefined,
    status: (r.status ?? "Dispatched") as TransportStatus,
    remarks: r.remarks ?? undefined,
    isDeleted: !!r.is_deleted,
    deletedAt: r.deleted_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    overriddenFields:
      typeof r.overridden_fields === "object" && r.overridden_fields !== null
        ? r.overridden_fields
        : undefined,
  };
}

export function entryToRow(e: Partial<TransportEntryInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(FIELD_MAP)) {
    const val = (e as Record<string, unknown>)[key];
    if (val !== undefined) {
      row[col] = val === "" && col.endsWith("_date") ? null : val;
    }
  }
  return row;
}

// -------------------------- REALTIME BUS -------------------------------------

const listeners = new Set<() => void>();
export function subscribeTransport(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emit() {
  listeners.forEach((l) => l());
}

let realtimeInitialized = false;
function initRealtime() {
  if (realtimeInitialized || typeof window === "undefined") return;
  realtimeInitialized = true;
  supabase
    .channel("realtime-transport_list")
    .on("postgres_changes", { event: "*", schema: "public", table: "transport_list" }, () => emit())
    .subscribe();
}
initRealtime();

// -------------------------- QUERIES ------------------------------------------

export async function getTransportEntries(opts?: {
  includeDeleted?: boolean;
}): Promise<TransportEntry[]> {
  let q = supabase
    .from("transport_list")
    .select("*")
    .order("dispatch_date", { ascending: false, nullsFirst: false })
    .order("entry_number", { ascending: false, nullsFirst: false });
  // Rows inserted outside the app may have is_deleted = NULL; `.eq(false)` would
  // silently hide them, so treat NULL as "not deleted".
  if (!opts?.includeDeleted) q = q.or("is_deleted.is.null,is_deleted.eq.false");
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(rowToEntry);
}

export async function getTransportEntry(id: string): Promise<TransportEntry | undefined> {
  const { data, error } = await supabase
    .from("transport_list")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToEntry(data) : undefined;
}

export async function peekNextTransportEntryNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const { count, error } = await supabase
    .from("transport_list")
    .select("id", { count: "exact", head: true })
    .like("entry_number", `TRP-${year}-%`);
  if (error) return `TRP-${year}-000001`;
  return `TRP-${year}-${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export async function createTransportEntry(input: TransportEntryInput): Promise<TransportEntry> {
  // entry_number is assigned ATOMICALLY by the `assign_transport_entry_number`
  // BEFORE INSERT trigger, inside this same transaction, so it can never race a
  // concurrent reset. Do not allocate or send a number here.
  const row = {
    ...entryToRow(applyCompletionRules(input)),
    is_deleted: false,
  };
  const { data, error } = await supabase.from("transport_list").insert(row).select().single();
  if (error) throw error;
  emit();
  return rowToEntry(data);
}

export async function updateTransportEntry(
  id: string,
  patch: Partial<TransportEntryInput>,
  editedFields?: string[],
): Promise<TransportEntry> {
  // Merge-based enforcement of the completion rules so a partial patch can
  // never leave this row violating Completed => balance 0 /
  // finalPaymentDate set => Completed. Only corrective keys are added.
  let effective: Partial<TransportEntryInput> = patch;
  try {
    const current = await getTransportEntry(id);
    if (current) {
      const merged = applyCompletionRules({ ...current, ...patch });
      if (merged.status !== current.status || merged.balance !== current.balance) {
        effective = { ...patch };
        if (merged.status !== current.status) effective.status = merged.status;
        if (merged.balance !== current.balance) effective.balance = merged.balance;
      }
    }
  } catch {
    // Best-effort: if the current row cannot be read, write the patch as-is.
  }
  const row = entryToRow(effective);
  if (editedFields && editedFields.length > 0) {
    let existingOverridden: Record<string, boolean> | null = null;
    try {
      const { data: existing } = await supabase
        .from("transport_list")
        .select("overridden_fields")
        .eq("id", id)
        .maybeSingle();
      if (typeof existing?.overridden_fields === "object" && existing.overridden_fields !== null) {
        existingOverridden = existing.overridden_fields;
      }
    } catch {
      existingOverridden = null;
    }
    if (existingOverridden !== null) {
      const overridden = { ...existingOverridden };
      editedFields.forEach((f) => {
        overridden[f] = true;
      });
      row.overridden_fields = overridden;
    }
  }
  const { data, error } = await supabase
    .from("transport_list")
    .update(row)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  emit();
  return rowToEntry(data);
}

export async function deleteTransportEntry(id: string): Promise<void> {
  const { error } = await supabase
    .from("transport_list")
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  emit();
}

export async function restoreTransportEntry(id: string): Promise<void> {
  const { error } = await supabase
    .from("transport_list")
    .update({ is_deleted: false, deleted_at: null })
    .eq("id", id);
  if (error) throw error;
  emit();
}

export async function permanentlyDeleteTransportEntry(id: string): Promise<void> {
  const { error } = await supabase.from("transport_list").delete().eq("id", id);
  if (error) throw error;
  emit();
}

/** Ensures a transport_list row exists for a finalized memo. Never overwrites an existing one. */
export async function ensureTransportEntryForMemo(memo: Record<string, any>): Promise<void> {
  const entryNumber = memo.memoNumber;
  if (!entryNumber) return;
  const { data: existing } = await supabase
    .from("transport_list")
    .select("id")
    .eq("entry_number", entryNumber)
    .maybeSingle();
  if (existing) return;
  const input: Partial<TransportEntryInput> = {
    dispatchDate: memo.dispatchDate,
    fromLocation: memo.fromLocation,
    toLocation: memo.toLocation,
    transportName: memo.transportName,
    truckNumber: memo.truckNumber,
    driverName: memo.driverName,
    ownerName: memo.ownerName,
    ownerPhone: memo.ownerPhone,
    consigneeName: memo.consigneeName,
    materialName: memo.materialName,
    weightTons: memo.weightTons,
    ratePerTon: memo.ratePerTon,
    netFreight: memo.netFreight,
    advance: memo.advance,
    balance: memo.balance,
    unloadingDate: memo.unloadingDate,
    haltingCharge: 0,
    lrReceivedDate: memo.lrReceivedDate,
    lrSubmittedDate: memo.lrSubmittedDate,
    description: memo.description,
    gcNo: memo.gcNo,
    totalHire: memo.totalHire,
    paidAt: memo.paidAt,
    localDriverGuide: memo.localDriverGuide,
    commission: memo.commission,
    loadingCharges: memo.loadingCharges,
    tds: memo.tds,
    goodsMamuli: memo.goodsMamuli,
    totalExpenses: memo.totalExpenses,
    paidBy: memo.paidBy,
    paymentMethod: memo.paymentMethod,
    finalPayable: memo.finalPayable,
    finalPaymentDate: memo.finalPaymentDate,
    status: memo.status,
    remarks: memo.remarks,
  };
  // entry_number is deliberately NOT sent as a plain column: the DB trigger
  // rejects any explicit client-supplied value. The trusted SECURITY DEFINER
  // RPC verifies the number is an existing memo number, arms the restore flag
  // for its own insert, and is idempotent, so this can never create an
  // arbitrary or duplicate transport row.
  const row = {
    ...entryToRow(applyCompletionRules(input)),
    is_deleted: false,
  };
  const { error } = await supabase.rpc("mirror_memo_to_transport", {
    p_entry_number: entryNumber,
    p_row: row,
  });
  if (error) {
    // Non-fatal: the DB may already create this row via trigger.
    console.warn("[transport_list] could not mirror memo", error.message);
    return;
  }
  emit();
}

export async function getTrashedTransportEntries(): Promise<TransportEntry[]> {
  const { data, error } = await supabase
    .from("transport_list")
    .select("*")
    .eq("is_deleted", true)
    .order("deleted_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToEntry);
}
