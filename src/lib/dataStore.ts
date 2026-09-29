/**
 * ============================================================================
 *  DATA STORE â€” Sahil Road Lines ERP (Supabase-backed)
 * ----------------------------------------------------------------------------
 *  Same exported functions/types as the original localStorage version â€”
 *  every UI component that imports from this file needs zero changes.
 *
 *  Audit log entries and status history are written automatically by database
 *  triggers (see supabase_migration_2.sql) â€” this file does not write to
 *  audit_log or memo_status_history directly, it just reads them back.
 * ============================================================================
 */

import { supabase } from "./supabaseClient";
import {
  getTrashedTransportEntries,
  getTransportEntries,
  restoreTransportEntry,
  permanentlyDeleteTransportEntry,
  entryToRow,
  emit as emitTransport,
} from "./transportListStore";
import type { TransportEntry } from "./transportListStore";
import { normalizeTruckNumber } from "./format";

// -----------------------------  TYPES  --------------------------------------
// (unchanged from the original file)

export type TruckStatus = "Available" | "Running" | "Maintenance" | "Inactive";
export interface FleetTruck {
  id: string;
  truckNumber: string;
  ownerName: string;
  ownerPhone: string;
  driverName: string;
  driverPhone: string;
  insuranceExpiry?: string;
  remarks?: string;
  isDeleted?: boolean;
  deletedAt?: string;
}

export interface Consignee {
  id: string;
  companyName: string;
  address: string;
  contactPerson: string;
  phone: string;
  city: string;
  state: string;
  remarks?: string;
  isDeleted?: boolean;
  deletedAt?: string;
}

export type MemoStatus =
  | "Dispatched"
  | "Delivered"
  | "Payment Pending"
  | "LR Received"
  | "LR Submitted"
  | "Completed";

export const ALL_MEMO_STATUSES: MemoStatus[] = [
  "Dispatched",
  "Delivered",
  "Payment Pending",
  "LR Received",
  "LR Submitted",
  "Completed",
];

export interface Memo {
  id: string;
  memoNumber: string;
  dispatchDate: string;
  fromLocation: string;
  toLocation: string;
  /** Source party that consigns the goods. Distinct from `fromLocation` (the
   *  dispatch origin) and from `consigneeName` (the delivery party). */
  consignor: string;
  transportName: string;
  consigneeId: string;
  truckId: string;
  truckNumber: string;      // free text, like transportName â€” no link required
  consigneeName: string;    // free text, like transportName â€” no link required
  driverName: string;
  ownerName: string;
  ownerPhone: string;
  materialName: string;
  weightTons: number;
  ratePerTon: number;
  netFreight: number;
  unloadingDate?: string;
  lrReceivedDate?: string;
  lrSubmittedDate?: string;
  description?: string;
  advance: number;
  balance: number;
  commission: number;
  loadingCharges: number;
  tds: number;
  goodsMamuli: number;
  totalExpenses: number;
  gcNo?: string;
  totalHire: number;
  paidAt?: string;
  localDriverGuide: number;
  paidBy: string;
  paymentMethod: string;
  finalPayable: number;
  finalPaymentDate?: string;
  internalNotes?: string;
  status: MemoStatus;
  remarks?: string;
  isDraft?: boolean;
  isDeleted: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoStatusHistory {
  id: string;
  memoId: string;
  oldStatus: MemoStatus | null;
  newStatus: MemoStatus;
  changedAt: string;
}

export interface AuditLogEntry {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  createdAt: string;
}

export interface Settings {
  companyName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  logoUrl: string;
  gst: string;
  jurisdictionText: string;
  terms: string;
  darkMode: boolean;
}

export type MemoInput = Omit<
  Memo,
  "id" | "memoNumber" | "isDeleted" | "createdAt" | "updatedAt" | "deletedAt"
>;

// -------------------------- ROW <-> APP TYPE MAPPING -------------------------
// Supabase columns are snake_case; app types are camelCase.

function rowToTruck(r: any): FleetTruck {
  return {
    id: r.id,
    truckNumber: r.truck_number,
    ownerName: r.owner_name ?? "",
    ownerPhone: r.owner_phone ?? "",
    driverName: r.driver_name ?? "",
    driverPhone: r.driver_phone ?? "",
    insuranceExpiry: r.insurance_expiry ?? undefined,
    remarks: r.remarks ?? undefined,
    isDeleted: r.is_deleted ?? false,
    deletedAt: r.deleted_at ?? undefined,
  };
}
function truckToRow(t: Partial<FleetTruck>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (t.truckNumber !== undefined) row.truck_number = t.truckNumber;
  if (t.ownerName !== undefined) row.owner_name = t.ownerName;
  if (t.ownerPhone !== undefined) row.owner_phone = t.ownerPhone;
  if (t.driverName !== undefined) row.driver_name = t.driverName;
  if (t.driverPhone !== undefined) row.driver_phone = t.driverPhone;
  if (t.insuranceExpiry !== undefined) row.insurance_expiry = t.insuranceExpiry || null;
  if (t.remarks !== undefined) row.remarks = t.remarks;
  if (t.isDeleted !== undefined) row.is_deleted = t.isDeleted;
  if (t.deletedAt !== undefined) row.deleted_at = t.deletedAt;
  return row;
}

function rowToConsignee(r: any): Consignee {
  return {
    id: r.id,
    companyName: r.company_name,
    address: r.address ?? "",
    contactPerson: r.contact_person ?? "",
    phone: r.phone ?? "",
    city: r.city ?? "",
    state: r.state ?? "",
    remarks: r.remarks ?? undefined,
    isDeleted: r.is_deleted ?? false,
    deletedAt: r.deleted_at ?? undefined,
  };
}
function consigneeToRow(c: Partial<Consignee>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (c.companyName !== undefined) row.company_name = c.companyName;
  if (c.address !== undefined) row.address = c.address;
  if (c.contactPerson !== undefined) row.contact_person = c.contactPerson;
  if (c.phone !== undefined) row.phone = c.phone;
  if (c.city !== undefined) row.city = c.city;
  if (c.state !== undefined) row.state = c.state;
  if (c.remarks !== undefined) row.remarks = c.remarks;
  if (c.isDeleted !== undefined) row.is_deleted = c.isDeleted;
  if (c.deletedAt !== undefined) row.deleted_at = c.deletedAt;
  return row;
}

const MEMO_FIELD_MAP: Record<string, string> = {
  memoNumber: "memo_number",
  dispatchDate: "dispatch_date",
  fromLocation: "from_location",
  toLocation: "to_location",
  consignor: "consignor",
  transportName: "transport_name",
  consigneeId: "consignee_id",
  truckId: "truck_id",
  truckNumber: "truck_number",
  consigneeName: "consignee_name",
  driverName: "driver_name",
  ownerName: "owner_name",
  ownerPhone: "owner_phone",
  materialName: "material_name",
  weightTons: "weight_tons",
  ratePerTon: "rate_per_ton",
  netFreight: "net_freight",
  unloadingDate: "unloading_date",
  lrReceivedDate: "lr_received_date",
  lrSubmittedDate: "lr_submitted_date",
  description: "description",
  gcNo: "gc_no",
  totalHire: "total_hire",
  paidAt: "paid_at",
  localDriverGuide: "local_driver_guide",
  advance: "advance",
  balance: "balance",
  commission: "commission",
  loadingCharges: "loading_charges",
  tds: "tds",
  goodsMamuli: "goods_mamuli",
  totalExpenses: "total_expenses",
  paidBy: "paid_by",
  paymentMethod: "payment_method",
  finalPayable: "final_payable",
  finalPaymentDate: "final_payment_date",
  internalNotes: "internal_notes",
  status: "status",
  remarks: "remarks",
  isDraft: "is_draft",
  isDeleted: "is_deleted",
  deletedAt: "deleted_at",
};

function rowToMemo(r: any): Memo {
  return {
    id: r.id,
    memoNumber: r.memo_number,
    dispatchDate: r.dispatch_date,
    fromLocation: r.from_location ?? "",
    toLocation: r.to_location ?? "",
    consignor: r.consignor ?? "",
    transportName: r.transport_name ?? "",
    consigneeId: r.consignee_id,
    truckId: r.truck_id,
    truckNumber: r.truck_number ?? "",
    consigneeName: r.consignee_name ?? "",
    driverName: r.driver_name ?? "",
    ownerName: r.owner_name ?? "",
    ownerPhone: r.owner_phone ?? "",
    materialName: r.material_name ?? "",
    weightTons: Number(r.weight_tons ?? 0),
    ratePerTon: Number(r.rate_per_ton ?? 0),
    netFreight: Number(r.net_freight ?? 0),
    unloadingDate: r.unloading_date ?? undefined,
    lrReceivedDate: r.lr_received_date ?? undefined,
    lrSubmittedDate: r.lr_submitted_date ?? undefined,
    description: r.description ?? undefined,
    gcNo: r.gc_no ?? undefined,
    totalHire: Number(r.total_hire ?? 0),
    paidAt: r.paid_at ?? undefined,
    localDriverGuide: r.local_driver_guide ?? undefined,
    advance: Number(r.advance ?? 0),
    balance: Number(r.balance ?? 0),
    commission: Number(r.commission ?? 0),
    loadingCharges: Number(r.loading_charges ?? 0),
    tds: Number(r.tds ?? 0),
    goodsMamuli: Number(r.goods_mamuli ?? 0),
    totalExpenses: Number(r.total_expenses ?? 0),
    paidBy: r.paid_by ?? "",
    paymentMethod: r.payment_method ?? "",
    finalPayable: Number(r.final_payable ?? 0),
    finalPaymentDate: r.final_payment_date ?? undefined,
    internalNotes: r.internal_notes ?? undefined,
    status: r.status as MemoStatus,
    remarks: r.remarks ?? undefined,
    isDraft: !!r.is_draft,
    isDeleted: r.is_deleted,
    deletedAt: r.deleted_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function memoToRow(m: Partial<MemoInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  for (const [key, col] of Object.entries(MEMO_FIELD_MAP)) {
    const val = (m as Record<string, unknown>)[key];

    if (val !== undefined) {
      if (
        val === "" &&
        (col.endsWith("_date") ||
          col === "consignee_id" ||
          col === "truck_id")
      ) {
        row[col] = null;
      } else {
        row[col] = val;
      }
    }
  }

  return row;
}

function rowToSettings(r: any): Settings {
  return {
    companyName: r.company_name ?? "",
    address: r.address ?? "",
    phone: r.phone ?? "",
    email: r.email ?? "",
    website: r.website ?? "",
    logoUrl: r.logo_url ?? "",
    gst: r.gst ?? "",
    jurisdictionText: r.jurisdiction_text ?? "",
    terms: r.terms ?? "",
    darkMode: !!r.dark_mode,
  };
}
function settingsToRow(s: Partial<Settings>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (s.companyName !== undefined) row.company_name = s.companyName;
  if (s.address !== undefined) row.address = s.address;
  if (s.phone !== undefined) row.phone = s.phone;
  if (s.email !== undefined) row.email = s.email;
  if (s.website !== undefined) row.website = s.website;
  if (s.logoUrl !== undefined) row.logo_url = s.logoUrl;
  if (s.gst !== undefined) row.gst = s.gst;
  if (s.jurisdictionText !== undefined) row.jurisdiction_text = s.jurisdictionText;
  if (s.terms !== undefined) row.terms = s.terms;
  if (s.darkMode !== undefined) row.dark_mode = s.darkMode;
  return row;
}

function rowToAudit(r: any): AuditLogEntry {
  return {
    id: r.id,
    actor: r.actor,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    oldValue: r.old_value,
    newValue: r.new_value,
    createdAt: r.created_at,
  };
}
function rowToHistory(r: any): MemoStatusHistory {
  return {
    id: r.id,
    memoId: r.memo_id,
    oldStatus: r.old_status,
    newStatus: r.new_status,
    changedAt: r.changed_at,
  };
}

// -------------------------- REALTIME SUBSCRIBE BUS ---------------------------
// Same subscribe() API as before â€” components don't need to change.
// Internally now backed by Supabase Realtime instead of a manual local emit.

const listeners = new Set<() => void>();
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  listeners.forEach((l) => l());
}

let realtimeInitialized = false;
function initRealtime() {
  if (realtimeInitialized || typeof window === "undefined") return;
  realtimeInitialized = true;
  const tables = [
    "memos",
    "fleet_trucks",
    "consignees",
    "audit_log",
    "memo_status_history",
    "settings",
  ];
  tables.forEach((table) => {
    supabase
      .channel(`realtime-${table}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, () => emit())
      .subscribe();
  });
}
initRealtime();

// -------------------------- SETTINGS ----------------------------------------

export async function getSettings(): Promise<Settings> {
  const { data, error } = await supabase.from("settings").select("*").limit(1).single();
  if (error) throw error;
  return rowToSettings(data);
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const { data: existing, error: selErr } = await supabase
    .from("settings")
    .select("id")
    .limit(1)
    .single();
  if (selErr) throw selErr;
  const { data, error } = await supabase
    .from("settings")
    .update(settingsToRow(patch))
    .eq("id", existing.id)
    .select()
    .single();
  if (error) throw error;
  return rowToSettings(data);
}

// -------------------------- TRUCKS ------------------------------------------

export async function getTrucks(): Promise<FleetTruck[]> {
  const { data, error } = await supabase
    .from("fleet_trucks")
    .select("*")
    .eq("is_deleted", false)
    .order("truck_number");
  if (error) throw error;
  return (data ?? []).map(rowToTruck);
}
export async function getTruck(id: string): Promise<FleetTruck | undefined> {
  const { data, error } = await supabase.from("fleet_trucks").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToTruck(data) : undefined;
}
export async function createTruck(input: Omit<FleetTruck, "id">): Promise<FleetTruck> {
  const { data, error } = await supabase
    .from("fleet_trucks")
    .insert(truckToRow(input))
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("Truck number already exists");
    throw error;
  }
  return rowToTruck(data);
}
export async function updateTruck(id: string, patch: Partial<FleetTruck>): Promise<FleetTruck> {
  const { data, error } = await supabase
    .from("fleet_trucks")
    .update(truckToRow(patch))
    .eq("id", id)
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("Truck number already exists");
    throw error;
  }
  return rowToTruck(data);
}
export async function deleteTruck(id: string): Promise<void> {
  const { error } = await supabase
    .from("fleet_trucks")
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
export async function restoreTruck(id: string): Promise<void> {
  const { error } = await supabase
    .from("fleet_trucks")
    .update({ is_deleted: false, deleted_at: null })
    .eq("id", id);
  if (error) throw error;
}
export async function permanentlyDeleteTruck(id: string): Promise<void> {
  const { error } = await supabase.from("fleet_trucks").delete().eq("id", id);
  if (error) throw error;
}

// -------------------------- CONSIGNEES --------------------------------------

export async function getConsignees(): Promise<Consignee[]> {
  const { data, error } = await supabase
    .from("consignees")
    .select("*")
    .eq("is_deleted", false)
    .order("company_name");
  if (error) throw error;
  return (data ?? []).map(rowToConsignee);
}
export async function getConsignee(id: string): Promise<Consignee | undefined> {
  const { data, error } = await supabase.from("consignees").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToConsignee(data) : undefined;
}
export async function createConsignee(input: Omit<Consignee, "id">): Promise<Consignee> {
  const { data, error } = await supabase
    .from("consignees")
    .insert(consigneeToRow(input))
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("Consignor company name already exists");
    throw error;
  }
  return rowToConsignee(data);
}
export async function updateConsignee(id: string, patch: Partial<Consignee>): Promise<Consignee> {
  const { data, error } = await supabase
    .from("consignees")
    .update(consigneeToRow(patch))
    .eq("id", id)
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("Consignor company name already exists");
    throw error;
  }
  return rowToConsignee(data);
}
export async function deleteConsignee(id: string): Promise<void> {
  const { error } = await supabase
    .from("consignees")
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
export async function restoreConsignee(id: string): Promise<void> {
  const { error } = await supabase
    .from("consignees")
    .update({ is_deleted: false, deleted_at: null })
    .eq("id", id);
  if (error) throw error;
}
export async function permanentlyDeleteConsignee(id: string): Promise<void> {
  const { error } = await supabase.from("consignees").delete().eq("id", id);
  if (error) throw error;
}

// -------------------------- UNIFIED TRASH (memos + trucks + consignees) -----

export interface TrashItem {
  kind: "Memo" | "Truck" | "Consignor" | "Transport";
  id: string;
  label: string;       // display text â€” memo number / truck number / company name
  deletedAt?: string;
}

export async function getAllTrashItems(): Promise<TrashItem[]> {
  const [memos, trucks, consignees, transport] = await Promise.all([
    getTrashedMemos(),
    supabase.from("fleet_trucks").select("*").eq("is_deleted", true),
    supabase.from("consignees").select("*").eq("is_deleted", true),
    getTrashedTransportEntries().catch(() => []),
  ]);
  const truckItems: TrashItem[] = (trucks.data ?? []).map((r: any) => ({
    kind: "Truck",
    id: r.id,
    label: r.truck_number,
    deletedAt: r.deleted_at,
  }));
  const consigneeItems: TrashItem[] = (consignees.data ?? []).map((r: any) => ({
    kind: "Consignor",
    id: r.id,
    label: r.company_name,
    deletedAt: r.deleted_at,
  }));
  const memoItems: TrashItem[] = memos.map((m) => ({
    kind: "Memo",
    id: m.id,
    label: m.memoNumber,
    deletedAt: m.deletedAt,
  }));
  const transportItems: TrashItem[] = transport.map((t) => ({
    kind: "Transport",
    id: t.id,
    label: t.entryNumber,
    deletedAt: t.deletedAt,
  }));
  return [...memoItems, ...truckItems, ...consigneeItems, ...transportItems].sort((a, b) =>
    (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""),
  );
}

export async function restoreTrashItem(item: TrashItem): Promise<void> {
  if (item.kind === "Memo") return restoreMemo(item.id);
  if (item.kind === "Truck") return restoreTruck(item.id);
  if (item.kind === "Consignor") return restoreConsignee(item.id);
  if (item.kind === "Transport") return restoreTransportEntry(item.id);
}

export async function permanentlyDeleteTrashItem(item: TrashItem): Promise<void> {
  if (item.kind === "Memo") return permanentlyDeleteMemo(item.id);
  if (item.kind === "Truck") return permanentlyDeleteTruck(item.id);
  if (item.kind === "Consignor") return permanentlyDeleteConsignee(item.id);
  if (item.kind === "Transport") return permanentlyDeleteTransportEntry(item.id);
}

// -------------------------- MEMOS -------------------------------------------

export async function getMemos(opts?: { includeDeleted?: boolean }): Promise<Memo[]> {
  let q = supabase.from("memos").select("*").order("dispatch_date", { ascending: false });
  if (!opts?.includeDeleted) q = q.eq("is_deleted", false);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(rowToMemo);
}
export async function getTrashedMemos(): Promise<Memo[]> {
  const { data, error } = await supabase
    .from("memos")
    .select("*")
    .eq("is_deleted", true)
    .order("deleted_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToMemo);
}
export async function getMemo(id: string): Promise<Memo | undefined> {
  const { data, error } = await supabase.from("memos").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToMemo(data) : undefined;
}
export async function peekNextMemoNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const { data, error } = await supabase
    .from("memo_counters")
    .select("counter")
    .eq("year", year)
    .maybeSingle();
  if (error) throw error;
  const next = (data?.counter ?? 0) + 1;
  return `SRL-${year}-${String(next).padStart(6, "0")}`;
}

/**
 * `consignor` is newer than the deployed database schema
 * (supabase/migrations/20260927000000_add_memo_consignor.sql). If the app runs
 * before that DDL has been applied, PostgREST rejects EVERY memo write with
 * "Could not find the 'consignor' column of 'memos' in the schema cache".
 * Detecting exactly that case lets the write be retried once without the single
 * new key, so the new field can never hard-break memo saving. Every other error
 * is surfaced unchanged.
 */
function isMissingConsignorColumn(error: { message?: string | null } | null): boolean {
  const message = String(error?.message ?? "");
  return message.includes("consignor") && /column|schema/i.test(message);
}

export async function createMemo(input: MemoInput): Promise<Memo> {
  const { data: memoNumber, error: numErr } = await supabase.rpc("next_memo_number");
  if (numErr) throw numErr;
  const insert = (r: Record<string, unknown>) => supabase.from("memos").insert(r).select().single();
  const row = { ...memoToRow(input), memo_number: memoNumber, is_deleted: false };
  let { data, error } = await insert(row);
  if (error && "consignor" in row && isMissingConsignorColumn(error)) {
    const { consignor, ...withoutConsignor } = row;
    void consignor;
    ({ data, error } = await insert(withoutConsignor));
  }
  if (error) throw error;
  return rowToMemo(data);
}
export async function updateMemo(id: string, patch: Partial<MemoInput>): Promise<Memo> {
  const run = (r: Record<string, unknown>) =>
    supabase.from("memos").update(r).eq("id", id).select().single();
  const row = memoToRow(patch);
  let { data, error } = await run(row);
  if (error && "consignor" in row && isMissingConsignorColumn(error)) {
    const { consignor, ...withoutConsignor } = row;
    void consignor;
    ({ data, error } = await run(withoutConsignor));
  }
  if (error) throw error;
  return rowToMemo(data);
}
export async function deleteMemo(id: string): Promise<void> {
  const { error } = await supabase
    .from("memos")
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
export async function restoreMemo(id: string): Promise<void> {
  const { error } = await supabase
    .from("memos")
    .update({ is_deleted: false, deleted_at: null })
    .eq("id", id);
  if (error) throw error;
}
export async function permanentlyDeleteMemo(id: string): Promise<void> {
  const { error } = await supabase.from("memos").delete().eq("id", id);
  if (error) throw error;
}

// -------------------------- LOGS --------------------------------------------
// Written automatically by database triggers â€” these functions only read.

export async function getAuditLog(): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map(rowToAudit);
}
export async function getMemoHistory(memoId: string): Promise<MemoStatusHistory[]> {
  const { data, error } = await supabase
    .from("memo_status_history")
    .select("*")
    .eq("memo_id", memoId)
    .order("changed_at");
  if (error) throw error;
  return (data ?? []).map(rowToHistory);
}

// -------------------------- AUTO-CREATE HELPERS (PARTS 1 & 2) ---------------

/** Find or create a consignee by name. Returns the consignee ID. */
export async function ensureConsigneeExists(name: string): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const { data: existing } = await supabase
    .from("consignees")
    .select("id")
    .ilike("company_name", trimmed)
    .eq("is_deleted", false)
    .maybeSingle();
  if (existing) return existing.id;
  const created = await createConsignee({
    companyName: trimmed,
    address: "",
    contactPerson: "",
    phone: "",
    city: "",
    state: "",
    remarks: "",
  });
  return created.id;
}

/** Find or create a truck by number. Returns the truck ID. */
export async function ensureTruckExists(
  truckNumber: string,
  driverName?: string,
  ownerName?: string,
  ownerPhone?: string,
): Promise<string | null> {
  const trimmed = normalizeTruckNumber(truckNumber);
  if (!trimmed) return null;
  const { data: existing } = await supabase
    .from("fleet_trucks")
    .select("id")
    .ilike("truck_number", trimmed)
    .eq("is_deleted", false)
    .maybeSingle();
  if (existing) return existing.id;
  const created = await createTruck({
    truckNumber: trimmed,
    driverName: driverName || "",
    ownerName: ownerName || "",
    ownerPhone: ownerPhone || "",
    driverPhone: "",
    insuranceExpiry: "",
    remarks: "",
  });
  return created.id;
}

// -------------------------- TRANSPORT SYNC (PARTS 8, 9, 10) -----------------

/** Memo input field â†’ transport_list column name mapping for sync. */
const SYNC_FIELD_MAP: Array<[keyof MemoInput, string]> = [
  ["dispatchDate", "dispatch_date"],
  ["fromLocation", "from_location"],
  ["toLocation", "to_location"],
  ["transportName", "transport_name"],
  ["truckNumber", "truck_number"],
  ["driverName", "driver_name"],
  ["ownerName", "owner_name"],
  ["ownerPhone", "owner_phone"],
  ["consigneeName", "consignee_name"],
  ["materialName", "material_name"],
  ["weightTons", "weight_tons"],
  ["ratePerTon", "rate_per_ton"],
  ["netFreight", "net_freight"],
  ["advance", "advance"],
  ["balance", "balance"],
  ["unloadingDate", "unloading_date"],
  ["lrReceivedDate", "lr_received_date"],
  ["lrSubmittedDate", "lr_submitted_date"],
  ["description", "description"],
  ["gcNo", "gc_no"],
  ["totalHire", "total_hire"],
  ["paidAt", "paid_at"],
  ["localDriverGuide", "local_driver_guide"],
  ["commission", "commission"],
  ["loadingCharges", "loading_charges"],
  ["tds", "tds"],
  ["goodsMamuli", "goods_mamuli"],
  ["totalExpenses", "total_expenses"],
  ["paidBy", "paid_by"],
  ["paymentMethod", "payment_method"],
  ["finalPayable", "final_payable"],
  ["finalPaymentDate", "final_payment_date"],
  ["status", "status"],
  ["remarks", "remarks"],
];

/**
 * Sync a memo's normal/operational fields to the corresponding transport_list entry.
 *
 * SYNC RULES:
 *  - Normal/operational fields (truck, driver, consignee, dates, status, etc.)
 *    always sync from Register â†’ Transport.
 *  - Calculation/financial fields (rate, freight, advance, balance, etc.) are
 *    NEVER synced from Register â†’ Transport after initial creation.
 *  - There is NO reverse sync from Transport â†’ Register.
 *
 * The overridden_fields column on transport_list is retained for data-safety
 * and display purposes but is no longer used to gate sync behaviour.
 */
export async function syncMemoToTransport(
  memoId: string,
  memoPatch: Partial<MemoInput>,
): Promise<void> {
  const memo = await getMemo(memoId);
  if (!memo) return;
  const entryNumber = memo.memoNumber;
  try {
    const { data: existing } = await supabase
      .from("transport_list")
      .select("id")
      .eq("entry_number", entryNumber)
      .maybeSingle();
    if (!existing) return;
    const patch: Record<string, unknown> = {};
    for (const [appKey, col] of SYNC_FIELD_MAP) {
      // Calculation/financial fields are NEVER synced from Register â†’ Transport
      // after initial creation. Only normal/operational fields sync.
      if (CALC_COLS.has(col)) continue;
      const val = (memoPatch as Record<string, unknown>)[appKey];
      if (val !== undefined) {
        patch[col] = val === "" && col.endsWith("_date") ? null : val;
      }
    }
    if (Object.keys(patch).length === 0) return;
    await supabase.from("transport_list").update(patch).eq("id", existing.id);
  } catch (e) {
    // If the query fails (e.g. legacy schema), fall back to syncing only
    // normal/operational fields, still skipping calculation fields.
    console.warn("[syncMemoToTransport] fallback sync (skipping calc fields)", e);
    const patch: Record<string, unknown> = {};
    for (const [appKey, col] of SYNC_FIELD_MAP) {
      if (CALC_COLS.has(col)) continue;
      const val = (memoPatch as Record<string, unknown>)[appKey];
      if (val !== undefined) {
        patch[col] = val === "" && col.endsWith("_date") ? null : val;
      }
    }
    if (Object.keys(patch).length > 0) {
      await supabase.from("transport_list").update(patch).eq("entry_number", entryNumber);
    }
  }
}

/** transport_list column names that belong to the CALCULATION / FINANCIAL group.
 * These fields are NEVER synced from Register â†’ Transport after initial creation.
 * They are copied once when the memo is first created (ensureTransportEntryForMemo),
 * then Transport List owns them independently.
 * All other SYNC_FIELD_MAP columns are normal/operational and always sync
 * from Register -> Transport (one-way); there is NO Transport -> Register sync. */
const CALC_COLS: ReadonlySet<string> = new Set([
  "rate_per_ton",
  "net_freight",
  "total_hire",
  "advance",
  "balance",
  "paid_at",
  "commission",
  "loading_charges",
  "tds",
  "local_driver_guide",
  "goods_mamuli",
  "total_expenses",
  "final_payable",
]);

// -------------------------- DEV UTIL ----------------------------------------
// âš ï¸ Business data only â€” does NOT touch auth, profiles, or settings.

export async function _resetStore(): Promise<void> {
  console.warn("_resetStore: clearing business data from Supabase â€” this cannot be undone.");
  await supabase.from("memo_status_history").delete().not("id", "is", null);
  await supabase.from("audit_log").delete().not("id", "is", null);
  await supabase.from("transport_list").delete().not("id", "is", null);
  await supabase.from("memos").delete().not("id", "is", null);
  await supabase.from("consignees").delete().not("id", "is", null);
  await supabase.from("fleet_trucks").delete().not("id", "is", null);
  await supabase.from("memo_counters").delete().not("year", "is", null);
}

// -------------------------- BACKUP / RESTORE (PARTS 11 & 12) ---------------

export async function exportAllDataXlsx(): Promise<void> {
  const XLSX = await import("xlsx");
  const [trucks, consignees, memos, settings, transports] = await Promise.all([
    getTrucks(),
    getConsignees(),
    getMemos({ includeDeleted: true }),
    getSettings(),
    getTransportEntries({ includeDeleted: true }),
  ]);

  const wb = XLSX.utils.book_new();

  // CSV/Excel-safe: JSON-serialize only the fields the app actually knows how to
  // restore, so a "revived" D.B. row never contains a truncated UUID.
  const cloneKnown = (obj: object, keys: string[]): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const src = obj as Record<string, unknown>;
    for (const k of keys) {
      const v = src[k];
      if (v !== undefined) out[k] = v;
    }
    return out;
  };

  const memoRows = memos.map((m) =>
    cloneKnown(m, [
      "memoNumber",
      "dispatchDate",
      "fromLocation",
      "toLocation",
      "transportName",
      "truckNumber",
      "consigneeName",
      "driverName",
      "ownerName",
      "ownerPhone",
      "materialName",
      "weightTons",
      "ratePerTon",
      "netFreight",
      "totalHire",
      "advance",
      "balance",
      "commission",
      "loadingCharges",
      "tds",
      "goodsMamuli",
      "totalExpenses",
      "paidBy",
      "paymentMethod",
      "finalPayable",
      "finalPaymentDate",
      "status",
      "remarks",
      "description",
      "gcNo",
      "paidAt",
      "localDriverGuide",
      "unloadingDate",
      "lrReceivedDate",
      "lrSubmittedDate",
      "internalNotes",
      "isDraft",
      "isDeleted",
    ]),
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(memoRows), "Memos");

  const truckRows = trucks.map((t) =>
    cloneKnown(t, [
      "truckNumber",
      "ownerName",
      "ownerPhone",
      "driverName",
      "driverPhone",
      "insuranceExpiry",
      "remarks",
    ]),
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(truckRows), "Fleet");

  const consigneeRows = consignees.map((c) =>
    cloneKnown(c, [
      "companyName",
      "contactPerson",
      "phone",
      "city",
      "state",
      "address",
      "remarks",
    ]),
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(consigneeRows), "Consignees");

  const transportRows = transports.map((t) => {
    const row = cloneKnown(t, [
      "entryNumber",
      "dispatchDate",
      "fromLocation",
      "toLocation",
      "transportName",
      "truckNumber",
      "driverName",
      "ownerName",
      "ownerPhone",
      "consigneeName",
      "materialName",
      "weightTons",
      "ratePerTon",
      "netFreight",
      "advance",
      "balance",
      "unloadingDate",
      "haltingDate",
      "haltingCharge",
      "lrReceivedDate",
      "lrSubmittedDate",
      "description",
      "gcNo",
      "totalHire",
      "paidAt",
      "localDriverGuide",
      "commission",
      "loadingCharges",
      "tds",
      "goodsMamuli",
      "totalExpenses",
      "paidBy",
      "paymentMethod",
      "finalPayable",
      "finalPaymentDate",
      "status",
      "remarks",
      "isDeleted",
    ]);
    if (t.overriddenFields) {
      // Preserve per-field override flags as readable JSON so a restore
      // doesn't clobber Transport List's independent edits.
      row["Overridden Fields"] = JSON.stringify(t.overriddenFields);
    }
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(transportRows), "Transport");

  const settingsRows = [{ ...settings }];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(settingsRows), "Settings");

  const date = new Date().toISOString().slice(0, 10);
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Sahil_Road_Lines_Backup_${date}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Import / RESTORE an application-exported Excel backup (Memos / Fleet /
 * Consignees / Transport / Settings sheets).
 *
 * SAFE MERGE / RESTORE SEMANTICS (idempotent â€” safe to run repeatedly):
 *  - A record key (memo number / truck number / company name / transport entry
 *    number) that already exists in the DB AND is NOT deleted is SKIPPED â€” its
 *    current data is never overwritten, and it is never duplicated.
 *  - A record key that exists in the DB but was SOFT-DELETED (trash) is
 *    RESTORED: it is un-deleted, deleted_at is cleared and its values are
 *    refreshed from the backup.
 *  - A record key missing from the DB is INSERTED from the backup.
 *  - Existing records are never deleted and no table is reset/truncated.
 *  - The Settings sheet (when present) restores the company settings row.
 *
 * COLUMN RESOLUTION
 *  - Headers are matched case-insensitively and whitespace-tolerantly and may
 *    use any of several legacy spellings ("Memo No." == "Memo Number", ...) so
 *    backups made by older app versions still import.
 *  - Memo / transport rows are keyed by their number columns (memo_number /
 *    entry_number); truck / consignee rows by truck_number / company_name.
 *  - After the Consignees and Fleet sheets are restored, each memo's
 *    consignee_id / truck_id is re-linked by an exact (case-insensitive) name /
 *    number match â€” with the free-text fallback columns always preserved.
 */

// -------------------------- IMPORT TYPES ------------------------------------

export interface ImportEntityCounts {
  inserted: number;
  restored: number;
  skipped: number;
  duplicate: number;
  failed: number;
}

export interface ImportOperation {
  sheet: string;
  row: number;
  key: string;
  operation: "inserted" | "restored" | "skipped" | "duplicate" | "failed";
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

export interface ImportSheetResult {
  sheetName: string;
  recognized: boolean;
  rows: number;
  columns: string[];
  processed: number;
  skippedNoKey: number;
  operations: ImportOperation[];
}

export interface ImportResult {
  memos: ImportEntityCounts;
  trucks: ImportEntityCounts;
  consignees: ImportEntityCounts;
  transports: ImportEntityCounts;
  settingsUpdated: boolean;
  recognizedSheets: string[];
  unknownSheets: string[];
  file: { name: string; size: number };
  sheets: ImportSheetResult[];
}

const emptyCounts = (): ImportEntityCounts => ({
  inserted: 0,
  restored: 0,
  skipped: 0,
  duplicate: 0,
  failed: 0,
});

// -------------------------- COLUMN RESOLUTION --------------------------------

type FieldDef = {
  aliases: string[];
};

const normKey = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]/g, "");

const fieldMap: Record<string, FieldDef> = {
  memoNumber: { aliases: ["Memo Number", "memoNumber", "Memo No.", "Memo No", "Memo #", "memo_number", "memoNo"] },
  dispatchDate: { aliases: ["Dispatch Date", "dispatchDate", "Dispatch", "dispatch_date", "date"] },
  fromLocation: { aliases: ["From", "from_location", "fromLocation"] },
  toLocation: { aliases: ["To", "Destination", "to_location", "toLocation"] },
  transportName: { aliases: ["Transport", "transport_name", "transportName"] },
  truckNumber: { aliases: ["Truck Number", "Truck", "Truck No.", "Truck No", "truck_number", "truckNo"] },
  consigneeName: { aliases: ["Consignee", "consignee_name", "consigneeName"] },
  driverName: { aliases: ["Driver Name", "Driver", "driver_name", "driverName"] },
  ownerName: { aliases: ["Owner Name", "Owner", "owner_name", "ownerName"] },
  ownerPhone: { aliases: ["Owner Phone", "Owner Phone No.", "owner_phone", "ownerPhone"] },
  driverPhone: { aliases: ["Driver Phone", "driver_phone", "driverPhone"] },
  materialName: { aliases: ["Material", "Article", "material_name", "materialName"] },
  weightTons: { aliases: ["Weight (Tons)", "Weight", "weight_tons", "weightTons"] },
  ratePerTon: { aliases: ["Rate/Ton", "Rate per Ton", "Rate/Ton (Transport)", "rate_per_ton", "ratePerTon"] },
  netFreight: { aliases: ["Net Freight", "net_freight", "netFreight"] },
  totalHire: { aliases: ["Total Hire", "total_hire", "totalHire"] },
  advance: { aliases: ["Advance", "advance"] },
  balance: { aliases: ["Balance", "balance"] },
  commission: { aliases: ["Commission", "commission"] },
  loadingCharges: { aliases: ["Loading Charges", "Loading", "loading_charges", "loadingCharges"] },
  tds: { aliases: ["TDS", "tds"] },
  goodsMamuli: { aliases: ["Goods Mamuli", "Office Mamuli", "goods_mamuli", "goodsMamuli"] },
  totalExpenses: { aliases: ["Total Expenses", "total_expenses", "totalExpenses"] },
  paidBy: { aliases: ["Paid By", "paid_by", "paidBy"] },
  paymentMethod: { aliases: ["Payment Method", "payment_method", "paymentMethod"] },
  finalPayable: { aliases: ["Final Payable", "final_payable", "finalPayable"] },
  finalPaymentDate: { aliases: ["Final Payment Date", "final_payment_date", "finalPaymentDate"] },
  status: { aliases: ["Status", "status"] },
  remarks: { aliases: ["Remarks", "Remark", "remarks"] },
  description: { aliases: ["Description", "description"] },
  gcNo: { aliases: ["G.C. No.", "GC No.", "GC No", "GC No", "gc_no", "gcNo"] },
  paidAt: { aliases: ["Paid At", "paid_at", "paidAt"] },
  localDriverGuide: { aliases: ["Local Driver / Guide", "Local Driver/Guide", "local_driver_guide", "localDriverGuide"] },
  unloadingDate: { aliases: ["Unloading Date", "Unloading", "unloading_date", "unloadingDate"] },
  lrReceivedDate: { aliases: ["LR Received Date", "LR Received", "lr_received_date", "lrReceivedDate"] },
  lrSubmittedDate: { aliases: ["LR Submitted Date", "LR Submitted", "lr_submitted_date", "lrSubmittedDate"] },
  internalNotes: { aliases: ["Internal Notes", "internal_notes", "internalNotes"] },
  isDraft: { aliases: ["Is Draft", "is_draft", "isDraft"] },
  isDeleted: { aliases: ["Is Deleted", "is_deleted", "isDeleted"] },
  companyName: { aliases: ["Company Name", "Name", "Party", "company_name", "companyName"] },
  contactPerson: { aliases: ["Contact Person", "contact_person", "contactPerson"] },
  phone: { aliases: ["Phone", "Phone No.", "Phone No", "phone"] },
  city: { aliases: ["City", "city"] },
  state: { aliases: ["State", "state"] },
  address: { aliases: ["Address", "address"] },
  insuranceExpiry: { aliases: ["Insurance Expiry", "insurance_expiry", "insuranceExpiry"] },
  entryNumber: { aliases: ["Entry Number", "Memo Number", "Memo #", "Entry No.", "Entry No", "entry_number", "entryNo"] },
  haltingDate: { aliases: ["Halting Date", "halting_date", "haltingDate"] },
  haltingCharge: { aliases: ["Halting Charge", "halting_charge", "haltingCharge"] },
  overriddenFields: { aliases: ["Overridden Fields", "overridden_fields", "overriddenFields"] },
  companyNameSettings: { aliases: ["companyName", "company_name"] },
  addressSettings: { aliases: ["address"] },
  phoneSettings: { aliases: ["phone"] },
  emailSettings: { aliases: ["email"] },
  websiteSettings: { aliases: ["website"] },
  logoUrlSettings: { aliases: ["logoUrl", "logo_url"] },
  gstSettings: { aliases: ["gst"] },
  jurisdictionTextSettings: { aliases: ["jurisdictionText", "jurisdiction_text"] },
  termsSettings: { aliases: ["terms"] },
  darkModeSettings: { aliases: ["darkMode", "dark_mode"] },
};

/** Reads a cell value that may be empty; undefined when the column is absent.
 *  Headers are matched case-insensitively / whitespace-tolerantly: first a
 *  direct hit on the exact alias, then a normalized (lowercased, punctuation-
 *  stripped) lookup so "Memo number", "G.C.No", "rate per ton" all resolve. */
function cellVal(row: Record<string, any>, field: string): string | number | undefined {
  const def = fieldMap[field];
  if (!def) return undefined;
  for (const alias of def.aliases) {
    const v = row[alias];
    if (v !== undefined && v !== null) {
      return typeof v === "number" ? v : String(v);
    }
  }
  for (const alias of def.aliases) {
    const nk = normKey(alias);
    const v = row[nk];
    if (v !== undefined && v !== null) return typeof v === "number" ? v : String(v);
  }
  return undefined;
}

/** Adds a normalized alias key (lowercased, punctuation stripped) for every
 *  header so tolerance-matched imports ("Memo number", "G.C.No") still read. */
function normalizeRows(rows: any[]): any[] {
  return rows.map((r) => {
    const out: Record<string, any> = { ...r };
    for (const k of Object.keys(r)) {
      const nk = normKey(k);
      if (nk && nk !== k && !(nk in out)) out[nk] = r[k];
    }
    return out;
  });
}

function cellStr(row: Record<string, any>, field: string): string {
  const v = cellVal(row, field);
  return v === undefined || v === null ? "" : String(v).trim();
}

function cellNum(row: Record<string, any>, field: string): number {
  const v = cellVal(row, field);
  if (v === undefined || v === null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Parses a boolean cell. Accepts the app's own export format (true/false booleans,
 *  which json_to_sheet writes as TRUE/FALSE), hand-typed "Yes"/"No", and numeric
 *  1/0. Anything else (empty, "—", "N/A") -> false. */
function cellBool(row: Record<string, any>, field: string): boolean {
  const v = cellVal(row, field);
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v)
    .trim()
    .replace(/^[!"']|[!"']$/g, "")
    .toLowerCase();
  if (s === "") return false;
  return s === "yes" || s === "y" || s === "true" || s === "t" || s === "1" || s === "x";
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ]|$)/;
const DMY_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** Excel serial number -> ISO date (YYYY-MM-DD). Returns "" when out of range. */
function excelSerialToIso(s: number): string {
  if (!Number.isFinite(s) || s <= 0 || s > 2958465) return "";
  const utcMs = Math.round((s - 25569) * 86400 * 1000);
  const d = new Date(utcMs);
  if (isNaN(d.getTime())) return "";
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/** Converts a date cell to ISO YYYY-MM-DD for Postgres `date` columns.
 *  The app exports dates via formatDate() as DD/MM/YYYY, and renders null as
 *  "—" (em-dash); raw DD/MM/YYYY or "—" must never reach Postgres (Postgres
 *  would parse DD/MM/YYYY under the MDY DateStyle and reject "—" with an
 *  invalid-input-syntax error). Handles dd/MM/yyyy, ISO strings, and Excel
 *  cell-value series numbers. Blank / placeholder ("—", "-", "/") -> undefined. */
function cellDate(row: Record<string, any>, field: string): string | undefined {
  const v = cellVal(row, field);
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") return excelSerialToIso(v) || undefined;
  const s = String(v).trim();
  if (s === "" || s === "—" || s === "-" || s === "/" || s === "--") return undefined;
  const dmy = s.match(DMY_RE);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  const iso = s.match(ISO_DATE_RE);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const t = Date.parse(s);
  if (!isNaN(t)) {
    const d = new Date(t);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }
  return undefined;
}

/** Captures Supabase error fields onto an ImportOperation. */
function capErr(e: any): Pick<ImportOperation, "message" | "code" | "details" | "hint"> {
  const out: Pick<ImportOperation, "message" | "code" | "details" | "hint"> = {
    message: String(e?.message ?? "Unknown error").slice(0, 400),
  };
  if (e?.code) out.code = String(e.code);
  if (e?.details) out.details = String(e.details);
  if (e?.hint) out.hint = String(e.hint);
  return out;
}

// -------------------------- SHEET DETECTION ----------------------------------

type SheetKind = "memos" | "trucks" | "consignees" | "transport" | "settings";

const KIND_SHEET_NAMES: Record<SheetKind, string[]> = {
  memos: ["Memos", "Register"],
  trucks: ["Fleet", "Trucks"],
  consignees: ["Consignees"],
  transport: ["Transport"],
  settings: ["Settings"],
};

/** Identifies the kind of data a worksheet holds from its header row, so that
 *  single-sheet exports (the Register List / Transport List "Sheet1" files) are
 *  recognized without relying on the Full-Backup sheet names. Matching uses the
 *  same punctuation/case-insensitive normalization as cellVal and explicit
 *  signatures only â€” never fuzzy substring matching, so a Reports export ("Memo #",
 *  "Date", "Expenses") is correctly NOT classified as memo data. */
function classifySheetKind(headers: string[]): SheetKind | null {
  const h = new Set(headers.map((x) => normKey(String(x))));
  const has = (alias: string) => h.has(normKey(alias));

  if (has("Jurisdiction Text") || has("Dark Mode") || (has("Company Name") && has("Logo URL"))) {
    return "settings";
  }
  if (has("Entry Number") || has("Halting Charge") || has("Rate/Ton (Transport)")) {
    return "transport";
  }
if (has("Company Name")) {
    if (has("Contact Person") || has("City") || has("State") || has("Address")) {
      return "consignees";
    }
    return null; // "Company Name" alone is also the Settings profile — stay strict.
  }
  const memoPrimary =
    has("Memo") || has("Memo Number") || has("Memo No.") || has("Memo No") || has("Memo #") || has("memoNumber");
  if (
    memoPrimary &&
    (has("Dispatch") ||
      has("Dispatch Date") ||
      has("From") ||
      has("To") ||
      has("Rate/Ton") ||
      has("Weight") ||
      has("Consignee") ||
      has("G.C. No.") ||
      has("Article"))
  ) {
    return "memos";
  }
  if (has("Truck Number") || has("Truck No.") || has("Truck No") || has("truckNumber")) {
    if (has("Owner Name") || has("Owner Phone") || has("Insurance Expiry") || has("Driver Name")) {
      return "trucks";
    }
  }
  return null;
}

// -------------------------- IMPORT -------------------------------------------

export async function importAllDataXlsx(file: File): Promise<ImportResult> {
  const XLSX = await import("xlsx");
  const debug = false; // toggle to true locally to trace every import step.
  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: "array" });

  if (debug) {
    // Dev-only diagnostics: workbook structure at import time.
    console.info(`[import] file=${file.name} size=${file.size}`);
    for (const n of wb.SheetNames) {
      const ws = wb.Sheets[n];
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
      const headers = ((grid[0] ?? []) as any[]).map((x) => String(x)).filter((x) => x !== "");
      console.info(
        `[import] sheet="${n}" range=${ws["!ref"] ?? "(none)"} gridRows=${grid.length} dataRows=${Math.max(0, grid.length - (headers.length ? 1 : 0))} headers=${JSON.stringify(headers)}`
      );
      grid.slice(0, 6).forEach((r, i) => console.info(`[import]   row${i + 1}: ${JSON.stringify(r)}`));
    }
  }

  // Resolve each sheet to a supported kind:
  //  1) by normalized name (Full-Backup workbook: Memos/Fleet/Consignees/Transport/Settings)
  //  2) otherwise by explicit header signatures (single-sheet "Sheet1" Register/Transport exports)
  const byKind = new Map<SheetKind, number>();
  const claimed = new Set<number>();
  for (let i = 0; i < wb.SheetNames.length; i++) {
    const nk = normKey(wb.SheetNames[i]);
    for (const kind of Object.keys(KIND_SHEET_NAMES) as SheetKind[]) {
      if (KIND_SHEET_NAMES[kind].some((n) => normKey(n) === nk) && !byKind.has(kind)) {
        byKind.set(kind, i);
        claimed.add(i);
        break;
      }
    }
  }
  for (let i = 0; i < wb.SheetNames.length; i++) {
    if (claimed.has(i)) continue;
    const ws = wb.Sheets[wb.SheetNames[i]];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
    const headers = ((grid[0] ?? []) as any[]).map((x) => String(x)).filter((x) => x !== "");
    const kind = classifySheetKind(headers);
    if (kind && !byKind.has(kind)) {
      byKind.set(kind, i);
      claimed.add(i);
    }
  }
  const sheetIndex = (kind: SheetKind): number | undefined => byKind.get(kind);
  const sheetNameOf = (kind: SheetKind): string => {
    const i = sheetIndex(kind);
    return i === undefined ? kind : wb.SheetNames[i];
  };
  const getSheet = (kind: SheetKind) => {
    const i = sheetIndex(kind);
    return i === undefined ? undefined : wb.Sheets[wb.SheetNames[i]];
  };

  const res: ImportResult = {
    memos: emptyCounts(),
    trucks: emptyCounts(),
    consignees: emptyCounts(),
    transports: emptyCounts(),
    settingsUpdated: false,
    recognizedSheets: [],
    unknownSheets: [],
    file: { name: file.name, size: file.size },
    sheets: [],
  };

  if (debug) {
    console.info(`[import] file=${file.name} size=${file.size} sheets=`, wb.SheetNames);
  }

  // ---- 1. Consignees (restore reference data first so memos can re-link) ----
  {
    const sheet = getSheet("consignees");
    if (sheet) {
      const sheetLabel = sheetNameOf("consignees");
      res.recognizedSheets.push(sheetLabel);
      const rows: any[] = normalizeRows(XLSX.utils.sheet_to_json(sheet, { defval: "" }));
      const columns = rows[0] ? Object.keys(rows[0]).map((k) => String(k)) : [];
      const counts = res.consignees;
      const ops: ImportOperation[] = [];
      const seen = new Set<string>();
      res.sheets.push({
        sheetName: sheetLabel,
        recognized: true,
        rows: rows.length,
        columns,
        processed: 0,
        skippedNoKey: 0,
        operations: ops,
      });
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] as Record<string, any>;
        const rowNum = i + 2;
        const companyName = cellStr(r, "companyName");
        if (!companyName) {
          counts.failed++;
          res.sheets[res.sheets.length - 1].skippedNoKey++;
          ops.push({ sheet: sheetLabel, row: rowNum, key: "", operation: "failed" });
          continue;
        }
        const key = companyName;
        if (seen.has(key.toLowerCase())) {
          counts.duplicate++;
          ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "duplicate" });
          continue;
        }
        seen.add(key.toLowerCase());
        const row = consigneeToRow({
          companyName,
          contactPerson: cellStr(r, "contactPerson"),
          phone: cellStr(r, "phone"),
          city: cellStr(r, "city"),
          state: cellStr(r, "state"),
          address: cellStr(r, "address"),
          remarks: cellStr(r, "remarks"),
        });
        const { data: found, error: findErr } = await supabase
          .from("consignees")
          .select("id, is_deleted")
          .ilike("company_name", key)
          .limit(1);
        if (findErr) {
          counts.failed++;
          ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "failed", ...capErr(findErr) });
          if (debug) console.error(`[import/consignees/${rowNum}] lookup: ${findErr.message}`);
          continue;
        }
        const existing = (found ?? [])[0];
        if (existing) {
          if (existing.is_deleted) {
            const { error } = await supabase
              .from("consignees")
              .update({ ...row, is_deleted: false, deleted_at: null })
              .eq("id", existing.id);
            if (error) {
              counts.failed++;
              ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "failed", ...capErr(error) });
              if (debug) console.error(`[import/consignees/${rowNum}] restore: ${error.message}`);
            } else {
              counts.restored++;
              ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "restored" });
            }
          } else {
            counts.skipped++;
            ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "skipped" });
          }
        } else {
          const { error } = await supabase.from("consignees").insert({ ...row, is_deleted: false });
          if (error) {
            counts.failed++;
            ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "failed", ...capErr(error) });
            if (debug) console.error(`[import/consignees/${rowNum}] insert: ${error.message}`);
          } else {
            counts.inserted++;
            ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "inserted" });
          }
        }
      }
    }
  }

  // ---- 2. Fleet (trucks) ----
  {
    const sheet = getSheet("trucks");
    if (sheet) {
      const sheetLabel = sheetNameOf("trucks");
      res.recognizedSheets.push(sheetLabel);
      const rows: any[] = normalizeRows(XLSX.utils.sheet_to_json(sheet, { defval: "" }));
      const columns = rows[0] ? Object.keys(rows[0]).map((k) => String(k)) : [];
      const counts = res.trucks;
      const ops: ImportOperation[] = [];
      const seen = new Set<string>();
      res.sheets.push({
        sheetName: sheetLabel,
        recognized: true,
        rows: rows.length,
        columns,
        processed: 0,
        skippedNoKey: 0,
        operations: ops,
      });
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] as Record<string, any>;
        const rowNum = i + 2;
        const truckNumber = normalizeTruckNumber(cellStr(r, "truckNumber"));
        if (!truckNumber) {
          counts.failed++;
          res.sheets[res.sheets.length - 1].skippedNoKey++;
          ops.push({ sheet: sheetLabel, row: rowNum, key: "", operation: "failed" });
          continue;
        }
        const key = truckNumber;
        if (seen.has(key.toLowerCase())) {
          counts.duplicate++;
          ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "duplicate" });
          continue;
        }
        seen.add(key.toLowerCase());
        const row = truckToRow({
          truckNumber,
          ownerName: cellStr(r, "ownerName"),
          ownerPhone: cellStr(r, "ownerPhone"),
          driverName: cellStr(r, "driverName"),
          driverPhone: cellStr(r, "driverPhone"),
          insuranceExpiry: cellDate(r, "insuranceExpiry"),
          remarks: cellStr(r, "remarks"),
        });
        const { data: found, error: findErr } = await supabase
          .from("fleet_trucks")
          .select("id, is_deleted")
          .ilike("truck_number", key)
          .limit(1);
        if (findErr) {
          counts.failed++;
          ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "failed", ...capErr(findErr) });
          if (debug) console.error(`[import/fleet/${rowNum}] lookup: ${findErr.message}`);
          continue;
        }
        const existing = (found ?? [])[0];
        if (existing) {
          if (existing.is_deleted) {
            const { error } = await supabase
              .from("fleet_trucks")
              .update({ ...row, is_deleted: false, deleted_at: null })
              .eq("id", existing.id);
            if (error) {
              counts.failed++;
              ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "failed", ...capErr(error) });
              if (debug) console.error(`[import/fleet/${rowNum}] restore: ${error.message}`);
            } else {
              counts.restored++;
              ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "restored" });
            }
          } else {
            counts.skipped++;
            ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "skipped" });
          }
        } else {
          const { error } = await supabase.from("fleet_trucks").insert({ ...row, is_deleted: false });
          if (error) {
            counts.failed++;
            ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "failed", ...capErr(error) });
            if (debug) console.error(`[import/fleet/${rowNum}] insert: ${error.message}`);
          } else {
            counts.inserted++;
            ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "inserted" });
          }
        }
      }
    }
  }

  // ---- 3. Memos (re-link FK IDs from the restored reference data) ----
  const consigneeIdBy = new Map<string, string>();
  const truckIdBy = new Map<string, string>();
  {
    const { data: consigneesData, error: errC } = await supabase
      .from("consignees")
      .select("id, company_name, is_deleted");
    if (!errC) {
      (consigneesData ?? []).forEach((c) => {
        if (c && typeof c.company_name === "string" && c.company_name) {
          consigneeIdBy.set(c.company_name.toLowerCase(), c.id as string);
        }
      });
    }
    const { data: trucksData, error: errT } = await supabase
      .from("fleet_trucks")
      .select("id, truck_number, is_deleted");
    if (!errT) {
      (trucksData ?? []).forEach((t) => {
        if (t && typeof t.truck_number === "string" && t.truck_number) {
          truckIdBy.set(normalizeTruckNumber(t.truck_number).toLowerCase(), t.id as string);
        }
      });
    }
  }

  const memoSheet = getSheet("memos");
  if (memoSheet) {
    const sheetLabel = sheetNameOf("memos");
    res.recognizedSheets.push(sheetLabel);
    const rows: any[] = normalizeRows(XLSX.utils.sheet_to_json(memoSheet, { defval: "" }));
    const columns = rows[0] ? Object.keys(rows[0]).map((k) => String(k)) : [];
    const counts = res.memos;
    const ops: ImportOperation[] = [];
    const seen = new Set<string>();
    res.sheets.push({
      sheetName: sheetLabel,
      recognized: true,
      rows: rows.length,
      columns,
      processed: 0,
      skippedNoKey: 0,
      operations: ops,
    });
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as Record<string, any>;
      const rowNum = i + 2;
      const memoNumber = cellStr(r, "memoNumber");
      if (!memoNumber) {
        counts.failed++;
        res.sheets[res.sheets.length - 1].skippedNoKey++;
        ops.push({ sheet: sheetLabel, row: rowNum, key: "", operation: "failed" });
        continue;
      }
      const key = memoNumber;
      if (seen.has(key.toLowerCase())) {
        counts.duplicate++;
        ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "duplicate" });
        continue;
      }
      seen.add(key.toLowerCase());
      const truckNumberName = normalizeTruckNumber(cellStr(r, "truckNumber"));
      const consigneeNameName = cellStr(r, "consigneeName");
      const row = memoToRow({
        dispatchDate: cellDate(r, "dispatchDate"),
          fromLocation: cellStr(r, "fromLocation"),
          toLocation: cellStr(r, "toLocation"),
          transportName: cellStr(r, "transportName"),
        truckNumber: truckNumberName,
        consigneeName: consigneeNameName,
        driverName: cellStr(r, "driverName"),
        ownerName: cellStr(r, "ownerName"),
        ownerPhone: cellStr(r, "ownerPhone"),
        materialName: cellStr(r, "materialName"),
        weightTons: cellNum(r, "weightTons"),
        ratePerTon: cellNum(r, "ratePerTon"),
        netFreight: cellNum(r, "netFreight"),
        advance: cellNum(r, "advance"),
        balance: cellNum(r, "balance"),
        commission: cellNum(r, "commission"),
        loadingCharges: cellNum(r, "loadingCharges"),
        tds: cellNum(r, "tds"),
        goodsMamuli: cellNum(r, "goodsMamuli"),
        totalExpenses: cellNum(r, "totalExpenses"),
        paidBy: cellStr(r, "paidBy"),
        paymentMethod: cellStr(r, "paymentMethod"),
        finalPayable: cellNum(r, "finalPayable"),
        finalPaymentDate: cellDate(r, "finalPaymentDate"),
        status: (cellStr(r, "status") || "Dispatched") as Memo["status"],
        remarks: cellStr(r, "remarks"),
        description: cellStr(r, "description"),
        gcNo: cellStr(r, "gcNo"),
        totalHire: cellNum(r, "totalHire"),
        paidAt: cellStr(r, "paidAt"),
        localDriverGuide: cellNum(r, "localDriverGuide"),
        unloadingDate: cellDate(r, "unloadingDate"),
        lrReceivedDate: cellDate(r, "lrReceivedDate"),
        lrSubmittedDate: cellDate(r, "lrSubmittedDate"),
        internalNotes: cellStr(r, "internalNotes"),
        isDraft: cellBool(r, "isDraft"),
      });
      const knownTruckId = truckNumberName ? (truckIdBy.get(truckNumberName.toLowerCase()) ?? null) : null;
      const knownConsigneeId = consigneeNameName
        ? (consigneeIdBy.get(consigneeNameName.toLowerCase()) ?? null)
        : null;
      row.truck_id = knownTruckId;
      row.consignee_id = knownConsigneeId;
      const { data: found, error: findErr } = await supabase
        .from("memos")
        .select("id, is_deleted")
        .eq("memo_number", key)
        .limit(1);
      if (findErr) {
        counts.failed++;
        ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "failed", ...capErr(findErr) });
        if (debug) console.error(`[import/memos/${rowNum}] lookup: ${findErr.message}`);
        continue;
      }
      const existing = (found ?? [])[0];
      if (existing) {
        if (existing.is_deleted) {
          const { error } = await supabase
            .from("memos")
            .update({ ...row, is_deleted: false, deleted_at: null })
            .eq("id", existing.id);
          if (error) {
            counts.failed++;
            ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "failed", ...capErr(error) });
            if (debug) console.error(`[import/memos/${rowNum}] restore: ${error.message}`);
          } else {
            counts.restored++;
            ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "restored" });
          }
        } else {
          counts.skipped++;
          ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "skipped" });
        }
      } else {
        const wasDeleted = cellBool(r, "isDeleted");
        const { error } = await supabase.from("memos").insert({ ...row, memo_number: memoNumber, is_deleted: wasDeleted });
        if (error) {
          counts.failed++;
          ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "failed", ...capErr(error) });
          if (debug) console.error(`[import/memos/${rowNum}] insert: ${error.message}`);
        } else {
          counts.inserted++;
          ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "inserted" });
        }
      }
    }
  }

  // ---- 4. Transport List (entry_number key; overridden_fields preserved) ----
  const transportSheet = getSheet("transport");
  if (transportSheet) {
    const sheetLabel = sheetNameOf("transport");
    res.recognizedSheets.push(sheetLabel);
    const rows: any[] = normalizeRows(XLSX.utils.sheet_to_json(transportSheet, { defval: "" }));
    const columns = rows[0] ? Object.keys(rows[0]).map((k) => String(k)) : [];
    const counts = res.transports;
    const ops: ImportOperation[] = [];
    const seen = new Set<string>();
    res.sheets.push({
      sheetName: sheetLabel,
      recognized: true,
      rows: rows.length,
      columns,
      processed: 0,
      skippedNoKey: 0,
      operations: ops,
    });

    const opt = (r: Record<string, any>, field: string): string | undefined => {
      const val = cellVal(r, field);
      return val === undefined || val === "" ? undefined : String(val);
    };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as Record<string, any>;
      const rowNum = i + 2;
      const entryNumber = cellStr(r, "entryNumber");
      if (!entryNumber) {
        counts.failed++;
        res.sheets[res.sheets.length - 1].skippedNoKey++;
        ops.push({ sheet: sheetLabel, row: rowNum, key: "", operation: "failed" });
        continue;
      }
      const key = entryNumber;
      if (seen.has(key.toLowerCase())) {
        counts.duplicate++;
        ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "duplicate" });
        continue;
      }
      seen.add(key.toLowerCase());

      const input: Partial<TransportEntry> = {
        entryNumber,
        dispatchDate: cellDate(r, "dispatchDate"),
        fromLocation: cellStr(r, "fromLocation"),
        toLocation: cellStr(r, "toLocation"),
        transportName: cellStr(r, "transportName"),
        truckNumber: normalizeTruckNumber(cellStr(r, "truckNumber")),
        driverName: cellStr(r, "driverName"),
        ownerName: cellStr(r, "ownerName"),
        ownerPhone: cellStr(r, "ownerPhone"),
        consigneeName: cellStr(r, "consigneeName"),
        materialName: cellStr(r, "materialName"),
        weightTons: cellNum(r, "weightTons"),
        ratePerTon: cellNum(r, "ratePerTon"),
        netFreight: cellNum(r, "netFreight"),
        advance: cellNum(r, "advance"),
        balance: cellNum(r, "balance"),
        unloadingDate: cellDate(r, "unloadingDate"),
        haltingDate: cellDate(r, "haltingDate"),
        haltingCharge: cellNum(r, "haltingCharge"),
        lrReceivedDate: cellDate(r, "lrReceivedDate"),
        lrSubmittedDate: cellDate(r, "lrSubmittedDate"),
        description: opt(r, "description"),
        gcNo: opt(r, "gcNo"),
        totalHire: cellNum(r, "totalHire"),
        paidAt: opt(r, "paidAt"),
        localDriverGuide: cellNum(r, "localDriverGuide"),
        commission: cellNum(r, "commission"),
        loadingCharges: cellNum(r, "loadingCharges"),
        tds: cellNum(r, "tds"),
        goodsMamuli: cellNum(r, "goodsMamuli"),
        totalExpenses: cellNum(r, "totalExpenses"),
        paidBy: cellStr(r, "paidBy"),
        paymentMethod: cellStr(r, "paymentMethod"),
        finalPayable: cellNum(r, "finalPayable"),
        finalPaymentDate: cellDate(r, "finalPaymentDate"),
        status: (cellStr(r, "status") || "Dispatched") as TransportEntry["status"],
        remarks: opt(r, "remarks"),
        isDeleted: cellBool(r, "isDeleted"),
      };
      let overridden: Record<string, boolean> | undefined;
      {
        const raw = cellVal(r, "overriddenFields");
        if (typeof raw === "string" && raw.trim()) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") overridden = parsed as Record<string, boolean>;
          } catch {
            // Non-fatal â€” legacy backups may not carry this column.
          }
        }
      }
      const row = entryToRow(input);
      if (overridden) row.overridden_fields = overridden;

      const { data: found, error: findErr } = await supabase
        .from("transport_list")
        .select("id, is_deleted")
        .eq("entry_number", key)
        .limit(1);
      if (findErr) {
        counts.failed++;
        ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "failed", ...capErr(findErr) });
        if (debug) console.error(`[import/transport/${rowNum}] lookup: ${findErr.message}`);
        continue;
      }
      const existing = (found ?? [])[0];
      if (existing) {
        if (existing.is_deleted) {
          const { error } = await supabase
            .from("transport_list")
            .update({ ...row, is_deleted: false, deleted_at: null })
            .eq("id", existing.id);
          if (error) {
            counts.failed++;
            ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "failed", ...capErr(error) });
            if (debug) console.error(`[import/transport/${rowNum}] restore: ${error.message}`);
          } else {
            counts.restored++;
            ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "restored" });
          }
        } else {
          counts.skipped++;
          ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "skipped" });
        }
      } else {
        const { error } = await supabase
          .from("transport_list")
          .insert({ ...row, entry_number: entryNumber, is_deleted: false });
        if (error) {
          counts.failed++;
          ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "failed", ...capErr(error) });
          if (debug) console.error(`[import/transport/${rowNum}] insert: ${error.message}`);
        } else {
          counts.inserted++;
          ops.push({ sheet: sheetLabel, row: rowNum, key, operation: "inserted" });
        }
      }
    }
  }

  // ---- 5. Settings (restore-able camelCase profile) ----
  const settingsSheet = getSheet("settings");
  if (settingsSheet) {
    const sheetLabel = sheetNameOf("settings");
    res.recognizedSheets.push(sheetLabel);
    const rows: any[] = normalizeRows(XLSX.utils.sheet_to_json(settingsSheet, { defval: "" }));
    res.sheets.push({
      sheetName: sheetLabel,
      recognized: true,
      rows: rows.length,
      columns: rows[0] ? Object.keys(rows[0]).map((k) => String(k)) : [],
      processed: rows.length,
      skippedNoKey: 0,
      operations: [],
    });
    if (rows.length > 0) {
      const s = rows[0] as Record<string, any>;
      const patch: Partial<Settings> = {};
      const pick = (field: string): string | undefined => {
        const anyVal = cellVal(s, field);
        return anyVal === undefined || anyVal === null ? undefined : String(anyVal);
      };
      const companyName = pick("companyNameSettings");
      const address = pick("addressSettings");
      const phone = pick("phoneSettings");
      const email = pick("emailSettings");
      const website = pick("websiteSettings");
      const logoUrl = pick("logoUrlSettings");
      const gst = pick("gstSettings");
      const jurisdictionText = pick("jurisdictionTextSettings");
      const terms = pick("termsSettings");
      const darkModeRaw = pick("darkModeSettings");
      if (companyName !== undefined) patch.companyName = companyName;
      if (address !== undefined) patch.address = address;
      if (phone !== undefined) patch.phone = phone;
      if (email !== undefined) patch.email = email;
      if (website !== undefined) patch.website = website;
      if (logoUrl !== undefined) patch.logoUrl = logoUrl;
      if (gst !== undefined) patch.gst = gst;
      if (jurisdictionText !== undefined) patch.jurisdictionText = jurisdictionText;
      if (terms !== undefined) patch.terms = terms;
      if (darkModeRaw !== undefined)
        patch.darkMode = String(darkModeRaw).toLowerCase() === "true" || darkModeRaw === "true";
      if (Object.keys(patch).length > 0) {
        try {
          await updateSettings(patch);
          res.settingsUpdated = true;
        } catch (e) {
          console.error("[import/settings] failed:", e);
        }
      }
    }
  }

  // Every sheet that was not claimed by a supported kind gets an honest report:
  // row count + the headers we saw, so "no supported worksheets" is never a
  // silent zero — the UI can distinguish a truly blank sheet from an
  // unrecognized-but-populated one.
  res.unknownSheets = wb.SheetNames.filter((_, i) => !claimed.has(i));
  for (const n of res.unknownSheets) {
    const ws = wb.Sheets[n];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
    const headers = ((grid[0] ?? []) as any[]).map((x) => String(x)).filter((x) => x !== "");
    res.sheets.push({
      sheetName: n,
      recognized: false,
      rows: Math.max(0, grid.length - (headers.length ? 1 : 0)),
      columns: headers,
      processed: 0,
      skippedNoKey: 0,
      operations: [],
    });
  }

  // Refresh the UI stores (both dataStore and transport list re-query via realtime,
  // but this guarantees an immediate refresh regardless of subscription timing).
  try {
    emit();
  } catch {
    // Non-fatal: subscriptions clean up lazily.
  }
  try {
    emitTransport();
  } catch {
    // Non-fatal.
  }

  if (debug) {
    console.info("[import] result:", res);
  }
  return res;
}