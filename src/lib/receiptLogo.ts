import receiptLogoAsset from "@/assets/receipt-logo.png";

/**
 * The FIXED receipt logo.
 *
 * This is the approved Sahil Road Lines artwork printed on every memo
 * receipt (screen preview, print portal, PDF/PNG download and share). It is
 * a protected application asset and is deliberately INDEPENDENT from the
 * client-configurable application logo stored in Settings (`settings.logoUrl`),
 * which drives the dashboard/sidebar logo and the browser favicon instead.
 *
 * Changing the logo in Settings must NEVER change what the receipt prints.
 *
 * To change the receipt logo in the future, a developer replaces
 * `src/assets/receipt-logo.png` with the newly approved artwork (same
 * filename) and deploys — there is intentionally no Settings/UI control
 * for it.
 */
export const RECEIPT_LOGO_URL: string = receiptLogoAsset;
