# PAMAA Billing — User Guide

One page per role. Print the page for your role and keep it near the counter.
Words in **bold** are the exact names of buttons or labels on the screen.

- Page 1 — Waiter
- Page 2 — Cashier
- Page 3 — Admin
- Page 4 — If something goes wrong · Glossary (for everyone)

<div style="page-break-after: always"></div>

## Page 1 — Waiter

**You can:** take orders, add more rounds to a table's bill, see your open bills, see table status, look up customers.
**You cannot:** give discounts, take payment, print bills, change the menu, or remove an item after you confirm it.

**Log in**
1. Type your **Username** and **Password**, tap **Sign in**. The **New Order** screen opens.
2. When your shift ends, tap **Logout** (top right).

**New customer**
1. On **New Order**, type the guest's 10-digit mobile number (must start with 6, 7, 8 or 9). It searches by itself.
2. If you see **New customer**, type a name if the guest gives one (it is **optional**). Tap **Register & Continue**.
3. **Select table**: tap a green **Available** table. Red (Occupied) and amber (Billing) tables cannot be tapped.
4. Tap a category (or **All**), or type in **Search items…**. Tap an item to add it.
   - If the item has extras (e.g. Cheese, Ghee roast), a box opens: tick the extras, set **Quantity**, write **Special instructions** (e.g. "Less spicy"), tap **Add · ₹…**.
   - Greyed items marked **Unavailable** cannot be ordered today.
5. Check the **Cart**. Use **−** / **+** to change quantity, **Remove** to take an item out.
6. Tap **Confirm Order** once. You will see "Order ORD-… saved to Bill RB-… · Table T…". The table turns red (Occupied).

**Returning customer (already in the system)**
1. Type the mobile number. Their name and number of visits appear.
2. No open bill → tap **Choose table** and continue as above.
3. Open bill already → you see "Active bill RB-… · Table T… · ₹…". Tap **Add to this bill**.

**Add another round (more food for the same table)**
- Type the guest's mobile number → **Add to this bill**, *or* go to **My Orders** → tap the table → **Add more items**.
- The cart shows **Cart (Round 2)**, **Round 3** … **This round** = this order only. **Bill so far** = whole table so far. **Previous rounds** shows what was already ordered.
- Each round is saved separately. Never start a new bill for the same guests.

**"Bill is at checkout"**
If you see "Bill RB-… · Table T… is at checkout — new items can't be added", the cashier is settling the bill right now (the table is amber, **Billing**). If the guest wants more, ask the cashier to tap **Cancel checkout** first, then add the round.

**Made a mistake after Confirm Order?** You cannot remove it yourself. Tell the admin; the admin can **Void** the item with a reason.

<div style="page-break-after: always"></div>

## Page 2 — Cashier

**You can:** see all running bills, check out, give a discount up to **your limit**, take payment (Cash, UPI, Card, Split), print and reprint invoices, see invoice history, see **your own shift's** dashboard and report.
**You cannot:** take orders, remove (void) items, cancel a bill, or change menu/prices. Call the admin for these.

**Log in** with **Username** / **Password** → **Sign in**. **Running Bills** opens.

**Find a bill**
- Type in **Search mobile / table / bill no.** (e.g. `98765`, `T5`, `RB-0042`). Filter with **All / Open / Billing**. The list refreshes every 10 seconds.
- Tap the bill to see every round, item, waiter and time.

**Check out**
1. On the bill, tap **Proceed to Checkout**. The table turns amber (**Billing**) and waiters can no longer add items.
   (If someone already started checkout, the button says **Continue checkout**.)
2. Check the items with the guest. Totals (Subtotal, Taxable, CGST, SGST, **Round-off**, **GRAND TOTAL**) come from the system — never work them out by hand.

**Discount (only if allowed)**
- Tap **%** or **₹**, then type the amount. Under it you see **Your limit: X%**.
- A ₹ discount also counts against your % limit (₹50 off a ₹500 bill = 10%).
- Above your limit you see "Discount above your limit of X%" and cannot continue. Ask the admin.

**Take payment** — pick one:
- **Cash**: type what the guest gave in **Cash received (₹)** (leave empty if exact). Give back the **Change to return**.
- **UPI** / **Card**: check the payment on your phone/machine first, then type the transaction number in **Reference (optional)**.
- **Split**: one row per payment (method, amount, received/reference). **+ Add payment** adds a row (up to 5). Example: ₹500 Cash + ₹740 UPI for a ₹1,240 bill.
- **Balance due** must be **₹0.00**. If it shows **Overpaid** or a balance, fix the amounts.

**Generate the invoice**
1. Tap **Generate invoice** once. The invoice opens. The table turns green (Available).
2. Choose **80mm** or **A4** if needed, tap **Print**. This is the original.
3. Every later print says **Reprint (duplicate)** and the paper shows **DUPLICATE COPY**.
   Important: if you close the print window without printing, the next print will already be a duplicate.

**Reprint an old invoice:** **Invoice History** → search by date, invoice no./mobile, table or payment → tap the invoice → **Reprint (duplicate)**.

**Cancel checkout** (guest wants to order more, or you opened the wrong bill): tap **Cancel checkout** → **Cancel checkout** again. The bill is open again, the table is red, and any discount is removed. **Keep checkout** closes the box without changing anything.

**Your shift:** **Dashboard** shows "Your shift today". **Reports** shows "Today · your shift" — use it to tally your cash drawer.

<div style="page-break-after: always"></div>

## Page 3 — Admin

**You can do everything** a waiter and cashier can, plus the **ADMIN** menu: **Menu**, **Categories**, **Table Setup**, **Users**, **Settings**. Your checkout says **No limit** for discounts. You land on **Dashboard**.

**Menu and prices** (**Menu**)
- **Add item** → **Name**, **Category**, **Price (₹)** (e.g. 80 or 80.50), **Description**, image, extras with **+ Add-on** → **Save**.
- **Edit** to change price or extras. **A new price only applies to new orders.** Orders already confirmed and old invoices keep the old price.
- **Delete** removes the item from New Order. Old bills still show it.

**Sold out today?** Flip the **Available** switch off in the Menu list. Waiters see it greyed out. Flip it on again when it is back.

**Categories** — **Add category**; **▲ / ▼** sets the order of tabs on New Order; **Edit** renames; **Deactivate** hides the category *and all its items* from New Order.

**Tables** (**Table Setup**) — **Add table** → **Table number** (e.g. T5), **Capacity**, **Section** (e.g. AC Hall). Tap a table to edit or **Deactivate** it. A table with an open bill cannot be renamed or deactivated. **Show inactive** shows hidden tables.

**Staff** (**Users**)
- **Add user** → **Name**, **Username** (cannot be changed later), **Role**, **Password** (at least 8 characters) → **Create user**.
- For cashiers, set **Max discount %** (0 = no discounts allowed).
- Forgot password: **Edit** → type a new one in **Reset password** → **Save changes**. They are signed out and use the new password.
- Staff left: **Deactivate** (never share accounts). They are signed out at once.

**Settings** — **Restaurant** (name, address, phone, **GSTIN**, logo), **Tax** (**GST rate (%)**, **Prices include tax**), **Invoice** (**Invoice prefix**, **Starting number**, **Invoice footer**, **Print format**) → **Save settings**. Changes affect new invoices only. Don't change the GST rate or prefix in the middle of a day.

**Fix a bill** (**Running Bills** → tap the bill)
- Wrong item: **Void** next to the item → write the **Reason** → **Void item**. It stays on the bill crossed out and is removed from the total. Voids are logged with your name.
- Guests left without eating: void every item, then **Cancel bill** → reason → **Cancel bill**. The table becomes Available. (**Cancel bill** only appears once no items are left.)
- A paid invoice can never be changed.

**Reports** — pick **Sales summary**, **Payment methods**, **Item-wise**, **Category-wise**, **Discounts** or **GST summary**; set **From** / **To**; optional **Cashier**, **Payment method**, **Category**. **Export CSV** for your accountant, **Print** for paper.

**Every day:** see the routine in `admin-handover.md` (open bills before closing, cash tally, reports).

<div style="page-break-after: always"></div>

## Page 4 — If something goes wrong (everyone)

| You see | What it means | What to do |
|---|---|---|
| "Table T5 was just taken. Please pick another table." | Another waiter got that table a second before you. | The app takes you back to the tables. Your cart is kept. Pick another table. |
| "… is no longer available — removed from cart." | The item was switched off while you were ordering. | Tell the guest; pick something else; **Confirm Order** again. |
| "Customer already has an open bill RB-… at Table T…" | This guest is already seated with an open bill. | The app moves your cart to that bill. Check the table, then **Confirm Order**. |
| "… is at checkout — new items can't be added" | The cashier is settling the bill. | Ask the cashier to **Cancel checkout**, then add the round. |
| "Discount above your limit of X%" | Cashier discount is more than allowed. | Lower it, or call the admin. |
| "Payments total ₹… but the bill is ₹…" | Payment amounts don't add up to the total. | Fix the amounts until **Balance due** is ₹0.00. |
| "Invoice already generated for this bill" | It was already billed (e.g. double tap or another screen). | Open **Invoice History**; reprint from there. Don't bill again. |
| "Bill or table changed meanwhile. Please refresh." | Someone else changed the bill at the same time. | Refresh the page and check again. |
| Login page appears / "Session expired" | You were signed out (8 hours idle, password reset, or account deactivated). | Sign in again. A cart that was not confirmed is still there in the same browser tab. |
| "Invalid username or password" / "Too many failed logins" | Wrong details, or too many tries. | Check caps/spelling. Wait a few minutes. Ask the admin to reset your password. |
| Spinning button, "Could not load …", **Retry** | Internet or server problem. | Tap **Retry**. Don't tap **Confirm Order** / **Generate invoice** many times — the system stops double orders and double invoices. Still down after 2–3 minutes? Use the paper bill book and tell the admin. |
| Printer prints nothing / cut-off text | Printer or print settings. | Check paper, power, cable/Wi-Fi. In the print window pick the thermal printer, paper 80mm, margins None, scale 100%, headers/footers off. Then **Reprint (duplicate)** from the invoice. |

**Glossary**

- **Round** — one order taken at the table and confirmed with **Confirm Order**. A table can have many rounds.
- **Running bill** — the open bill for one table and guest (number like RB-0042). Every round is added to it until the cashier checks out. One invoice is made at the end.
- **Checkout / Billing** — the cashier is settling the bill. The table is amber; no new rounds can be added.
- **Void** — removing a wrong item from an open bill (admin only, with a reason).
- **Round-off** — the total is rounded to the nearest rupee; the few paise added or removed are shown as **Round-off**.
- **CGST / SGST** — GST split into two equal halves (e.g. 5% = 2.5% + 2.5%).
- **Duplicate copy** — any print of an invoice after the first one.
