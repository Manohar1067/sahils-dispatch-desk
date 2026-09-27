import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { useStoreData } from "@/lib/useStore";
import { getMemo, getTruck, getConsignee, getSettings, type Memo, type FleetTruck, type Consignee, type Settings } from "@/lib/dataStore";
import { formatDate, formatMoney, normalizeTruckNumber } from "@/lib/format";
import { formatDisplayText } from "@/lib/textUtils";
import { Button } from "@/components/ui/button";
import { Printer, Download, ArrowLeft, Pencil, ChevronDown, Phone, Mail, MapPin, Share2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAuth, isSuperAdmin } from "@/lib/AuthContext";

type S = { print?: number };
export const Route = createFileRoute("/memo/$id")({
  component: MemoView,
  validateSearch: (s: Record<string, unknown>): S => ({ print: s.print ? 1 : undefined }),
});

/* Fixed document colours — a printed business document must not follow the app theme. */
const NAVY = "#0B2A55";
const RED = "#C1121F";
const LINE = "#D6DAE3";

/** Section heading strip inside a details card. */
function SectionHead({ children }: { children: ReactNode }) {
  return (
    <div
      className="px-3 py-[3px]"
      style={{ background: NAVY, color: "#fff", fontSize: "12.5px", fontWeight: 900, letterSpacing: "0.6px", textTransform: "uppercase" }}
    >
      {children}
    </div>
  );
}

/** Label / value row: two-column table with vertical divider. */
function Row({ label, value, money, last }: { label: string; value: ReactNode; money?: boolean; last?: boolean }) {
  const empty = value === undefined || value === null || value === "";
  return (
    <div className="flex" style={{ borderBottom: last ? "none" : `1px solid ${LINE}` }}>
      <div
        className="shrink-0 px-3 py-[5px]"
        style={{ width: "40%", background: "#F5F6FA", borderRight: `1px solid ${NAVY}`, fontSize: "13px", fontWeight: 800, color: "#3A4356" }}
      >
        {label}
      </div>
      <div
        className="flex-1 px-3 py-[5px]"
        style={{ fontSize: "14px", fontWeight: 800, color: money ? NAVY : "#111" }}
      >
        {empty ? "—" : value}
      </div>
    </div>
  );
}

/** Indian-system number to words, display-only (does not alter any calculation). */
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return (TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "")).trim();
}
function amountInWords(value: number | null | undefined): string {
  let n = Math.round(Number(value ?? 0));
  if (!isFinite(n) || n <= 0) return "Zero";
  const parts: string[] = [];
  const units: Array<[number, string]> = [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"], [100, "Hundred"]];
  for (const [div, name] of units) {
    const q = Math.floor(n / div);
    if (q > 0) {
      parts.push(`${div >= 1000 ? amountInWords(q) : twoDigits(q)} ${name}`);
      n %= div;
    }
  }
  if (n > 0) parts.push(twoDigits(n));
  return parts.join(" ").trim();
}


async function renderCanvas(el: HTMLElement) {
  // html2canvas-pro supports modern CSS colors (oklch) used by Tailwind v4;
  // the legacy html2canvas throws/hangs on them.
  const { default: html2canvas } = await import("html2canvas-pro");
  return html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
}
async function buildPdfBlob(el: HTMLElement) {
  const canvas = await renderCanvas(el);
  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = pdf.internal.pageSize.getWidth();   // 210mm
  const pageH = pdf.internal.pageSize.getHeight();  // 297mm

  // Scale the rendered receipt proportionally to fit EXACTLY inside ONE A4 page.
  // This preserves the aspect ratio (no distortion), never overflows onto a
  // second page, and never crops — any slack is centered on the page.
  const imgW = canvas.width;
  const imgH = canvas.height;
  const ratio = Math.min(pageW / imgW, pageH / imgH);
  const drawW = (imgW * ratio) * 0.985; // tiny safety margin so the border isn't clipped at the page edge
  const drawH = imgH * ratio * 0.985;
  const offsetX = (pageW - drawW) / 2;
  const offsetY = (pageH - drawH) / 2;

  pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", offsetX, offsetY, drawW, drawH);
  return pdf.output("blob");
}
async function buildImageBlob(el: HTMLElement): Promise<Blob> {
  const canvas = await renderCanvas(el);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image encoding failed"))), "image/png", 1),
  );
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * The SRL logo — a close digital recreation of the original Sahil Road Lines
 * diamond branding (navy diamond with "SRL" lettering). Used on receipts when
 * no custom logo is configured, and as a consistent brand mark.
 */
function SRLDiamond({ size = 76 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-label="SRL logo">
      <g transform="rotate(45 50 50)">
        <rect x="12" y="12" width="76" height="76" rx="6" fill="#0B2A55" />
        <rect x="12" y="12" width="76" height="76" rx="6" fill="none" stroke="#C1121F" strokeWidth="3" />
      </g>
      <text
        x="50"
        y="60"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="800"
        fontSize="34"
        fill="#ffffff"
        letterSpacing="1"
      >
        SRL
      </text>
    </svg>
  );
}

/**
 * The Goods Despatch Memo receipt — faithful digital reproduction of the
 * original physical Sahil Road Lines hard-copy memo.
 *
 * Structure mirrors the original:
 *   1. HEADER — logo | company identity | cell numbers
 *   2. OFFICE ADDRESS line
 *   3. MEMO TITLE — No. / GOODS DESPATCH MEMO / Date
 *   4. MAIN DETAILS TABLE — From/To, G.C. No., Article, Owner, Driver,
 *      Consignor, Consignee, Description, Rate, Weight
 *   5. RED NOTICE BAR
 *   6. FINANCIAL / TRUCK / EXPENSE AREA
 *   7. DECLARATION
 *   8. SIGNATURE — Driver on behalf of Owner
 *   9. COMPANY SIGNATURE — For SAHIL ROAD LINES
 *  10. BOTTOM WARNING
 *
 * ALL business values are dynamic. Nothing is hardcoded.
 */
export const ReceiptPage = forwardRef<
  HTMLDivElement,
  {
    memo: Memo;
    settings: Settings;
    truck?: FleetTruck;
    consignee?: Consignee;
    terms: string[];
  }
>(function ReceiptPage({ memo, settings, truck, consignee, terms }, ref) {
  // Normalize at render time as a defensive safeguard so legacy lowercase truck
  // numbers in old memo records always print/display uppercased.
  const truckNo = normalizeTruckNumber(truck?.truckNumber || memo.truckNumber) || "—";
  const consigneeName = consignee?.companyName || memo.consigneeName || "—";
  /**
   * CONSIGNOR is its own stored value and NOTHING else.
   *
   * There is deliberately NO fallback to `fromLocation`, `toLocation`,
   * `consigneeName` or any other field. Memos created before the `consignor`
   * column existed have no stored Consignor, so they must print "—" rather
   * than borrow an unrelated field's value and present it as if it had been
   * entered. `formatDisplayText` already maps null / undefined / empty /
   * whitespace-only to "", so the "—" here is the only empty-state handling
   * needed. `consigneeName` above remains the delivery party.
   */
  const consignorName = formatDisplayText(memo.consignor) || "—";
  const logoEl = settings.logoUrl ? (
    <img src={settings.logoUrl} className="h-[72px] w-auto max-w-[100px] object-contain" alt="Company logo" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.15))" }} />
  ) : (
    <SRLDiamond size={72} />
  );

  const FONT = "'Inter', 'Segoe UI', system-ui, Roboto, Arial, Helvetica, sans-serif";
  const CASTELLAR = "'Castellar', 'Castellar MT', Georgia, 'Times New Roman', serif";

  // ---- Single-A4 auto-compaction ------------------------------------------
  // The document is designed at exactly screen-A4 scale. If the content (e.g.
  // long Terms & Conditions) exceeds one page, all vertical metrics (font
  // sizes, paddings, signature spacing) are scaled down proportionally until
  // the receipt fits inside the single A4 sheet. No transform/zoom hacks, no
  // clipping, no hidden content — the document simply typesets tighter.
  const [compact, setCompact] = useState(1);
  // Mirrors `compact` synchronously so the measurement solver never reads stale
  // values from a previous render while its rAF chain awaits layout.
  const compactRef = useRef(1);
  // Records which receipt content has already been measured AND settled. Once a
  // given content key is solved it is never measured again, so unrelated renders
  // (theme toggles, parent state, store notifications) cannot re-trigger the
  // compaction loop.
  const solvedRef = useRef<string | null>(null);
  // Internal measurement ref — the forwarded `ref` is not always provided
  // (the print-portal copy and /test-receipt skip it), so we measure our own.
  const areaRef = useRef<HTMLDivElement>(null);
  const setAreaRef = (node: HTMLDivElement | null) => {
    areaRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  const s = (px: number) => Math.max(1, Math.round(px * compact));
  const fs = (px: number) => Math.max(1, Math.round(px * compact * 1.08));

  // ---- Single-A4 auto-compaction: measure once, settle, never churn --------
  // The previous implementation looped: `compact` was in its own dependency
  // array, and a measurement reporting "fits" reset the scale back to 100%,
  // which immediately re-overflowed the page, which the next measurement
  // "fixed", which reset to 100% again — an unbounded render ↔ measure ↔
  // shrink ↔ reset cycle that made the receipt visually shrink/grow/blink
  // forever whenever ANY compaction was needed. This solver instead:
  //   1. runs only when the receipt CONTENT changes, never on a scale change or
  //      an unrelated re-render,
  //   2. walks the scale DOWN monotonically until the content fits a single A4
  //      page (or hits the 0.7 floor), keeping whatever scale achieved the fit —
  //      it never bounces back to 1 mid-solve,
  //   3. records a "solved" key so a settled receipt is measured exactly once
  //      and then left completely alone (no continuous re-measurement),
  //   4. bounds the walk and cancels it on unmount so it provably terminates.
  // Measurement runs inside requestAnimationFrame, so React has already applied
  // the previous scale to the DOM before the next measurement reads it.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;

    // Content fingerprint — anything that changes the vertical extent of the
    // receipt belongs in it. Identical fingerprints render identically, so
    // solving once covers both the screen copy and the print-portal copy.
    const key = JSON.stringify([
      memo.memoNumber, memo.dispatchDate, memo.gcNo, memo.materialName,
      memo.ownerName, memo.driverName, memo.fromLocation, memo.toLocation,
      memo.consignor, memo.consigneeName,
      memo.description, memo.ratePerTon, memo.weightTons, memo.netFreight,
      memo.totalHire, memo.advance, memo.balance, memo.paidAt, memo.transportName,
      memo.commission, memo.loadingCharges, memo.tds, memo.localDriverGuide,
      memo.goodsMamuli, memo.totalExpenses, memo.finalPayable,
      memo.finalPaymentDate, memo.paidBy, memo.paymentMethod,
      settings.companyName, settings.address, settings.phone, settings.email,
      settings.website, settings.jurisdictionText,
      truck?.truckNumber, consignee?.companyName, terms,
    ]);
    if (solvedRef.current === key) return; // already settled — do nothing

    let cancelled = false;
    let iter = 0;
    let rafId: number | undefined;

    const step = () => {
      if (cancelled) return;
      if (iter >= 12) {
        solvedRef.current = key; // safety cap — deterministic termination
        return;
      }
      const node = areaRef.current;
      if (!node) return;
      const contentH = node.scrollHeight;
      const pageH = node.clientHeight;
      if (contentH <= pageH + 2) {
        // Fits on one A4 page at the current scale — keep the scale and stop.
        solvedRef.current = key;
        return;
      }
      iter += 1;
      const next = Math.max(0.7, (pageH / contentH) * compactRef.current);
      if (Math.abs(next - compactRef.current) > 0.004) {
        compactRef.current = next;
        setCompact(next); // re-render, then measure again after layout applies
        rafId = requestAnimationFrame(step);
      } else {
        // The scale cannot meaningfully improve any further (usually the 0.7
        // floor) — settle rather than churn.
        solvedRef.current = key;
      }
    };

    // New (or changed) content: start solving from full size. The scale is only
    // reset here — on a content change — never while solving.
    if (compactRef.current !== 1) {
      compactRef.current = 1;
      setCompact(1);
      // Double rAF so the full-size layout has been applied before measuring.
      rafId = requestAnimationFrame(() => {
        if (!cancelled) rafId = requestAnimationFrame(step);
      });
    } else {
      rafId = requestAnimationFrame(step);
    }

    return () => {
      cancelled = true;
      if (rafId !== undefined) cancelAnimationFrame(rafId);
    };
    // Intentionally NOT depending on `compact` — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memo, settings, truck, consignee, terms]);

  const cell = (bBorder = true, bBot = true): React.CSSProperties => ({
    boxSizing: "border-box",
    borderRight: bBorder ? `1px solid ${NAVY}` : "none",
    borderBottom: bBot ? `1px solid ${NAVY}` : "none",
    padding: `${s(4)}px 8px`,
    fontSize: `${fs(12.5)}px`,
    lineHeight: 1.25,
    // A flex/grid child will not shrink below its content width unless it is
    // told to, which is what let long values push across the cell border.
    minWidth: 0,
    overflowWrap: "anywhere",
  });
  const cellLabel: React.CSSProperties = {
    color: "#3A4356",
    fontWeight: 900,
    fontSize: `${fs(13.5)}px`,
    letterSpacing: "0.3px",
    whiteSpace: "nowrap",
  };
  /**
   * Free-text values (Consignor, Consignee, Description, Owner, Driver, From,
   * To, Paid At …) must stay INSIDE their own cell at the increased text size.
   * `anywhere` breaks a single long word that has no spaces, and `break-word`
   * wraps normally-spaced text — together they stop a long party name from
   * being clipped or crossing the divider.
   */
  const cellValue: React.CSSProperties = {
    fontWeight: 800,
    color: "#111",
    fontSize: `${fs(14.5)}px`,
    lineHeight: 1.2,
    minWidth: 0,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };
  const cellHeading: React.CSSProperties = {
    padding: `${s(4)}px 8px`,
    fontSize: `${fs(12)}px`,
    fontWeight: 900,
    color: "#0B2A55",
    background: "#F5F6FA",
    borderBottom: `1px solid ${NAVY}`,
    letterSpacing: "0.6px",
    textTransform: "uppercase" as const,
  };

  const detailRow = (label: string, value: ReactNode, opts: React.CSSProperties = {}) => (
    <div style={{ ...cell(true, true), ...opts, display: "flex", alignItems: "stretch" }}>
      <div style={{ width: "40%", flexShrink: 0, padding: `${s(5)}px 8px`, background: "#F5F6FA", borderRight: `1px solid ${NAVY}`, display: "flex", alignItems: "center" }}>
        <span style={cellLabel}>{label}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: `${s(5)}px 8px`, display: "flex", alignItems: "center" }}>
        <span style={{ ...cellValue, display: "block", width: "100%", ...(opts.fontSize ? { fontSize: opts.fontSize } : {}) }}>{value}</span>
      </div>
    </div>
  );

  return (
    <div
      ref={setAreaRef}
      className="print-area"
      style={{
        width: "794px",
        height: "1123px",
        boxSizing: "border-box",
        padding: `${s(12)}px`,
        background: "#ffffff",
        color: "#000",
        fontFamily: FONT,
        overflow: "hidden",
      }}
    >
      <div
        className="print-receipt"
        style={{
          width: "100%",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          color: "#000",
          border: `2px solid ${NAVY}`,
          overflow: "visible",
        }}
      >
      {/* ====== 1. HEADER ====== */}
      <div className="avoid-break flex items-stretch" style={{ borderBottom: `2px solid ${NAVY}` }}>
        <div className="flex w-[112px] shrink-0 items-center justify-center px-2 py-[6px]">
          {logoEl}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-3 py-[6px] text-center">
          {/* Company name: SRL red with a Castellar-style display serif (fallback
              stack for machines without Castellar). Everything else uses the
              document body sans font. The text stroke thickens the lettering so
              the heading stays strongly bold at print scale; min-w-0 +
              overflow-wrap stop a long configured name from pushing into the
              contact column. */}
          <div style={{ fontSize: `${fs(34)}px`, fontWeight: 900, color: RED, WebkitTextStroke: "0.6px", lineHeight: 1.05, letterSpacing: "0.2px", fontFamily: CASTELLAR, maxWidth: "100%", overflowWrap: "anywhere", wordBreak: "break-word" }}>
            {settings.companyName || "SAHIL ROAD LINES"}
          </div>
          <div style={{ fontSize: `${fs(14)}px`, fontWeight: 800, color: NAVY, letterSpacing: "0.7px", marginTop: `${s(1)}px`, maxWidth: "100%", overflowWrap: "anywhere" }}>
            TRANSPORT CONTRACTORS &amp; COMMISSION AGENTS
          </div>
          <div style={{ fontSize: `${fs(12.5)}px`, lineHeight: 1.25, marginTop: `${s(2)}px`, maxWidth: "100%", overflowWrap: "anywhere" }} className="text-neutral-700">
            {settings.address}
          </div>
          <div style={{ fontSize: `${fs(12)}px`, fontWeight: 700, color: NAVY, marginTop: `${s(2)}px`, maxWidth: "100%", overflowWrap: "anywhere" }}>
            {settings.jurisdictionText || "Subject to Visakhapatnam Jurisdiction"}
          </div>
        </div>
        {/* Contact details (cell phones, email, website) — GSTIN removed */}
        <div
          className="flex w-[190px] shrink-0 flex-col justify-center gap-[3px] px-4 py-[6px] text-left"
          style={{ borderLeft: `1px solid ${NAVY}`, fontSize: `${fs(12)}px`, lineHeight: 1.3, overflowWrap: "anywhere", wordBreak: "break-word" }}
        >
          {settings.phone && <div className="font-semibold text-neutral-700">Ph: {settings.phone}</div>}
          {settings.email && <div className="text-neutral-600">{settings.email}</div>}
          {settings.website && <div className="text-neutral-600">{settings.website}</div>}
        </div>
      </div>

      {/* ====== 2. MEMO TITLE BAR ====== */}
      <div className="avoid-break flex items-center justify-between gap-3" style={{ borderBottom: `2px solid ${NAVY}`, background: NAVY, color: "#fff", padding: `${s(4)}px 14px` }}>
        <div style={{ fontSize: `${fs(14)}px`, fontWeight: 800, minWidth: 0, overflowWrap: "anywhere" }}>
          No. {memo.memoNumber}
        </div>
        <div style={{ fontSize: `${fs(20)}px`, fontWeight: 900, letterSpacing: "2px", color: "#fff", textAlign: "center", minWidth: 0, overflowWrap: "anywhere" }}>
          GOODS DESPATCH MEMO
        </div>
        <div style={{ fontSize: `${fs(13)}px`, fontWeight: 700, minWidth: 0, overflowWrap: "anywhere" }}>
          Date: {formatDate(memo.dispatchDate)}
        </div>
      </div>

      {/* ====== 3. MAIN DETAILS TABLE ====== */}
      <div className="avoid-break" style={{ borderBottom: `2px solid ${NAVY}` }}>
        {/* From | value | To | value — side-by-side on one row. The value cells
            wrap instead of clipping (overflow:hidden) so a long place name can
            never be cut off or spill across the To column. */}
        <div className="flex" style={{ borderBottom: `1px solid ${NAVY}` }}>
          <div style={{ width: "20%", flexShrink: 0, padding: `${s(5)}px 8px`, background: "#F5F6FA", borderRight: `1px solid ${NAVY}`, display: "flex", alignItems: "center" }}>
            <span style={cellLabel}>From:</span>
          </div>
          <div style={{ width: "30%", minWidth: 0, padding: `${s(5)}px 8px`, borderRight: `1px solid ${NAVY}`, display: "flex", alignItems: "center" }}>
            <span style={cellValue}>{formatDisplayText(memo.fromLocation) || "—"}</span>
          </div>
          <div style={{ width: "15%", flexShrink: 0, padding: `${s(5)}px 8px`, background: "#F5F6FA", borderRight: `1px solid ${NAVY}`, display: "flex", alignItems: "center" }}>
            <span style={cellLabel}>To:</span>
          </div>
          <div style={{ width: "35%", minWidth: 0, padding: `${s(5)}px 8px`, display: "flex", alignItems: "center" }}>
            <span style={cellValue}>{formatDisplayText(memo.toLocation) || "—"}</span>
          </div>
        </div>
        {detailRow("G.C. No.:", memo.gcNo || "—")}
        {detailRow("Article:", formatDisplayText(memo.materialName) || "—")}
        {detailRow("Lorry Owner Name:", formatDisplayText(memo.ownerName) || "—")}
        {detailRow("Driver Name:", formatDisplayText(memo.driverName) || "—")}
        {detailRow("Consignor:", consignorName)}
        {detailRow("Consignee:", formatDisplayText(consigneeName) || "—")}
        {detailRow("Description:", formatDisplayText(memo.description) || "—")}
        {/* Per Ton Rs. | value | Weight | value — side-by-side on one row */}
        <div className="flex" style={{ borderBottom: `0px solid ${NAVY}` }}>
          <div style={{ width: "25%", flexShrink: 0, padding: `${s(5)}px 8px`, background: "#F5F6FA", borderRight: `1px solid ${NAVY}`, display: "flex", alignItems: "center" }}>
            <span style={cellLabel}>Per Ton Rs.:</span>
          </div>
          <div style={{ width: "25%", minWidth: 0, padding: `${s(5)}px 8px`, borderRight: `1px solid ${NAVY}`, display: "flex", alignItems: "center" }}>
            <span style={cellValue}>{formatMoney(memo.ratePerTon)}</span>
          </div>
          <div style={{ width: "20%", flexShrink: 0, padding: `${s(5)}px 8px`, background: "#F5F6FA", borderRight: `1px solid ${NAVY}`, display: "flex", alignItems: "center" }}>
            <span style={cellLabel}>Weight:</span>
          </div>
          <div style={{ width: "30%", minWidth: 0, padding: `${s(5)}px 8px`, display: "flex", alignItems: "center" }}>
            <span style={cellValue}>{memo.weightTons ? `${memo.weightTons} MT` : "—"}</span>
          </div>
        </div>
      </div>

      {/* ====== 4. RED NOTICE BAR ====== */}
      <div className="avoid-break" style={{ borderBottom: `2px solid ${NAVY}`, background: "#C1121F", color: "#fff", padding: `${s(5)}px 14px`, textAlign: "center" }}>
        <div style={{ fontSize: `${fs(13.5)}px`, fontWeight: 900, letterSpacing: "0.6px" }}>
          Goods Receipt should be arrived within 15 days
        </div>
      </div>

      {/* ====== 5. FINANCIAL / TRUCK / EXPENSE AREA ====== */}
      <div className="avoid-break" style={{ borderBottom: `2px solid ${NAVY}` }}>
        <div className="grid grid-cols-3">
          {/* LEFT: Financial summary */}
          <div style={{ borderRight: `2px solid ${NAVY}`, minWidth: 0 }}>
            <div style={cellHeading}>Financial</div>
            <div className="flex" style={{ borderBottom: `1px solid ${NAVY}` }}>
              <div style={{ ...cell(true, false), width: "52%", fontWeight: 900, fontSize: `${fs(13)}px` }}>Net Freight:</div>
              <div style={{ ...cell(false, false), width: "48%", fontWeight: 800, color: NAVY, fontSize: `${fs(14.5)}px` }}>{formatMoney(memo.netFreight)}</div>
            </div>
            <div className="flex" style={{ borderBottom: `1px solid ${NAVY}` }}>
              <div style={{ ...cell(true, false), width: "52%", fontWeight: 900, fontSize: `${fs(13)}px` }}>Total Hire:</div>
              <div style={{ ...cell(false, false), width: "48%", fontWeight: 800, color: NAVY, fontSize: `${fs(14.5)}px` }}>{formatMoney(memo.totalHire)}</div>
            </div>
            <div className="flex" style={{ borderBottom: `1px solid ${NAVY}` }}>
              <div style={{ ...cell(true, false), width: "52%", fontWeight: 900, fontSize: `${fs(13)}px` }}>Advance:</div>
              <div style={{ ...cell(false, false), width: "48%", fontWeight: 800, color: NAVY, fontSize: `${fs(14.5)}px` }}>{formatMoney(memo.advance)}</div>
            </div>
            <div className="flex" style={{ borderBottom: `1px solid ${NAVY}` }}>
              <div style={{ ...cell(true, false), width: "52%", fontWeight: 900, fontSize: `${fs(13)}px` }}>Balance:</div>
              <div style={{ ...cell(false, false), width: "48%", fontWeight: 800, color: NAVY, fontSize: `${fs(14.5)}px` }}>{formatMoney(memo.balance)}</div>
            </div>
            <div className="flex" style={{ borderBottom: `1px solid ${NAVY}` }}>
              <div style={{ ...cell(true, false), width: "52%", fontWeight: 900, fontSize: `${fs(13)}px` }}>Paid At:</div>
              <div style={{ ...cell(false, false), width: "48%", fontWeight: 800, color: NAVY, fontSize: `${fs(14.5)}px` }}>{formatDisplayText(memo.paidAt) || "—"}</div>
            </div>
          </div>

          {/* CENTER: Vehicle (two vertically-centered halves: Truck + Transport) */}
          <div style={{ borderRight: `2px solid ${NAVY}`, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={cellHeading}>Vehicle</div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: `${s(6)}px`, minHeight: 0 }}>
              <div style={{ fontSize: `${fs(14)}px`, fontWeight: 800, color: "#3A4356" }}>Truck No.:</div>
              <div style={{ fontSize: `${fs(22)}px`, fontWeight: 900, color: NAVY, lineHeight: 1.1, textAlign: "center", overflowWrap: "anywhere", wordBreak: "break-word" }}>{truckNo}</div>
            </div>
            <div style={{ borderTop: `1px solid ${NAVY}` }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: `${s(6)}px`, minHeight: 0 }}>
              <div style={{ fontSize: `${fs(14)}px`, fontWeight: 800, color: "#3A4356" }}>Transport:</div>
              <div style={{ fontSize: `${fs(20)}px`, fontWeight: 900, color: NAVY, lineHeight: 1.1, textAlign: "center", overflowWrap: "anywhere", wordBreak: "break-word" }}>{formatDisplayText(memo.transportName) || "—"}</div>
            </div>
          </div>

          {/* RIGHT: Expenses */}
          <div style={{ minWidth: 0 }}>
            <div style={cellHeading}>Expenses</div>
            <div className="flex" style={{ borderBottom: `1px solid ${NAVY}` }}>
              <div style={{ ...cell(true, false), width: "52%", fontWeight: 900, fontSize: `${fs(13)}px` }}>Commission:</div>
              <div style={{ ...cell(false, false), width: "48%", fontWeight: 800, color: NAVY, fontSize: `${fs(14.5)}px` }}>{formatMoney(memo.commission)}</div>
            </div>
            <div className="flex" style={{ borderBottom: `1px solid ${NAVY}` }}>
              <div style={{ ...cell(true, false), width: "52%", fontWeight: 900, fontSize: `${fs(13)}px` }}>Loading:</div>
              <div style={{ ...cell(false, false), width: "48%", fontWeight: 800, color: NAVY, fontSize: `${fs(14.5)}px` }}>{formatMoney(memo.loadingCharges)}</div>
            </div>
            <div className="flex" style={{ borderBottom: `1px solid ${NAVY}` }}>
              <div style={{ ...cell(true, false), width: "52%", fontWeight: 900, fontSize: `${fs(13)}px` }}>T.D.S.:</div>
              <div style={{ ...cell(false, false), width: "48%", fontWeight: 800, color: NAVY, fontSize: `${fs(14.5)}px` }}>{formatMoney(memo.tds)}</div>
            </div>
            <div className="flex" style={{ borderBottom: `1px solid ${NAVY}` }}>
              <div style={{ ...cell(true, false), width: "52%", fontWeight: 900, fontSize: `${fs(13)}px` }}>Local Driver / Guide:</div>
              <div style={{ ...cell(false, false), width: "48%", fontWeight: 800, color: NAVY, fontSize: `${fs(14.5)}px` }}>{formatMoney(memo.localDriverGuide)}</div>
            </div>
            <div className="flex" style={{ borderBottom: `1px solid ${NAVY}` }}>
              <div style={{ ...cell(true, false), width: "52%", fontWeight: 900, fontSize: `${fs(13)}px` }}>Payment Mamuli:</div>
              <div style={{ ...cell(false, false), width: "48%", fontWeight: 800, color: NAVY, fontSize: `${fs(14.5)}px` }}>{formatMoney(memo.goodsMamuli)}</div>
            </div>
            <div className="flex">
              <div style={{ ...cell(true, false), width: "52%", fontWeight: 900, fontSize: `${fs(13.5)}px` }}>Total Expenses:</div>
              <div style={{ ...cell(false, false), width: "48%", fontWeight: 900, color: RED, fontSize: `${fs(14.5)}px` }}>{formatMoney(memo.totalExpenses)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ====== 6. FINAL PAYABLE BAR (prominent, but slightly smaller than the oversized version) ====== */}
      <div
        className="avoid-break"
        style={{ borderBottom: `2px solid ${NAVY}`, background: "#FDECEE", padding: `${s(5)}px 14px`, textAlign: "center" }}
      >
        <div style={{ fontSize: `${fs(15)}px`, fontWeight: 900, letterSpacing: "1.2px", color: NAVY }}>FINAL PAYABLE</div>
        <div style={{ fontSize: `${fs(22)}px`, fontWeight: 900, color: RED, lineHeight: 1.1, marginTop: `${s(1)}px` }}>
          {formatMoney(memo.finalPayable)}
        </div>
        <div style={{ fontSize: `${fs(11)}px`, fontWeight: 600, color: NAVY, marginTop: `${s(1)}px` }}>
          (Rupees {amountInWords(memo.finalPayable)} Only)
        </div>
        <div style={{ fontSize: `${fs(10.5)}px`, fontWeight: 700, color: NAVY, marginTop: `${s(1)}px` }}>
          {memo.finalPaymentDate && <span>Final Payment Date: {formatDate(memo.finalPaymentDate)}</span>}
          {memo.paidBy && <span>  |  Paid By: {memo.paidBy}</span>}
          {memo.paymentMethod && <span>  |  Mode: {memo.paymentMethod}</span>}
        </div>
      </div>

      {/* ====== 7. DECLARATION ====== */}
      <div className="avoid-break" style={{ borderBottom: `1px solid ${NAVY}`, padding: `${s(4)}px 14px` }}>
        <div style={{ fontSize: `${fs(10.5)}px`, lineHeight: 1.35, color: "#222" }}>
          I agree with terms and conditions overleaf and abide by that Received the goods in good condition.
        </div>
      </div>

      {/* ====== 8. TERMS & CONDITIONS ====== */}
      {terms.length > 0 && (
        <div className="avoid-break" style={{ borderBottom: `1px solid ${NAVY}`, padding: `${s(4)}px 14px` }}>
          <div style={{ fontSize: `${fs(11)}px`, fontWeight: 900, color: NAVY, marginBottom: `${s(1)}px`, letterSpacing: "0.5px", textTransform: "uppercase" as const }}>Terms &amp; Conditions</div>
          <ol className="list-decimal pl-5" style={{ fontSize: `${fs(10)}px`, lineHeight: 1.25, color: "#333" }}>
            {terms.map((t, i) => <li key={i} className="mb-0" style={{ marginBottom: 0 }}>{t}</li>)}
          </ol>
        </div>
      )}

      {/* ====== 9. SIGNATURES ====== */}
      <div className="avoid-break flex" style={{ borderBottom: `1px solid ${NAVY}` }}>
        <div style={{ flex: 1, borderRight: `1px solid ${NAVY}`, padding: `${s(6)}px 14px`, textAlign: "center", minHeight: `${s(130)}px` }}>
          <div style={{ fontSize: `${fs(11)}px`, fontWeight: 700, color: "#555", marginTop: `${s(78)}px` }}>Signature of the Driver</div>
          <div style={{ fontSize: `${fs(10)}px`, fontWeight: 600, color: "#777" }}>on behalf of the Owner</div>
        </div>
        <div style={{ flex: 1, padding: `${s(6)}px 14px`, textAlign: "center", minHeight: `${s(130)}px` }}>
          <div style={{ fontSize: `${fs(11)}px`, fontWeight: 700, color: "#555", marginTop: `${s(78)}px` }}>For <b style={{ color: NAVY, fontWeight: 800 }}>{settings.companyName || "SAHIL ROAD LINES"}</b></div>
          <div style={{ fontSize: `${fs(10)}px`, fontWeight: 600, color: "#777" }}>Authorised Signatory</div>
        </div>
      </div>

      {/* ====== 10. BOTTOM WARNING ====== */}
      <div
        className="avoid-break"
        style={{ background: NAVY, color: "#fff", padding: `${s(4)}px 14px`, textAlign: "center", fontSize: `${fs(10.5)}px`, fontWeight: 900, letterSpacing: "0.3px" }}
      >
        Return payment will not get without this Receipt and any other particulars
      </div>
      </div>
    </div>
  );
});

function MemoView() {
  const { id } = Route.useParams();
  const { print } = Route.useSearch();
  const nav = useNavigate();
  const { profile } = useAuth();
  const admin = isSuperAdmin(profile);
  const { data: memo } = useStoreData<Memo | undefined>(() => getMemo(id), [id]);
  const { data: settings } = useStoreData<Settings>(() => getSettings(), []);
  const [truck, setTruck] = useState<FleetTruck | undefined>();
  const [consignee, setConsignee] = useState<Consignee | undefined>();
  const [busy, setBusy] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  /** Existing terms text, split into numbered points. Content is never altered. */
  const terms = (settings?.terms ?? "")
    .split(/\r?\n/)
    .map((t) => t.replace(/^\s*(\d+[.)]\s*|[-•*]\s*)/, "").trim())
    .filter(Boolean);

  /** Non-null settings so the shared document always receives a valid value. */
  const safeSettings: Settings = settings ?? {
    companyName: "SAHIL ROAD LINES",
    address: "",
    phone: "",
    email: "",
    website: "",
    logoUrl: "",
    gst: "",
    jurisdictionText: "Subject to Visakhapatnam Jurisdiction",
    terms: "",
    darkMode: false,
  };



  useEffect(() => {
    if (memo) {
      getTruck(memo.truckId).then(setTruck);
      getConsignee(memo.consigneeId).then(setConsignee);
    }
  }, [memo]);

  useEffect(() => {
    if (print && memo) setTimeout(() => window.print(), 400);
  }, [print, memo]);

  /** Runs a receipt-generation task with a single toast that always resolves. */
  const withReceipt = async <T,>(
    label: string,
    fn: (el: HTMLElement) => Promise<T>,
  ): Promise<T | undefined> => {
    if (!printRef.current || !memo || busy) return;
    const tid = toast.loading(label);
    setBusy(true);
    try {
      const out = await fn(printRef.current);
      toast.dismiss(tid);
      return out;
    } catch (e) {
      console.error("[receipt]", e);
      toast.error("Could not generate the receipt", {
        id: tid,
        description: e instanceof Error ? e.message : "Unknown error",
      });
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const download = async (fmt: "pdf" | "png") => {
    if (!memo) return;
    const blob = await withReceipt(
      fmt === "pdf" ? "Generating PDF…" : "Generating image…",
      (el) => (fmt === "pdf" ? buildPdfBlob(el) : buildImageBlob(el)),
    );
    if (!blob) return;
    saveBlob(blob, `${memo.memoNumber}.${fmt}`);
    toast.success(fmt === "pdf" ? "PDF downloaded" : "Image downloaded");
  };

  const shareText = () =>
    `${settings?.companyName ?? "Sahil Road Lines"}\nMemo ${memo?.memoNumber}\nDate: ${formatDate(memo?.dispatchDate ?? "")}\nTruck: ${normalizeTruckNumber(truck?.truckNumber || memo?.truckNumber) || "—"}\nMaterial: ${formatDisplayText(memo?.materialName) || "—"}\nFinal Payable: ${formatMoney(memo?.finalPayable ?? 0)}`;

  const shareWhatsApp = async () => {
    if (!memo) return;
    const blob = await withReceipt("Preparing receipt…", (el) => buildPdfBlob(el));
    if (!blob) return;
    const file = new File([blob], `${memo.memoNumber}.pdf`, { type: "application/pdf" });
    const nav2 = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav2.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: memo.memoNumber, text: shareText() });
        return;
      } catch {
        /* user cancelled or unsupported — fall through to wa.me */
      }
    }
    // Fallback: download the PDF and open WhatsApp with the summary text to attach.
    saveBlob(blob, `${memo.memoNumber}.pdf`);
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText())}`, "_blank");
    toast.success("PDF downloaded — attach it in WhatsApp");
  };

  const shareEmail = async () => {
    if (!memo) return;
    const blob = await withReceipt("Preparing receipt…", (el) => buildPdfBlob(el));
    if (!blob) return;
    saveBlob(blob, `${memo.memoNumber}.pdf`);
    const subject = `Goods Receipt ${memo.memoNumber}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(shareText())}`;
    toast.success("PDF downloaded — attach it to the email");
  };


  if (!memo) return <AppShell title="Memo"><div className="card-surface p-8 text-center">Loading…</div></AppShell>;

  return (
    <AppShell
      title={`Memo ${memo.memoNumber}`}
      breadcrumb="Home / Register / Memo"
      actions={
        <>
          <Button variant="outline" onClick={() => nav({ to: "/register" })}><ArrowLeft className="mr-1 h-4 w-4" />Back</Button>
          {admin && <Button variant="outline" onClick={() => nav({ to: "/new-memo", search: { edit: memo.id } as never })}><Pencil className="mr-1 h-4 w-4" />Edit</Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline"><Download className="mr-1 h-4 w-4" />Download<ChevronDown className="ml-1 h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => download("pdf")}>PDF (.pdf)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => download("png")}>Image (.png)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline"><Share2 className="mr-1 h-4 w-4" />Share<ChevronDown className="ml-1 h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={shareWhatsApp}>WhatsApp</DropdownMenuItem>
              <DropdownMenuItem onClick={shareEmail}>Email</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print</Button>
        </>
      }
    >
      {/*
        On-screen preview. This element is ALSO the html2canvas source for the
        PDF/PNG/WhatsApp downloads (always visible, so capture is reliable).
      */}
      <div className="print-preview mx-auto w-full max-w-[900px]">
        <div className="mx-auto my-8 overflow-x-auto" style={{ boxShadow: "0 10px 30px rgba(15,23,42,0.18)" }}>
          <ReceiptPage
            ref={printRef}
            memo={memo}
            settings={safeSettings}
            truck={truck}
            consignee={consignee}
            terms={terms}
          />
        </div>
      </div>

      {/*
        Print portal. The SAME receipt, but mounted as a DIRECT child of <body>
        via createPortal — outside #root and outside AppShell's flex/grid layout
        tree. This guarantees no ancestor (ml-60 sidebar spacer, px-8 main
        padding, max-w container, any transform/zoom/flex-shrink) can shrink,
        offset, or clip it during printing, eliminating the blank RIGHT/BOTTOM
        white space. It is hidden on screen and becomes the only printed page.
      */}
      {typeof document !== "undefined" &&
        createPortal(
          <div className="print-only" aria-hidden="true">
            <ReceiptPage
              memo={memo}
              settings={safeSettings}
              truck={truck}
              consignee={consignee}
              terms={terms}
            />
          </div>,
          document.body,
        )}

      <style>{`
        /*
          @page must live at the TOP LEVEL of the stylesheet (CSS Paged Media
          forbids nesting it inside @media). When it is nested inside @media
          print, the browser ignores it and falls back to the user's default
          paper size (often US Letter), which shrinks/misaligns the receipt vs
          the A4 screen design. Declaring it at top level guarantees A4 portrait
          with zero margin so print matches the on-screen A4 document exactly.
        */
        @page { size: A4 portrait; margin: 0; }

        .avoid-break { break-inside: avoid; page-break-inside: avoid; }

        /* The print document is hidden OFF-SCREEN (kept in layout) so the
           auto-compaction measurement still works for the real printed copy.
           It becomes the ONLY page on print. */
        .print-only {
          position: fixed !important;
          top: 0 !important;
          left: -9999px !important;
          display: block !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }

        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
          }

          /*
            Remove the ENTIRE application from the print flow (not just hide it
            visually). display:none takes the app out of layout so the receipt is
            the only in-flow element on the page. This is the key: the app's
            sidebar/main/max-w wrappers can no longer participate in the print
            layout AT ALL.
          */
          body > *:not(.print-only) { display: none !important; }

          /*
            The portaled print document: a single A4 sheet.

            IMPORTANT: no explicit height, max-height or height:100%
            forcing here. Forcing the sheet to exactly 297mm (and the receipt to
            100% of it) makes the block measure a hair taller than the page box
            in some engines, which emits a stray BLANK second page. Instead the
            sheet is pinned to the A4 width with min-height: 297mm and
            overflow: hidden, so the receipt lays out at its natural content
            height (identical to the on-screen A4 document) and can never spill
            onto a second page.
          */
          .print-only {
            display: block !important;
            visibility: visible !important;
            position: static !important;
            width: 210mm !important;
            min-width: 210mm !important;
            max-width: 210mm !important;
            min-height: 297mm !important;
            margin: 0 !important;
            padding: 0 !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
          }

          .print-only .print-area {
            width: 210mm !important;
            min-height: 297mm !important;
            max-height: 297mm !important;
            box-sizing: border-box !important;
            margin: 0 !important;
            padding: 12px !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            overflow: hidden !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /*
            The bordered receipt sits inside the inset margin of the A4 page.
            It keeps its natural content height (no height:100% stretch), so
            print typography, spacing and proportions match the screen precisely.
          */
          .print-only .print-receipt {
            width: 100% !important;
            box-sizing: border-box !important;
            margin: 0 !important;
            overflow: hidden !important;
            display: flex !important;
            flex-direction: column !important;
            background: #ffffff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
    </AppShell>
  );
}

