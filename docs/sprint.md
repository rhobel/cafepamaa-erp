# PAMAA Restaurant Billing — Sprint Plan (Phase 1)

**Version:** 1.0
**Date:** 10 Nov 2026
**Stack:** React (Vite) · Node.js/Express · MongoDB Atlas
**Related docs:** `requirement.md`, `web-flow.md`, `moodboard.html`

---

## 1. Planning Assumptions

| Item | Assumption (adjust to your team) |
|---|---|
| Sprint length | 2 weeks (10 working days) |
| Team | 1 frontend dev, 1 backend dev, 1 QA (part-time), 1 PO/owner |
| Capacity | ~30 story points per sprint for the team |
| Estimation | Story points: 1, 2, 3, 5, 8 (8 = split if possible) |
| Total | 6 sprints ≈ 12 weeks · Sprint 0 + Sprints 1–5 + hardening inside Sprint 6 |
| Start | Mon 16 Nov 2026 |

### Timeline

| Sprint | Dates | Goal |
|---|---|---|
| Sprint 0 | 16 Nov – 27 Nov 2026 | Foundation: repo, auth, design system, DB |
| Sprint 1 | 30 Nov – 11 Dec 2026 | Admin masters: users, settings, tables, menu |
| Sprint 2 | 14 Dec – 25 Dec 2026 | Waiter POS: customer lookup → order confirmed |
| Sprint 3 | 28 Dec 2026 – 08 Jan 2027 | Running bills + cashier checkout calculation |
| Sprint 4 | 11 Jan – 22 Jan 2027 | Payments, invoice generation, printing |
| Sprint 5 | 25 Jan – 05 Feb 2027 | Invoice history, dashboard, reports |
| Sprint 6 | 08 Feb – 19 Feb 2027 | Hardening, UAT, deployment, go-live |

> Sprint 2 and 3 cross holidays (Christmas / New Year). Reduce capacity by ~20% if the team takes leave.

---

## 2. Definition of Ready (story can enter a sprint)

- User story written with acceptance criteria.
- API contract agreed (endpoint, request, response).
- UI matches `moodboard.html` patterns; screen flow exists in `web-flow.md`.
- Dependencies done or in the same sprint.
- Estimated by the team.

## 3. Definition of Done

- Code reviewed and merged to `develop`.
- Backend: validation, role check, error handling, unit tests for services (billing math ≥ 90% coverage).
- Frontend: responsive at 768px (tablet) and 1280px (desktop); loading, empty and error states handled.
- API documented (Postman collection or Swagger updated).
- QA tested on staging; no open critical/high bugs.
- Demoed to PO at sprint review.

---

## 4. Sprint 0 — Foundation

**Goal:** A developer can log in to a deployed staging app with role-based navigation, using the design system.

| ID | Story / Task | Owner | Pts |
|---|---|---|---|
| S0-1 | Create monorepo (`/client`, `/server`), ESLint, Prettier, Husky, `.env.example` | BE | 2 |
| S0-2 | MongoDB Atlas: project, dev + staging clusters, DB users, IP access list, backups on | BE | 2 |
| S0-3 | Express skeleton: routing, error handler, response format `{success,data,message}`, Helmet, CORS, rate limiter, logger | BE | 3 |
| S0-4 | `users` model, bcrypt hashing, seed admin script | BE | 2 |
| S0-5 | Auth API: login, refresh (httpOnly cookie), logout, `/me`; `auth` + `requireRole` middleware | BE | 5 |
| S0-6 | `counters` model + atomic sequence service (bill, order, invoice numbers) | BE | 2 |
| S0-7 | React app (Vite), React Router, API client with token refresh, TanStack Query | FE | 3 |
| S0-8 | Design system: CSS tokens from moodboard, Button, Input, Badge, Toggle, Checkbox, Modal, Toast, Table, StatCard | FE | 5 |
| S0-9 | App shell: sidebar (role-based), topbar, collapsed tablet mode | FE | 3 |
| S0-10 | Login page + `RequireAuth` / `RequireRole` guards + role-based landing redirect | FE | 3 |
| S0-11 | CI pipeline (lint + test on PR); staging deploy for client and server | BE | 3 |
| | **Total** | | **33** |

**Demo:** Admin, waiter and cashier each log in on staging and see their own menu.

---

## 5. Sprint 1 — Admin Masters

**Goal:** Admin can fully set up the restaurant: users, settings, tables, categories and menu.

| ID | Story | Owner | Pts |
|---|---|---|---|
| S1-1 | As admin, I can create/edit/deactivate users with role and cashier discount limit | BE+FE | 5 |
| S1-2 | As admin, I can set restaurant details, GSTIN, GST rate, inclusive/exclusive, invoice prefix, footer, print format | BE+FE | 5 |
| S1-3 | As admin, I can add/edit/deactivate tables (number, capacity, section); unique table number | BE+FE | 3 |
| S1-4 | As admin, I can manage categories (add, edit, reorder, deactivate) | BE+FE | 3 |
| S1-5 | As admin, I can manage menu items: price, description, category, availability, add-ons | BE+FE | 8 |
| S1-6 | Item image upload (Cloudinary/S3), store URL only | BE+FE | 3 |
| S1-7 | Soft delete for menu items; audit log for price changes | BE | 2 |
| | **Total** | | **29** |

**Acceptance highlights**
- Duplicate table number or category name is rejected with a clear message.
- Waiter/cashier calling admin APIs directly gets `403`.
- Deactivated users cannot log in.

---

## 6. Sprint 2 — Waiter POS

**Goal:** A waiter can take an order from mobile lookup to confirmed order, and the table becomes Occupied.

| ID | Story | Owner | Pts |
|---|---|---|---|
| S2-1 | `customers` model; search by mobile; quick register with optional name | BE+FE | 3 |
| S2-2 | POS start screen: mobile input (numeric keypad, auto-search at 10 digits), customer card, "active bill" notice | FE | 3 |
| S2-3 | Table picker grid with live status (10s polling); only Available is selectable | FE | 3 |
| S2-4 | `runningBills` model with embedded rounds; partial unique index (one active bill per table) | BE | 3 |
| S2-5 | `POST /bills/orders` in a transaction: create session if needed, snapshot prices, add round, occupy table, idempotency key | BE | 8 |
| S2-6 | POS menu: category tabs, search, item cards, unavailable state, add-on/instructions modal | FE | 5 |
| S2-7 | Cart: qty +/−, remove, round total, bill-so-far, sessionStorage backup, confirm with disabled-on-click | FE | 3 |
| S2-8 | "Add to existing bill" flow from mobile lookup | FE | 2 |
| S2-9 | My Orders page (waiter's open bills, read-only detail, "Add more items") | FE | 2 |
| | **Total** | | **32** |

**Acceptance highlights**
- New customer can order without a name.
- Two waiters choosing the same table at once → second gets `409` and returns to the table grid.
- Changing a menu price after ordering doesn't change the saved round.
- Unavailable item in cart at confirm → `422`, item removed with message.

---

## 7. Sprint 3 — Running Bills & Checkout Calculation

**Goal:** Cashier can find any open bill, review all rounds and see correct totals with discount and GST.

| ID | Story | Owner | Pts |
|---|---|---|---|
| S3-1 | Running bills list: search by mobile / table / bill no., status filter, totals | BE+FE | 5 |
| S3-2 | Bill detail page: rounds with timestamps, items, add-ons, waiter | FE | 3 |
| S3-3 | Billing calculation service (paise integers): subtotal, discount %, flat, taxable, CGST/SGST, round-off; inclusive & exclusive modes | BE | 5 |
| S3-4 | Unit tests for calculation service (edge cases: 0 discount, 100% discount, odd paise, inclusive tax) | BE | 3 |
| S3-5 | `POST /bills/:id/checkout` → table + bill to Billing; cancel checkout → back to Occupied/Open | BE | 3 |
| S3-6 | Checkout screen left panel: item summary, discount input, server-calculated totals | FE | 5 |
| S3-7 | Discount limit check per cashier (server-side) | BE | 2 |
| S3-8 | Admin: void item with reason; cancel empty bill → release table; audit log | BE+FE | 3 |
| S3-9 | Waiter POS blocks new rounds while bill is in Billing (message shown) | BE+FE | 1 |
| | **Total** | | **30** |

**Acceptance highlights**
- Totals match manual calculation to the paisa for 20 test bills.
- Discount above limit → rejected server-side even if UI is bypassed.

---

## 8. Sprint 4 — Payments, Invoice & Printing

**Goal:** Cashier can collect payment (including split), generate one invoice, print it, and the table is released.

| ID | Story | Owner | Pts |
|---|---|---|---|
| S4-1 | Payment panel: Cash (tendered + change), UPI/Card (reference), Split rows, live balance | FE | 5 |
| S4-2 | `invoices` model; unique `invoiceNumber` and unique `billId` | BE | 2 |
| S4-3 | `POST /bills/:id/invoice` transaction: recalc, verify payments = total, FY invoice number, create invoice, bill Paid, release table, update customer stats, audit | BE | 8 |
| S4-4 | Idempotency for invoice endpoint; Generate button disabled on click | BE+FE | 2 |
| S4-5 | Invoice view page | FE | 3 |
| S4-6 | Print stylesheets: A4 and 80mm thermal; reprint marked "DUPLICATE COPY", print count | FE+BE | 5 |
| S4-7 | Financial-year reset of invoice counter (Apr 1) + test | BE | 2 |
| S4-8 | Customer profile: visits, total spent, past invoices | FE | 2 |
| | **Total** | | **29** |

**Acceptance highlights**
- Double-click / network retry produces exactly one invoice.
- Split ₹500 cash + ₹740 UPI on a ₹1,240 bill succeeds; any mismatch blocks generation.
- After payment, table shows Available within one polling cycle.
- 80mm print fits on thermal paper without cut-off.

---

## 9. Sprint 5 — History, Dashboard & Reports

**Goal:** Owner can see today's business at a glance and run basic sales reports.

| ID | Story | Owner | Pts |
|---|---|---|---|
| S5-1 | Invoice history: filters (date, invoice no., mobile, table, method, cashier), pagination | BE+FE | 5 |
| S5-2 | Dashboard summary API + page: sales, bill count, open bills, tables used, payment split, recent invoices | BE+FE | 5 |
| S5-3 | Reports API with aggregation pipelines: sales summary, payment-wise, item-wise, category-wise, discounts, GST | BE | 8 |
| S5-4 | Reports page: type selector, date range, filters, totals table | FE | 5 |
| S5-5 | Export CSV/Excel + print for reports | FE | 3 |
| S5-6 | Indexes for report queries; check query times on 50k invoice seed | BE | 2 |
| | **Total** | | **28** |

**Acceptance highlights**
- Report totals equal the sum of invoices for the same range.
- Dates grouped in IST (no UTC day-boundary errors).
- Cashier sees only own-shift summary.

---

## 10. Sprint 6 — Hardening, UAT & Go-Live

**Goal:** Production-ready release accepted by the restaurant.

| ID | Task | Owner | Pts |
|---|---|---|---|
| S6-1 | Full regression test of all flows in `web-flow.md` | QA | 5 |
| S6-2 | Security pass: role checks on every route, input validation, rate limits, secrets, HTTPS, CORS | BE | 3 |
| S6-3 | Performance: menu & tables < 2s, order confirm < 1s on 4G/tablet | FE+BE | 3 |
| S6-4 | Tablet usability pass on real device (tap targets, keyboard, landscape) | FE | 3 |
| S6-5 | Production Atlas cluster, backups, monitoring alerts; production deploy | BE | 3 |
| S6-6 | Data setup with owner: real menu, tables, users, GST details | PO+BE | 2 |
| S6-7 | UAT with restaurant staff (one dinner service in parallel with existing system) | All | 5 |
| S6-8 | Bug fixes from UAT (buffer) | All | 5 |
| S6-9 | User guide (1-page per role) + admin handover | PO | 2 |
| | **Total** | | **31** |

**Go-live checklist**
- [ ] All critical/high bugs closed
- [ ] Atlas backups verified with a test restore
- [ ] Invoice counter starts at configured number
- [ ] Printer tested on the restaurant's actual thermal printer
- [ ] Admin password changed from seed; seed script disabled
- [ ] Rollback plan agreed

---

## 11. Release Milestones

| Milestone | End of | What's usable |
|---|---|---|
| M1 — Setup ready | Sprint 1 | Admin can configure the restaurant |
| M2 — Orders live | Sprint 2 | Waiters can take orders (internal demo) |
| M3 — Billing complete | Sprint 4 | End-to-end: order → invoice → payment → table free |
| M4 — Go-live | Sprint 6 | Production with reports |

---

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Billing math errors (rounding, inclusive GST) | High | Paise integers, dedicated service, test suite in Sprint 3 |
| Two waiters booking the same table | Medium | Partial unique index + transaction + 409 handling |
| Thermal printer quirks | Medium | Get the exact printer model early; test in Sprint 4, not Sprint 6 |
| Atlas free/shared tier doesn't suit transactions or load | Medium | Use a replica-set tier (M10+) for staging/prod |
| Holiday capacity loss (Sprints 2–3) | Medium | Plan ~24 pts instead of 30; move S2-9 or S3-8 if needed |
| Scope creep (KOT, takeaway, loyalty) | High | Park in Phase 2 backlog; PO approves any change |

---

## 13. Phase 2 Backlog (not scheduled)

- Kitchen Display / KOT
- Takeaway & delivery orders
- Table reservations
- Move/merge/split tables and bills
- Loyalty points
- SMS / WhatsApp invoice
- Payment gateway / UPI QR with auto-confirmation
- Inventory & recipe costing
- Multi-branch
- Offline mode
- Real-time updates via WebSockets (replace polling)

---

## 14. Ceremonies

| Ceremony | When | Length |
|---|---|---|
| Sprint planning | Day 1 (Mon) | 2 h |
| Daily stand-up | Every day | 15 min |
| Backlog refinement | Week 2, Wed | 1 h |
| Sprint review / demo | Day 10 (Fri) | 1 h |
| Retrospective | Day 10 (Fri) | 45 min |
