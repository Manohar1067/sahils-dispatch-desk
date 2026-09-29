import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { useTransportData } from "@/lib/useTransportStore";
import { useStoreData } from "@/lib/useStore";
import {
  getTransportEntries, deleteTransportEntry,
  ALL_TRANSPORT_STATUSES, type TransportEntry,
} from "@/lib/transportListStore";
import { getTrucks, getConsignees, type FleetTruck, type Consignee } from "@/lib/dataStore";
import { formatDate, formatMoney, toDateKey, normalizeTruckNumber, effectiveWorkflowStatus, qualifiesForStatus, compareMemoNumberDesc } from "@/lib/format";
import { formatDisplayText } from "@/lib/textUtils";
import { StatusBadge } from "@/components/StatusBadge";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/Combobox";
import { Eye, Pencil, Trash2, Search, Download } from "lucide-react";
import { toast } from "sonner";
import { useAuth, isSuperAdmin } from "@/lib/AuthContext";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ColumnFilter } from "@/components/ColumnFilter";
import { DateColumnFilter } from "@/components/DateColumnFilter";
import { exportRows } from "@/lib/exportData";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/transport-list")({
  component: TransportListPage,
});

function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d = new Date()) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

type ColKey =
  | "entryNumber" | "dispatch" | "truck" | "consignee" | "destination"
  | "rate" | "weight" | "netFreight" | "advance" | "balance"
  | "unloading" | "halting" | "lrRec" | "lrSub" | "remarks"
  | "finalPayable" | "finalPayDate" | "status";

/** Columns whose per-column filter is a calendar date picker. */
const DATE_COL_KEYS = new Set<ColKey>(["dispatch", "unloading", "lrRec", "lrSub", "finalPayDate"]);

/** Extracts an entry's raw date value for a date column. */
const dateValue = (r: TransportEntry, key: ColKey): string | undefined => {
  switch (key) {
    case "dispatch": return r.dispatchDate;
    case "unloading": return r.unloadingDate;
    case "lrRec": return r.lrReceivedDate;
    case "lrSub": return r.lrSubmittedDate;
    case "finalPayDate": return r.finalPaymentDate;
    default: return undefined;
  }
};

function TransportListPage() {
  const nav = useNavigate();
  const { profile } = useAuth();
  const admin = isSuperAdmin(profile);
  const { data: entries, loading, error } = useTransportData<TransportEntry[]>(() => getTransportEntries(), []);
  const { data: trucks } = useStoreData<FleetTruck[]>(() => getTrucks(), []);
  const { data: consignees } = useStoreData<Consignee[]>(() => getConsignees(), []);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [paidBy, setPaidBy] = useState<string>("all");
  const [consignee, setConsignee] = useState<string>("all");
  const [truck, setTruck] = useState<string>("all");
  const [scope, setScope] = useState<string>("all");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [confirmDel, setConfirmDel] = useState<TransportEntry | null>(null);
  const [colFilters, setColFilters] = useState<Partial<Record<ColKey, Set<string> | null>>>({});
  const [dateFilters, setDateFilters] = useState<Partial<Record<ColKey, string | null>>>({});

  const rowsPre = useMemo(() => {
    let rows = entries ?? [];
    const now = new Date();
    if (scope === "today") rows = rows.filter((x) => new Date(x.dispatchDate).toDateString() === now.toDateString());
    else if (scope === "month") rows = rows.filter((x) => new Date(x.dispatchDate) >= startOfMonth(now));
    else if (scope === "week") {
      const ws = startOfWeek(now);
      const we = endOfDay(new Date(ws));
      we.setDate(we.getDate() + 6);
      rows = rows.filter((x) => { const d = new Date(x.dispatchDate); return d >= ws && d <= we; });
    }
    else if (scope === "running") rows = rows.filter((x) => x.status === "Dispatched");
    else if (scope === "completed") rows = rows.filter((x) => x.status === "Completed");
    else if (scope === "pending") rows = rows.filter((x) => x.status === "Dispatched");
    else if (scope === "payment_pending") rows = rows.filter((x) => x.status === "Payment Pending");
    else if (scope === "collection_due") rows = rows.filter((x) => x.status !== "Completed" && x.balance > 0);

    if (status !== "all") rows = rows.filter((r) => qualifiesForStatus(r, status));
    if (paidBy !== "all") rows = rows.filter((r) => r.paidBy === paidBy);
    if (consignee !== "all") rows = rows.filter((r) => (r.consigneeName || "—") === consignee);
    if (truck !== "all") rows = rows.filter((r) => (normalizeTruckNumber(r.truckNumber) || "—") === truck);
    if (customStart || customEnd) {
      const cs = customStart ? new Date(customStart + "T00:00:00") : new Date("1970-01-01T00:00:00");
      const ce = customEnd ? endOfDay(new Date(customEnd + "T00:00:00")) : endOfDay(new Date("9999-12-31T00:00:00"));
      rows = rows.filter((r) => { const d = new Date(r.dispatchDate); return d >= cs && d <= ce; });
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter((r) =>
        [r.entryNumber, r.truckNumber, r.driverName, r.transportName, r.consigneeName, r.toLocation, r.materialName, effectiveWorkflowStatus(r), r.remarks]
          .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [entries, query, status, paidBy, consignee, truck, scope, customStart, customEnd]);

  const consigneeOptions = useMemo(() => {
    const names = new Set<string>();
    (consignees ?? []).forEach((c) => { if (c.companyName) names.add(c.companyName); });
    (entries ?? []).forEach((e) => names.add(e.consigneeName || "—"));
    return [
      { value: "all", label: "All consignors" },
      ...Array.from(names).sort().map((n) => ({ value: n, label: n })),
    ];
  }, [consignees, entries]);
  const truckOptions = useMemo(() => {
    const names = new Set<string>();
    (trucks ?? []).forEach((t) => { if (t.truckNumber) names.add(normalizeTruckNumber(t.truckNumber)); });
    (entries ?? []).forEach((e) => names.add(normalizeTruckNumber(e.truckNumber) || "—"));
    return [
      { value: "all", label: "All trucks" },
      ...Array.from(names).sort().map((n) => ({ value: n, label: n })),
    ];
  }, [trucks, entries]);

  const colValue = (r: TransportEntry, key: ColKey): string => {
    switch (key) {
      case "entryNumber": return r.entryNumber;
      case "dispatch": return formatDate(r.dispatchDate);
      case "truck": return normalizeTruckNumber(r.truckNumber) || "—";
      case "consignee": return r.consigneeName || "—";
      case "destination": return r.toLocation || "—";
      case "rate": return String(r.ratePerTon ?? "");
      case "weight": return String(r.weightTons ?? "");
      case "netFreight": return String(r.netFreight ?? "");
      case "advance": return String(r.advance ?? "");
      case "balance": return String(r.balance ?? "");
      case "unloading": return formatDate(r.unloadingDate);
      case "halting": return String(r.haltingCharge ?? 0);
      case "lrRec": return formatDate(r.lrReceivedDate);
      case "lrSub": return formatDate(r.lrSubmittedDate);
      case "remarks": return r.remarks || "—";
      case "finalPayable": return String(r.finalPayable ?? "");
      case "finalPayDate": return formatDate(r.finalPaymentDate);
      case "status": return effectiveWorkflowStatus(r);
    }
  };

  const filtered = useMemo(() => {
    let rows = rowsPre;
    // Calendar-based date filters compare the stored date exactly as displayed.
    for (const k of DATE_COL_KEYS) {
      const dk = dateFilters[k];
      if (dk) rows = rows.filter((r) => toDateKey(dateValue(r, k)) === dk);
    }
    (Object.keys(colFilters) as ColKey[]).forEach((k) => {
      const sel = colFilters[k];
      if (sel) rows = rows.filter((r) => sel.has(colValue(r, k)));
    });
    return [...rows].sort((a, b) => compareMemoNumberDesc(a.entryNumber, b.entryNumber));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsPre, colFilters, dateFilters]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const resetFilters = () => {
    setQuery(""); setStatus("all"); setPaidBy("all"); setConsignee("all"); setTruck("all"); setScope("all"); setPage(1); setColFilters({});
    setDateFilters({});
    setCustomStart(""); setCustomEnd("");
  };

  const toExportRows = (rows: TransportEntry[]) => rows.map((r) => ({
    "Memo Number": r.entryNumber,
    "Dispatch Date": formatDate(r.dispatchDate),
    "Truck": normalizeTruckNumber(r.truckNumber),
    "Transport": r.transportName,
    "Destination": r.toLocation,
    "Consignee": r.consigneeName,
    "Driver": r.driverName,
    "Material": r.materialName,
    "Rate/Ton (Transport)": r.ratePerTon,
    "Weight": r.weightTons,
    "Net Freight": r.netFreight,
    "Advance": r.advance,
    "Balance": r.balance,
    "Unloading": formatDate(r.unloadingDate),
    "Halting Charge": r.haltingCharge,
    "LR Received": formatDate(r.lrReceivedDate),
    "LR Submitted": formatDate(r.lrSubmittedDate),
    "Final Payable": r.finalPayable,
    "Final Payment Date": formatDate(r.finalPaymentDate),
    "Status": effectiveWorkflowStatus(r),
    "Remarks": r.remarks ?? "",
  }));

  const doExport = (fmt: "xlsx" | "csv") => {
    if (filtered.length === 0) { toast.error("No rows to export"); return; }
    exportRows(toExportRows(filtered), `transport-list-${new Date().toISOString().slice(0, 10)}`, fmt);
    toast.success(`Exported ${filtered.length} row(s)`);
  };

  type Col = { key: ColKey; label: string; align?: "left" | "right"; render: (r: TransportEntry) => React.ReactNode };
  const cols: Col[] = [
    { key: "entryNumber", label: "Memo Number", render: (r) => <Link to="/transport/$id" params={{ id: r.id }} className="font-semibold text-blue-600 hover:underline">{r.entryNumber}</Link> },
    { key: "dispatch", label: "Dispatch Date", render: (r) => <span className="whitespace-nowrap">{formatDate(r.dispatchDate)}</span> },
    { key: "truck", label: "Truck", render: (r) => <span className="font-semibold whitespace-nowrap">{normalizeTruckNumber(r.truckNumber) || "—"}</span> },
    { key: "consignee", label: "Consignor", render: (r) => <span className="font-semibold text-navy">{formatDisplayText(r.consigneeName) || "—"}</span> },
    { key: "destination", label: "Destination", render: (r) => <span className="font-semibold">{formatDisplayText(r.toLocation)}</span> },
    { key: "rate", label: "Rate/Ton (Transport)", align: "right", render: (r) => formatMoney(r.ratePerTon) },
    { key: "weight", label: "Weight", align: "right", render: (r) => r.weightTons },
    { key: "netFreight", label: "Net Freight", align: "right", render: (r) => formatMoney(r.netFreight) },
    { key: "advance", label: "Advance", align: "right", render: (r) => formatMoney(r.advance) },
    { key: "balance", label: "Balance", align: "right", render: (r) => formatMoney(r.balance) },
    { key: "unloading", label: "Unloading", render: (r) => <span className="whitespace-nowrap">{formatDate(r.unloadingDate)}</span> },
    { key: "halting", label: "Halting Charge (₹)", align: "right", render: (r) => formatMoney(r.haltingCharge) },
    { key: "lrRec", label: "LR Rec.", render: (r) => <span className="whitespace-nowrap">{formatDate(r.lrReceivedDate)}</span> },
    { key: "lrSub", label: "LR Sub.", render: (r) => <span className="whitespace-nowrap">{formatDate(r.lrSubmittedDate)}</span> },
    { key: "remarks", label: "Remarks", render: (r) => <span className="text-sm text-muted-foreground">{formatDisplayText(r.remarks) || "—"}</span> },
    { key: "finalPayable", label: "Final Payable", align: "right", render: (r) => formatMoney(r.finalPayable) },
    { key: "finalPayDate", label: "Final Pay Date", render: (r) => <span className="whitespace-nowrap">{formatDate(r.finalPaymentDate)}</span> },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={effectiveWorkflowStatus(r)} /> },
  ];

  return (
    <AppShell
      title="Transport List"
      breadcrumb="Home / Transport List"
      actions={
        <>
          {admin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline"><Download className="mr-1 h-4 w-4" />Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => doExport("xlsx")}>Excel (.xlsx) — all filtered</DropdownMenuItem>
                <DropdownMenuItem onClick={() => doExport("csv")}>CSV — all filtered</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {admin && <Button onClick={() => nav({ to: "/new-transport" })}>+ New Transport Entry</Button>}
        </>
      }
    >
      <div className="card-surface p-5">
        {error && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Could not load transport entries: {error}
          </div>
        )}
        {!error && !loading && (entries?.length ?? 0) === 0 && (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            The transport_list table returned 0 rows for your account. If rows exist in the database, your account is
            not permitted to read them (row-level security) — no filter on this page is excluding them.
          </div>
        )}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="Search memo number / truck / driver / transport / consignor / destination / material / status / remarks…"
            className="h-12 pl-10 text-base"
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="section-title mb-1 block">Scope</label>
            <Select value={scope} onValueChange={(v) => { setScope(v); setPage(1); }}>
              <SelectTrigger className="h-11 min-w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">Current Month</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="pending">Pending Deliveries</SelectItem>
                <SelectItem value="payment_pending">Payment Pending</SelectItem>
                <SelectItem value="collection_due">Collection Due</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="section-title mb-1 block">Status</label>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="h-11 min-w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {ALL_TRANSPORT_STATUSES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="section-title mb-1 block">Consignor</label>
            <Combobox
              options={consigneeOptions}
              value={consignee}
              onChange={(v) => { setConsignee(v); setPage(1); }}
              placeholder="All consignors"
              className="w-[200px]"
            />
          </div>
          <div>
            <label className="section-title mb-1 block">Truck</label>
            <Combobox
              options={truckOptions}
              value={truck}
              onChange={(v) => { setTruck(v); setPage(1); }}
              placeholder="All trucks"
              className="w-[200px]"
            />
          </div>
          <div>
            <label className="section-title mb-1 block">Paid By</label>
            <Select value={paidBy} onValueChange={(v) => { setPaidBy(v); setPage(1); }}>
              <SelectTrigger className="h-11 min-w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="SRL">Sahil</SelectItem>
                <SelectItem value="KAREEM">Kareem</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="section-title mb-1 block">From Date</label>
              <Input type="date" className="h-11 w-[160px]" value={customStart} onChange={(e) => { setCustomStart(e.target.value); setPage(1); }} />
            </div>
            <div>
              <label className="section-title mb-1 block">To Date</label>
              <Input type="date" className="h-11 w-[160px]" value={customEnd} onChange={(e) => { setCustomEnd(e.target.value); setPage(1); }} />
            </div>
            {(customStart || customEnd) && (
              <Button variant="ghost" onClick={() => { setCustomStart(""); setCustomEnd(""); setPage(1); }}>Clear</Button>
            )}
          </div>
          <Button variant="outline" onClick={resetFilters}>Reset filters</Button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1700px] text-left">
            <thead className="border-b bg-muted/40">
              <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                {cols.map((c) => (
                  <th key={c.key} className={`px-3 py-3 ${c.align === "right" ? "text-right" : ""}`}>
                    <span className="inline-flex items-center">
                      {c.label}
                      {DATE_COL_KEYS.has(c.key) ? (
                        <DateColumnFilter
                          label={c.label}
                          value={dateFilters[c.key] ?? null}
                          onApply={(n) => setDateFilters((f) => ({ ...f, [c.key]: n }))}
                        />
                      ) : (
                        <ColumnFilter
                          values={rowsPre.map((r) => colValue(r, c.key))}
                          selected={colFilters[c.key] ?? null}
                          onApply={(n) => setColFilters((f) => ({ ...f, [c.key]: n }))}
                        />
                      )}
                    </span>
                  </th>
                ))}
                {admin && <th className="sticky right-0 z-10 bg-muted px-3 py-3 text-right shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.25)]">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr><td colSpan={cols.length + 1} className="py-16 text-center text-muted-foreground">
                  <div>No records found</div>
                  <Button variant="link" onClick={resetFilters}>Reset filters</Button>
                </td></tr>
              )}
              {pageRows.map((r) => (
                <tr key={r.id} className="border-b hover:bg-muted/30">
                  {cols.map((c) => (
                    <td key={c.key} className={`px-3 py-3 ${c.align === "right" ? "text-right" : ""}`}>{c.render(r)}</td>
                  ))}
                  {admin && (
                    <td className="sticky right-0 z-10 bg-background px-3 py-3 shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.25)]">
                      <div className="flex justify-end gap-1">
                        <Link to="/transport/$id" params={{ id: r.id }}><Button size="icon" variant="ghost"><Eye className="h-4 w-4" /></Button></Link>
                        <Link to="/transport-edit/$id" params={{ id: r.id }}><Button size="icon" variant="ghost"><Pencil className="h-4 w-4" /></Button></Link>
                        <Button size="icon" variant="ghost" onClick={() => setConfirmDel(r)}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">Showing {pageRows.length} of {total}</div>
          <div className="flex items-center gap-3">
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[25, 50, 100, 200].map((n) => (<SelectItem key={n} value={String(n)}>{n} / page</SelectItem>))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</Button>
            <div className="text-sm">Page {page} of {pages}</div>
            <Button variant="outline" size="sm" disabled={page === pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      </div>

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete transport entry?</AlertDialogTitle>
            <AlertDialogDescription>
              Entry <b>{confirmDel?.entryNumber}</b> will be removed from the Transport List.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              if (confirmDel) {
                const n = confirmDel.entryNumber;
                try {
                  await deleteTransportEntry(confirmDel.id);
                  toast.success(`Entry ${n} deleted`);
                } catch (e) {
                  toast.error((e as Error).message);
                }
                setConfirmDel(null);
              }
            }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
