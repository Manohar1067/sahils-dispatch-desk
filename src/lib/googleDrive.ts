/**
 * ============================================================================
 *  GOOGLE DRIVE BACKUP — Sahil Road Lines ERP
 * ----------------------------------------------------------------------------
 *  Client-side Google Drive integration for the Excel backup in Settings →
 *  Backup/Restore.
 *
 *  WHY NO new npm dependency
 *  ------------------------
 *  The Drive operations we need are three REST calls (list / upload / download).
 *  The `googleapis` package is a large Node-oriented SDK; importing it would
 *  add weight and version risk to the Vite/TanStack Start build for no gain.
 *  OAuth is handled by Google Identity Services (GIS), which is a plain
 *  <script> loaded on demand, and Drive is called over HTTPS with `fetch`.
 *
 *  SECURITY MODEL
 *  --------------
 *  - OAuth 2.0 via GIS `initTokenClient`. The client-side token flow needs NO
 *    client secret, so there is no secret to embed in the bundle and therefore
 *    NO backend / Supabase Edge Function is required. Only the public OAuth
 *    client id is configured, via VITE_GOOGLE_CLIENT_ID.
 *  - Scope is `drive.file` ONLY. Google grants this app access to just the
 *    files this app itself created. It cannot read, modify or delete any other
 *    file in the user's Drive — the strictest scope that still allows the app
 *    to round-trip its own backups.
 *  - The access token lives in a module variable and is mirrored in
 *    `sessionStorage` (dies with the browser tab). It is NEVER written to the
 *    Supabase database, never written to `localStorage`, and never logged.
 *    `disconnectGoogleDrive()` revokes it at Google and clears it locally.
 *  - Supabase Auth (email + PIN) is entirely separate from this. Signing in to
 *    Sahil Road Lines does NOT connect Google Drive, and connecting Google
 *    Drive does NOT sign anybody in or grant any app access.
 *
 *  WORKBOOK PROVENANCE
 *  -------------------
 *  The bytes uploaded here come from `buildBackupWorkbook()` in dataStore.ts —
 *  the exact function the local "Download Excel Backup" button uses — so a
 *  Drive backup and a local download are identical.
 * ============================================================================
 */

const GIS_SRC = "https://accounts.google.com/gsi/client";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

/** Minimum scope: this app's own files only. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TOKEN_STORAGE_KEY = "srl:google-drive-token";

/** Hard ceiling on the GIS <script> load, so a stalled request can never hang the UI. */
const GIS_LOAD_TIMEOUT_MS = 15_000;
/** Hard ceiling on the OAuth round-trip (popup) so "Connecting…" always resolves. */
const OAUTH_TIMEOUT_MS = 120_000;

/* -------------------------------------------------------------------------- */
/* Minimal GIS typings — avoids adding a @types/google.accounts dependency.     */
/* -------------------------------------------------------------------------- */

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string; hint?: string }): void;
}

interface GisTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: GisTokenResponse) => void;
  error_callback?: (err: { type?: string; message?: string }) => void;
}

interface GisAccounts {
  accounts: {
    oauth2: {
      initTokenClient(config: GisTokenClientConfig): GisTokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}

declare global {
  interface Window {
    google?: GisAccounts;
  }
}

/* -------------------------------------------------------------------------- */
/* Public types                                                                 */
/* -------------------------------------------------------------------------- */

export interface DriveToken {
  accessToken: string;
  /** Epoch ms at which Google expires this token. */
  expiresAt: number;
  scope: string;
}

export interface DriveBackupFile {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
}

export interface DriveUploadResult {
  file: DriveBackupFile;
  /** "updated" means an existing same-day backup was replaced in place. */
  action: "created" | "updated";
}

export class GoogleDriveError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message);
    this.name = "GoogleDriveError";
  }
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

/** Public OAuth client id. Safe in VITE_ — it is not a secret. */
export function googleClientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "").trim();
}

/** True when a Google OAuth client id has been configured for this deployment. */
export function isDriveConfigured(): boolean {
  return googleClientId().length > 0;
}

function requireClientId(): string {
  const id = googleClientId();
  if (!id) {
    throw new GoogleDriveError(
      "VITE_GOOGLE_CLIENT_ID is not set",
      "Google Drive is not configured for this deployment. A Super Admin must set VITE_GOOGLE_CLIENT_ID and redeploy.",
    );
  }
  return id;
}

/* -------------------------------------------------------------------------- */
/* Token store — memory first, sessionStorage as a tab-lifetime mirror.         */
/* -------------------------------------------------------------------------- */

let inMemoryToken: DriveToken | null = null;
let storageChecked = false;

function sessionStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    // Private-mode / blocked storage — memory-only mode is still correct.
    return null;
  }
}

function adoptStoredToken() {
  if (storageChecked) return;
  storageChecked = true;
  const store = sessionStore();
  if (!store) return;
  try {
    const raw = store.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as DriveToken;
    if (parsed && typeof parsed.accessToken === "string" && Number(parsed.expiresAt) > 0) {
      inMemoryToken = parsed;
    }
  } catch {
    store.removeItem(TOKEN_STORAGE_KEY);
  }
}

/** Returns the current token only while it is still usable; never null-safe surprises. */
export function getDriveToken(): DriveToken | null {
  adoptStoredToken();
  if (!inMemoryToken) return null;
  if (inMemoryToken.expiresAt <= Date.now() + 30_000) {
    clearDriveToken();
    return null;
  }
  return inMemoryToken;
}

export function isDriveConnected(): boolean {
  return getDriveToken() !== null;
}

function setDriveToken(token: DriveToken) {
  inMemoryToken = token;
  const store = sessionStore();
  if (!store) return;
  try {
    store.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token));
  } catch {
    // Non-fatal: the token still works for the life of this page.
  }
}

export function clearDriveToken() {
  inMemoryToken = null;
  const store = sessionStore();
  if (!store) return;
  try {
    store.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/* -------------------------------------------------------------------------- */
/* Google Identity Services loader (lazy, browser-only)                        */
/* -------------------------------------------------------------------------- */

let gisPromise: Promise<GisAccounts> | null = null;

/** GIS is only usable once `google.accounts.oauth2` exists. */
function readyGis(): GisAccounts | null {
  return typeof window !== "undefined" && window.google?.accounts?.oauth2 ? window.google : null;
}

function removeGisScript(): void {
  if (typeof document === "undefined") return;
  document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`)?.remove();
}

/** One-shot settle guard: late callbacks are ignored and the timer is always cleared. */
function settleOnce() {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settle = (action: () => void) => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    action();
  };
  return {
    settle,
    arm(ms: number, action: () => void) {
      timer = setTimeout(() => settle(action), ms);
    },
  };
}

function loadGis(): Promise<GisAccounts> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new GoogleDriveError(
        "GIS requires a browser",
        "Google Drive is only available in the browser.",
      ),
    );
  }
  const ready = readyGis();
  if (ready) return Promise.resolve(ready);
  if (gisPromise) return gisPromise;

  gisPromise = new Promise<GisAccounts>((resolve, reject) => {
    const { settle, arm } = settleOnce();

    arm(GIS_LOAD_TIMEOUT_MS, () => {
      removeGisScript();
      reject(gisLoadError());
    });

    removeGisScript();

    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const gis = readyGis();
      settle(() => (gis ? resolve(gis) : reject(gisLoadError())));
    };
    script.onerror = () =>
      settle(() => {
        removeGisScript();
        reject(gisLoadError());
      });
    document.head.appendChild(script);
  }).catch((e) => {
    gisPromise = null;
    throw e;
  });

  return gisPromise;
}

function gisLoadError() {
  return new GoogleDriveError(
    "Failed to load Google Identity Services",
    "Could not reach Google's sign-in service. Check your internet connection and try again.",
  );
}

/* -------------------------------------------------------------------------- */
/* OAuth                                                                       */
/* -------------------------------------------------------------------------- */

function requestToken(prompt: "consent" | ""): Promise<DriveToken> {
  return loadGis().then(
    (gis) =>
      new Promise<DriveToken>((resolve, reject) => {
        const { settle, arm } = settleOnce();

        arm(OAUTH_TIMEOUT_MS, () =>
          reject(
            new GoogleDriveError(
              `OAuth did not respond within ${OAUTH_TIMEOUT_MS / 1000}s`,
              "The Google authorization window was closed, blocked, or did not respond.",
            ),
          ),
        );

        try {
          const client = gis.accounts.oauth2.initTokenClient({
            client_id: requireClientId(),
            scope: DRIVE_SCOPE,
            callback: (response) => {
              if (response.error || !response.access_token) {
                settle(() =>
                  reject(
                    new GoogleDriveError(
                      `OAuth error: ${response.error ?? "no_token"}`,
                      response.error_description ||
                        "Google did not grant Drive access. Nothing was changed.",
                    ),
                  ),
                );
                return;
              }
              const token: DriveToken = {
                accessToken: response.access_token,
                expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
                scope: response.scope ?? DRIVE_SCOPE,
              };
              settle(() => {
                setDriveToken(token);
                resolve(token);
              });
            },
            error_callback: (err) =>
              settle(() =>
                reject(
                  new GoogleDriveError(
                    `GIS error: ${err.type ?? "unknown"}`,
                    err.message || "The Google authorisation window was closed or blocked.",
                  ),
                ),
              ),
          });
          client.requestAccessToken({ prompt });
        } catch (e) {
          settle(() => reject(e));
        }
      }),
  );
}

/** Opens the Google account chooser and authorises Drive access. */
export async function connectGoogleDrive(): Promise<DriveToken> {
  const existing = getDriveToken();
  if (existing) return existing;
  return requestToken("consent");
}

/** Returns a usable token, silently re-authorising if the old one expired. */
async function ensureDriveToken(): Promise<DriveToken> {
  const existing = getDriveToken();
  if (existing) return existing;
  try {
    return await requestToken("");
  } catch {
    return requestToken("consent");
  }
}

/** Revokes the grant at Google and forgets the token locally. */
export async function disconnectGoogleDrive(): Promise<void> {
  const token = getDriveToken();
  clearDriveToken();
  if (!token) return;
  try {
    const gis = await loadGis();
    await new Promise<void>((resolve) => {
      gis.accounts.oauth2.revoke(token.accessToken, () => resolve());
      // GIS never calls back in some browsers; don't hang the UI on it.
      setTimeout(resolve, 2000);
    });
  } catch {
    // Local token is already cleared — that is what matters for this app.
  }
}

/* -------------------------------------------------------------------------- */
/* Drive REST helpers                                                          */
/* -------------------------------------------------------------------------- */

async function driveFetch(url: string, init: RequestInit, token: DriveToken): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token.accessToken}` },
  });
  if (res.ok) return res;

  let detail = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) detail = body.error.message;
  } catch {
    // non-JSON error body; keep the status code
  }

  if (res.status === 401 || res.status === 403) {
    clearDriveToken();
    throw new GoogleDriveError(
      detail,
      "Google Drive rejected the request or access expired. Disconnect and connect again.",
    );
  }
  if (res.status === 404) {
    throw new GoogleDriveError(detail, "That backup file no longer exists in Google Drive.");
  }
  throw new GoogleDriveError(detail, `Google Drive error: ${detail}`);
}

/** Escapes a literal for use inside a Drive `q=` string. */
function qEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/* -------------------------------------------------------------------------- */
/* Drive operations                                                            */
/* -------------------------------------------------------------------------- */

/** Lists this app's backup workbooks in Drive, newest first. */
export async function listDriveBackups(prefix: string): Promise<DriveBackupFile[]> {
  const token = await ensureDriveToken();
  const q = `name contains '${qEscape(prefix)}' and trashed = false`;
  const params = new URLSearchParams({
    q,
    spaces: "drive",
    orderBy: "modifiedTime desc",
    pageSize: "50",
    fields: "files(id,name,modifiedTime,size)",
  });
  const res = await driveFetch(`${DRIVE_API}/files?${params}`, { method: "GET" }, token);
  const body = (await res.json()) as { files?: DriveBackupFile[] };
  return body.files ?? [];
}

/**
 * Uploads the backup workbook.
 *
 * If a file with the same name already exists it is UPDATED in place, so
 * repeated backups on the same day never pile up duplicates.
 */
export async function uploadBackupToDrive(
  blob: Blob,
  filename: string,
  prefix: string,
): Promise<DriveUploadResult> {
  const token = await ensureDriveToken();

  // Exact-name lookup first so we replace rather than duplicate.
  const lookup = new URLSearchParams({
    q: `name = '${qEscape(filename)}' and trashed = false`,
    spaces: "drive",
    pageSize: "2",
    fields: "files(id,name,modifiedTime,size)",
  });
  const lookupRes = await driveFetch(`${DRIVE_API}/files?${lookup}`, { method: "GET" }, token);
  const existing = ((await lookupRes.json()) as { files?: DriveBackupFile[] }).files ?? [];

  const fields = "id,name,modifiedTime,size";
  const headers = { "Content-Type": XLSX_MIME };

  if (existing.length > 0) {
    const target = existing[0];
    const res = await driveFetch(
      `${DRIVE_UPLOAD_API}/files/${target.id}?uploadType=media&fields=${fields}`,
      { method: "PATCH", headers, body: blob },
      token,
    );
    return { file: (await res.json()) as DriveBackupFile, action: "updated" };
  }

  const boundary = "srl_backup_boundary";
  const metadata = JSON.stringify({
    name: filename,
    mimeType: XLSX_MIME,
  });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${XLSX_MIME}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);

  const res = await driveFetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=${fields}`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
    token,
  );
  return { file: (await res.json()) as DriveBackupFile, action: "created" };
}

/**
 * Downloads a Drive backup and wraps it as a File, ready to be handed to the
 * EXISTING importAllDataXlsx(file).  No import logic lives here.
 */
export async function downloadBackupFromDrive(file: DriveBackupFile): Promise<File> {
  const token = await ensureDriveToken();
  const res = await driveFetch(`${DRIVE_API}/files/${file.id}?alt=media`, { method: "GET" }, token);
  const blob = await res.blob();
  if (blob.size === 0) {
    throw new GoogleDriveError("empty download", `"${file.name}" came back empty from Drive.`);
  }
  return new File([blob], file.name, { type: XLSX_MIME });
}

/** Turns any thrown value into a message safe to show in the UI. */
export function driveErrorMessage(e: unknown): string {
  if (e instanceof GoogleDriveError) return e.userMessage;
  if (e instanceof Error) return e.message;
  return "Unexpected Google Drive error.";
}
