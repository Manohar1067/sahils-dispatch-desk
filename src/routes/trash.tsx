import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { useStoreData } from "@/lib/useStore";
import { getAllTrashItems, restoreTrashItem, permanentlyDeleteTrashItem, type TrashItem } from "@/lib/dataStore";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";
import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth, isSuperAdmin } from "@/lib/AuthContext";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/trash")({ component: TrashPage });

const KINDS = ["All", "Memo", "Transport", "Truck", "Consignor"] as const;

function TrashPage() {
  const { profile } = useAuth();
  const admin = isSuperAdmin(profile);
  const { data, refresh } = useStoreData<TrashItem[]>(() => getAllTrashItems(), []);
  const all = data ?? [];
  const [tab, setTab] = useState<string>("All");
  const [pending, setPending] = useState<TrashItem | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = tab === "All" ? all : all.filter((r) => r.kind === tab);

  const doRestore = async (r: TrashItem) => {
    if (busy) return;
    setBusy(true);
    try {
      await restoreTrashItem(r);
      refresh();
      toast.success(`${r.kind} ${r.label} restored`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doPermanentDelete = async () => {
    if (!pending || busy) return;
    const { kind, label } = pending;
    setBusy(true);
    try {
      await permanentlyDeleteTrashItem(pending);
      setPending(null);
      refresh();
      toast.success(`${kind} ${label} permanently deleted`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Trash" breadcrumb="Home / Trash">
      <div className="card-surface p-5">
        <Tabs value={tab} onValueChange={setTab} className="mb-4">
          <TabsList>
            {KINDS.map((k) => (
              <TabsTrigger key={k} value={k}>
                {k === "All" ? "All" : k === "Transport" ? "Transport Entries" : `${k}s`}
                <span className="ml-2 text-xs text-muted-foreground">
                  {k === "All" ? all.length : all.filter((r) => r.kind === k).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left">
            <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Item</th>
                <th className="px-3 py-3">Deleted At</th>
                {admin && <th className="px-3 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={admin ? 4 : 3} className="py-16 text-center text-muted-foreground">Trash is empty</td></tr>
              )}
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`} className="border-b">
                  <td className="px-3 py-3">
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">{r.kind}</span>
                  </td>
                  <td className="px-3 py-3 font-semibold">{r.label}</td>
                  <td className="px-3 py-3">{r.deletedAt ? formatDate(r.deletedAt) : "—"}</td>
                  {admin && (
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => doRestore(r)}>
                          <RotateCcw className="mr-1 h-4 w-4" />Restore
                        </Button>
                        <Button size="sm" variant="destructive" disabled={busy} onClick={() => setPending(r)}>
                          <Trash2 className="mr-1 h-4 w-4" />Delete forever
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Permanently delete {pending?.kind.toLowerCase()} {pending?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This record will be permanently removed from the system. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={doPermanentDelete}>{busy ? "Deleting…" : "Delete permanently"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
