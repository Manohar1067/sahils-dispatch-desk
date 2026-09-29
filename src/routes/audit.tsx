import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { getAuditLog, type AuditLogEntry } from "@/lib/dataStore";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { Search, Eye, Loader2, RefreshCw } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/audit")({ component: AuditPage });

// Readable labels used in the diff modal
const FIELD_LABELS: Record<string, string> = {
  memoNumber: "Memo #", dispatchDate: "Dispatch Date", fromLocation: "From",
  toLocation: "Destination", transportName: "Transport", consigneeId: "Consignor",
  truckId: "Truck", driverName: "Driver", ownerName: "Owner", ownerPhone: "Owner Phone",
  materialName: "Material", weightTons: "Weight (tons)", ratePerTon: "Rate / Ton",
  netFreight: "Net Freight", advance: "Advance", balance: "Balance", commission: "Commission",
  loadingCharges: "Loading Charges", tds: "TDS", goodsMamuli: "Goods Mamuli",
  totalExpenses: "Total Expenses", paidBy: "Paid By", paymentMethod: "Payment Method",
  finalPayable: "Final Payable", finalPaymentDate: "Final Payment Date",
  unloadingDate: "Unloading Date", lrReceivedDate: "LR Received Date",
  lrSubmittedDate: "LR Submitted Date", status: "Status", remarks: "Remarks",
  description: "Description", internalNotes: "Internal Notes",
  truckNumber: "Truck #", driverPhone: "Driver Phone", insuranceExpiry: "Insurance Expiry",
  companyName: "Company Name", address: "Address", contactPerson: "Contact Person",
  phone: "Phone", city: "City", state: "State",
  logoUrl: "Logo", gst: "GST", email: "Email", website: "Website",
  jurisdictionText: "Jurisdiction", terms: "Terms",
};

const MONEY_FIELDS = new Set([
  "netFreight","advance","balance","commission","loadingCharges","tds","goodsMamuli","totalExpenses","finalPayable","ratePerTon",
]);
const DATE_FIELDS = new Set([
  "dispatchDate","unloadingDate","lrReceivedDate","lrSubmittedDate","finalPaymentDate","insuranceExpiry","deletedAt","createdAt","updatedAt",
]);
const HIDDEN_FIELDS = new Set(["id","createdAt","updatedAt","isDeleted","deletedAt","logoUrl"]);

function pretty(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (DATE_FIELDS.has(field) && typeof value === "string") return formatDate(value);
  if (MONEY_FIELDS.has(field) && typeof value === "number") return formatMoney(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function computeDiff(oldVal: unknown, newVal: unknown): Array<{ label: string; before: string; after: string }> {
  const a = (oldVal ?? {}) as Record<string, unknown>;
  const b = (newVal ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: Array<{ label: string; before: string; after: string }> = [];
  keys.forEach((k) => {
    if (HIDDEN_FIELDS.has(k)) return;
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) return;
    out.push({ label: FIELD_LABELS[k] ?? k, before: pretty(k, a[k]), after: pretty(k, b[k]) });
  });
  return out.sort((x, y) => x.label.localeCompare(y.label));
}

function AuditPage() {
  const [data, setData] = useState<AuditLogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [q, setQ] = useState("");
  const [viewing, setViewing] = useState<AuditLogEntry | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    getAuditLog()
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) { setError(true); setLoading(false); } });
    return () => { alive = false; };
  }, [reloadKey]);

  const rows = useMemo(() => (data ?? []).filter((r) =>
    [r.actor, r.action, r.entityType, r.entityId].join(" ").toLowerCase().includes(q.toLowerCase())
  ), [data, q]);

  return (
    <AppShell title="Audit Log" breadcrumb="Home / Audit Log">
      <div className="card-surface p-5">
        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search actions…" className="h-11 pl-9" disabled={loading || error} />
        </div>

        {loading && (
          <div>
            <div className="flex items-center justify-center gap-3 py-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-base font-medium">Loading audit logs…</span>
            </div>
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-11 w-full animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="py-12 text-center">
            <p className="mb-4 text-muted-foreground">Unable to load audit logs. Please try again.</p>
            <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
              <RefreshCw className="mr-1 h-4 w-4" />Retry
            </Button>
          </div>
        )}

        {!loading && !error && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left">
            <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-3">Date</th><th className="px-3 py-3">Time</th>
                <th className="px-3 py-3">User</th><th className="px-3 py-3">Entity</th>
                <th className="px-3 py-3">Action</th><th className="px-3 py-3 text-right">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (<tr><td colSpan={6} className="py-12 text-center text-muted-foreground">No audit activity found.</td></tr>)}

              {rows.map((r) => {
                const changes = computeDiff(r.oldValue, r.newValue);
                return (
                  <tr key={r.id} className="border-b align-top">
                    <td className="px-3 py-3 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{formatDateTime(r.createdAt).split(" ")[1]}</td>
                    <td className="px-3 py-3">{r.actor}</td>
                    <td className="px-3 py-3">{r.entityType}</td>
                    <td className="px-3 py-3 font-medium">
                      {r.action}
                      {changes.length > 0 && <span className="ml-2 text-xs text-muted-foreground">({changes.length} change{changes.length === 1 ? "" : "s"})</span>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end">
                        <Button size="sm" variant="outline" onClick={() => setViewing(r)}>
                          <Eye className="mr-1 h-4 w-4" />View
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>


      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewing?.action} · {viewing?.entityType}</DialogTitle>
          </DialogHeader>
          {viewing && (() => {
            const changes = computeDiff(viewing.oldValue, viewing.newValue);
            return (
              <div>
                <div className="mb-4 text-sm text-muted-foreground">
                  {formatDateTime(viewing.createdAt)} · by <b>{viewing.actor}</b>
                </div>
                {changes.length === 0 ? (
                  <div className="py-6 text-center text-muted-foreground">No field-level changes recorded.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b text-xs uppercase text-muted-foreground">
                        <tr><th className="py-2 text-left">Field</th><th className="py-2 text-left">Before</th><th className="py-2 text-left">After</th></tr>
                      </thead>
                      <tbody>
                        {changes.map((c) => (
                          <tr key={c.label} className="border-b">
                            <td className="py-2 pr-3 font-medium">{c.label}</td>
                            <td className="py-2 pr-3 text-muted-foreground line-through">{c.before}</td>
                            <td className="py-2 font-semibold text-emerald-700">{c.after}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
