// Money is integer paise everywhere (API + DB). Convert only at the edges of the UI.
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** 12500000 → "₹1,25,000.00" */
export const formatINR = (paise) => inr.format((paise ?? 0) / 100);

/** "80" | "80.5" → 8000 | 8050. Returns NaN for invalid input or more than 2 decimals. */
export function toPaise(rupees) {
  const s = String(rupees).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [r, p = ''] = s.split('.');
  return Number(r) * 100 + Number(p.padEnd(2, '0'));
}

/** 8050 → "80.50" (for form inputs) */
export const toRupees = (paise) => ((paise ?? 0) / 100).toFixed(2);
