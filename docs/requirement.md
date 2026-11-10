# Restaurant Billing & Management Software — Requirements

**Version:** 1.0
**Date:** 10 Nov 2026
**Phase:** 1 (Core billing workflow)

---

## 1. Project Overview

A web-based restaurant billing system covering customer registration, waiter order taking, table allocation, running bills, cashier billing, payment collection, invoice printing and basic sales reports.

The system must be simple, fast and easy for restaurant staff to operate. It is a billing and order-management tool, not a general-purpose ERP. **There is no kitchen integration and no KOT generation.**

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React (Vite), React Router, a state/data-fetching library (e.g. TanStack Query or Redux Toolkit), a UI kit or Tailwind CSS |
| Backend | Node.js with Express (REST API) |
| Database | MongoDB Atlas, accessed through Mongoose |
| Authentication | JWT (access + refresh tokens), passwords hashed with bcrypt |
| Validation | Server-side schema validation (e.g. Zod or Joi); client-side form validation |
| Printing | Browser print with a print-optimised invoice layout (A4 and 80mm thermal) |
| Hosting | Frontend on any static host; backend on a Node host; database on MongoDB Atlas |

### 2.1 Project Structure (suggested)

```
/client        React app
  /src
    /pages     Dashboard, POS, Tables, Menu, RunningBills, Billing, Invoices, Reports, Users, Settings
    /components
    /api       API client functions
    /context   Auth and role context
/server        Node/Express API
  /models      Mongoose schemas
  /routes
  /controllers
  /middleware  auth, role check, error handler, validation
  /services    billing calculations, invoice numbering
  /utils
```

### 2.2 Environment Configuration

Backend `.env`:
```
PORT=5000
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<db>
JWT_SECRET=
JWT_REFRESH_SECRET=
JWT_EXPIRES_IN=15m
CLIENT_URL=http://localhost:5173
```
Frontend `.env`:
```
VITE_API_URL=http://localhost:5000/api
```

---

## 3. User Roles & Permissions

| Capability | Admin | Waiter | Cashier |
|---|:-:|:-:|:-:|
| Register / search customers | ✓ | ✓ | ✓ |
| Select table, create & confirm orders | ✓ | ✓ | – |
| View own active orders | ✓ | ✓ | – |
| View all running bills | ✓ | – | ✓ |
| Generate final invoice | ✓ | – | ✓ |
| Apply discount (within limit) | ✓ | – | ✓ |
| Record payments | ✓ | – | ✓ |
| Print / reprint invoices | ✓ | – | ✓ |
| Manage menu, categories, prices | ✓ | – | – |
| Manage tables | ✓ | – | – |
| Manage users & roles | ✓ | – | – |
| Reports | ✓ | – | Own-shift summary |
| Restaurant settings (GST, invoice prefix, discount limits) | ✓ | – | – |

Role checks are enforced on the **backend** for every route, not only hidden in the UI.

---

## 4. Functional Requirements

### 4.1 Customer Management
- FR-C1: Waiter enters a 10-digit mobile number to start an order.
- FR-C2: If the mobile number exists, customer details are fetched automatically.
- FR-C3: If not, the waiter can register the customer; **name is optional**.
- FR-C4: Mobile number is unique and is the primary identifier.
- FR-C5: View a customer's order and billing history.
- FR-C6: Search customers by mobile number or name.

### 4.2 Table Management
- FR-T1: Admin can create, edit, deactivate tables (table number, seating capacity, optional section/area).
- FR-T2: Display all tables in a visual grid layout with colour-coded status.
- FR-T3: Table statuses: **Available**, **Occupied**, **Billing**.
- FR-T4: Waiter selects a table when starting a new dining session.
- FR-T5: An occupied/billing table cannot be assigned to another active session (enforced in DB, see §7).
- FR-T6: Table moves to **Billing** when the cashier opens the bill for checkout.
- FR-T7: Table returns to **Available** only after successful full payment.

### 4.3 Menu & Category Management
- FR-M1: Categories (e.g. Breakfast, Lunch, Dinner, Snacks, Beverages) — add, edit, reorder, deactivate.
- FR-M2: Food items — name, description, category, selling price, optional image, availability toggle.
- FR-M3: Optional add-ons per item (name + price).
- FR-M4: Unavailable items are shown greyed out and cannot be added to a cart.
- FR-M5: Deleting an item that appears in past orders must be a soft delete.
- FR-M6: Item images stored externally (e.g. Cloudinary or S3); only the URL is saved in MongoDB.

### 4.4 POS / Waiter Order Taking
Workflow:
1. Enter mobile number → fetch or register customer.
2. Select table (or continue the customer's existing active session).
3. Browse menu by category or search.
4. Add items, set quantities, add-ons and special instructions.
5. Edit quantities / remove items in the cart.
6. Review cart and confirm.

On confirmation:
- FR-O1: Generate a unique order number.
- FR-O2: Save order with customer, table, waiter, date/time.
- FR-O3: Attach the order as a new **round** to the customer's active running bill (create the bill if none exists).
- FR-O4: Snapshot item name and price at the time of ordering, so later menu price changes do not alter open or past bills.
- FR-O5: No kitchen notification, no KOT.
- FR-O6: POS must be touch-friendly and usable on tablets.

### 4.5 Running Bills
- FR-R1: One active running bill per dining session (customer + table).
- FR-R2: Each confirmed order is stored as a separate round with its own timestamp.
- FR-R3: Show all rounds, items and the live running total.
- FR-R4: Bill stays **Open** until checkout.
- FR-R5: No separate invoice is created per round.
- FR-R6: Admin can cancel/void an item in an open bill with a reason (logged).

### 4.6 Cashier & Final Billing
Workflow:
1. Open the active bills screen.
2. Search by mobile number, table number or running bill number.
3. Open the bill → table status becomes **Billing**.
4. Review rounds, quantities and prices.
5. System calculates subtotal.
6. Apply discount (percentage or flat) within the cashier's permitted limit.
7. System calculates GST (CGST + SGST split).
8. Show final payable amount (rounded to the nearest rupee, round-off shown separately).
9. Select payment method(s) and record payment.
10. Generate final invoice.

Invoice contents: restaurant name, address, GSTIN, phone; invoice number; date and time; customer name and mobile; table number; item lines (description, qty, rate, amount); subtotal; discount; GST breakdown; round-off; grand total; payment method(s); payment status.

- FR-B1: Invoice numbers are sequential and unique, with a configurable prefix and financial-year reset (e.g. `INV/2026-27/00001`).
- FR-B2: Once an invoice is generated, its items and amounts are locked.
- FR-B3: Reprint is allowed and marked "Duplicate copy".

### 4.7 Payment Management
- FR-P1: Methods: Cash, UPI, Debit/Credit Card, and split payment across methods.
- FR-P2: Record amount, method, transaction reference (UPI/Card), date/time, status.
- FR-P3: For cash, accept tendered amount and show change to return.
- FR-P4: Payment total must equal the invoice amount before the bill can be marked Paid.
- FR-P5: On successful payment: mark bill **Paid**, close the session, release the table, keep full history.
- FR-P6: Duplicate payment submission must be prevented (see §7).

### 4.8 Invoice History
- Search and filter by date range, invoice number, mobile number, table, payment method, cashier.
- View, print and reprint any past invoice.

### 4.9 Dashboard
- Today's sales total and bill count.
- Table status overview (Available / Occupied / Billing counts).
- Active running bills count and value.
- Payment method split for the day.

### 4.10 Sales & Billing Reports (Phase 1)
- Daily / date-range sales summary.
- Payment-method-wise collection.
- Item-wise sales quantity and value.
- Category-wise sales.
- Discount report.
- GST summary (taxable value, CGST, SGST).
- Export to CSV/Excel and print.

### 4.11 User & Role Management
- Admin creates users with name, username/mobile, password and role.
- Activate / deactivate users; reset passwords.
- Per-cashier maximum discount percentage.

### 4.12 Restaurant Settings
- Restaurant name, address, phone, GSTIN, logo.
- GST rate (default 5% for restaurants, configurable) and whether prices are tax-inclusive or exclusive.
- Invoice prefix and starting number.
- Invoice footer text.
- Print format (A4 / 80mm thermal).

---

## 5. Data Model (MongoDB Collections)

### users
```
_id, name, username (unique), passwordHash, role: 'admin'|'waiter'|'cashier',
maxDiscountPercent, isActive, createdAt, updatedAt
```

### customers
```
_id, mobile (unique, indexed), name?, totalVisits, totalSpent,
lastVisitAt, createdAt, updatedAt
```

### tables
```
_id, tableNumber (unique), capacity, section?, status: 'available'|'occupied'|'billing',
currentBillId?, isActive, createdAt, updatedAt
```

### categories
```
_id, name (unique), sortOrder, isActive, createdAt, updatedAt
```

### menuItems
```
_id, name, description?, categoryId, price, imageUrl?,
addOns: [{ name, price }], isAvailable, isDeleted, createdAt, updatedAt
```

### runningBills (dining sessions)
```
_id, billNumber (unique), customerId, customerMobile, tableId, tableNumber,
status: 'open'|'billing'|'paid'|'cancelled',
rounds: [{
  orderNumber, waiterId, createdAt,
  items: [{ menuItemId, name, price, qty, addOns: [{name, price}],
            instructions?, lineTotal, isVoided, voidReason? }]
}],
subtotal, openedAt, closedAt?, invoiceId?, createdAt, updatedAt
```
> Rounds are embedded because they are always read with the bill and a single visit stays well within MongoDB's document size limit.

### invoices
```
_id, invoiceNumber (unique), billId, customer: { name, mobile }, tableNumber,
items: [{ name, qty, rate, amount }],
subtotal, discount: { type: 'percent'|'flat', value, amount, approvedBy },
taxableAmount, cgst, sgst, roundOff, grandTotal,
payments: [{ method: 'cash'|'upi'|'card', amount, reference?, paidAt }],
paymentStatus: 'paid', cashierId, printCount, createdAt
```

### counters
```
_id: 'invoice-2026-27' | 'bill' | 'order', seq
```
Used with atomic `findOneAndUpdate({ $inc: { seq: 1 } })` to generate sequential numbers.

### settings
Single document holding restaurant details, GST config, invoice prefix, print format.

### auditLogs
```
_id, userId, action, entity, entityId, details, createdAt
```
Logs voids, discounts, price changes, reprints, user changes.

### Key Indexes
- `customers.mobile` unique
- `tables.tableNumber` unique
- `runningBills`: partial unique index on `tableId` where `status ∈ {open, billing}` — guarantees one active session per table
- `runningBills`: index on `customerMobile`, `status`
- `invoices.invoiceNumber` unique; `invoices.billId` unique (one invoice per bill)
- `invoices.createdAt` for reports

---

## 6. REST API (Outline)

Base path: `/api`

| Area | Method & Path | Roles |
|---|---|---|
| Auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` | All |
| Customers | `GET /customers?mobile=`, `POST /customers`, `GET /customers/:id`, `GET /customers/:id/history` | All |
| Tables | `GET /tables`, `POST /tables`, `PATCH /tables/:id` | Read: all; write: admin |
| Categories | `GET /categories`, `POST`, `PATCH /:id`, `DELETE /:id` | Read: all; write: admin |
| Menu items | `GET /menu-items?category=&search=`, `POST`, `PATCH /:id`, `DELETE /:id` | Read: all; write: admin |
| Running bills | `GET /bills?status=&table=&mobile=` | Admin, cashier, waiter (own) |
| | `GET /bills/active-by-table/:tableId` | All |
| | `POST /bills/orders` (create session if needed + add round) | Admin, waiter |
| | `PATCH /bills/:id/items/:itemId/void` | Admin |
| Billing | `POST /bills/:id/checkout` (set Billing, return calculation) | Admin, cashier |
| | `POST /bills/:id/invoice` (discount + payments → invoice, close bill, release table) | Admin, cashier |
| Invoices | `GET /invoices?from=&to=&q=`, `GET /invoices/:id`, `POST /invoices/:id/reprint` | Admin, cashier |
| Reports | `GET /reports/sales`, `/reports/items`, `/reports/categories`, `/reports/payments`, `/reports/gst`, `/reports/discounts` | Admin (cashier: own shift) |
| Users | `GET /users`, `POST /users`, `PATCH /users/:id` | Admin |
| Settings | `GET /settings`, `PUT /settings` | Read: all; write: admin |
| Dashboard | `GET /dashboard/summary` | Admin, cashier |

All responses use a consistent shape: `{ success, data, message }`, with proper HTTP status codes.

---

## 7. Business Rules & Data Integrity

1. A customer is identified primarily by mobile number.
2. Every dine-in order must have a table.
3. A table cannot have more than one active session — enforced by the partial unique index plus a check inside a transaction.
4. All rounds in a visit belong to one running bill.
5. Confirmed orders are saved only; no kitchen notification or KOT.
6. Exactly one final invoice per running bill (unique index on `invoices.billId`).
7. Table is released only after full payment.
8. Closed bills and invoices are never hard-deleted.
9. Only authorised users can change prices, discounts and billing settings.
10. **Invoice generation runs in a MongoDB transaction**: create invoice → mark bill Paid → release table → update customer stats. Either all succeed or none.
11. **Duplicate protection**: invoice/payment endpoints accept an idempotency key from the client; the "Generate Invoice" button disables on click.
12. **Money handling**: store amounts in paise (integers) or use `Decimal128`; never rely on floating-point arithmetic. All totals are recalculated on the server — client-sent totals are never trusted.
13. Discounts above the cashier's limit are rejected by the server.

---

## 8. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Devices | Responsive on desktop, laptop and tablet (min 768px for POS); touch-friendly controls |
| Performance | Menu and table screens load in under 2 seconds; order confirmation under 1 second on normal connections |
| Security | HTTPS, JWT auth, bcrypt hashing, role middleware on every route, rate limiting on login, Helmet, CORS restricted to the client URL, input validation and sanitisation |
| Database | MongoDB Atlas with IP access list, dedicated DB user with least privilege, replica set (required for transactions) |
| Backup | Atlas automated backups enabled; point-in-time restore where the tier allows |
| Reliability | Graceful error messages; failed saves never leave a table stuck as Occupied without a bill |
| Auditability | Voids, discounts, reprints and price changes logged with user and timestamp |
| Printing | Clean print stylesheet for A4 and 80mm thermal |
| Time zone | All timestamps stored in UTC, displayed in IST |
| Code quality | ESLint + Prettier; environment-based config; no secrets in the repository |

---

## 9. Screens (Frontend Pages)

1. Login
2. Dashboard
3. POS — mobile lookup → table picker → menu grid with category tabs and search → cart panel
4. Tables — visual grid with status colours
5. Running Bills — list + detail view with rounds
6. Billing / Checkout — bill review, discount, GST, payment entry, generate invoice
7. Invoice view / print
8. Invoice History
9. Customers — search, profile, history
10. Menu & Categories (admin)
11. Reports
12. Users (admin)
13. Settings (admin)

---

## 10. Phase 1 Scope

**In scope:** customer management, table management, menu management, waiter order taking, running bills, cashier billing, payments (including split), invoice printing, invoice history, basic sales reports, users and roles, settings.

**Out of scope (future phases):** kitchen display / KOT, inventory and recipe costing, takeaway and delivery orders, online ordering, table reservations, loyalty points, SMS/WhatsApp invoices, payment gateway integration, multi-branch support, offline mode.

---

## 11. Acceptance Criteria (Key Scenarios)

- A waiter can take an order for a new customer without entering a name, and the table turns Occupied.
- A second and third order for the same customer/table appear as separate rounds on the same running bill.
- Assigning an already-occupied table to a new customer is blocked with a clear message.
- The cashier can find a bill by mobile number, table number or bill number.
- Subtotal, discount, CGST, SGST, round-off and grand total are correct to the paisa.
- A split payment (e.g. ₹500 cash + ₹740 UPI) is accepted only when it equals the grand total.
- Double-clicking "Generate Invoice" creates exactly one invoice.
- After payment, the table returns to Available and the invoice appears in history.
- A waiter cannot access billing, reports, menu editing or user management, even by calling the API directly.
- Changing a menu price does not change open or past bills.
