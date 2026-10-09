import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { useStoreData } from "@/lib/useStore";
import {
  getTrucks, getConsignees, createMemo, updateMemo, getMemo, peekNextMemoNumber,
  ensureConsigneeExists, ensureTruckExists, syncMemoToTransport,
  ALL_MEMO_STATUSES,
  type FleetTruck, type Consignee, type MemoStatus, type MemoInput,
} from "@/lib/dataStore";
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
import { ensureTransportEntryForMemo } from "@/lib/transportListStore";
import { useAuth, isSuperAdmin } from "@/lib/AuthContext";

/** localStorage key holding the in-progress (unsaved) New Memo form. */
const DRAFT_CACHE_KEY = "srl:new-memo:in-progress";

/**
 * The unsaved-draft payload. The memo number is stored explicitly so that
 * reopening the page restores the SAME working memo number instead of
 * computing a new one. The memo counter is never advanced by merely opening
 * the page or saving a draft — only by actually saving the memo (createMemo).
 */
type DraftCache = {
  memoNumber: string;
  form: MemoInput;
};

const CREATE_STATUSES: MemoStatus[] = ["Dispatched", "Delivered", "Payment Pending", "LR Received", "LR Submitted", "Completed"];

type Search = { edit?: string };
export const Route = createFileRoute("/new-memo")({
  component: NewMemo,
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

const emptyForm = (): MemoInput => ({
  dispatchDate: new Date().toISOString(),
  fromLocation: "",
  toLocation: "",
  // Default starting value for the Consignee field on a NEW memo. It is only a
  // seed — the field stays fully editable (append/edit/replace) and the value
  // the user saves is what gets persisted. Existing memos are never touched:
  // Edit mode loads the stored value instead of this default.
  consignor: "As per the challan",
  transportName: "",
  consigneeId: "",
  truckId: "",
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
  internalNotes: "",
});

function NewMemo() {
  const { edit } = Route.useSearch();
  const nav = useNavigate();
  const { profile } = useAuth();
  const admin = isSuperAdmin(profile);
  const { data: trucks } = useStoreData<FleetTruck[]>(() => getTrucks(), []);
  const { data: consignees } = useStoreData<Consignee[]>(() => getConsignees(), []);
  const [nextNum, setNextNum] = useState("");
  const [form, setForm] = useState<MemoInput>(emptyForm());
  const [dirty, setDirty] = useState(false);
  const [freightOverride, setFreightOverride] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!edit) {
      // Restore any in-progress form the user left behind, INCLUDING its memo
      // number. Opening the page must not consume or regenerate the counter.
      let draft: DraftCache | null = null;
      try {
        const cached = localStorage.getItem(DRAFT_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as Partial<DraftCache>;
          if (parsed && typeof parsed === "object" && parsed.form) {
            draft = { memoNumber: parsed.memoNumber ?? "", form: parsed.form };
          } else if (parsed && typeof parsed === "object" && (parsed as MemoInput).dispatchDate) {
            // Legacy bare-form cache (no memo number stored). Restore the data
            // and fall through to peeking the next number for the preview.
            const legacy = parsed as MemoInput;
            const memoNumber = (parsed as Record<string, unknown>).memoNumber as string | undefined;
            draft = { memoNumber: memoNumber ?? "", form: legacy };
          }
        }
      } catch {
        localStorage.removeItem(DRAFT_CACHE_KEY);
      }

      if (draft && draft.form) {
        const restored = { ...emptyForm(), ...draft.form };
        setForm(restored);
        // A restored draft may carry a manually-typed Net Freight — keep the
        // override on so the auto-calc effect cannot silently overwrite it.
        setFreightOverride(Math.abs((restored.netFreight || 0) - Math.round((restored.weightTons || 0) * (restored.ratePerTon || 0))) > 0.01);
        if (draft.memoNumber) {
          setNextNum(draft.memoNumber);
        } else {
          peekNextMemoNumber().then(setNextNum);
        }
        toast.info("Restored your unsaved memo");
      } else {
        // Fresh start — show the next number as a PREVIEW only. peekNextMemoNumber
        // reads the counter and does NOT increment/reserve it; the permanent
        // increment happens solely in createMemo() at save time.
        peekNextMemoNumber().then(setNextNum);
      }
      return;
    }

    // Edit mode: keep the existing memo number — never generate/increment.
    getMemo(edit).then((m) => {
      if (m) {
        const { id, memoNumber, isDeleted, createdAt, updatedAt, deletedAt, ...rest } = m;
        void id; void memoNumber; void isDeleted; void createdAt; void updatedAt; void deletedAt;
        setForm(rest);
        // Keep a stored manual Net Freight: opening for edit must NOT let the
        // auto-calc effect recompute it (and later save the new value).
        setFreightOverride(Math.abs((rest.netFreight || 0) - Math.round((rest.weightTons || 0) * (rest.ratePerTon || 0))) > 0.01);
        setNextNum(memoNumber);
      }
    });
  }, [edit]);

  // auto-calc
  useEffect(() => {
    setForm((f) => {
      const netFreight = freightOverride ? f.netFreight : Math.round((f.weightTons || 0) * (f.ratePerTon || 0));
      const unpaid = netFreight - (f.advance || 0);
      const settled = f.status === "Completed" || !!f.finalPaymentDate;
      const balance = settled ? 0 : unpaid;
      const totalExpenses = (f.commission || 0) + (f.loadingCharges || 0) + (f.goodsMamuli || 0) + (f.tds || 0) + (f.localDriverGuide || 0);
      const finalPayable = unpaid - totalExpenses;
      const totalHire = f.totalHire || 0;
      return { ...f, netFreight, balance, totalExpenses, finalPayable, totalHire };
    });
  }, [
    form.weightTons,
    form.ratePerTon,
    form.advance,
    form.commission,
    form.loadingCharges,
    form.goodsMamuli,
    form.tds,
    form.localDriverGuide,
    form.status,
    form.finalPaymentDate,
    freightOverride,
  ]);

  // Continuously cache the in-progress form (new memos only), including the
  // working memo number so reopening restores the same number.
  useEffect(() => {
    if (edit || !dirty) return;
    if (!nextNum) return; // wait until the preview memo number is resolved
    try {
      const cache: DraftCache = { memoNumber: nextNum, form };
      localStorage.setItem(DRAFT_CACHE_KEY, JSON.stringify(cache));
    } catch { /* quota — ignore */ }
  }, [form, nextNum, dirty, edit]);

  // PART 9: Auto-complete memo when final payment date is set.
  useEffect(() => {
    if (form.finalPaymentDate && form.status !== "Completed") {
      setForm((f) => ({ ...f, status: "Completed" as MemoStatus }));
    }
  }, [form.finalPaymentDate]);

  // Keep status in step with the LR workflow: setting an LR Received/Submitted
  // date promotes an earlier status forward (never demotes a manual selection
  // like Completed / Payment Pending), so the Register List status filters
  // always reflect the stored data immediately when a memo is edited.
  useEffect(() => {
    setForm((f) => {
      if (!f.lrSubmittedDate && !f.lrReceivedDate) return f;
      if (f.status === "Completed" || f.status === "Payment Pending") return f;
      if (f.lrSubmittedDate && (f.status === "Dispatched" || f.status === "Delivered" || f.status === "LR Received")) {
        return { ...f, status: "LR Submitted" as MemoStatus };
      }
      // lr_submitted cleared but lr_received still set: a memo that had advanced
      // to LR Submitted moves back to LR Received (submission is not final).
      if (!f.lrSubmittedDate && f.lrReceivedDate && (f.status === "Dispatched" || f.status === "Delivered" || f.status === "LR Submitted")) {
        return { ...f, status: "LR Received" as MemoStatus };
      }
      return f;
    });
  }, [form.lrReceivedDate, form.lrSubmittedDate]);

  // warn on unload
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const set = <K extends keyof MemoInput>(k: K, v: MemoInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const paidByOptions = useMemo(() => ["SRL", "KAREEM"], []);

  const submit = async (draft = false) => {
    if (saving) return;
    if (!admin) {
      toast.error("Viewers have read-only access. Only a Super Admin can create or edit memos.");
      return;
    }
    if (!form.truckNumber) return toast.error("Truck is required");
    if (!form.consigneeName) return toast.error("Consignor is required");
    if (!form.ratePerTon) return toast.error("Rate/Ton is required");
    if (!form.dispatchDate) return toast.error("Dispatch date is required");
    setSaving(true);
    try {
      // Normalize the truck number (uppercase) at save time so historical
      // lowercase values are safely normalized whenever a memo is edited.
      const normalizedTruck = normalizeTruckNumber(form.truckNumber);
      let finalForm: MemoInput & { isDraft: boolean } = { ...form, truckNumber: normalizedTruck || form.truckNumber, isDraft: draft };

      const [consigneeId, truckId] = await Promise.all([
        ensureConsigneeExists(form.consigneeName),
        ensureTruckExists(normalizedTruck || form.truckNumber, form.driverName, form.ownerName, form.ownerPhone),
      ]);
      finalForm.consigneeId = consigneeId || finalForm.consigneeId;
      finalForm.truckId = truckId || finalForm.truckId;

      if (edit) {
        const updated = await updateMemo(edit, finalForm);
        localStorage.removeItem(DRAFT_CACHE_KEY);
        toast.success(draft ? "Draft saved" : "Memo updated");
        setDirty(false);
        if (!draft) {
          // Finalizing a draft must create its transport entry — syncMemoToTransport
          // only updates an EXISTING row, so drafts (which have none) would never
          // appear in the Transport List otherwise.
          const m = await getMemo(edit);
          if (m?.isDraft) {
            await ensureTransportEntryForMemo({ ...m, ...finalForm, isDraft: false });
          } else {
            await syncMemoToTransport(edit, finalForm);
          }
        }
        nav({ to: draft ? "/register" : "/memo/$id", params: { id: edit } as never });
      } else {
        const created = await createMemo(finalForm);
        localStorage.removeItem(DRAFT_CACHE_KEY);
        toast.success(draft ? `Draft ${created.memoNumber} saved` : `Memo ${created.memoNumber} created`);
        setDirty(false);
        if (!draft) await ensureTransportEntryForMemo(created);
        if (draft) nav({ to: "/register" });
        else nav({ to: "/memo/$id", params: { id: created.id } });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!admin) {
    return (
      <AppShell title={edit ? "Edit Memo" : "New Memo"} breadcrumb={`Home / ${edit ? "Edit Memo" : "New Memo"}`}>
        <div className="card-surface p-6 text-center text-muted-foreground">
          Viewers have read-only access. Memos can only be created or edited by a Super Admin.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={edit ? "Edit Memo" : "New Memo"} breadcrumb={`Home / ${edit ? "Edit Memo" : "New Memo"}`}>
      <div className="space-y-5 pb-24">
        <Section title="Memo Information">
          <Field label="Memo Number"><Input value={nextNum} readOnly className="h-11 bg-muted font-mono" /></Field>
          <Field label="Dispatch Date" required>
            <Input type="date" className="h-11" value={toInputDate(form.dispatchDate)} onChange={(e) => set("dispatchDate", fromInputDate(e.target.value))} />
          </Field>
          <Field label="Status" required>
            <Select value={form.status} onValueChange={(v) => set("status", v as MemoStatus)}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{(edit ? ALL_MEMO_STATUSES : CREATE_STATUSES).map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}</SelectContent>
            </Select>
          </Field>
          <Field label="Remarks"><Input className="h-11" value={form.remarks} onChange={(e) => set("remarks", e.target.value)} /></Field>
        </Section>

        <Section title="Transport Information">
          <Field label="From"><Input className="h-11" value={form.fromLocation} onChange={(e) => set("fromLocation", e.target.value)} /></Field>
          <Field label="To"><Input className="h-11" value={form.toLocation} onChange={(e) => set("toLocation", e.target.value)} /></Field>
          <Field label="G.C. No."><Input className="h-11" value={form.gcNo || ""} onChange={(e) => set("gcNo", e.target.value)} /></Field>
          <Field label="Consignee">
            <Input
              className="h-11"
              value={form.consignor || ""}
              placeholder="Source / originating party consigning the goods"
              onChange={(e) => set("consignor", e.target.value)}
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
          <Field label="Article"><Input className="h-11" value={form.materialName} onChange={(e) => set("materialName", e.target.value)} /></Field>
          <Field label="Weight (tons)"><NumericInput step="0.01" allowEmpty value={form.weightTons} onValueChange={(v) => set("weightTons", v)} /></Field>
          <Field label="Rate / Ton (₹)" required><NumericInput value={form.ratePerTon || 0} onValueChange={(v) => set("ratePerTon", v)} /></Field>
          <Field label="Unloading Date"><Input className="h-11" type="date" value={toInputDate(form.unloadingDate)} onChange={(e) => set("unloadingDate", fromInputDate(e.target.value))} /></Field>
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
          <Field label="Total Hire (₹)"><NumericInput value={form.totalHire || 0} onValueChange={(v) => set("totalHire", v)} /></Field>
          <Field label="Advance (₹)"><NumericInput value={form.advance || 0} onValueChange={(v) => set("advance", v)} /></Field>
          <Field label="Balance (₹)"><Input className="h-11" value={form.balance} readOnly /></Field>
          <Field label="Commission (₹)"><NumericInput value={form.commission || 0} onValueChange={(v) => set("commission", v)} /></Field>
          <Field label="Loading Charges (₹)"><NumericInput value={form.loadingCharges || 0} onValueChange={(v) => set("loadingCharges", v)} /></Field>
          <Field label="TDS (₹)"><NumericInput value={form.tds || 0} onValueChange={(v) => set("tds", v)} /></Field>
          <Field label="Local Driver / Guide (₹)"><NumericInput value={form.localDriverGuide || 0} onValueChange={(v) => set("localDriverGuide", v)} /></Field>
          <Field label="Payment Mamuli (₹)"><NumericInput value={form.goodsMamuli || 0} onValueChange={(v) => set("goodsMamuli", v)} /></Field>
          <Field label="Total Expenses (₹)"><Input className="h-11" value={form.totalExpenses} readOnly /></Field>
          <Field label="Paid At"><Input className="h-11" value={form.paidAt || ""} onChange={(e) => set("paidAt", e.target.value)} placeholder="e.g. Visakhapatnam" /></Field>
          <Field label="Paid By">
            <Select value={form.paidBy} onValueChange={(v) => set("paidBy", v)}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{paidByOptions.map((p) => (<SelectItem key={p} value={p}>{p}</SelectItem>))}</SelectContent>
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
          <div className="md:col-span-2 lg:col-span-3">
            <Field label="Internal Notes (never printed)"><Textarea rows={2} value={form.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} /></Field>
          </div>
        </Section>
      </div>

      {/* Fixed action bar */}
      <div className="fixed bottom-0 left-60 right-0 z-10 flex justify-end gap-2 border-t bg-background/95 px-8 py-3 backdrop-blur">
        <Button variant="outline" disabled={saving} onClick={() => { if (!dirty || confirm("Discard unsaved changes?")) nav({ to: "/register" }); }}>Cancel</Button>
        <Button variant="outline" disabled={saving} onClick={() => submit(true)}>{saving ? "Saving…" : "Save Draft"}</Button>
        <Button disabled={saving} onClick={() => submit(false)}>{saving ? "Saving…" : "Save Memo"}</Button>
      </div>
    </AppShell>
  );
}
