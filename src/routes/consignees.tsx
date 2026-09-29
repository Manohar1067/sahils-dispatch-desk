import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { useStoreData } from "@/lib/useStore";
import { getConsignees, createConsignee, updateConsignee, deleteConsignee, type Consignee } from "@/lib/dataStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState } from "react";
import { Pencil, Trash2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { useAuth, isSuperAdmin } from "@/lib/AuthContext";

export const Route = createFileRoute("/consignees")({ component: Page });

const empty: Omit<Consignee, "id"> = {
  companyName: "", address: "", contactPerson: "", phone: "", city: "", state: "", remarks: "",
};

function Page() {
  const { profile } = useAuth();
  const admin = isSuperAdmin(profile);
  const { data: rows } = useStoreData<Consignee[]>(() => getConsignees(), []);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Consignee | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = (rows ?? []).filter((r) =>
    [r.companyName, r.city, r.state, r.contactPerson, r.phone].some((v) => v.toLowerCase().includes(q.toLowerCase())),
  );

  const openNew = () => { setForm(empty); setEditId(null); setOpen(true); };
  const openEdit = (c: Consignee) => { const { id, ...rest } = c; void id; setForm(rest); setEditId(c.id); setOpen(true); };
  const save = async () => {
    if (busy) return;
    try {
      if (!form.companyName) return toast.error("Company name required");
      setBusy(true);
      if (editId) { await updateConsignee(editId, form); toast.success("Consignor updated"); }
      else { await createConsignee(form); toast.success("Consignor added"); }
      setOpen(false);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const confirmDelete = async () => {
    if (!pendingDelete || busy) return;
    const n = pendingDelete.companyName;
    setBusy(true);
    try {
      await deleteConsignee(pendingDelete.id);
      setPendingDelete(null);
      toast.success(`Consignor ${n} deleted`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Consignor Management" breadcrumb="Home / Consignor Management" actions={admin ? <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" />Add Consignor</Button> : undefined}>
      <div className="card-surface p-5">
        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search consignors…" className="h-11 pl-9" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-3">Company</th><th className="px-3 py-3">Contact</th><th className="px-3 py-3">Phone</th>
                <th className="px-3 py-3">City</th><th className="px-3 py-3">State</th><th className="px-3 py-3">Address</th>
                {admin && <th className="px-3 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (<tr><td colSpan={admin ? 7 : 6} className="py-16 text-center text-muted-foreground">No consignors found</td></tr>)}
              {filtered.map((c) => (
                <tr key={c.id} className="border-b hover:bg-muted/30">
                  <td className="px-3 py-3 font-semibold">{c.companyName}</td>
                  <td className="px-3 py-3">{c.contactPerson}</td>
                  <td className="px-3 py-3">{c.phone}</td>
                  <td className="px-3 py-3">{c.city}</td>
                  <td className="px-3 py-3">{c.state}</td>
                  <td className="px-3 py-3 text-sm text-muted-foreground">{c.address}</td>
                  {admin && (
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => setPendingDelete(c)}>
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
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editId ? "Edit Consignor" : "Add Consignor"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><Label>Company Name *</Label><Input className="h-11 mt-1.5" value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} /></div>
            <div><Label>Contact Person</Label><Input className="h-11 mt-1.5" value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} /></div>
            <div><Label>Phone</Label><Input className="h-11 mt-1.5" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
            <div><Label>City</Label><Input className="h-11 mt-1.5" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} /></div>
            <div><Label>State</Label><Input className="h-11 mt-1.5" value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} /></div>
            <div className="col-span-2"><Label>Address</Label><Textarea rows={2} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className="mt-1.5" /></div>
            <div className="col-span-2"><Label>Remarks</Label><Input className="h-11 mt-1.5" value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete consignor {pendingDelete?.companyName}?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={busy}>{busy ? "Deleting…" : "Delete"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
