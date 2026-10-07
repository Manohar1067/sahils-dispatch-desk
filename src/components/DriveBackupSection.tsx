/**
 * Google Drive section for Settings → Backup/Restore.
 *
 * Owns ONLY Drive concerns: connect/disconnect, upload the workbook produced by
 * `buildBackupWorkbook()`, and pick an existing Drive backup to restore.
 *
 * The workbook bytes come from dataStore's `buildBackupWorkbook()` and the
 * chosen file is handed to the page via `onPickImportFile`, which feeds the
 * page's EXISTING import confirmation + summary dialogs and then the existing
 * `importAllDataXlsx(file)`.  No import/validation/merge logic is duplicated.
 */

import { useCallback, useEffect, useState } from "react";
import { Cloud, CloudOff, Loader2, RefreshCw, Upload, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { BACKUP_FILENAME_PREFIX, backupFileName, buildBackupWorkbook } from "@/lib/dataStore";
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  downloadBackupFromDrive,
  driveErrorMessage,
  isDriveConfigured,
  isDriveConnected,
  listDriveBackups,
  uploadBackupToDrive,
  type DriveBackupFile,
} from "@/lib/googleDrive";

/** Timestamp of the last SUCCESSFUL Drive backup. Not a credential. */
const LAST_DRIVE_BACKUP_KEY = "srl:gdrive-last-backup-at";

function readLastDriveBackup(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_DRIVE_BACKUP_KEY);
  } catch {
    return null;
  }
}

function recordLastDriveBackup(iso: string) {
  try {
    window.localStorage.setItem(LAST_DRIVE_BACKUP_KEY, iso);
  } catch {
    // ignore — the timestamp is a convenience, not the source of truth.
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatSize(bytes: string | undefined): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDriveDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

interface Props {
  /** Hands a Drive-downloaded File to the page's existing import flow. */
  onPickImportFile: (file: File) => void;
}

export function DriveBackupSection({ onPickImportFile }: Props) {
  const configured = isDriveConfigured();
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<
    "connect" | "backup" | "picker" | "download" | "disconnect" | null
  >(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [files, setFiles] = useState<DriveBackupFile[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    setConnected(isDriveConnected());
    setLastBackup(readLastDriveBackup());
  }, []);

  /** Clears the two banner messages before a new operation starts. */
  const beginOp = useCallback((op: typeof busy) => {
    setBusy(op);
    setError(null);
    setSuccess(null);
  }, []);

  const onConnect = async () => {
    beginOp("connect");
    try {
      await connectGoogleDrive();
      setConnected(true);
      setSuccess(
        "Google Drive connected. This app can now read and write only its own backup files.",
      );
      toast.success("Google Drive connected");
    } catch (e) {
      const msg = driveErrorMessage(e);
      setError(msg);
      setConnected(false);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  };

  const onDisconnect = async () => {
    beginOp("disconnect");
    try {
      await disconnectGoogleDrive();
      setConnected(false);
      setFiles([]);
      setSuccess("Google Drive disconnected. Access has been revoked.");
      toast.success("Google Drive disconnected");
    } catch (e) {
      const msg = driveErrorMessage(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  };

  const onBackup = async () => {
    beginOp("backup");
    try {
      // Identical workbook to the local download — same bytes, same sheets.
      const blob = await buildBackupWorkbook();
      const filename = backupFileName();
      const result = await uploadBackupToDrive(blob, filename, BACKUP_FILENAME_PREFIX);
      const now = new Date().toISOString();
      recordLastDriveBackup(now);
      setLastBackup(now);
      const msg =
        result.action === "updated"
          ? `Updated ${filename} in Google Drive.`
          : `Uploaded ${filename} to Google Drive.`;
      setSuccess(msg);
      toast.success(msg);
    } catch (e) {
      const msg = driveErrorMessage(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  };

  const onOpenPicker = async () => {
    beginOp("picker");
    setPickerOpen(true);
    try {
      const found = await listDriveBackups(BACKUP_FILENAME_PREFIX);
      setFiles(found);
      if (found.length === 0) {
        setSuccess("No backups found in Google Drive yet. Use “Backup to Google Drive” first.");
      }
    } catch (e) {
      const msg = driveErrorMessage(e);
      setError(msg);
      toast.error(msg);
      setPickerOpen(false);
    } finally {
      setBusy(null);
    }
  };

  const onChoose = async (file: DriveBackupFile) => {
    setDownloadingId(file.id);
    setError(null);
    try {
      const local = await downloadBackupFromDrive(file);
      setPickerOpen(false);
      // Hand to the page's EXISTING confirm dialog → importAllDataXlsx().
      onPickImportFile(local);
    } catch (e) {
      const msg = driveErrorMessage(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setDownloadingId(null);
    }
  };

  const loading = busy !== null;

  return (
    <div className="mt-6 border-t pt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {connected ? (
            <Cloud className="h-4 w-4 text-emerald-600" aria-hidden />
          ) : (
            <CloudOff className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span>Google Drive</span>
          <span
            className={
              connected
                ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"
                : "rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground"
            }
          >
            {configured ? (connected ? "Connected" : "Not Connected") : "Not Configured"}
          </span>
        </div>
        {connected && (
          <Button variant="ghost" size="sm" disabled={loading} onClick={onDisconnect}>
            {busy === "disconnect" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Unlink className="mr-2 h-4 w-4" />
            )}
            Disconnect
          </Button>
        )}
      </div>

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="font-medium text-foreground">Last Google Drive backup:</span>
        <span className={lastBackup ? "font-semibold text-navy" : "text-muted-foreground"}>
          {formatTime(lastBackup)}
        </span>
      </div>

      {!configured ? (
        <p className="text-xs text-muted-foreground">
          Google Drive is not configured for this deployment. A Super Admin must set the public
          OAuth client id <code className="rounded bg-muted px-1">VITE_GOOGLE_CLIENT_ID</code> and
          redeploy. Local backup and restore are unaffected.
        </p>
      ) : !connected ? (
        <Button variant="outline" disabled={loading} onClick={onConnect}>
          {busy === "connect" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Cloud className="mr-2 h-4 w-4" />
          )}
          {busy === "connect" ? "Connecting…" : "Connect Google Drive"}
        </Button>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button disabled={loading} onClick={onBackup}>
            {busy === "backup" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {busy === "backup" ? "Backing up…" : "Backup to Google Drive"}
          </Button>
          <Button variant="outline" disabled={loading} onClick={onOpenPicker}>
            {busy === "picker" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {busy === "picker" ? "Loading backups…" : "Restore from Google Drive"}
          </Button>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        This uses a separate Google authorisation from your Sahil Road Lines login, and requests
        only the <code className="rounded bg-muted px-1">drive.file</code> scope — the app can read
        and write only the backup files it created. No Google client secret is stored in the
        browser.
      </p>

      {success && (
        <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {success}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Drive backup picker */}
      <AlertDialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore from Google Drive</AlertDialogTitle>
            <AlertDialogDescription>
              Choose a backup to download. It is then merged using exactly the same safe rules as a
              local Excel restore — existing records are skipped, previously deleted records are
              restored, and missing records are added.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="max-h-72 overflow-y-auto rounded border">
            {busy === "picker" || downloadingId ? (
              <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {downloadingId ? "Downloading backup…" : "Loading backups…"}
              </div>
            ) : files.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No backups found in Google Drive yet.
              </p>
            ) : (
              <ul className="divide-y">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{f.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDriveDate(f.modifiedTime)}
                        {formatSize(f.size) ? ` · ${formatSize(f.size)}` : ""}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => onChoose(f)}>
                      Use this
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
