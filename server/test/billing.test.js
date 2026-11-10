// Pure unit tests for the bill calculator. No DB. Expectations are hand-computed (paise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateBill, roundDiv } from '../src/services/billing.js';
import { HttpError } from '../src/utils/http.js';

const pct = (value) => ({ type: 'percent', value });
const flat = (value) => ({ type: 'flat', value });

test('docs worked example: ₹390, 10% off, 5% GST exclusive', () => {
  assert.deepEqual(
    calculateBill({ subtotal: 39000, discount: pct(10), gstRate: 5, pricesIncludeTax: false }),
    {
      subtotal: 39000,
      discount: { type: 'percent', value: 10, amount: 3900 },
      taxableAmount: 35100,
      cgstRate: 2.5,
      sgstRate: 2.5,
      cgst: 878,
      sgst: 878,
      roundOff: 44,
      grandTotal: 36900,
      pricesIncludeTax: false,
    },
  );
});

test('roundDiv rounds half up', () => {
  assert.equal(roundDiv(5, 2), 3);
  assert.equal(roundDiv(4, 2), 2);
  assert.equal(roundDiv(149, 100), 1);
  assert.equal(roundDiv(150, 100), 2);
  assert.equal(roundDiv(0, 7), 0);
});

// [label, subtotal, discount, gstRate, inclusive, discAmt, taxable, cgst, sgst, roundOff, grandTotal]
const CASES = [
  ['no discount 5%', 10000, null, 5, false, 0, 10000, 250, 250, 0, 10500],
  ['100% discount → zeros', 25050, pct(100), 18, false, 25050, 0, 0, 0, 0, 0],
  ['flat = subtotal → zeros', 5000, flat(5000), 5, false, 5000, 0, 0, 0, 0, 0],
  ['flat ₹50 off, 12%', 40000, flat(5000), 12, false, 5000, 35000, 2100, 2100, 0, 39200],
  ['flat 1 paisa off, 18%', 100001, flat(1), 18, false, 1, 100000, 9000, 9000, 0, 118000],
  // 33300 × 12.5% = 4162.5 → 4163 (discount half-paisa); 29137 × 2.5% = 728.425 → 728
  ['12.5% discount half-paisa', 33300, pct(12.5), 5, false, 4163, 29137, 728, 728, 7, 30600],
  // 12345 × 7.25% = 895.0125 → 895; 11450 × 9% = 1030.5 → 1031 (tax half-paisa)
  [
    '7.25% discount, 18% tax half-paisa',
    12345,
    pct(7.25),
    18,
    false,
    895,
    11450,
    1031,
    1031,
    -12,
    13500,
  ],
  ['33.33% discount 18%', 10000, pct(33.33), 18, false, 3333, 6667, 600, 600, 33, 7900],
  ['0.29% (float-unfriendly) 0%', 10000, pct(0.29), 0, false, 29, 9971, 0, 0, 29, 10000],
  // 50 × 1% = 0.5 → 1; 49 × 2.5% = 1.225 → 1; gross 51 → ₹1
  ['1% discount half-paisa', 50, pct(1), 5, false, 1, 49, 1, 1, 49, 100],
  // 5000 × 0.01% = 0.5 → 1; 4999 × 2.5% = 124.975 → 125
  ['0.01% discount half-paisa', 5000, pct(0.01), 5, false, 1, 4999, 125, 125, -49, 5200],
  ['odd paise 12%', 9999, null, 12, false, 0, 9999, 600, 600, 1, 11200],
  // 1100 × 2.5% = 27.5 → 28
  ['5% tax half-paisa', 1100, null, 5, false, 0, 1100, 28, 28, 44, 1200],
  ['round-off +50 boundary 0%', 12350, null, 0, false, 0, 12350, 0, 0, 50, 12400],
  ['round-off −49 0%', 12349, null, 0, false, 0, 12349, 0, 0, -49, 12300],
  ['round-off +50 with tax', 1000, null, 5, false, 0, 1000, 25, 25, 50, 1100],
  ['GST 0% with 15% discount', 20000, pct(15), 0, false, 3000, 17000, 0, 0, 0, 17000],
  ['zero subtotal', 0, null, 5, false, 0, 0, 0, 0, 0, 0],
  // Inclusive
  ['incl 5% exact', 10500, null, 5, true, 0, 10000, 250, 250, 0, 10500],
  // 10000 / 1.05 = 9523.81 → 9524; tax 476
  ['incl 5% ₹100', 10000, null, 5, true, 0, 9524, 238, 238, 0, 10000],
  ['incl 18% exact', 11800, null, 18, true, 0, 10000, 900, 900, 0, 11800],
  // 9999 / 1.18 = 8473.73 → 8474; tax 1525 → 763 + 762
  ['incl 18% odd tax paisa', 9999, null, 18, true, 0, 8474, 763, 762, 1, 10000],
  // 25000 / 1.12 = 22321.43 → 22321; tax 2679 → 1340 + 1339
  ['incl 12%', 25000, null, 12, true, 0, 22321, 1340, 1339, 0, 25000],
  // 5614 / 1.12 = 5012.5 exactly → 5013; tax 601 → 301 + 300
  ['incl 12% taxable half-paisa', 5614, null, 12, true, 0, 5013, 301, 300, -14, 5600],
  ['incl 0%', 12345, null, 0, true, 0, 12345, 0, 0, -45, 12300],
  // net 35100 / 1.05 = 33428.57 → 33429; tax 1671 → 836 + 835
  ['incl 5% with 10% discount', 39000, pct(10), 5, true, 3900, 33429, 836, 835, 0, 35100],
  // net 27450 / 1.12 = 24508.93 → 24509; tax 2941 → 1471 + 1470
  ['incl 12% with flat discount', 30000, flat(2550), 12, true, 2550, 24509, 1471, 1470, 50, 27500],
  ['incl 18% 100% discount', 11800, pct(100), 18, true, 11800, 0, 0, 0, 0, 0],
];

test(`table of ${CASES.length} hand-computed bills`, async (t) => {
  for (const [
    label,
    subtotal,
    discount,
    gstRate,
    inclusive,
    d,
    taxable,
    cgst,
    sgst,
    ro,
    gt,
  ] of CASES) {
    await t.test(label, () => {
      const b = calculateBill({ subtotal, discount, gstRate, pricesIncludeTax: inclusive });
      assert.deepEqual(
        [b.discount?.amount ?? 0, b.taxableAmount, b.cgst, b.sgst, b.roundOff, b.grandTotal],
        [d, taxable, cgst, sgst, ro, gt],
      );
      assert.equal(b.cgstRate, gstRate / 2);
      assert.equal(b.sgstRate, gstRate / 2);
    });
  }
});

test('invariants over generated inputs', () => {
  const discounts = [
    null,
    pct(0),
    pct(5),
    pct(7.25),
    pct(12.5),
    pct(33.33),
    pct(100),
    flat(0),
    flat(1),
    flat(999),
  ];
  let n = 0;
  for (let subtotal = 0; subtotal <= 300000; subtotal += 1237) {
    for (const gstRate of [0, 5, 12, 18, 28]) {
      for (const pricesIncludeTax of [false, true]) {
        for (const discount of discounts) {
          if (discount?.type === 'flat' && discount.value > subtotal) continue;
          const b = calculateBill({ subtotal, discount, gstRate, pricesIncludeTax });
          const nums = [b.taxableAmount, b.cgst, b.sgst, b.roundOff, b.grandTotal];
          for (const x of nums)
            assert.ok(Number.isInteger(x), `non-integer in ${JSON.stringify(b)}`);
          assert.equal(b.taxableAmount + b.cgst + b.sgst + b.roundOff, b.grandTotal);
          assert.equal(b.grandTotal % 100, 0);
          assert.ok(b.roundOff > -50 && b.roundOff <= 50);
          assert.ok(b.taxableAmount >= 0 && b.cgst >= 0 && b.sgst >= 0);
          const net = subtotal - (b.discount?.amount ?? 0);
          if (pricesIncludeTax) {
            assert.equal(b.taxableAmount + b.cgst + b.sgst, net);
            assert.ok(b.cgst - b.sgst === 0 || b.cgst - b.sgst === 1);
          } else {
            assert.equal(b.taxableAmount, net);
            assert.equal(b.cgst, b.sgst);
          }
          n++;
        }
      }
    }
  }
  assert.ok(n > 20000);
});

test('rejects invalid input with 422', () => {
  const bad = [
    { subtotal: 10000, discount: pct(100.01) },
    { subtotal: 10000, discount: pct(-1) },
    { subtotal: 10000, discount: pct(10.555) },
    { subtotal: 10000, discount: pct(NaN) },
    { subtotal: 10000, discount: flat(10001) },
    { subtotal: 10000, discount: flat(10.5) },
    { subtotal: 10000, discount: flat(-1) },
    { subtotal: 100.5, discount: null },
    { subtotal: -1, discount: null },
    { subtotal: 10000, discount: { type: 'bogus', value: 5 } },
  ];
  for (const input of bad) {
    assert.throws(
      () => calculateBill({ ...input, gstRate: 5, pricesIncludeTax: false }),
      (e) => e instanceof HttpError && e.status === 422,
      JSON.stringify(input),
    );
  }
});
