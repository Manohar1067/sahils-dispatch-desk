import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { useTransportData } from "@/lib/useTransportStore";
import { getTransportEntry, deleteTransportEntry, type TransportEntry } from "@/lib/transportListStore";
import { formatDate, formatMoney, normalizeTruckNumber } from "@/lib/format";
import { formatDisplayText } from "@/lib/textUtils";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth, isSuperAdmin } from "@/lib/AuthContext";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/transport/$id")({
  component: TransportEntryView,
});

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-[15px] font-medium">{value ?? "—"}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-surface p-6">
      <div className="section-title mb-2">{title}</div>
      <div className="mb-5 border-b" />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function TransportEntryView() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const { profile } = useAuth();
  const admin = isSuperAdmin(profile);
  const [confirmDel, setConfirmDel] = useState(false);
  const { data: entry } = useTransportData<TransportEntry | undefined>(() => getTransportEntry(id), [id]);

  if (!entry) {
    return (
      <AppShell title="Transport Entry" breadcrumb="Home / Transport List / Entry">
        <div className="card-surface p-10 text-center text-muted-foreground">Loading entry…</div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={`Entry ${entry.entryNumber}`}
      breadcrumb="Home / Transport List / Entry"
      actions={
        <>
          {admin && <Link to="/transport-edit/$id" params={{ id: entry.id }}>
            <Button variant="outline"><Pencil className="mr-1 h-4 w-4" />Edit</Button>
          </Link>}
          {admin && <Button variant="destructive" onClick={() => setConfirmDel(true)}>
            <Trash2 className="mr-1 h-4 w-4" />Delete
          </Button>}
        </>
      }
    >
      <div className="space-y-5">
        <Section title="Entry Information">
          <Row label="Entry Number" value={<span className="font-mono">{entry.entryNumber}</span>} />
          <Row label="Dispatch Date" value={formatDate(entry.dispatchDate)} />
          <Row label="Status" value={<StatusBadge status={entry.status} />} />
          <Row label="Remarks" value={formatDisplayText(entry.remarks) || "—"} />
        </Section>

        <Section title="Transport Information">
          <Row label="From" value={formatDisplayText(entry.fromLocation) || "—"} />
          <Row label="To" value={formatDisplayText(entry.toLocation) || "—"} />
          <Row label="Transport Name" value={formatDisplayText(entry.transportName) || "—"} />
          <Row label="Consignor" value={formatDisplayText(entry.consigneeName) || "—"} />
        </Section>

        <Section title="Vehicle Information">
          <Row label="Truck Number" value={normalizeTruckNumber(entry.truckNumber) || "—"} />
          <Row label="Driver Name" value={formatDisplayText(entry.driverName) || "—"} />
          <Row label="Owner Name" value={formatDisplayText(entry.ownerName) || "—"} />
          <Row label="Owner Phone" value={entry.ownerPhone || "—"} />
        </Section>

        <Section title="Goods Information">
          <Row label="Material" value={formatDisplayText(entry.materialName) || "—"} />
          <Row label="Weight (tons)" value={entry.weightTons} />
          <Row label="Rate/Ton (Transport)" value={formatMoney(entry.ratePerTon)} />
          <Row label="Unloading Date" value={formatDate(entry.unloadingDate)} />
          <Row label="Halting Charge (₹)" value={formatMoney(entry.haltingCharge)} />
          <Row label="LR Received Date" value={formatDate(entry.lrReceivedDate)} />
          <Row label="LR Submitted Date" value={formatDate(entry.lrSubmittedDate)} />
          <Row label="Description" value={formatDisplayText(entry.description) || "—"} />
        </Section>

        <Section title="Payment Information">
          <Row label="Net Freight" value={formatMoney(entry.netFreight)} />
          <Row label="Advance" value={formatMoney(entry.advance)} />
          <Row label="Balance" value={formatMoney(entry.balance)} />
          <Row label="Commission" value={formatMoney(entry.commission)} />
          <Row label="Loading Charges" value={formatMoney(entry.loadingCharges)} />
          <Row label="TDS" value={formatMoney(entry.tds)} />
          <Row label="Goods Mamuli" value={formatMoney(entry.goodsMamuli)} />
          <Row label="Total Expenses" value={formatMoney(entry.totalExpenses)} />
          <Row label="Paid By" value={entry.paidBy === "SRL" ? "Sahil" : entry.paidBy === "KAREEM" ? "Kareem" : entry.paidBy || "—"} />
          <Row label="Payment Method" value={entry.paymentMethod || "—"} />
          <Row label="Final Payable" value={formatMoney(entry.finalPayable)} />
          <Row label="Final Payment Date" value={formatDate(entry.finalPaymentDate)} />
        </Section>
      </div>

      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete transport entry?</AlertDialogTitle>
            <AlertDialogDescription>
              Entry <b>{entry.entryNumber}</b> will be removed from the Transport List.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              await deleteTransportEntry(entry.id);
              toast.success(`Entry ${entry.entryNumber} deleted`);
              nav({ to: "/transport-list" });
            }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
