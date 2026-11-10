# PAMAA Billing — Admin Handover

For the owner / admin who runs the system after go-live. Staff instructions are in [`user-guide.md`](user-guide.md). Hosting, environment variables, backups and rollback are in [`deploy.md`](deploy.md) — this document does not repeat them.

---

## 1. What the system is

- A web app used in a browser on tablets (waiters) and a counter PC (cashier) — no install.
- **Phase 1 covers:** customers by mobile number, table status, menu, waiter orders (rounds), running bills, checkout with discount + GST, cash/UPI/card/split payments, invoice printing (80mm or A4), invoice history, dashboard, reports.
- **Not in Phase 1:** kitchen tickets (KOT), takeaway/delivery, reservations, moving/merging tables, loyalty, SMS/WhatsApp bills, payment-gateway auto-confirm, **offline mode**.
- Parts: browser app → API server → MongoDB Atlas database (cloud, backed up continuously). Details and hosting in `deploy.md`.

**Things the system guarantees** (useful when a staff member says "the system did it"):
- One open bill per table; two waiters cannot take the same table.
- Prices are copied into the bill when ordered — later menu price changes never change open bills or old invoices.
- One invoice per bill, even if "Generate invoice" is tapped twice or the network retries.
- Invoice numbers are sequential per financial year: `INV/2026-27/00001`, resetting on 1 April.
- Paid invoices cannot be edited. Voids, discounts, reprints, price changes and user changes are recorded with who and when.

---

## 2. Accounts and roles

| Role | Lands on | Can | Cannot |
|---|---|---|---|
| Waiter | New Order | Take orders, add rounds, My Orders, Tables, Customers | Billing, discounts, reports, menu, users |
| Cashier | Running Bills | Checkout, discount ≤ own limit, payments, print/reprint, Invoice History, own-shift Dashboard & Reports | Orders, void, cancel bill, menu, users, settings |
| Admin | Dashboard | Everything, incl. void items, cancel bills, menu, tables, users, settings, all reports; no discount limit | Deactivate or change the role of their own account |

Rules:
- One account per person. Never share passwords — the audit trail and the cashier report are per account.
- Usernames are lowercase letters, digits, `.` `_` `-` (3–40 characters) and cannot be renamed. Passwords: at least 8 characters.
- Keep **two admin accounts** (owner + manager) so one can reset the other.
- Cashier **Max discount %** applies to both % and ₹ discounts (₹ is checked as a % of the subtotal). 0 = no discounts.
- Users are signed out automatically after 8 hours without activity.

### Change the admin password

There is no separate "My account" page. Use the Users screen on yourself:

1. **Users** → find your own row → **Edit**.
2. Type the new password in **Reset password** → **Save changes**.
3. You are signed out straight away (on every device) and see the login page. Sign in with the new password. This is expected, not an error.

Do this on day one: the first admin was created by the seed script with a temporary password (`deploy.md` §4).

### Add / remove staff

- **Add:** **Users** → **Add user** → Name, Username, Role, (cashier) Max discount %, Password → **Create user**. Give the person their password privately; ask them to tell you if they want it changed (staff cannot change their own password — you reset it for them).
- **Forgot password:** **Edit** → **Reset password** → **Save changes**. They are signed out everywhere.
- **Leaves:** **Deactivate** the same day. Their past orders and invoices keep their name. Never delete or reuse an account for someone else.

---

## 3. Loading the real data (setup file)

Instead of typing the whole menu by hand, fill one JSON file and import it. Start from [`setup-template.json`](setup-template.json) (a small South-Indian café example that also works as demo data).

### Fields

| Section | Field | Required | Notes |
|---|---|---|---|
| `restaurant` | `name` | yes (if section given) | Printed on invoices. Max 80. |
| | `address`, `phone`, `invoiceFooter` | no | Phone: 10–15 digits/spaces/`+`. |
| | `gstin` | no | 15 chars, e.g. `29ABCDE1234F1Z5`; `""` if not registered. |
| | `gstRate` | no | Percent, 0–28, e.g. `5`. Split equally into CGST + SGST. |
| | `pricesIncludeTax` | no | `false` = GST added on top of menu prices; `true` = menu prices already include GST. |
| | `invoicePrefix` | no | 1–10 letters/digits/`-`, e.g. `INV`. |
| | `invoiceStartNumber` | no | First invoice number of the year (a floor: it can move numbering forward, never back). |
| | `printFormat` | no | `"80mm"` or `"A4"`. |
| | `logoUrl` | no | `https://` link to the logo image. |
| `categories` | list of names | — | In the order the tabs should appear on New Order. |
| `menuItems[]` | `name`, `category`, `price` | yes | `category` must be in `categories` (or already in the app). **Price in rupees**: `80`, `"80.50"` — max 2 decimals. |
| | `description`, `imageUrl`, `isAvailable` | no | `isAvailable: false` = shown greyed out. |
| | `addOns` | no | `[{ "name": "Cheese", "price": 30 }]` — price in rupees, `0` allowed, max 20. |
| `tables[]` | `tableNumber`, `capacity` | yes | `"T5"` (stored in capitals), capacity 1–50. |
| | `section`, `isActive` | no | e.g. `"AC Hall"`, `"Garden"`. |
| `users[]` | `name`, `username`, `role` | yes | `role`: `waiter`, `cashier` or `admin`. |
| | `password` | new users | ≥ 8 chars. **Change the template passwords.** Delete the file (or the passwords) after import. |
| | `maxDiscountPercent` | no | Cashiers only, 0–100. Default 0. |

Unknown fields (typos like `"prise"`) are reported as errors, not ignored. Fields you leave out are not touched on a re-run (so an item you switched off in the app stays off unless the file sets `isAvailable`).

### Run it

From the `server/` folder, with `MONGODB_URI` in `server/.env` pointing at the right database:

```bash
# 1. Check the file and see the plan — writes nothing
npm run import:setup -- ../docs/my-setup.json --dry-run
# 2. Import for real
npm run import:setup -- ../docs/my-setup.json
```

Docker host: `docker run --rm --env-file /etc/pamaa/prod.env -v "$PWD/my-setup.json:/setup.json:ro" pamaa:<tag> node server/src/scripts/import-setup.js /setup.json --dry-run`

How it behaves:
- Every row is checked first. Any error → a list like `menuItems[3].price: Price must be rupees…` and **nothing is written**.
- Matching: settings (single record), categories by name (case-insensitive), menu items by name + category, tables by number, users by username. Matches are updated, new ones created. **Nothing is ever deleted** — remove items/tables/users in the app.
- Safe to run again; a second run reports everything as `unchanged`.
- Existing users' passwords are **kept**. Add `--reset-passwords` to set them to the file's passwords (signs those users out).
- Ends with a created / updated / unchanged count per collection.

---

## 4. Daily routine

### Start of day (10 minutes before opening)
1. Sign in as admin on the counter PC. **Dashboard** should show Today Sales ₹0 and no open bills from yesterday.
2. **Tables**: all green. A red/amber table from yesterday = an unfinished bill — open it in **Running Bills** and settle or cancel it.
3. **Menu**: switch off (**Available**) anything not available today.
4. Check the printer: reprint yesterday's last invoice from **Invoice History** (it prints DUPLICATE COPY, so it is safe) and check paper and print quality.
5. Check the cashier and waiter tablets are signed in to their own accounts and charged.

### During the day
- Price change: **Menu** → **Edit**. Applies to new orders only.
- Watch **Dashboard** → **Open Bills** (count · value). Bills open for hours usually mean a guest left without the bill being closed.

### End of day (before closing)
1. **Running Bills** must be empty. For each remaining bill: settle it, or void the items and **Cancel bill** (with a reason).
2. **Reports** → **Payment methods** for today: compare **Cash** with the cash drawer, **UPI** with the UPI app/settlement, **Card** with the card machine's batch total. Write differences in the day book.
3. **Reports** → **Sales summary** and **GST summary** for today → **Export CSV** (or **Print**) and keep for the accountant.
4. **Discounts** report: check discounts by cashier look reasonable.
5. Cashiers sign out (**Logout**). Tablets on charge.

Weekly/monthly: export **Sales summary**, **GST summary**, **Item-wise** for the period for GST filing and menu decisions.

---

## 5. Backups and outages

- **Backups** are automatic in MongoDB Atlas (continuous, point-in-time restore). Setup, the test restore and alerts are in `deploy.md` §1 and §5. Nothing to do daily. Ask your tech support to repeat a test restore every 3 months.
- **Report exports** (CSV) are your own extra copy of the numbers — keep them in a cloud folder.

### If the internet or server is down
There is **no offline mode** in Phase 1. Orders and bills need the server.

1. Waiters see spinning buttons or "Could not load…" with **Retry**. Wait 2–3 minutes and **Retry** once or twice.
2. Still down → **switch to the manual bill book** (keep one at the counter, always). Write: table, items, amounts, payment method, time.
3. Bills already open in the system: keep a note of their table numbers; settle them in the system when it comes back (or on paper, then cancel them in the system with reason "settled on paper, bill book #…").
4. When it is back, do not re-enter paper bills as new orders unless your accountant asks — the paper bills are the record for that period. Note the paper bill numbers in the day book.
5. Call support (below). If a bad update caused it, support follows the rollback plan in `deploy.md` §6.

Tip: a mobile hotspot as a backup internet for the counter PC and tablets avoids most outages.

---

## 6. Support contacts

| What | Who | Phone / email |
|---|---|---|
| App problems, bugs, rollback | _[developer / support company]_ | _[phone]_ · _[email]_ |
| Hosting / database account owner | _[name]_ | _[phone]_ |
| Internet provider | _[ISP]_ | _[helpline]_ · account no. _[…]_ |
| Thermal printer | _[vendor]_ | _[phone]_ · model _[…]_ |
| Accountant (GST) | _[name]_ | _[phone]_ |

When reporting a problem, send: time, screen, the exact message shown, bill/invoice number, and a photo of the screen.

---

## 7. Links

- Staff guide: [`user-guide.md`](user-guide.md)
- Deployment, environment, backups, rollback, go-live checklist: [`deploy.md`](deploy.md)
- Setup file template: [`setup-template.json`](setup-template.json); importer: `server/src/scripts/import-setup.js` (`npm run import:setup`)
- UAT script: [`uat-checklist.md`](uat-checklist.md)
- Requirements and screen flows: [`requirement.md`](requirement.md), [`web-flow.md`](web-flow.md)
