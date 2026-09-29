import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { useStoreData } from "@/lib/useStore";
import {
  getTrucks, getConsignees, ensureConsigneeExists, ensureTruckExists,
  type FleetTruck, type Consignee,
} from "@/lib/dataStore";
import {
  createTransportEntry, updateTransportEntry, getTransportEntry, peekNextTransportEntryNumber,
  ALL_TRANSPORT_STATUSES, type TransportStatus, type TransportEntryInput,
} from "@/lib/transportListStore";
import { useEffect, useMemo, useState } from "react";
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

type Search = { edit?: string };
export const Route = createFileRoute("/new-transport")({
  component: NewTransportEntry,
  validateSearch: (s: Record<string, unknown>): Search => ({ edit: typeof s.edit === "string" ? s.edit : undefined }),
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

const emptyForm = (): TransportEntryInput => ({
  dispatchDate: new Date().toISOString(),
  fromLocation: "",
  toLocation: "",
  transportName: "",
  truckNumber: "",
  consigneeName: "",
  driverName: "",
  ownerName: "",
  ownerPhone: "",
  materialName: "",
  gcNo: "",
  weightTons: 0,
  ratePerTon: 0,
  netFreight: 0,
  totalHire: 0,
  advance: 0,
  balance: 0,
  haltingCharge: 0,
  commission: 0,
  loadingCharges: 0,
  tds: 0,
  goodsMamuli: 0,
  localDriverGuide: 0,
  totalExpenses: 0,
  paidBy: "SRL",
  paidAt: "",
  paymentMethod: "Cash",
  finalPayable: 0,
  status: "Dispatched",
  remarks: "",
  description: "",
});

function NewTransportEntry() {
  const { edit } = Route.useSearch();
  const nav = useNavigate();
  const { profile } = useAuth();
  const admin = isSuperAdmin(profile);
  const { data: trucks } = useStoreData<FleetTruck[]>(() => getTrucks(), []);
  const { data: consignees } = useStoreData<Consignee[]>(() => getConsignees(), []);
  const [nextNum, setNextNum] = useState("");
  const [form, setForm] = useState<TransportEntryInput>(emptyForm());
  const [dirty, setDirty] = useState(false);
  const [freightOverride, setFreightOverride] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (edit) {
      getTransportEntry(edit).then((m) => {
        if (m) {
          const { id, entryNumber, isDeleted, createdAt, updatedAt, deletedAt, ...rest } = m;
          void id; void isDeleted; void createdAt; void updatedAt; void deletedAt;
          setForm(rest);
          // Keep a stored manual Net Freight: opening for edit must NOT let the
          // auto-calc effect recompute it (and later save the new value).
          setFreightOverride(Math.abs((rest.netFreight || 0) - Math.round((rest.weightTons || 0) * (rest.ratePerTon || 0))) > 0.01);
          setNextNum(entryNumber);
        }
      });
    } else {
      peekNextTransportEntryNumber().then(setNextNum);
    }
  }, [edit]);

  useEffect(() => {
    setForm((f) => {
      const netFreight = freightOverride ? f.netFreight : Math.round((f.weightTons || 0) * (f.ratePerTon || 0));
      const balance = netFreight - (f.advance || 0);
      const totalExpenses =
        (f.commission || 0) + (f.loadingCharges || 0) + (f.goodsMamuli || 0) + (f.tds || 0) + (f.haltingCharge || 0);
      const finalPayable = balance - totalExpenses;
      return { ...f, netFreight, balance, totalExpenses, finalPayable };
    });
  }, [form.weightTons, form.ratePerTon, form.advance, form.commission, form.loadingCharges, form.goodsMamuli, form.tds, form.haltingCharge, freightOverride]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const set = <K extends keyof TransportEntryInput>(k: K, v: TransportEntryInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const paidByOptions = useMemo(() => ["SRL", "KAREEM"], []);

  /** PART 9: auto-complete when final payment date is set. */
  useEffect(() => {
    if (form.finalPaymentDate && form.status !== "Completed") {
      setForm((f) => ({ ...f, status: "Completed" as TransportStatus }));
    }
  }, [form.finalPaymentDate]);

  const submit = async () => {
    if (saving) return;
    if (!admin) {
      toast.error("Viewers have read-only access. Only a Super Admin can create or edit transport entries.");
      return;
    }
    if (!form.truckNumber) return toast.error("Truck is required");
    if (!form.consigneeName) return toast.error("Consignor is required");
    if (!form.materialName) return toast.error("Material is required");
    if (!form.weightTons) return toast.error("Weight is required");
    if (!form.ratePerTon) return toast.error("Rate/Ton (Transport) is required");
    if (!form.dispatchDate) return toast.error("Dispatch date is required");
    setSaving(true);
    try {
      const normalizedTruck = normalizeTruckNumber(form.truckNumber);
      const finalForm = { ...form, truckNumber: normalizedTruck || form.truckNumber };
      await ensureConsigneeExists(form.consigneeName);
      await ensureTruckExists(normalizedTruck || form.truckNumber, form.driverName, form.ownerName, form.ownerPhone);
      if (edit) {
        await updateTransportEntry(edit, finalForm);
        toast.success("Transport entry updated");
        setDirty(false);
        nav({ to: "/transport/$id", params: { id: edit } });
      } else {
        const created = await createTransportEntry(finalForm);
        toast.success(`Entry ${created.entryNumber} created`);
        setDirty(false);
        nav({ to: "/transport/$id", params: { id: created.id } });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!admin) {
    return (
      <AppShell
        title={edit ? "Edit Transport Entry" : "New Transport Entry"}
        breadcrumb={`Home / Transport List / ${edit ? "Edit Entry" : "New Entry"}`}
      >
        <div className="card-surface p-6 text-center text-muted-foreground">
          Viewers have read-only access. Transport entries can only be created or edited by a Super Admin.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={edit ? "Edit Transport Entry" : "New Transport Entry"}
      breadcrumb={`Home / Transport List / ${edit ? "Edit Entry" : "New Entry"}`}
    >
      <div className="space-y-5 pb-24">
        <Section title="Entry Information">
          <Field label="Entry Number"><Input value={nextNum} readOnly className="h-11 bg-muted font-mono" /></Field>
          <Field label="Dispatch Date" required>
            <Input type="date" className="h-11" value={toInputDate(form.dispatchDate)} onChange={(e) => set("dispatchDate", fromInputDate(e.target.value))} />
          </Field>
          <Field label="Status" required>
            <Select value={form.status} onValueChange={(v) => set("status", v as TransportStatus)}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{ALL_TRANSPORT_STATUSES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}</SelectContent>
            </Select>
          </Field>
          <Field label="Remarks"><Input className="h-11" value={form.remarks} onChange={(e) => set("remarks", e.target.value)} /></Field>
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
          <Field label="Consignor" required>
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
              onChange={(v) => {
                const norm = normalizeTruckNumber(v);
                set("truckNumber", norm);
                const t = trucks?.find((x) => normalizeTruckNumber(x.truckNumber) === norm);
                if (t) setForm((f) => ({ ...f, driverName: t.driverName, ownerName: t.ownerName, ownerPhone: t.ownerPhone }));
              }}
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
          <Field label="Weight (tons)" required><NumericInput step="0.01" value={form.weightTons || 0} onValueChange={(v) => set("weightTons", v)} /></Field>
          <Field label="Rate/Ton (Transport) (₹)" required><NumericInput value={form.ratePerTon || 0} onValueChange={(v) => set("ratePerTon", v)} /></Field>
          <Field label="Unloading Date"><Input className="h-11" type="date" value={toInputDate(form.unloadingDate)} onChange={(e) => set("unloadingDate", fromInputDate(e.target.value))} /></Field>
          <Field label="Halting Charge (₹)"><NumericInput value={form.haltingCharge || 0} onValueChange={(v) => set("haltingCharge", v)} /></Field>
          <Field label="LR Received Date"><Input className="h-11" type="date" value={toInputDate(form.lrReceivedDate)} onChange={(e) => set("lrReceivedDate", fromInputDate(e.target.value))} /></Field>
          <Field label="LR Submitted Date"><Input className="h-11" type="date" value={toInputDate(form.lrSubmittedDate)} onChange={(e) => set("lrSubmittedDate", fromInputDate(e.target.value))} /></Field>
          <div className="md:col-span-2 lg:col-span-3">
            <Field label="Description"><Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
          </div>
        </Section>

        <Section title="Payment Information">
          <Field label="Net Freight (₹)">
            <div className="flex gap-2">
              <NumericInput value={form.netFreight || 0} onValueChange={(v) => { setFreightOverride(true); set("netFreight", v); }} />
              {freightOverride && <Button variant="outline" onClick={() => setFreightOverride(false)}>Auto</Button>}
            </div>
          </Field>
          <Field label="Advance (₹)"><NumericInput value={form.advance || 0} onValueChange={(v) => set("advance", v)} /></Field>
          <Field label="Balance (₹)"><Input className="h-11" value={form.balance} readOnly /></Field>
          <Field label="Commission (₹)"><NumericInput value={form.commission || 0} onValueChange={(v) => set("commission", v)} /></Field>
          <Field label="Loading Charges (₹)"><NumericInput value={form.loadingCharges || 0} onValueChange={(v) => set("loadingCharges", v)} /></Field>
          <Field label="TDS (₹)"><NumericInput value={form.tds || 0} onValueChange={(v) => set("tds", v)} /></Field>
          <Field label="Goods Mamuli (₹)"><NumericInput value={form.goodsMamuli || 0} onValueChange={(v) => set("goodsMamuli", v)} /></Field>
          <Field label="Total Expenses (₹)"><Input className="h-11" value={form.totalExpenses} readOnly /></Field>
          <Field label="Paid By">
            <Select value={form.paidBy} onValueChange={(v) => set("paidBy", v)}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{paidByOptions.map((p) => (<SelectItem key={p} value={p}>{p === "SRL" ? "Sahil" : "Kareem"}</SelectItem>))}</SelectContent>
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
          <Field label="Final Payable (₹)"><NumericInput value={form.finalPayable || 0} onValueChange={(v) => set("finalPayable", v)} /></Field>
          <Field label="Final Payment Date"><Input className="h-11" type="date" value={toInputDate(form.finalPaymentDate)} onChange={(e) => set("finalPaymentDate", fromInputDate(e.target.value))} /></Field>
        </Section>
      </div>

      <div className="fixed bottom-0 left-60 right-0 z-10 flex justify-end gap-2 border-t bg-background/95 px-8 py-3 backdrop-blur">
        <Button variant="outline" disabled={saving} onClick={() => { if (!dirty || confirm("Discard unsaved changes?")) nav({ to: "/transport-list" }); }}>Cancel</Button>
        <Button disabled={saving} onClick={submit}>{saving ? "Saving…" : (edit ? "Save Changes" : "Save Entry")}</Button>
      </div>
    </AppShell>
  );
}
