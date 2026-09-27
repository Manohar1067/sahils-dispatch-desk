import { createFileRoute } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import { ReceiptPage } from "./memo.$id";
import type { Memo, Settings } from "@/lib/dataStore";

export const Route = createFileRoute("/test-receipt")({
  component: TestReceipt,
});

const mockMemo: Memo = {
  id: "mock-1",
  memoNumber: "0001",
  dispatchDate: "2026-08-28",
  // Mirrors a real OLD memo (SRL-2026-000023): stored Consignor is EMPTY and
  // must print "—" — never the From value.
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

const longTerms = [
  "The material is received in good condition and will be delivered at the destination place safe and sound.",
  "The lorry is loaded with the material mentioned above and the responsibility of the material lies with the driver till delivery.",
  "The driver is responsible for any loss or damage caused to the material in transit on account of his negligence.",
  "Unauthorised overloading beyond the lorry capacity is strictly prohibited and the same will be treated as a breach.",
  "The consignee must check and confirm the material at the time of unloading; no claims will be entertained afterwards.",
  "Demurrage and detention charges, if any, will be payable by the consignee at prevailing rates as per the market.",
  "This consignment is subject to the jurisdiction of Visakhapatnam courts only for any disputes.",
  "Octroi, tolls, taxes and other statutory charges en route shall be borne by the owner of the material.",
  "The transporter shall not be liable for delays caused by floods, accidents, strikes, or acts of God.",
  "Advance paid at the time of loading shall be adjusted against the final freight on delivery.",
  "The balance amount shall be settled within the agreed credit period as per the booking note.",
  "Any amount remaining unpaid after the due date shall attract interest at 18% per annum.",
  "Shortage or damage, if any, must be reported in writing within 48 hours of delivery with driver's acknowledgement.",
  "The company reserves the right to amend any of the above terms and conditions without prior notice.",
];

const mockSettings: Settings = {
  companyName: "SAHIL ROAD LINES",
  address: "D.No. 5-2-3, Main Road, Visakhapatnam - 530001",
  phone: "9988776655",
  email: "sahil111tms@gmail.com",
  website: "www.sahiiroadlines.in",
  logoUrl: "",
  gst: "gstascwerghjytrdsa",
  jurisdictionText: "Subject to Visakhapatnam Jurisdiction",
  terms: "",
  darkMode: false,
};

function TestReceipt() {
  const ref = { current: null as HTMLDivElement | null };
  return (
    <div className="mx-auto p-4" style={{ background: "#e5e5e5" }}>
      <div className="mx-auto my-8 overflow-x-auto">
        <ReceiptPage
          ref={ref}
          memo={mockMemo}
          settings={mockSettings}
          truck={{ id: "mock-t", truckNumber: "ap12we2345", ownerName: "mnbvc", ownerPhone: "", driverName: "werty", driverPhone: "" }}
          consignee={{ id: "mock-c", companyName: mockMemo.consigneeName, address: "", contactPerson: "", phone: "", city: "", state: "" }}
          terms={longTerms}
        />
      </div>

      {typeof document !== "undefined" &&
        createPortal(
          <div className="print-only" aria-hidden="true">
            <ReceiptPage
              memo={mockMemo}
              settings={mockSettings}
              truck={{ id: "mock-t", truckNumber: "ap12we2345", ownerName: "mnbvc", ownerPhone: "", driverName: "werty", driverPhone: "" }}
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