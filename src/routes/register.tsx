import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { useStoreData } from "@/lib/useStore";
import {
  getMemos, getTrucks, getConsignees, deleteMemo, updateMemo, syncMemoToTransport,
  ALL_MEMO_STATUSES, type Memo, type FleetTruck, type Consignee, type MemoStatus,
} from "@/lib/dataStore";
import { formatDate, formatMoney, toDateKey, normalizeTruckNumber, effectiveWorkflowStatus, qualifiesForStatus, compareMemoNumberDesc } from "@/lib/format";
import { formatDisplayText } from "@/lib/textUtils";
import { StatusBadge } from "@/components/StatusBadge";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, Pencil, Printer, Trash2, Search, Download } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth, isSuperAdmin } from "@/lib/AuthContext";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ColumnFilter } from "@/components/ColumnFilter";
import { DateColumnFilter } from "@/components/DateColumnFilter";
import { Combobox } from "@/components/Combobox";
import { exportRows } from "@/lib/exportData";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Search = { f?: string };
export const Route = createFileRoute("/register")({
  component: RegisterPage,
  validateSearch: (s: Record<string, unknown>): Search => ({ f: typeof s.f === "string" ? s.f : undefined }),
});

function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d = new Date()) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

// Register list supports per-column excel-style filters; each key names a column.
type ColKey =
  | "memoNumber" | "dispatch" | "truck" | "consignee" | "destination"
  | "rate" | "weight" | "netFreight" | "advance" | "balance"
  | "unloading" | "lrRec" | "lrSub" | "finalPayable" | "finalPayDate"
  | "remarks" | "status";

/** Columns whose per-column filter is a calendar date picker. */
const DATE_COL_KEYS = new Set<ColKey>(["dispatch", "unloading", "lrRec", "lrSub", "finalPayDate"]);

/** Extracts a memo's raw date value for a date column. */
const dateValue = (r: Memo, key: ColKey): string | undefined => {
  switch (key) {
    case "dispatch": return r.dispatchDate;
    case "unloading": return r.unloadingDate;
    case "lrRec": return r.lrReceivedDate;
    case "lrSub": return r.lrSubmittedDate;
    case "finalPayDate": return r.finalPaymentDate;
    default: return undefined;
  }
};

function RegisterPage() {
  const { f } = Route.useSearch();
  const nav = useNavigate();
  const { profile } = useAuth();
  const admin = isSuperAdmin(profile);
  const { data: memos } = useStoreData<Memo[]>(() => getMemos(), []);
  const { data: trucks } = useStoreData<FleetTruck[]>(() => getTrucks(), []);
  const { data: consignees } = useStoreData<Consignee[]>(() => getConsignees(), []);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [truckId, setTruckId] = useState<string>("all");
  const [consigneeId, setConsigneeId] = useState<string>("all");
  const [paidBy, setPaidBy] = useState<string>("all");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<string>(f ?? "month");

  // Keep the Scope select in sync when the app navigates to /register?f=… from
  // the Dashboard or the notification bell (e.g. ?f=running / ?f=payment_pending).
  useEffect(() => {
    if (typeof f === "string" && f !== scope) {
      setScope(f);
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);
  const [confirmDel, setConfirmDel] = useState<Memo | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [colFilters, setColFilters] = useState<Partial<Record<ColKey, Set<string> | null>>>({
    truck: null, consignee: null, destination: null, status: null,
  });
  const [dateFilters, setDateFilters] = useState<Partial<Record<ColKey, string | null>>>({});

  const truckById = (id: string) => trucks?.find((t) => t.id === id);
  const consigneeById = (id: string) => consignees?.find((c) => c.id === id);

  /** Resolve truck display: prefer linked truck, fall back to free-text truckNumber.
   *  Always normalized to uppercase so legacy lowercase values display correctly. */
  const truckLabel = (r: Memo): string => {
    const linked = r.truckId ? truckById(r.truckId)?.truckNumber : undefined;
    return normalizeTruckNumber(linked || r.truckNumber) || "—";
  };
  /** Resolve consignee display: prefer linked consignee, fall back to free-text consigneeName. */
  const consigneeLabel = (r: Memo): string => {
    const linked = r.consigneeId ? consigneeById(r.consigneeId)?.companyName : undefined;
    return linked || r.consigneeName || "—";
  };

  const rowsPre = useMemo(() => {
    let rows = memos ?? [];
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
    if (truckId !== "all") rows = rows.filter((r) => r.truckId === truckId);
    if (consigneeId !== "all") rows = rows.filter((r) => r.consigneeId === consigneeId);
    if (paidBy !== "all") rows = rows.filter((r) => r.paidBy === paidBy);
    if (customStart || customEnd) {
      const cs = customStart ? new Date(customStart + "T00:00:00") : new Date("1970-01-01T00:00:00");
      const ce = customEnd ? endOfDay(new Date(customEnd + "T00:00:00")) : endOfDay(new Date("9999-12-31T00:00:00"));
      rows = rows.filter((r) => { const d = new Date(r.dispatchDate); return d >= cs && d <= ce; });
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter((r) => {
        return [r.memoNumber, truckLabel(r), r.driverName, r.transportName, consigneeLabel(r), r.toLocation, r.materialName, effectiveWorkflowStatus(r), r.remarks]
          .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
      });
    }
    return rows;
  }, [memos, trucks, consignees, query, status, truckId, consigneeId, paidBy, scope, customStart, customEnd]);

  // Value extractor per column, used for both column-filter menus and filtering.
  const colValue = (r: Memo, key: ColKey): string => {
    switch (key) {
      case "memoNumber": return r.memoNumber;
      case "dispatch": return formatDate(r.dispatchDate);
      case "truck": return truckLabel(r);
      case "consignee": return consigneeLabel(r);
      case "destination": return r.toLocation || "—";
      case "rate": return String(r.ratePerTon ?? "");
      case "weight": return String(r.weightTons ?? "");
      case "netFreight": return String(r.netFreight ?? "");
      case "advance": return String(r.advance ?? "");
      case "balance": return String(r.balance ?? "");
      case "unloading": return formatDate(r.unloadingDate);
      case "lrRec": return formatDate(r.lrReceivedDate);
      case "lrSub": return formatDate(r.lrSubmittedDate);
      case "finalPayable": return String(r.finalPayable ?? "");
      case "finalPayDate": return formatDate(r.finalPaymentDate);
      case "remarks": return r.remarks || "—";
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
    return [...rows].sort(
      (a, b) =>
        compareMemoNumberDesc(a.memoNumber, b.memoNumber) ||
        +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsPre, colFilters, dateFilters, trucks, consignees]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const resetFilters = () => {
    setQuery(""); setStatus("all"); setTruckId("all"); setConsigneeId("all"); setPaidBy("all"); setScope("all"); setPage(1);
    setCustomStart(""); setCustomEnd("");
    setColFilters({});
    setDateFilters({});
  };

  const toggleAll = () => {
    if (selected.size === pageRows.length) setSelected(new Set());
    else setSelected(new Set(pageRows.map((r) => r.id)));
  };

  const bulkDelete = async () => {
    const ids = Array.from(selected);
    try {
      for (const id of ids) await deleteMemo(id);
      toast.success(`${ids.length} memo(s) moved to trash`);
      setSelected(new Set());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setConfirmBulk(false);
    }
  };

  const bulkStatus = async (s: MemoStatus) => {
    const ids = Array.from(selected);
    try {
      for (const id of ids) {
        await updateMemo(id, { status: s });
        await syncMemoToTransport(id, { status: s });
      }
      toast.success(`Updated ${ids.length} memo(s) to ${s}`);
      setSelected(new Set());
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const toExportRows = (rows: Memo[]) => rows.map((r) => ({
      "Memo #": r.memoNumber,
      "Dispatch Date": formatDate(r.dispatchDate),
      "Truck": truckLabel(r),
      "G.C. No.": r.gcNo ?? "",
      "Destination": r.toLocation,
      "Consignee": consigneeLabel(r),
      "Driver": r.driverName,
      "Article": r.materialName,
      "Rate/Ton": r.ratePerTon,
      "Weight": r.weightTons,
      "Net Freight": r.netFreight,
      "Total Hire": r.totalHire,
      "Advance": r.advance,
      "Balance": r.balance,
      "Commission": r.commission,
      "Loading": r.loadingCharges,
      "TDS": r.tds,
      "Local Driver/Guide": r.localDriverGuide ?? "",
      "Payment Mamuli": r.goodsMamuli,
      "Paid At": r.paidAt ?? "",
      "Unloading": formatDate(r.unloadingDate),
      "LR Received": formatDate(r.lrReceivedDate),
      "LR Submitted": formatDate(r.lrSubmittedDate),
      "Final Payable": r.finalPayable,
      "Final Payment Date": formatDate(r.finalPaymentDate),
      "Status": effectiveWorkflowStatus(r),
      "Remarks": r.remarks ?? "",
    }));

  const doExport = (fmt: "xlsx" | "csv", onlySelected: boolean) => {
    const rows = onlySelected ? filtered.filter((r) => selected.has(r.id)) : filtered;
    if (rows.length === 0) { toast.error("No rows to export"); return; }
    exportRows(toExportRows(rows), `register-${new Date().toISOString().slice(0, 10)}`, fmt);
    toast.success(`Exported ${rows.length} row(s)`);
  };

  return (
    <AppShell
      title="Register List"
      breadcrumb="Home / Register List"
      actions={
        <>
          {admin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline"><Download className="mr-1 h-4 w-4" />Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => doExport("xlsx", false)}>Excel (.xlsx) — all filtered</DropdownMenuItem>
                <DropdownMenuItem onClick={() => doExport("csv", false)}>CSV — all filtered</DropdownMenuItem>
                {selected.size > 0 && (
                  <>
                    <DropdownMenuItem onClick={() => doExport("xlsx", true)}>Excel — {selected.size} selected</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => doExport("csv", true)}>CSV — {selected.size} selected</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {admin && <Button onClick={() => nav({ to: "/new-memo" })}>+ New Memo</Button>}
        </>
      }
    >
      <div className="card-surface p-5">
        {/* Global search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="Search memo # / truck / driver / consignee / destination / material / status / remarks…"
            className="h-12 pl-10 text-base"
          />
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="section-title mb-1 block">Scope</label>
            <Select value={scope} onValueChange={setScope}>
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
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-11 min-w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {ALL_MEMO_STATUSES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="section-title mb-1 block">Truck</label>
            <Combobox
              options={[
                { value: "all", label: "All trucks" },
                ...(trucks ?? []).map((t) => ({ value: t.id, label: t.truckNumber, keywords: `${t.driverName} ${t.ownerName}` })),
              ]}
              value={truckId}
              onChange={(v) => { setTruckId(v); setPage(1); }}
              placeholder="All trucks"
              className="w-[200px]"
            />
          </div>
          <div>
            <label className="section-title mb-1 block">Consignee</label>
            <Combobox
              options={[
                { value: "all", label: "All consignees" },
                ...(consignees ?? []).map((c) => ({ value: c.id, label: c.companyName, keywords: `${c.city} ${c.contactPerson} ${c.phone}` })),
              ]}
              value={consigneeId}
              onChange={(v) => { setConsigneeId(v); setPage(1); }}
              placeholder="All consignees"
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
          {admin && selected.size > 0 && (
            <>
              <Select onValueChange={(v) => bulkStatus(v as MemoStatus)}>
                <SelectTrigger className="h-11 min-w-[200px]"><SelectValue placeholder={`Set status for ${selected.size}…`} /></SelectTrigger>
                <SelectContent>
                  {ALL_MEMO_STATUSES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
              <Button variant="destructive" onClick={() => setConfirmBulk(true)}>Delete {selected.size} selected</Button>
            </>
          )}
        </div>

        {(() => {
          // Column definitions — single source of truth for header, filter, and cell.
          type Col = { key: ColKey; label: string; align?: "left" | "right"; render: (r: Memo) => React.ReactNode };
          const cols: Col[] = [
            { key: "memoNumber", label: "Memo #", render: (r) => <span className="inline-flex items-center"><Link to="/memo/$id" params={{ id: r.id }} className="font-semibold text-blue-600 hover:underline">{r.memoNumber}</Link>{r.isDraft && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Draft</span>}</span> },
            { key: "dispatch", label: "Dispatch Date", render: (r) => <span className="whitespace-nowrap font-semibold text-blue-700">{formatDate(r.dispatchDate)}</span> },
            { key: "truck", label: "Truck", render: (r) => <span className="font-bold whitespace-nowrap text-navy underline decoration-navy/30 underline-offset-2">{truckLabel(r)}</span> },
            { key: "consignee", label: "Consignee", render: (r) => <span className="font-semibold text-navy">{formatDisplayText(consigneeLabel(r))}</span> },
            { key: "destination", label: "Destination", render: (r) => <span className="font-bold text-navy">{formatDisplayText(r.toLocation)}</span> },
            { key: "rate", label: "Rate/Ton", align: "right", render: (r) => formatMoney(r.ratePerTon) },
            { key: "weight", label: "Weight", align: "right", render: (r) => r.weightTons },
            { key: "netFreight", label: "Net Freight", align: "right", render: (r) => formatMoney(r.netFreight) },
            { key: "advance", label: "Advance", align: "right", render: (r) => formatMoney(r.advance) },
            { key: "balance", label: "Balance", align: "right", render: (r) => formatMoney(r.balance) },
            { key: "unloading", label: "Unloading", render: (r) => <span className="whitespace-nowrap">{formatDate(r.unloadingDate)}</span> },
            { key: "lrRec", label: "LR Rec.", render: (r) => <span className="whitespace-nowrap">{formatDate(r.lrReceivedDate)}</span> },
            { key: "lrSub", label: "LR Sub.", render: (r) => <span className="whitespace-nowrap">{formatDate(r.lrSubmittedDate)}</span> },
            { key: "remarks", label: "Remarks", render: (r) => <span className="text-sm text-muted-foreground">{formatDisplayText(r.remarks) || "—"}</span> },
            { key: "finalPayable", label: "Final Payable", align: "right", render: (r) => formatMoney(r.finalPayable) },
            { key: "finalPayDate", label: "Final Pay Date", render: (r) => <span className="whitespace-nowrap">{formatDate(r.finalPaymentDate)}</span> },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={effectiveWorkflowStatus(r) as MemoStatus} /> },
          ];
          return (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[1700px] text-left">
                <thead className="border-b bg-muted/40">
                  <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                    {admin && <th className="w-8 px-3 py-3"><Checkbox checked={pageRows.length > 0 && selected.size === pageRows.length} onCheckedChange={toggleAll} /></th>}
                    {!admin && <th className="w-8 px-3 py-3" />}
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
                    <th className="sticky right-0 z-10 bg-muted px-3 py-3 text-right shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.25)]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 && (
                    <tr><td colSpan={cols.length + 2} className="py-16 text-center text-muted-foreground">
                      <div>No records found</div>
                      <Button variant="link" onClick={resetFilters}>Reset filters</Button>
                    </td></tr>
                  )}
                  {pageRows.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-muted/30">
                      {admin && (
                        <td className="px-3 py-3">
                          <Checkbox checked={selected.has(r.id)} onCheckedChange={(v) => {
                            const next = new Set(selected); if (v) next.add(r.id); else next.delete(r.id); setSelected(next);
                          }} />
                        </td>
                      )}
                      {!admin && <td className="px-3 py-3" />}
                      {cols.map((c) => (
                        <td key={c.key} className={`px-3 py-3 ${c.align === "right" ? "text-right" : ""}`}>{c.render(r)}</td>
                      ))}
                      <td className="sticky right-0 z-10 bg-background px-3 py-3 shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.25)]">
                        <div className="flex justify-end gap-1">
                          <Link to="/memo/$id" params={{ id: r.id }}><Button size="icon" variant="ghost"><Eye className="h-4 w-4" /></Button></Link>
                          {admin && <Link to="/new-memo" search={{ edit: r.id } as never}><Button size="icon" variant="ghost"><Pencil className="h-4 w-4" /></Button></Link>}
                          <Link to="/memo/$id" params={{ id: r.id }} search={{ print: 1 } as never}><Button size="icon" variant="ghost"><Printer className="h-4 w-4" /></Button></Link>
                          {admin && (
                            <Button size="icon" variant="ghost" onClick={() => setConfirmDel(r)}>
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            Showing {pageRows.length} of {total}
          </div>
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
            <AlertDialogTitle>Move memo to trash?</AlertDialogTitle>
            <AlertDialogDescription>
              Memo <b>{confirmDel?.memoNumber}</b> will be moved to Trash. You can restore it any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              if (confirmDel) {
                const n = confirmDel.memoNumber;
                try {
                  await deleteMemo(confirmDel.id);
                  toast.success(`Memo ${n} moved to Trash`);
                } catch (e) {
                  toast.error((e as Error).message);
                }
                setConfirmDel(null);
              }
            }}>Move to trash</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmBulk} onOpenChange={setConfirmBulk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move {selected.size} memo(s) to trash?</AlertDialogTitle>
            <AlertDialogDescription>All selected memos will be soft-deleted. Restore from Trash any time.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={bulkDelete}>Move to trash</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
