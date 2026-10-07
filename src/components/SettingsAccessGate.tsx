/**
 * SettingsAccessGate — access layer in front of the Settings page.
 *
 * The 6-digit PIN is the user's EXISTING login PIN (their Supabase Auth
 * credential — the same one used by Login, Change My PIN, Forgot PIN and the
 * admin reset). Verification happens server-side: the entered PIN is sent
 * only to the Supabase token endpoint over HTTPS and the response tells us
 * success or failure. Nothing PIN-related is stored in localStorage,
 * sessionStorage, or any other browser storage, and no PIN, hash, or secret
 * is ever read into the frontend.
 *
 * The unlock flag is plain component state, so it lives exactly as long as
 * this route is mounted: refreshing the page, navigating away, or logging
 * out always re-locks Settings.
 */
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Loader2, LockKeyhole } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

declare module "@tanstack/history" {
  interface HistoryState {
    /** Path the user was on before navigating to a locked route. */
    backTo?: string;
  }
}

/**
 * Verifies the entered PIN against the signed-in user's existing credential.
 * Returns null on success, or an error message on failure. Only success /
 * failure ever leaves this function — the stored credential never does.
 */
async function verifySettingsPin(pin: string): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const email = data.session?.user.email;
  if (!email) return "Your session has expired. Please log in again.";

  const { error } = await supabase.auth.signInWithPassword({ email, password: pin });
  if (!error) return null;
  if (error.message?.toLowerCase().includes("invalid login credentials")) {
    return "Incorrect PIN. Please try again.";
  }
  return error.message || "Could not verify the PIN. Please try again.";
}

export function SettingsAccessGate({
  lockedView,
  children,
}: {
  /** Rendered behind the modal while Settings is locked (reveals no settings). */
  lockedView: ReactNode;
  /** The existing Settings page — mounted only after a correct PIN. */
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cancel / Escape / ✕ — do not open Settings; return to the page the user
  // came from (direct URL visits fall back to the Dashboard). replace() keeps
  // /settings out of the back history so Back cannot reveal a locked page.
  const cancel = () => {
    const backTo = location.state.backTo;
    navigate({ to: backTo && backTo !== "/settings" ? backTo : "/", replace: true });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (verifying || !/^\d{6}$/.test(pin)) return;
    setVerifying(true);
    setError(null);
    try {
      const problem = await verifySettingsPin(pin);
      if (problem) {
        setError(problem);
        setPin("");
        inputRef.current?.focus();
        return;
      }
      setUnlocked(true);
    } finally {
      setVerifying(false);
    }
  };

  if (unlocked) return <>{children}</>;

  return (
    <>
      {lockedView}
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) cancel();
        }}
      >
        <DialogContent
          className="max-w-sm"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <form onSubmit={submit} noValidate>
            <DialogHeader>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <LockKeyhole className="h-6 w-6 text-[color:var(--color-navy)]" />
              </div>
              <DialogTitle className="text-center">Settings Locked</DialogTitle>
              <DialogDescription className="text-center">
                Enter your 6-digit PIN to access Settings and company configuration.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-2">
              <Input
                ref={inputRef}
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                maxLength={6}
                placeholder="••••••"
                className="h-11 text-center text-lg tracking-[0.5em]"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
                  if (error) setError(null);
                }}
                aria-invalid={!!error}
              />
              {error && (
                <p role="alert" className="text-center text-sm text-red-600">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter className="mt-5">
              <Button type="button" variant="outline" onClick={cancel} disabled={verifying}>
                Cancel
              </Button>
              <Button type="submit" disabled={verifying || pin.length !== 6}>
                {verifying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  "Unlock"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
