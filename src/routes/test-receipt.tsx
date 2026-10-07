import { createFileRoute } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import { ReceiptPage } from "./memo.$id";
import type { Memo, Settings } from "@/lib/dataStore";
import { DEFAULT_TERMS_TEXT, resolveTerms } from "@/lib/terms";

export const Route = createFileRoute("/test-receipt")({
  component: TestReceipt,
});

const mockMemo: Memo = {
  id: "mock-1",
  memoNumber: "0001",
  dispatchDate: "2026-08-28",
  // Mirrors a real OLD memo (SRL-2026-000023): the source-party field
  // (memo.consignor, now printed under the "Consignee:" row) is EMPTY and must
  // print "—" — never the From value or the delivery party.
  fromLocation: "VIZINAGARAM",
  toLocation: "PUNE",
  consignor: "",
  transportName: "Sri Lakshmi Narasimha Roadlines & Carriers",
  consigneeId: "mock-c",
  truckId: "mock-t",
  truckNumber: "ap12we2345",
  consigneeName: "KANDOL STEEL & POWER INFRASTRUCTURE LIMITED BHIVANDI WORKS",
  driverName: "werty",
  ownerName: "mnbvc",
  ownerPhone: "",
  materialName: "bags",
  weightTons: 12,
  ratePerTon: 5000,
  netFreight: 60000,
  description: "General goods",
  advance: 4000,
  balance: 10000,
  commission: 2000,
  loadingCharges: 3000,
  tds: 1000,
  goodsMamuli: 1000,
  totalExpenses: 20000,
  gcNo: "GC-0099",
  totalHire: 46000,
  paidAt: "28 Aug 2026",
  localDriverGuide: 1000,
  paidBy: "Sahil",
  paymentMethod: "Cash",
  finalPayable: 46000,
  finalPaymentDate: "2026-09-05",
  status: "Dispatched",
  isDraft: false,
  isDeleted: false,
  createdAt: "2026-08-28",
  updatedAt: "2026-08-28",
};

const longTerms = resolveTerms(DEFAULT_TERMS_TEXT);

const mockSettings: Settings = {
  companyName: "SAHIL ROAD LINES",
  // Mirrors how the company really stores the header addresses: BOTH in this one
  // field, newline-separated, with the second line marked "H.O.:". The header
  // must lift the H.O. line onto its own row.
  address:
    "D.No. 5-2-3, Main Road, Visakhapatnam - 530001\n" +
    "H.O.: D.No. 8-4-12, Station Road, Visakhapatnam - 530001",
  phone: "9393102969,9246992969",
  email: "sahil111tms@gmail.com",
  website: "www.sahiiroadlines.in",
  logoUrl: "",
  gst: "gstascwerghjytrdsa",
  jurisdictionText: "Subject to Visakhapatnam Jurisdiction",
  terms: DEFAULT_TERMS_TEXT,
  darkMode: false,
};

/**
 * `?shape=prod` mirrors the LIVE `settings` row exactly: both addresses stored
 * in the single `address` field, separated by a newline, with no separate
 * H.O. field. The header must still lift the "H.O.:" line onto its own row.
 */
const PROD_SETTINGS: Settings = {
  ...mockSettings,
  address:
    "Plot No.5, N.H.-5 Road, Opp.Radio Station, Kurmannapalem, Visakhapatnam - 530046.\n" +
    "H.O.: Plot No.115,Sector-19 C, Behind Banking Complex, Vashi, Navi Mumbai -705, 022-27652009",
};

function TestReceipt() {
  const ref = { current: null as HTMLDivElement | null };
  const params =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const settings = params.get("shape") === "prod" ? PROD_SETTINGS : mockSettings;
  // `?truck=XXXX` stresses the centre column with a deliberately long plate
  // number, to confirm the receipt shrinks it instead of clipping it.
  const truckNumber = params.get("truck") || "ap12we2345";
  const truck = {
    id: "mock-t",
    truckNumber,
    ownerName: "mnbvc",
    ownerPhone: "",
    driverName: "werty",
    driverPhone: "",
  };
  return (
    <div className="mx-auto p-4" style={{ background: "#e5e5e5" }}>
      <div className="mx-auto my-8 overflow-x-auto">
        <ReceiptPage
          ref={ref}
          memo={mockMemo}
          settings={settings}
          truck={truck}
          consignee={{ id: "mock-c", companyName: mockMemo.consigneeName, address: "", contactPerson: "", phone: "", city: "", state: "" }}
          terms={longTerms}
        />
      </div>

      {typeof document !== "undefined" &&
        createPortal(
          <div className="print-only" aria-hidden="true">
            <ReceiptPage
              memo={mockMemo}
              settings={settings}
              truck={truck}
              consignee={{ id: "mock-c", companyName: mockMemo.consigneeName, address: "", contactPerson: "", phone: "", city: "", state: "" }}
              terms={longTerms}
            />
          </div>,
          document.body,
        )}

      <style>{`
        @page { size: A4 portrait; margin: 0; }
        .avoid-break { break-inside: avoid; page-break-inside: avoid; }
        .print-only {
          position: fixed !important;
          top: 0 !important;
          left: -9999px !important;
          display: block !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #ffffff !important; }
          body > *:not(.print-only) { display: none !important; }
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
    </div>
  );
}