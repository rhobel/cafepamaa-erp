import { HttpError } from '../utils/http.js';

// All money is integer paise. Percentages (discount, GST) are converted to basis points (1% = 100 bp)
// so every step is integer arithmetic with one explicit rounding rule: half-up to the nearest paisa.

/** Integer division rounded half-up, for non-negative integers. */
export const roundDiv = (n, d) => Math.floor((2 * n + d) / (2 * d));

/** 2.5 → 250 bp. Accepts at most 2 decimals. */
const toBp = (pct) => Math.round(pct * 100);

/**
 * Bill totals from a subtotal.
 * @param {object} p
 * @param {number} p.subtotal          paise, sum of non-voided line totals
 * @param {{type:'percent'|'flat', value:number}|null} [p.discount]  percent (≤2 decimals) or flat paise
 * @param {number} p.gstRate           percent, split equally into CGST + SGST
 * @param {boolean} p.pricesIncludeTax menu prices already contain GST
 * @returns {{subtotal, discount:{type,value,amount}|null, taxableAmount, cgstRate, sgstRate, cgst, sgst, roundOff, grandTotal, pricesIncludeTax}}
 *
 * Exclusive: taxable = subtotal − discount; CGST = SGST = round(taxable × rate/2).
 * Inclusive: taxable = round((subtotal − discount) ÷ (1 + rate)); the tax inside is split, CGST gets the odd paisa.
 * Grand total is rounded to the nearest rupee; roundOff = grandTotal − (taxable + CGST + SGST).
 */
export function calculateBill({ subtotal, discount = null, gstRate, pricesIncludeTax }) {
  if (!Number.isInteger(subtotal) || subtotal < 0) throw new HttpError(422, 'Invalid subtotal');

  let discountAmount = 0;
  if (discount) {
    const { type, value } = discount;
    if (type === 'percent') {
      if (!(value >= 0 && value <= 100) || Math.abs(value * 100 - toBp(value)) > 1e-6) {
        throw new HttpError(422, 'Discount % must be between 0 and 100 with at most 2 decimals');
      }
      discountAmount = roundDiv(subtotal * toBp(value), 10000);
    } else if (type === 'flat') {
      if (!Number.isInteger(value) || value < 0) throw new HttpError(422, 'Invalid flat discount');
      if (value > subtotal) throw new HttpError(422, 'Discount cannot exceed the subtotal');
      discountAmount = value;
    } else {
      throw new HttpError(422, 'Discount type must be percent or flat');
    }
  }

  const net = subtotal - discountAmount;
  const rateBp = toBp(gstRate);
  let taxableAmount, cgst, sgst;
  if (pricesIncludeTax) {
    taxableAmount = roundDiv(net * 10000, 10000 + rateBp);
    const tax = net - taxableAmount;
    cgst = roundDiv(tax, 2);
    sgst = tax - cgst;
  } else {
    taxableAmount = net;
    cgst = roundDiv(net * rateBp, 20000);
    sgst = cgst;
  }

  const gross = taxableAmount + cgst + sgst;
  const grandTotal = roundDiv(gross, 100) * 100;

  return {
    subtotal,
    discount: discount ? { ...discount, amount: discountAmount } : null,
    taxableAmount,
    cgstRate: gstRate / 2,
    sgstRate: gstRate / 2,
    cgst,
    sgst,
    roundOff: grandTotal - gross,
    grandTotal,
    pricesIncludeTax,
  };
}
