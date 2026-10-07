import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { useStoreData } from "@/lib/useStore";
import { getMemos, getTrucks, getConsignees, type Memo, type FleetTruck, type Consignee } from "@/lib/dataStore";
import { hasOutstandingBalance } from "@/lib/completionRules";
import { formatMoney, normalizeTruckNumber } from "@/lib/format";
import {
  TrendingUp, TrendingDown, Truck, Building2, Clock, CheckCircle2,
  AlertCircle, Wallet, Package, Calendar, Award, User, IndianRupee, ReceiptText,
} from "lucide-react";

export const Route = createFileRoute("/")({ component: Dashboard });

function isSameDay(iso: string, d = new Date()) {
  const a = new Date(iso);
  return a.getFullYear() === d.getFullYear() && a.getMonth() === d.getMonth() && a.getDate() === d.getDate();
}
function isSameMonth(iso: string, d = new Date()) {
  const a = new Date(iso);
  return a.getFullYear() === d.getFullYear() && a.getMonth() === d.getMonth();
}

type Tone = "blue" | "green" | "red" | "orange" | "purple" | "indigo";
const tones: Record<Tone, { bg: string; fg: string }> = {
  blue: { bg: "bg-blue-100", fg: "text-blue-600" },
  green: { bg: "bg-emerald-100", fg: "text-emerald-600" },
  red: { bg: "bg-red-100", fg: "text-red-600" },
  orange: { bg: "bg-orange-100", fg: "text-orange-600" },
  purple: { bg: "bg-purple-100", fg: "text-purple-600" },
  indigo: { bg: "bg-indigo-100", fg: "text-indigo-600" },
};

function KpiCard({
  label, value, sub, icon: Icon, tone = "blue", onClick, valueColor,
}: {
  label: string; value: string; sub?: string; icon: React.ComponentType<{ className?: string }>;
  tone?: Tone; onClick?: () => void; valueColor?: string;
}) {
  const t = tones[tone];
  return (
    <button
      onClick={onClick}
      className="card-surface group flex items-start gap-4 p-5 text-left transition-all duration-150 hover:-translate-y-[1px] hover:shadow-md"
    >
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${t.bg}`}>
        <Icon className={`h-5 w-5 ${t.fg}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="section-title truncate">{label}</div>
        <div className={`mt-1 text-[22px] font-bold leading-tight ${valueColor ?? "text-foreground"}`}>{value}</div>
        {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
      </div>
    </button>
  );
}

function Dashboard() {
  const nav = useNavigate();
  const { data: memos } = useStoreData<Memo[]>(() => getMemos(), []);
  const { data: trucks } = useStoreData<FleetTruck[]>(() => getTrucks(), []);
  const { data: consignees } = useStoreData<Consignee[]>(() => getConsignees(), []);

  const m = memos ?? [];
  const today = m.filter((x) => isSameDay(x.dispatchDate));
  const monthly = m.filter((x) => isSameMonth(x.dispatchDate));
  const todayRevenue = today.reduce((s, x) => s + (x.netFreight || 0), 0);
  const todayExpenses = today.reduce((s, x) => s + (x.totalExpenses || 0), 0);
  const todayProfit = todayRevenue - todayExpenses;
  const monthlyRevenue = monthly.reduce((s, x) => s + (x.netFreight || 0), 0);
  const running = m.filter((x) => x.status === "Dispatched").length;
  const completed = m.filter((x) => x.status === "Completed").length;
  const pendingDeliveries = m.filter((x) => x.status === "Dispatched").length;
  const pendingPayment = m.filter(hasOutstandingBalance);
  const pendingPaymentAmount = pendingPayment.reduce((s, x) => s + (x.balance || 0), 0);
  const collectionDue = m.filter(hasOutstandingBalance).reduce((s, x) => s + (x.balance || 0), 0);

  const truckCounts: Record<string, number> = {};
  const truckAmt: Record<string, number> = {};
  const driverCounts: Record<string, number> = {};
  monthly.forEach((x) => {
    truckCounts[x.truckId] = (truckCounts[x.truckId] || 0) + 1;
    truckAmt[x.truckId] = (truckAmt[x.truckId] || 0) + x.netFreight;
    driverCounts[x.driverName] = (driverCounts[x.driverName] || 0) + 1;
  });
  const topTruckId = Object.keys(truckCounts).sort((a, b) => truckCounts[b] - truckCounts[a])[0];
  const topTruck = trucks?.find((t) => t.id === topTruckId);
  const topDriver = Object.keys(driverCounts).sort((a, b) => driverCounts[b] - driverCounts[a])[0];

  const go = (filter: string) => nav({ to: "/register", search: { f: filter } as never });
  const goReport = (period: string) => nav({ to: "/reports", search: { period } as never });

  return (
    <AppShell title="Dashboard" breadcrumb="Home / Dashboard">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Today's Memos" value={String(today.length)} icon={ReceiptText} tone="blue" onClick={() => go("today")} />
        <KpiCard label="Today's Revenue" value={formatMoney(todayRevenue)} icon={IndianRupee} tone="green" onClick={() => goReport("today")} />
        <KpiCard label="Today's Expenses" value={formatMoney(todayExpenses)} icon={TrendingDown} tone="red" onClick={() => goReport("today")} />
        <KpiCard label="Today's Profit" value={formatMoney(todayProfit)} icon={TrendingUp} tone="green" valueColor="text-emerald-600" onClick={() => goReport("today")} />

        <KpiCard label="Running Trips" value={String(running)} icon={Truck} tone="blue" onClick={() => go("running")} />
        <KpiCard label="Completed Trips" value={String(completed)} icon={CheckCircle2} tone="green" onClick={() => go("completed")} />
        <KpiCard label="Pending Deliveries" value={String(pendingDeliveries)} icon={Clock} tone="orange" onClick={() => go("pending")} />
        <KpiCard label="Pending Payments" value={String(pendingPayment.length)} sub={formatMoney(pendingPaymentAmount) + " outstanding"} icon={AlertCircle} tone="orange" onClick={() => go("payment_pending")} />

        <KpiCard label="Collection Due" value={formatMoney(collectionDue)} icon={Wallet} tone="orange" onClick={() => go("collection_due")} />
        <KpiCard label="Monthly Revenue" value={formatMoney(monthlyRevenue)} icon={Calendar} tone="indigo" onClick={() => goReport("month")} />
        <KpiCard label="Total Trucks" value={String(trucks?.length ?? 0)} icon={Truck} tone="purple" onClick={() => nav({ to: "/fleet" })} />
        <KpiCard label="Total Consignors" value={String(consignees?.length ?? 0)} icon={Building2} tone="purple" onClick={() => nav({ to: "/consignees" })} />

        <KpiCard label="Top Truck This Month" value={normalizeTruckNumber(topTruck?.truckNumber) || "—"} sub={topTruck ? `${truckCounts[topTruck.id]} trips · ${formatMoney(truckAmt[topTruck.id])}` : "No data"} icon={Award} tone="indigo" onClick={() => goReport("month")} />
        <KpiCard label="Top Driver This Month" value={topDriver ?? "—"} sub={topDriver ? `${driverCounts[topDriver]} trips` : "No data"} icon={User} tone="indigo" onClick={() => goReport("month")} />

        <KpiCard label="Total Memos (All Time)" value={String(m.length)} icon={Package} tone="blue" onClick={() => nav({ to: "/register" })} />
      </div>
    </AppShell>
  );
}
