import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { useStoreData } from "@/lib/useStore";
import { getTrucks, getConsignees, type FleetTruck, type Consignee } from "@/lib/dataStore";
import {
  updateTransportEntry, getTransportEntry,
  ALL_TRANSPORT_STATUSES, type TransportStatus, type TransportEntryInput,
} from "@/lib/transportListStore";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/Combobox";
import { toInputDate, fromInputDate, normalizeTruckNumber } from "@/lib/format";
import { toast } from "sonner";
import { useAuth, isSuperAdmin } from "@/lib/AuthContext";

export const Route = createFileRoute("/transport-edit/$id")({
  component: TransportEditPage,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-surface p-6">
      <div className="section-title mb-2">{title}</div>
      <div className="mb-5 border-b" />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium">{label} {required && <span className="text-red-500">*</span>}</Label>
      {children}
    </div>
  );
}

function TransportEditPage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const { profile } = useAuth();
  const admin = isSuperAdmin(profile);
  const { data: trucks } = useStoreData<FleetTruck[]>(() => getTrucks(), []);
  const { data: consignees } = useStoreData<Consignee[]>(() => getConsignees(), []);
  const [memoNumber, setMemoNumber] = useState("");
  const [form, setForm] = useState<TransportEntryInput | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set());
  // The values as originally loaded from the DB. Used to detect which fields the
  // user ACTUALLY changed, so only real edits become persistent overrides.
  const originalRef = useRef<TransportEntryInput | null>(null);

  /** app camelCase field → transport_list column name */
  const FIELD_TO_COL: Record<string, string> = {
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
    haltingCharge: "halting_charge",
    unloadingDate: "unloading_date",
    lrReceivedDate: "lr_received_date",
    lrSubmittedDate: "lr_submitted_date",
    description: "description",
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
  };

  useEffect(() => {
    getTransportEntry(id)
      .then((m) => {
        if (!m) { toast.error("Transport entry not found"); return; }
        const { id: _i, entryNumber, isDeleted: _d, createdAt: _c, updatedAt: _u, deletedAt: _x, ...rest } = m;
        void _i; void _d; void _c; void _u; void _x;
        // Stored values are loaded as-is — NO recalculation on load.
        setForm(rest);
        originalRef.current = rest;
        setMemoNumber(entryNumber);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load entry"));
  }, [id]);

  const set = <K extends keyof TransportEntryInput>(k: K, v: TransportEntryInput[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    const col = FIELD_TO_COL[k as string];
    if (col) setEditedFields((s) => new Set(s).add(col));
    setDirty(true);
  };

  /** Only triggered when the user actively edits an amount field — never on load. */
  type NumKey = "weightTons" | "ratePerTon" | "advance" | "commission" | "loadingCharges" | "tds" | "goodsMamuli" | "haltingCharge";

  /** PART 9: auto-complete when final payment date is set. */
  useEffect(() => {
    if (form?.finalPaymentDate && form.status !== "Completed") {
      setForm((f) => (f ? { ...f, status: "Completed" as TransportStatus } : f));
    }
  }, [form?.finalPaymentDate]);

  // Completion rule: a settled entry always shows balance 0 in the form too.
  useEffect(() => {
    setForm((f) =>
      f && f.status === "Completed" && Number(f.balance) !== 0 ? { ...f, balance: 0 } : f,
    );
  }, [form?.status]);

  const setAndRecalc = (k: NumKey, v: number) => {
    setForm((f) => {
      if (!f) return f;
      const next = { ...f, [k]: v };
      const netFreight = Math.round((next.weightTons || 0) * (next.ratePerTon || 0));
      const unpaid = netFreight - (next.advance || 0);
      const settled = next.status === "Completed" || !!next.finalPaymentDate;
      const balance = settled ? 0 : unpaid;
      const totalExpenses =
        (next.commission || 0) + (next.loadingCharges || 0) + (next.tds || 0) +
        (next.goodsMamuli || 0) + (next.haltingCharge || 0);
      const finalPayable = unpaid - totalExpenses;
      return { ...next, netFreight, balance, totalExpenses, finalPayable };
    });
    const col = FIELD_TO_COL[k as string];
    if (col) setEditedFields((s) => new Set(s).add(col));
    setDirty(true);
  };

  const submit = async () => {
    if (!form) return;
    if (saving) return;
    if (!admin) {
      toast.error("Viewers have read-only access. Only a Super Admin can edit transport entries.");
      return;
    }
    if (!form.truckNumber) return toast.error("Truck is required");
    if (!form.materialName) return toast.error("Material is required");
    if (!form.dispatchDate) return toast.error("Dispatch date is required");
    setSaving(true);
    try {
      // Value-based override detection: a field only becomes PERMANENTLY
      // overridden if the user edited it AND its value actually changed from the
      // originally loaded value. This guarantees:
      //   - untouched fields are never marked overridden (tracked for data-safety),
      //   - auto-derived fields (netFreight/balance/totalExpenses/finalPayable)
      //     are never frozen unless explicitly edited,
      //   - previously overridden fields are always preserved by updateTransportEntry.
      //
      // NOTE: overridden_fields is retained for data-safety/display purposes.
      // Calculation fields no longer sync from Register → Transport at all,
      // so the override flag is a record of independent Transport edits.
      const original = originalRef.current;
      const actualOverrides: string[] = [];
      if (original) {
        for (const [key, col] of Object.entries(FIELD_TO_COL)) {
          if (!editedFields.has(col)) continue;
          const before = (original as Record<string, unknown>)[key];
          const after = (form as unknown as Record<string, unknown>)[key];
          if (String(before ?? "") !== String(after ?? "")) actualOverrides.push(col);
        }
      } else {
        actualOverrides.push(...Array.from(editedFields));
      }
      // Writes ONLY to transport_list — the originating memo is never touched.
      await updateTransportEntry(id, { ...form, truckNumber: normalizeTruckNumber(form.truckNumber) || form.truckNumber }, actualOverrides);
      toast.success("Transport entry updated");
      setDirty(false);
      nav({ to: "/transport-list" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!form) {
    return <AppShell title="Edit Transport Entry"><div className="card-surface p-8 text-center">Loading…</div></AppShell>;
  }

  if (!admin) {
    return (
      <AppShell title={`Edit Transport Entry ${memoNumber}`} breadcrumb="Home / Transport List / Edit Entry">
        <div className="card-surface p-6 text-center text-muted-foreground">
          Viewers have read-only access. Transport entries can only be edited by a Super Admin.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={`Edit Transport Entry ${memoNumber}`}
      breadcrumb="Home / Transport List / Edit Entry"
    >
      <div className="space-y-5 pb-24">
        <Section title="Entry Information">
          <Field label="Memo Number"><Input value={memoNumber} readOnly className="h-11 bg-muted font-mono" /></Field>
          <Field label="Dispatch Date" required>
            <Input type="date" className="h-11" value={toInputDate(form.dispatchDate)} onChange={(e) => set("dispatchDate", fromInputDate(e.target.value))} />
          </Field>
          <Field label="Status" required>
            <Select value={form.status} onValueChange={(v) => set("status", v as TransportStatus)}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{ALL_TRANSPORT_STATUSES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}</SelectContent>
            </Select>
          </Field>
          <Field label="Remarks"><Input className="h-11" value={form.remarks ?? ""} onChange={(e) => set("remarks", e.target.value)} /></Field>
        </Section>

        <Section title="Transport Information">
          <Field label="From"><Input className="h-11" value={form.fromLocation} onChange={(e) => set("fromLocation", e.target.value)} /></Field>
          <Field label="To"><Input className="h-11" value={form.toLocation} onChange={(e) => set("toLocation", e.target.value)} /></Field>
          <Field label="Transport Name">
            <Combobox
              options={Array.from(new Set(["SRL Direct", "Kareem Transports", form.transportName].filter(Boolean))).map((n) => ({ value: n, label: n }))}
              value={form.transportName}
              onChange={(v) => set("transportName", v)}
              placeholder="Search or type transport…"
              allowCustom
              createLabel="Use"
            />
          </Field>
          <Field label="Consignor">
            <Combobox
              options={(consignees ?? []).map((c) => ({ value: c.companyName, label: c.companyName, keywords: `${c.city} ${c.contactPerson}` }))}
              value={form.consigneeName}
              onChange={(v) => set("consigneeName", v)}
              placeholder="Search or type consignor…"
              allowCustom
              createLabel="Use"
            />
          </Field>
        </Section>

        <Section title="Vehicle Information">
          <Field label="Truck Number" required>
            <Combobox
              options={(trucks ?? []).map((t) => ({ value: t.truckNumber, label: t.truckNumber, keywords: `${t.driverName} ${t.ownerName}` }))}
              value={form.truckNumber}
              onChange={(v) => set("truckNumber", normalizeTruckNumber(v))}
              placeholder="Search or type truck number…"
              allowCustom
              createLabel="Use"
            />
          </Field>
          <Field label="Driver Name"><Input className="h-11" value={form.driverName} onChange={(e) => set("driverName", e.target.value)} /></Field>
          <Field label="Owner Name"><Input className="h-11" value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} /></Field>
          <Field label="Owner Phone"><Input className="h-11" value={form.ownerPhone} onChange={(e) => set("ownerPhone", e.target.value)} /></Field>
        </Section>

        <Section title="Goods Information">
          <Field label="Material" required><Input className="h-11" value={form.materialName} onChange={(e) => set("materialName", e.target.value)} /></Field>
          <Field label="Weight (tons)" required>
            <NumericInput step="0.01" value={form.weightTons ?? 0} onValueChange={(v) => setAndRecalc("weightTons", v)} />
          </Field>
          <Field label="Rate/Ton (Transport) (₹)" required>
            <NumericInput value={form.ratePerTon ?? 0} onValueChange={(v) => setAndRecalc("ratePerTon", v)} />
          </Field>
          <Field label="Unloading Date"><Input className="h-11" type="date" value={toInputDate(form.unloadingDate)} onChange={(e) => set("unloadingDate", fromInputDate(e.target.value))} /></Field>
          <Field label="Halting Charge (₹)"><NumericInput value={form.haltingCharge ?? 0} onValueChange={(v) => setAndRecalc("haltingCharge", v)} /></Field>
          <Field label="LR Received Date"><Input className="h-11" type="date" value={toInputDate(form.lrReceivedDate)} onChange={(e) => set("lrReceivedDate", fromInputDate(e.target.value))} /></Field>
          <Field label="LR Submitted Date"><Input className="h-11" type="date" value={toInputDate(form.lrSubmittedDate)} onChange={(e) => set("lrSubmittedDate", fromInputDate(e.target.value))} /></Field>
          <div className="md:col-span-2 lg:col-span-3">
            <Field label="Description"><Textarea rows={2} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} /></Field>
          </div>
        </Section>

        <Section title="Payment Information">
          <Field label="Net Freight (₹)"><NumericInput value={form.netFreight ?? 0} onValueChange={(v) => set("netFreight", v)} /></Field>
          <Field label="Advance (₹)"><NumericInput value={form.advance ?? 0} onValueChange={(v) => setAndRecalc("advance", v)} /></Field>
          <Field label="Balance (₹)"><NumericInput value={form.balance ?? 0} onValueChange={(v) => set("balance", v)} /></Field>
          <Field label="Commission (₹)"><NumericInput value={form.commission ?? 0} onValueChange={(v) => setAndRecalc("commission", v)} /></Field>
          <Field label="Loading Charges (₹)"><NumericInput value={form.loadingCharges ?? 0} onValueChange={(v) => setAndRecalc("loadingCharges", v)} /></Field>
          <Field label="TDS (₹)"><NumericInput value={form.tds ?? 0} onValueChange={(v) => setAndRecalc("tds", v)} /></Field>
          <Field label="Goods Mamuli (₹)"><NumericInput value={form.goodsMamuli ?? 0} onValueChange={(v) => setAndRecalc("goodsMamuli", v)} /></Field>
          <Field label="Total Expenses (₹)"><NumericInput value={form.totalExpenses ?? 0} onValueChange={(v) => set("totalExpenses", v)} /></Field>
          <Field label="Paid By">
            <Select value={form.paidBy} onValueChange={(v) => set("paidBy", v)}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SRL">Sahil</SelectItem>
                <SelectItem value="KAREEM">Kareem</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Payment Method">
            <Select value={form.paymentMethod} onValueChange={(v) => set("paymentMethod", v)}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="PhonePe">PhonePe</SelectItem>
                <SelectItem value="GPay">GPay</SelectItem>
                <SelectItem value="Paytm">Paytm</SelectItem>
                <SelectItem value="Axis Bank – Current">Axis Bank – Current</SelectItem>
                <SelectItem value="Axis Bank – Savings">Axis Bank – Savings</SelectItem>
                <SelectItem value="HDFC Bank – Current">HDFC Bank – Current</SelectItem>
                <SelectItem value="HDFC Bank – Savings">HDFC Bank – Savings</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Section>

        <Section title="Internal Financial Details (Admin Only)">
          <Field label="Final Payable (₹)"><NumericInput value={form.finalPayable ?? 0} onValueChange={(v) => set("finalPayable", v)} /></Field>
          <Field label="Final Payment Date"><Input className="h-11" type="date" value={toInputDate(form.finalPaymentDate)} onChange={(e) => set("finalPaymentDate", e.target.value ? new Date(e.target.value + "T00:00:00").toISOString() : "")} /></Field>
        </Section>
      </div>

      <div className="fixed bottom-0 left-60 right-0 z-10 flex justify-end gap-2 border-t bg-background/95 px-8 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => { if (!dirty || confirm("Discard unsaved changes?")) nav({ to: "/transport-list" }); }}>Cancel</Button>
        <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
      </div>
    </AppShell>
  );
}
