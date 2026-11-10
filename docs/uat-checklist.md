# PAMAA Billing — UAT Script (S6-7)

One real dinner service, run **in parallel** with the existing billing system. Print this document; fill in by hand.

| Date | Service | Venue | UAT lead | App version / build |
|---|---|---|---|---|
| | Dinner, __:__ – __:__ | | | |

---

## 1. Ground rules

- **The existing system stays the official bill.** Customers get the existing system's bill and pay as usual. Every order is *also* entered in PAMAA by the same waiter / cashier.
- PAMAA invoices printed tonight are **test copies** — do not hand them to customers as tax invoices. Write "UAT" on them and keep them in the UAT envelope.
- Run UAT on a **separate UAT database** loaded with the same setup file as production (`npm run import:setup`, see `admin-handover.md` §3). Reason: invoice numbers are a legal sequence and cannot be reset — UAT invoices must not consume production numbers. If UAT has to run on the production database, the database must be reset (by the deploy owner) before go-live and `invoiceStartNumber` re-checked.
- Payments in PAMAA mirror what really happened (same method, same amount) so the reconciliation in §5 works.
- Any problem → log it in §6 immediately (time + bill number). Don't stop service to debug.

## 2. Prerequisites (complete the day before)

| # | Item | Done |
|---|---|---|
| P1 | UAT environment deployed over HTTPS, URL bookmarked on every device | ☐ |
| P2 | Real data imported: settings + GST, categories, full menu with prices/add-ons, all tables, all staff (`--dry-run` first, then real run; summary pasted below) | ☐ |
| P3 | Owner has checked: restaurant name/address/GSTIN/phone on a sample invoice, GST rate, inclusive/exclusive, prefix & starting number, footer, print format | ☐ |
| P4 | Accounts: 1 admin (owner/manager), every cashier with correct **Max discount %**, every waiter. Each person has logged in once | ☐ |
| P5 | Devices: waiter tablets (charged, browser open, landscape), cashier PC/laptop, **the restaurant's actual thermal printer** set as default, 80mm paper loaded, print settings: margins None, scale 100%, headers/footers off | ☐ |
| P6 | Network: Wi-Fi tested in every section; mobile hotspot available as backup | ☐ |
| P7 | Staff briefed (15 min) with `user-guide.md` printed per role | ☐ |
| P8 | Manual bill book at the counter (fallback) | ☐ |
| P9 | Old system's end-of-day report procedure known (needed for §5) | ☐ |

Import summary (paste):

```
settings   created __ updated __ unchanged __
categories created __ updated __ unchanged __
menuItems  created __ updated __ unchanged __
tables     created __ updated __ unchanged __
users      created __ updated __ unchanged __
```

**Roles during UAT**

| Role | Person | Device | Account |
|---|---|---|---|
| Waiter 1 | | Tablet 1 | |
| Waiter 2 | | Tablet 2 | |
| Cashier | | Counter PC | |
| Admin / UAT lead (observer, logs bugs) | | Laptop/phone | |

---

## 3. Before service — setup checks (15 min)

| ID | Steps | Expected result | P/F | Notes |
|---|---|---|---|---|
| S-01 | Each person logs in with own account | Waiter → **New Order**, Cashier → **Running Bills**, Admin → **Dashboard**; sidebar shows only that role's pages | | |
| S-02 | Wrong password once | "Invalid username or password"; stays on login | | |
| S-03 | Waiter types `/dashboard`, `/bills`, `/reports`, `/admin/menu` in the address bar | "Not authorised" on each | | |
| S-04 | Admin: **Tables** | All tables present with correct capacity/section, all green | | |
| S-05 | Waiter: **New Order** → any customer → table → menu | All categories in the agreed order; prices and add-ons match the printed menu | | |
| S-06 | Admin switches one item **Available** off | Waiter sees it greyed **Unavailable**, cannot add it. Switch back on | | |
| S-07 | Test bill: waiter orders one item on a spare table; cashier checks out (Cash), **Generate invoice**, **Print** on the thermal printer | Fits 80mm width, nothing cut off, GSTIN/address correct, text readable | | |

## 4. During service — test cases

Tick each case at least once tonight; most happen naturally. Write the bill number (RB-…) in Notes.

| ID | Source | Steps | Expected result | P/F | Notes |
|---|---|---|---|---|---|
| T-01 | §11 · S2 | New customer: mobile only, **no name** → **Register & Continue** → table → items → **Confirm Order** | Order saved message with ORD- and RB- numbers; table turns **Occupied** (red) within 10 s on all devices | | |
| T-02 | S2 | Returning customer (from T-01 or earlier): enter mobile | Name/visits shown; "Active bill … · Table …" with **Add to this bill** | | |
| T-03 | §11 | Same table orders a 2nd and 3rd time (via mobile lookup *and* via **My Orders → Add more items**) | Cart shows **Cart (Round 2/3)**; cashier's bill detail shows Round 1, 2, 3 separately with times and waiter; one bill only | | |
| T-04 | §11 · S2 | Waiter 1 and Waiter 2 both open table picker for the same free table and confirm at nearly the same time | One succeeds; the other gets "Table T… was just taken. Please pick another table.", returns to grid with cart kept | | |
| T-05 | §11 | Try to pick a red/amber table | Not tappable | | |
| T-06 | S2 | Item with add-ons + special instruction ("less spicy"), qty 2 | Cart line shows add-on price and instruction; bill detail shows the same | | |
| T-07 | S2 | Admin switches an item off while a waiter has it in the cart → waiter confirms | "… is no longer available — removed from cart"; rest of the order can be confirmed | | |
| T-08 | §11 · S2 | Admin changes the price of an item that is on an open bill (note old/new). Waiter orders it again | Old round keeps old price; new round uses new price; old invoices unchanged. **Restore price afterwards** | | |
| T-09 | §11 · S3 | Cashier finds bills by mobile, by table (`T5`) and by bill no. (`RB-…`) | Each search finds the bill | | |
| T-10 | S3 | **Proceed to Checkout**; waiter then tries to add a round to that table | Table amber (**Billing**); waiter sees "… is at checkout — new items can't be added" | | |
| T-11 | S3 | **Cancel checkout** → **Cancel checkout**; waiter adds a round; checkout again | Bill back to Open, table red; new round appears; checkout includes it | | |
| T-12 | §11 · S3 | For 5 real bills, compare PAMAA Subtotal/Discount/CGST/SGST/Round-off/Grand total with the old system and a calculator | Equal to the paisa (allow for known differences in the old system's rounding — note them) | | |
| T-13 | S3 | Cashier enters a discount within limit (% and ₹) | Totals recalc; **Generate invoice** enabled | | |
| T-14 | S3 | Cashier enters a discount above limit | "Discount above your limit of X%"; cannot generate. Admin on the same bill → **No limit** | | |
| T-15 | S4 | Cash payment with **Cash received** more than total | **Change to return** correct; invoice shows Tendered/Change | | |
| T-16 | S4 | UPI payment with reference; Card payment with reference | Reference printed on invoice | | |
| T-17 | §11 · S4 | Split e.g. ₹500 Cash + rest UPI. First enter a wrong amount | Wrong amount → **Balance due/Overpaid** ≠ 0 and button disabled; correct amounts → invoice generated | | |
| T-18 | §11 · S4 | Double-tap **Generate invoice** (on a real bill) | Exactly one invoice (check **Invoice History** — one row for that bill) | | |
| T-19 | §11 · S4 | After invoice | Table **Available** within 10 s on waiter tablets; invoice in **Invoice History** and **Dashboard → Recent invoices** | | |
| T-20 | S4 | **Print** then **Reprint (duplicate)** | First copy has no banner; reprint shows **DUPLICATE COPY**; both fit 80mm | | |
| T-21 | S4 | Invoice content | Name, address, GSTIN, phone, invoice no. `PREFIX/YYYY-YY/NNNNN`, date/time IST, customer, table, items (qty/rate/amount), subtotal, discount, CGST/SGST, round-off, grand total, payment(s) | | |
| T-22 | S3 | Admin voids a wrongly entered item with a reason | Item struck through with reason; subtotal reduced; cashier sees new total | | |
| T-23 | S3 | Admin: a bill with all items voided → **Cancel bill** | Bill cancelled; table Available | | |
| T-24 | S5 | **Customers** → search by mobile → profile | Visits and total spent updated after T-19 | | |
| T-25 | S5 | **Invoice History** filters: date, invoice no., mobile, table, payment method, cashier (admin) | Each filter returns the right invoices | | |
| T-26 | S5 | Cashier: **Dashboard** and **Reports** | Shows "Your shift today" / "Today · your shift" — only this cashier's invoices | | |
| T-27 | S0 | Waiter refreshes the browser mid-order (before **Confirm Order**) | Same screen, cart still there | | |
| T-28 | S6 | Turn Wi-Fi off on one tablet for 30 s while confirming an order, then on | Error message, no duplicate round after **Confirm Order** again | | |
| T-29 | S6 | Speed: open **New Order** menu and **Tables** on a tablet | Loads in < 2 s; **Confirm Order** responds in < 1 s | | |

Sources: §11 = `requirement.md` §11 acceptance criteria; S0–S6 = sprint acceptance highlights in `sprint.md`.

## 5. After service — reconciliation

Do this before the cashier leaves. Use the old system's end-of-day report, the cash drawer count, UPI app and card-machine batch.

PAMAA figures: **Reports** (admin) → today → **Sales summary**, **Payment methods**, **GST summary**. **Dashboard** for open bills.

| Check | Old system | PAMAA | Cash drawer / UPI app / card batch | Difference | Explained? |
|---|---|---|---|---|---|
| Number of bills | | | — | | |
| Gross sales (subtotal) | | | — | | |
| Discounts | | | — | | |
| Taxable value | | | — | | |
| CGST | | | — | | |
| SGST | | | — | | |
| Round-off | | | — | | |
| **Grand total** | | | — | | |
| Cash | | | | | |
| UPI | | | | | |
| Card | | | | | |
| Open bills left in PAMAA (must be 0) | — | | — | | |

Rules:
- Every difference must be traced to a bill (missed entry, wrong item, different rounding, etc.) and written in the Notes or as a bug.
- Pass = all differences explained, none caused by PAMAA calculation errors, 0 open bills left.
- Export the PAMAA reports (**Export CSV**) and attach them with the old system's report.

## 6. Bug log

Format for each issue (one line in the table; attach photos):

| # | Time | Who / device | Screen | Steps (what you did) | Expected | Actual (exact message) | Bill / invoice no. | Severity |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |
| 2 | | | | | | | | |
| 3 | | | | | | | | |
| 4 | | | | | | | | |
| 5 | | | | | | | | |

**Severity**

| Level | Meaning | Examples | Go-live |
|---|---|---|---|
| **Critical** | Wrong money, lost data, or service cannot continue | Wrong total/GST, duplicate invoice, order lost, table stuck, can't log in, can't print at all | Blocks go-live |
| **High** | Important task fails, workaround is painful | Split payment fails, cashier can't find bills, discount limit not enforced, reprint not marked duplicate | Blocks go-live |
| **Medium** | Works with an easy workaround or wrong text | Confusing message, slow screen (> 2 s), layout issue on tablet | Fix in S6-8 if time; owner decides |
| **Low** | Cosmetic / suggestion | Spelling, colour, nicer wording, Phase 2 idea | Backlog |

Bugs go to the S6-8 buffer. Critical/high must be fixed and re-tested before sign-off.

## 7. Sign-off

| Result | ☐ Accepted — go live on ______ ☐ Accepted with conditions (list below) ☐ Not accepted — repeat UAT on ______ |
|---|---|

Conditions / open items:

1.
2.
3.

| Role | Name | Signature | Date |
|---|---|---|---|
| Owner / Product owner | | | |
| Restaurant manager | | | |
| Cashier representative | | | |
| Waiter representative | | | |
| Development lead | | | |
