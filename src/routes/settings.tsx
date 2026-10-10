import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { useStoreData } from "@/lib/useStore";
import {
  getSettings,
  updateSettings,
  _resetStore,
  exportAllDataXlsx,
  importAllDataXlsx,
  type Settings,
  type ImportResult,
} from "@/lib/dataStore";
import { supabase } from "@/lib/supabaseClient";
import { DriveBackupSection } from "@/components/DriveBackupSection";
import { DEFAULT_TERMS, DEFAULT_TERMS_TEXT } from "@/lib/terms";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useAuth, isSuperAdmin } from "@/lib/AuthContext";
import { SettingsAccessGate } from "@/components/SettingsAccessGate";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

/** Route component: the existing Settings page is only mounted after the
 *  6-digit PIN has been verified. The gate also covers direct visits to
 *  /settings, not just the sidebar link, and re-locks on refresh, navigation
 *  away, or logout (it holds no persistent unlock state). */
function SettingsPage() {
  return (
    <SettingsAccessGate
      lockedView={
        <AppShell title="Settings" breadcrumb="Home / Settings">
          <div className="card-surface p-6 text-center text-muted-foreground">
            Settings is locked. Enter your PIN to continue.
          </div>
        </AppShell>
      }
    >
      <SettingsContent />
    </SettingsAccessGate>
  );
}

/** Persists the last successful backup timestamp in the browser so it survives
 * refresh and re-login without requiring a live-DB migration. */
const LAST_BACKUP_KEY = "srl:last-backup-at";

function formatBackupTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function getLastBackup(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_BACKUP_KEY);
}

function SettingsContent() {
  const { profile } = useAuth();
  const admin = isSuperAdmin(profile);
  const { data } = useStoreData<Settings>(() => getSettings(), []);
  const [form, setForm] = useState<Settings | null>(null);
  const [uploading, setUploading] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importSummary, setImportSummary] = useState<ImportResult | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [changingPin, setChangingPin] = useState(false);
  const [saving, setSaving] = useState(false);

  // The Settings PIN is the account's existing 6-digit login PIN — this app
  // has only one PIN mechanism. The Current PIN is re-verified server-side
  // (Supabase Auth) BEFORE the change is applied; the stored credential is
  // never read, displayed, or exposed to the frontend.
  const closePinDialog = () => {
    setPinDialogOpen(false);
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
  };

  const changeSettingsPin = async () => {
    if (!/^\d{6}$/.test(currentPin)) {
      toast.error("Current PIN must be exactly 6 digits");
      return;
    }
    if (!/^\d{6}$/.test(newPin)) {
      toast.error("PIN must be exactly 6 digits");
      return;
    }
    if (newPin !== confirmPin) {
      toast.error("PINs do not match");
      return;
    }
    setChangingPin(true);
    try {
      const { data: authData } = await supabase.auth.getSession();
      const email = authData.session?.user.email;
      if (!email) {
        toast.error("Your session has expired. Please log in again.");
        return;
      }
      const { error: currentError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPin,
      });
      if (currentError) {
        toast.error(
          currentError.message?.toLowerCase().includes("invalid login credentials")
            ? "Current PIN is incorrect"
            : currentError.message || "Could not verify the current PIN",
        );
        setCurrentPin("");
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPin });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Settings PIN has been changed");
      closePinDialog();
    } finally {
      setChangingPin(false);
    }
  };

  // Pre-load the seven ORIGINAL Conditions into the editor whenever the company
  // has never saved a list of its own, so the conditions from the physical
  // document are visible and editable here. This only seeds the local form — it
  // is persisted only when an administrator explicitly presses Save Settings,
  // and it never touches any memo record.
  useEffect(() => {
    if (data) {
      setForm({ ...data, terms: data.terms?.trim() ? data.terms : DEFAULT_TERMS_TEXT });
    }
  }, [data]);
  useEffect(() => {
    setLastBackup(getLastBackup());
  }, []);

  if (!form)
    return (
      <AppShell title="Settings">
        <div className="card-surface p-8">Loading…</div>
      </AppShell>
    );

  if (!admin) {
    return (
      <AppShell title="Settings" breadcrumb="Home / Settings">
        <div className="card-surface p-6 text-center text-muted-foreground">
          Viewers have read-only access. Settings can only be modified by a Super Admin.
        </div>
      </AppShell>
    );
  }

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setForm((f) => ({ ...(f as Settings), [k]: v }));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateSettings(form);
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const confirmReset = async () => {
    if (resetting) return;
    setResetting(true);
    try {
      await _resetStore();
      setResetOpen(false);
      toast.success("Business data reset. This year's memo numbering restarts from its baseline.");
    } catch (e) {
      // Keep the dialog open so the user can retry; a failed reset is never
      // reported as success.
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      // Try Supabase Storage first (bucket must be created & public)
      const ext = file.name.split(".").pop() || "png";
      const path = `logo-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("logos")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const { data: pub } = supabase.storage.from("logos").getPublicUrl(path);
      set("logoUrl", pub.publicUrl);
      await updateSettings({ logoUrl: pub.publicUrl });
      toast.success("Logo uploaded");
    } catch (err) {
      // Fallback: embed as data URL so app still works even without storage bucket
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      set("logoUrl", dataUrl);
      await updateSettings({ logoUrl: dataUrl });
      toast.warning(
        "Storage bucket unavailable — logo embedded locally. Create a public 'logos' bucket in Supabase for hosted uploads.",
      );
      console.warn("Logo upload fallback:", err);
    } finally {
      setUploading(false);
    }
  };

  const exportAll = async () => {
    try {
      await exportAllDataXlsx();
      // Only a SUCCESSFUL export advances the "Last Backup" timestamp.
      const now = new Date().toISOString();
      try {
        window.localStorage.setItem(LAST_BACKUP_KEY, now);
      } catch {
        /* ignore */
      }
      setLastBackup(now);
      toast.success("Excel backup downloaded");
    } catch (e) {
      toast.error("Export failed");
      console.error(e);
    }
  };

  const pickImportFile = () => importInputRef.current?.click();
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
    }
    e.target.value = "";
  };
  const confirmImport = async () => {
    if (!importFile) return;
    try {
      const summary = await importAllDataXlsx(importFile);
      setImportSummary(summary);
      const { memos, trucks, consignees, transports } = summary;
      const inserted = memos.inserted + trucks.inserted + consignees.inserted + transports.inserted;
      const restored = memos.restored + trucks.restored + consignees.restored + transports.restored;
      const skipped = memos.skipped + trucks.skipped + consignees.skipped + transports.skipped;
      const failed = memos.failed + trucks.failed + consignees.failed + transports.failed;
      const detail =
        `${inserted} added, ${restored} restored, ${skipped} already present` +
        (summary.settingsUpdated ? ", settings updated" : "") +
        (failed > 0 ? `, ${failed} failed` : "");
      // Never show a clean success when numbering could not be reconciled or
      // any row failed: the operator must know the restore needs attention.
      if (!summary.numberingReconciled) {
        toast.error(
          `Import finished (${detail}) but memo numbering could NOT be reconciled — verify counters before creating memos.`,
        );
      } else if (failed > 0) {
        toast.warning(`Import finished with errors: ${detail}. See the summary below for details.`);
      } else {
        toast.success(`Import finished: ${detail}`);
      }
      setImportFile(null);
    } catch (e) {
      toast.error("Import failed — see console for details");
      console.error(e);
    }
  };

  return (
    <AppShell
      title="Settings"
      breadcrumb="Home / Settings"
      actions={
        <Button disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      }
    >
      <div className="space-y-5 pb-24">
        <div className="card-surface p-6">
          <div className="section-title mb-2">Company Information</div>
          <div className="mb-5 border-b" />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <Label>Company Name</Label>
              <Input
                className="h-11 mt-1.5"
                value={form.companyName}
                onChange={(e) => set("companyName", e.target.value)}
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                className="h-11 mt-1.5"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input
                className="h-11 mt-1.5"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </div>
            <div>
              <Label>Website</Label>
              <Input
                className="h-11 mt-1.5"
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
              />
            </div>
            <div>
              <Label>GST Number</Label>
              <Input
                className="h-11 mt-1.5"
                value={form.gst}
                onChange={(e) => set("gst", e.target.value)}
              />
            </div>
            <div>
              <Label>Jurisdiction Text</Label>
              <Input
                className="h-11 mt-1.5"
                value={form.jurisdictionText}
                onChange={(e) => set("jurisdictionText", e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Address</Label>
              <Textarea
                rows={3}
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                className="mt-1.5"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Put the H.O. address on its own line starting with &ldquo;H.O.&rdquo; — the memo
                header prints it as a separate <strong>H.O. Address</strong> line, exactly as on the
                original receipt.
              </p>
            </div>
            <div className="md:col-span-2">
              <Label>Logo</Label>
              <div className="mt-1.5 flex items-center gap-4">
                {form.logoUrl && (
                  <img
                    src={form.logoUrl}
                    className="h-16 w-16 rounded border object-contain"
                    alt="logo"
                  />
                )}
                {uploading ? (
                  <div className="flex h-11 items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading…
                  </div>
                ) : (
                  <Input
                    type="file"
                    accept="image/*"
                    className="h-11 max-w-xs"
                    onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
                  />
                )}
                {form.logoUrl && !uploading && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      set("logoUrl", "");
                      updateSettings({ logoUrl: "" });
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="card-surface p-6">
          <div className="section-title mb-2">Printed Terms &amp; Conditions</div>
          <div className="mb-5 border-b" />
          <p className="mb-3 text-xs text-muted-foreground">
            One condition per line. The receipt prints these automatically in up to three columns
            (1&ndash;5 in the first, 6&ndash;10 in the second, 11&ndash;15 in the third). Leave the
            box empty to print the {DEFAULT_TERMS.length} conditions from the original Sahil Road
            Lines Conditions document.
          </p>
          <Textarea rows={10} value={form.terms} onChange={(e) => set("terms", e.target.value)} />
          <div className="mt-3 flex items-center gap-3">
            <Button variant="outline" onClick={() => set("terms", DEFAULT_TERMS_TEXT)}>
              Restore the original {DEFAULT_TERMS.length} conditions
            </Button>
            <Button variant="ghost" onClick={() => set("terms", "")}>
              Clear (use printed defaults)
            </Button>
          </div>
        </div>

        <div className="card-surface p-6">
          <div className="section-title mb-2">Security</div>
          <div className="mb-5 border-b" />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="font-medium">Settings PIN</div>
              <div className="text-sm text-muted-foreground">
                Protect access to Settings with a 6-digit PIN.
              </div>
              <div className="text-xs text-muted-foreground">
                It is the same PIN you use to log in — changing it also changes your login PIN.
              </div>
            </div>
            <Button onClick={() => setPinDialogOpen(true)}>Change PIN</Button>
          </div>
        </div>

        {/* Change Settings PIN — the current PIN is verified server-side before
            the change is applied; the stored credential is never read by the frontend. */}
        <Dialog
          open={pinDialogOpen}
          onOpenChange={(open) => {
            if (!open) closePinDialog();
          }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Change Settings PIN</DialogTitle>
              <DialogDescription>
                Enter your current PIN, then choose a new 6-digit PIN.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void changeSettingsPin();
              }}
            >
              <div>
                <Label>Current PIN</Label>
                <Input
                  className="h-11 mt-1.5 tracking-[0.4em]"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="••••••"
                  autoComplete="current-password"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </div>
              <div>
                <Label>New 6-digit PIN</Label>
                <Input
                  className="h-11 mt-1.5 tracking-[0.4em]"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="••••••"
                  autoComplete="new-password"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </div>
              <div>
                <Label>Confirm New PIN</Label>
                <Input
                  className="h-11 mt-1.5 tracking-[0.4em]"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="••••••"
                  autoComplete="new-password"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closePinDialog}
                  disabled={changingPin}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    changingPin ||
                    currentPin.length !== 6 ||
                    newPin.length !== 6 ||
                    confirmPin.length !== 6
                  }
                >
                  {changingPin ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Changing…
                    </>
                  ) : (
                    "Change PIN"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <div className="card-surface p-6">
          <div className="section-title mb-2">Backup / Restore</div>
          <div className="mb-5 border-b" />
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="font-medium text-foreground">Last Backup:</span>
            <span className={lastBackup ? "text-navy font-semibold" : "text-muted-foreground"}>
              {lastBackup ? formatBackupTime(lastBackup) : "Never"}
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={exportAll}>
              Export All Data (Excel)
            </Button>
            <Button variant="outline" onClick={pickImportFile}>
              Import Excel…
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={onImportFile}
            />
            <Button variant="destructive" onClick={() => setResetOpen(true)}>
              Reset All Data
            </Button>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Export downloads an Excel workbook (Memos / Fleet / Consignees / Transport / Settings
            sheets). Import can read that workbook or a single-sheet Register / Transport List
            export ("Sheet1"), merging records safely using memo number, truck number, and company
            name as stable identifiers: existing records are never overwritten or duplicated,
            records previously deleted are restored, and missing records are added.
          </div>

          {/* Google Drive — a separate authorisation from the Sahil Road Lines login.
              The Drive workbook is produced by the same buildBackupWorkbook() that the
              download button above uses, and a chosen Drive file flows into the existing
              import confirmation / summary dialogs above. */}
          <DriveBackupSection onPickImportFile={setImportFile} />
        </div>
      </div>

      <div className="fixed bottom-0 left-60 right-0 z-10 flex justify-end gap-2 border-t bg-background/95 px-8 py-3 backdrop-blur">
        <Button disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>

      {/* Import confirm */}
      <AlertDialog open={!!importFile} onOpenChange={(o) => !o && setImportFile(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import Excel backup?</AlertDialogTitle>
            <AlertDialogDescription>
              This will safely merge memos, trucks, consignees, and settings from the selected Excel
              file. Records that already exist are skipped (never overwritten or duplicated);
              records that were previously deleted are restored; missing records are added. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmImport}>Import</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import summary */}
      <AlertDialog open={!!importSummary} onOpenChange={(o) => !o && setImportSummary(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import complete</AlertDialogTitle>
            <AlertDialogDescription>
              {importSummary && (
                <>
                  <div className="space-y-2 text-left">
                    {importSummary.recognizedSheets.length === 0 ? (
                      <>
                        <p className="text-destructive">
                          No supported worksheets were found in this workbook.
                        </p>
                        <ul className="space-y-1 text-sm">
                          {importSummary.sheets.map((s) => (
                            <li key={s.sheetName}>
                              <b>{s.sheetName}</b>
                              {s.rows === 0
                                ? " — no data rows (blank)."
                                : ` — ${s.rows} row(s) present, but headers could not be recognized: ${s.columns.slice(0, 8).join(" · ")}${s.columns.length > 8 ? " …" : ""}`}
                            </li>
                          ))}
                          {importSummary.sheets.length === 0 && (
                            <li>— a blank/malformed file was read; no sheets found.</li>
                          )}
                        </ul>
                      </>
                    ) : (
                      <>
                        {[
                          { label: "Memos", c: importSummary.memos },
                          { label: "Transport Entries", c: importSummary.transports },
                          { label: "Trucks", c: importSummary.trucks },
                          { label: "Consignees", c: importSummary.consignees },
                        ].map(({ label, c }) => (
                          <div key={label}>
                            <b>{label}:</b> {c.inserted + c.restored} imported ({c.inserted} added,{" "}
                            {c.restored} restored), {c.skipped} already present, {c.failed} failed,{" "}
                            {c.duplicate} duplicate-in-file
                          </div>
                        ))}
                        {(() => {
                          const failed = importSummary.sheets.flatMap((s) =>
                            s.operations.filter((o) => o.operation === "failed"),
                          );
                          if (failed.length === 0) return null;
                          return (
                            <details className="mt-2 max-h-56 overflow-y-auto rounded border border-border p-2 text-sm">
                              <summary className="cursor-pointer font-medium text-destructive">
                                {failed.length} failed row(s) — expand for details
                              </summary>
                              <ul className="mt-2 space-y-1">
                                {failed.map((o, i) => (
                                  <li key={i}>
                                    <b>{o.key || "(no key)"}</b> (row {o.row}):
                                    {o.code ? ` [${o.code}]` : ""} {o.message ?? "operation failed"}
                                    {o.details ? ` — ${o.details}` : ""}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          );
                        })()}
                        {importSummary.settingsUpdated && (
                          <div>
                            <b>Settings:</b> updated
                          </div>
                        )}
                        {importSummary.unknownSheets.length > 0 && (
                          <p className="text-muted-foreground">
                            Unrecognized sheet(s) — not imported:{" "}
                            {importSummary.sheets
                              .filter((s) => !s.recognized)
                              .map(
                                (s) => `${s.sheetName} (${s.rows} row${s.rows === 1 ? "" : "s"})`,
                              )
                              .join(", ")}
                          </p>
                        )}
                      </>
                    )}
                    <p className="text-xs text-muted-foreground">
                      File: {importSummary.file.name} ({importSummary.file.size.toLocaleString()}{" "}
                      bytes)
                    </p>
                  </div>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setImportSummary(null)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset confirm */}
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all business data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all records from:
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>Register List / memo data</li>
                <li>Transport List data</li>
                <li>Consignor Management</li>
                <li>Fleet Management</li>
              </ul>
              <p className="mt-2">
                User accounts, authentication, settings, and your current login will <b>NOT</b> be
                affected. This year's memo numbering restarts from its physical baseline, so the
                next memo continues after the last memo issued on paper and nothing is re-issued.
                The transport numbering sequence is preserved.
              </p>
              <p className="mt-2">Consider exporting a backup first.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetting}
              onClick={(e) => {
                // Prevent Radix from closing the dialog before the DB confirms;
                // confirmReset closes it only on success.
                e.preventDefault();
                void confirmReset();
              }}
            >
              {resetting ? "Resetting…" : "Reset Business Data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
