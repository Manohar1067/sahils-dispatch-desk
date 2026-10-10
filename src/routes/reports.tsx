import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { useStoreData } from "@/lib/useStore";
import { getMemos, getTrucks, type Memo, type FleetTruck } from "@/lib/dataStore";
import { hasOutstandingBalance } from "@/lib/completionRules";
import { formatMoney, formatDate, normalizeTruckNumber, compareMemoNumberDesc } from "@/lib/format";
import { formatDisplayText } from "@/lib/textUtils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { useMemo, useRef, useState } from "react";
import { Printer, Download } from "lucide-react";
import { toast } from "sonner";
import { exportRows } from "@/lib/exportData";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";

export const Route = createFileRoute("/reports")({
  component: ReportsPage,
  validateSearch: (s: Record<string, unknown>) => ({ period: typeof s.period === "string" ? s.period : undefined }),
});

type Range = "today" | "yesterday" | "week" | "last_week" | "month" | "last_month" | "year" | "fy" | "all";

function rangeStart(r: Range): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  switch (r) {
    case "today": return d;
    case "yesterday": { const x = new Date(d); x.setDate(x.getDate() - 1); return x; }
    case "week": { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; }
    case "last_week": { const x = new Date(d); x.setDate(x.getDate() - x.getDay() - 7); return x; }
    case "month": return new Date(d.getFullYear(), d.getMonth(), 1);
    case "last_month": return new Date(d.getFullYear(), d.getMonth() - 1, 1);
    case "year": return new Date(d.getFullYear(), 0, 1);
    case "fy": {
      const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
      return new Date(y, 3, 1);
    }
    case "all": return new Date(0);
  }
}
function rangeEnd(r: Range): Date {
  const d = new Date(); d.setHours(23, 59, 59, 999);
  if (r === "yesterday") { const x = new Date(d); x.setDate(x.getDate() - 1); return x; }
  if (r === "last_week") { const x = new Date(d); x.setDate(x.getDate() - x.getDay() - 1); return x; }
  if (r === "last_month") return new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 59);
  return d;
}

function ReportsPage() {
  const { data: memos } = useStoreData<Memo[]>(() => getMemos(), []);
  const { data: trucks } = useStoreData<FleetTruck[]>(() => getTrucks(), []);
  const { period } = Route.useSearch();
  const [range, setRange] = useState<Range>((period === "today" || period === "month" || period === "year" || period === "week") ? period as Range : "month");
  const [type, setType] = useState<string>("summary");
  const chartsRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<{ kind: "truck" | "driver"; id: string; label: string } | null>(null);

  const inRange = useMemo(() => {
    const s = rangeStart(range).getTime(); const e = rangeEnd(range).getTime();
    return (memos ?? []).filter((m) => { const t = +new Date(m.dispatchDate); return t >= s && t <= e; });
  }, [memos, range]);

  const filtered = useMemo(() => {
    if (!focus) return inRange;
    return inRange.filter((m) => (focus.kind === "truck" ? m.truckId === focus.id : m.driverName === focus.id));
  }, [inRange, focus]);

  /** Rows actually listed under the currently selected report type.
   *  Filter first, then sort Memo Number STRICT DESCENDING (numeric suffix). */
  const visibleTrips = useMemo(() => {
    let rows = filtered;
    if (type === "pending") rows = rows.filter(hasOutstandingBalance);
    if (type === "lr") rows = rows.filter((x) => !x.lrSubmittedDate);
    return [...rows].sort((a, b) => compareMemoNumberDesc(a.memoNumber, b.memoNumber));
  }, [filtered, type]);

  const revenue = filtered.reduce((s, x) => s + x.netFreight, 0);
  const expense = filtered.reduce((s, x) => s + x.totalExpenses, 0);
  const profit = revenue - expense;
  const pendingPay = filtered.filter(hasOutstandingBalance).reduce((s, x) => s + x.balance, 0);
  const lrPendingCount = filtered.filter((x) => !x.lrSubmittedDate).length;
  const completed = filtered.filter((x) => x.status === "Completed").length;
  const running = filtered.filter((x) => x.status === "Dispatched").length;
  const pendingPayCount = filtered.filter(hasOutstandingBalance).length;

  const truckStats: Array<{ id: string; number: string; trips: number; revenue: number }> = [];
  const groupTruck: Record<string, { trips: number; revenue: number }> = {};
  inRange.forEach((m) => {
    if (!groupTruck[m.truckId]) groupTruck[m.truckId] = { trips: 0, revenue: 0 };
    groupTruck[m.truckId].trips++;
    groupTruck[m.truckId].revenue += m.netFreight;
  });
  Object.entries(groupTruck).forEach(([id, v]) => {
    const t = trucks?.find((x) => x.id === id);
    truckStats.push({ id, number: normalizeTruckNumber(t?.truckNumber) || "—", ...v });
  });
  truckStats.sort((a, b) => b.revenue - a.revenue);

  const driverStats: Record<string, number> = {};
  inRange.forEach((m) => { driverStats[m.driverName] = (driverStats[m.driverName] || 0) + 1; });
  const topDrivers = Object.entries(driverStats).sort((a, b) => b[1] - a[1]);

  // chart data
  const monthly = useMemo(() => {
    const map: Record<string, { key: string; revenue: number; expenses: number; trips: number }> = {};
    filtered.forEach((m) => {
      const d = new Date(m.dispatchDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!map[key]) map[key] = { key, revenue: 0, expenses: 0, trips: 0 };
      map[key].revenue += m.netFreight;
      map[key].expenses += m.totalExpenses;
      map[key].trips += 1;
    });
    return Object.values(map).sort((a, b) => a.key.localeCompare(b.key));
  }, [filtered]);

  const statusPie = useMemo(() => {
    const buckets: Record<string, number> = { Completed: 0, Dispatched: 0, Pending: 0, Delivered: 0 };
    filtered.forEach((m) => {
      if (m.status === "Completed") buckets.Completed++;
      else if (m.status === "Dispatched") buckets.Dispatched++;
      else if (m.status === "Delivered") buckets.Delivered++;
      else buckets.Pending++;
    });
    return Object.entries(buckets).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const PIE_COLORS: Record<string, string> = {
    Completed: "#10b981", Dispatched: "#3b82f6", Delivered: "#8b5cf6", Pending: "#f59e0b",
  };

  const exportSummary = (fmt: "xlsx" | "csv") => {
    // Export exactly what the selected report type displays — not every memo
    // in the date range. Otherwise "Pending Payment" / "LR Pending" exports
    // silently included rows the user never saw on screen.
    const visible = visibleTrips;
    const rows = visible.map((m) => {
      const t = trucks?.find((x) => x.id === m.truckId);
      return {
        "Memo #": m.memoNumber, "Date": formatDate(m.dispatchDate),
        "Truck": normalizeTruckNumber(t?.truckNumber) ?? "", "Destination": m.toLocation, "Material": m.materialName,
        "Net Freight": m.netFreight, "Advance": m.advance, "Balance": m.balance,
        "Expenses": m.totalExpenses, "Final Payable": m.finalPayable, "Status": m.status,
      };
    });
    if (!rows.length) { toast.error("No data to export"); return; }
    exportRows(rows, `report-${range}-${new Date().toISOString().slice(0, 10)}`, fmt);
    toast.success(`Exported ${rows.length} row(s)`);
  };

  const exportPdf = async () => {
    if (!chartsRef.current) return;
    toast.info("Generating PDF…");
    try {
      // html2canvas-pro supports the modern CSS colors (oklch) emitted by
      // Tailwind v4; the legacy html2canvas throws/hangs on them (see memo.$id.tsx).
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas-pro"), import("jspdf"),
      ]);
      const canvas = await html2canvas(chartsRef.current, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const w = pdf.internal.pageSize.getWidth();
      const h = (canvas.height * w) / canvas.width;
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, w, h);
      pdf.save(`report-${range}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate PDF");
    }
  };

  return (
    <AppShell title="Reports" breadcrumb="Home / Reports" actions={
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline"><Download className="mr-1 h-4 w-4" />Export</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => exportSummary("xlsx")}>Excel (.xlsx)</DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportSummary("csv")}>CSV</DropdownMenuItem>
            <DropdownMenuItem onClick={exportPdf}>PDF</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print</Button>
      </>
    }>

      <div className="card-surface mb-5 flex flex-wrap items-end gap-3 p-5">
        <div>
          <label className="section-title mb-1 block">Date Range</label>
          <Select value={range} onValueChange={(v) => setRange(v as Range)}>
            <SelectTrigger className="h-11 min-w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="yesterday">Yesterday</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="last_week">Last Week</SelectItem>
              <SelectItem value="month">Current Month</SelectItem>
              <SelectItem value="last_month">Last Month</SelectItem>
              <SelectItem value="year">Current Year</SelectItem>
              <SelectItem value="fy">Financial Year</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="section-title mb-1 block">Report Type</label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-11 min-w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="summary">Revenue / Expense / Profit</SelectItem>
              <SelectItem value="trucks">Top Trucks</SelectItem>
              <SelectItem value="drivers">Top Drivers</SelectItem>
              <SelectItem value="pending">Pending Payment</SelectItem>
              <SelectItem value="lr">LR Pending</SelectItem>
              <SelectItem value="trips">Trip List</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {focus && (
        <div className="card-surface mb-5 flex items-center justify-between gap-4 border-l-4 border-blue-600 p-4">
          <div className="text-sm">
            Showing only <span className="font-semibold">{focus.kind === "truck" ? "Truck" : "Driver"} {focus.label}</span>
            {" "}— {filtered.length} trip(s), {formatMoney(revenue)} revenue
          </div>
          <Button size="sm" variant="outline" onClick={() => setFocus(null)}>Back to full report</Button>
        </div>
      )}

      <div ref={chartsRef} className="mb-5 space-y-5">
        {/* Summary KPIs */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Revenue" value={formatMoney(revenue)} tone="text-emerald-600" />
          <StatCard label="Expenses" value={formatMoney(expense)} tone="text-red-600" />
          <StatCard label="Profit" value={formatMoney(profit)} tone={profit >= 0 ? "text-emerald-600" : "text-red-600"} />
          <StatCard label="Pending Payment" value={formatMoney(pendingPay)} tone="text-orange-600" />
          <StatCard label="Completed Trips" value={String(completed)} />
          <StatCard label="Dispatched" value={String(running)} />
          <StatCard label="Payment Pending" value={String(pendingPayCount)} />
          <StatCard label="LR Pending" value={String(lrPendingCount)} />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="card-surface p-5">
            <h3 className="mb-3">Monthly Revenue vs Expenses</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="key" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={(v: number) => formatMoney(v)} />
                  <Legend />
                  <Bar dataKey="revenue" name="Revenue" fill="#10b981" />
                  <Bar dataKey="expenses" name="Expenses" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card-surface p-5">
            <h3 className="mb-3">Monthly Trips</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="key" fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="trips" name="Trips" stroke="#3b82f6" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card-surface p-5 lg:col-span-2">
            <h3 className="mb-3">Status Distribution</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusPie} dataKey="value" nameKey="name" outerRadius={90} label>
                    {statusPie.map((s) => (<Cell key={s.name} fill={PIE_COLORS[s.name]} />))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {type === "trucks" && (
        <div className="card-surface p-5">
          <h3 className="mb-3">Top Trucks</h3>
          <table className="w-full text-left">
            <thead className="border-b text-xs uppercase text-muted-foreground"><tr><th className="py-2">Truck</th><th>Trips</th><th className="text-right">Revenue</th></tr></thead>
            <tbody>{truckStats.map((t) => (<tr key={t.id} className={`cursor-pointer border-b hover:bg-muted/50 ${focus?.kind === "truck" && focus.id === t.id ? "bg-blue-50" : ""}`} onClick={() => setFocus({ kind: "truck", id: t.id, label: t.number })}><td className="py-2 font-semibold text-blue-600">{t.number}</td><td>{t.trips}</td><td className="text-right">{formatMoney(t.revenue)}</td></tr>))}
            {truckStats.length === 0 && (<tr><td colSpan={3} className="py-8 text-center text-muted-foreground">No data</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
      {type === "drivers" && (
        <div className="card-surface p-5">
          <h3 className="mb-3">Top Drivers</h3>
          <table className="w-full text-left">
            <thead className="border-b text-xs uppercase text-muted-foreground"><tr><th className="py-2">Driver</th><th className="text-right">Trips</th></tr></thead>
            <tbody>{topDrivers.map(([d, n]) => (<tr key={d} className={`cursor-pointer border-b hover:bg-muted/50 ${focus?.kind === "driver" && focus.id === d ? "bg-blue-50" : ""}`} onClick={() => setFocus({ kind: "driver", id: d, label: d })}><td className="py-2 font-semibold text-blue-600">{d}</td><td className="text-right">{n}</td></tr>))}
            {topDrivers.length === 0 && (<tr><td colSpan={2} className="py-8 text-center text-muted-foreground">No data</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
      {(type === "summary" || type === "trips" || type === "pending" || type === "lr") && (
        <div className="card-surface p-5">
          <h3 className="mb-3">Trips ({visibleTrips.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr><th className="px-3 py-2">Memo #</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Truck</th><th className="px-3 py-2">Destination</th><th className="px-3 py-2 text-right">Net Freight</th><th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2">Status</th></tr>
              </thead>
              <tbody>
                {visibleTrips.map((m) => {
                  const t = trucks?.find((x) => x.id === m.truckId);
                  return (
                    <tr key={m.id} className="border-b">
                      <td className="px-3 py-2 font-semibold text-blue-600">{m.memoNumber}</td>
                      <td className="px-3 py-2">{formatDate(m.dispatchDate)}</td>
                      <td className="px-3 py-2">{normalizeTruckNumber(t?.truckNumber) || "—"}</td>
                      <td className="px-3 py-2 font-semibold">{formatDisplayText(m.toLocation)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(m.netFreight)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(m.balance)}</td>
                      <td className="px-3 py-2"><StatusBadge status={m.status} /></td>
                    </tr>
                  );
                })}
                {visibleTrips.length === 0 && (<tr><td colSpan={7} className="py-10 text-center text-muted-foreground">No records for this report</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card-surface p-5">
      <div className="section-title">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
