# Melbourne Cup Lunch — booking system setup

This page lets guests book and pay for the Melbourne Cup lunch at **The Jack &
Cleaver**. It is made of:

- `melbourne-cup.html` — the public booking page
- `melbourne-cup-confirmed.html` — the thank-you / PayID-instructions page
- `netlify/functions/create-booking.js` — takes the booking, records it, starts payment
- `netlify/functions/stripe-webhook.js` — marks card payments as paid and emails confirmation
- A promo banner on `the-jack-and-cleaver.html` linking to the booking page

**No passwords or API keys are stored in the website code.** Everything
sensitive is read from Netlify environment variables. Until those are set, the
page still displays, but bookings will show a friendly "please call us" message.

Event settings (date, $50 price, min 2 / max 60 guests, 72-hour cut-off, the
three mains) are constants at the top of `netlify/functions/create-booking.js`
and in `melbourne-cup.html` — tell me if any of them change.

---

## 1. Airtable (where bookings are recorded)

1. Create a free account at airtable.com and make a new **base** (e.g. "FSHG
   Bookings").
2. Create (or rename the first) table to exactly: **`Melbourne Cup Bookings`**
3. Add these fields, with these **exact names and types**:

   | Field name        | Type                         | Notes |
   |-------------------|------------------------------|-------|
   | `Reference`       | Single line text (primary)   | e.g. MC-7F3K9Q |
   | `Name`            | Single line text             | |
   | `Email`           | Email                        | |
   | `Phone`           | Phone number                 | |
   | `Guests`          | Number (integer)             | used for the 60-seat capacity count |
   | `Amount`          | Currency (or Number)         | dollars |
   | `Mains`           | Long text                    | e.g. "2 × Sticky Pork Belly, 1 × Grilled Lamb Shoulder" |
   | `Guest Details`   | Long text                    | per-guest name / main / dietary |
   | `Dietary`         | Long text                    | any allergy / dietary notes |
   | `Payment Method`  | Single select                | options: `Card`, `PayID` |
   | `Paid`            | Checkbox                     | **this is your paid/unpaid toggle** |
   | `Status`          | Single select                | options: `Awaiting payment`, `Awaiting PayID`, `Confirmed`, `Cancelled` |
   | `Stripe Session ID` | Single line text           | for card bookings (support/matching) |
   | `Notes`           | Long text                    | guest's note to you |

   *(The function uses "typecast", so if you miss a single-select option it will
   be created automatically — but it's cleaner to add them yourself.)*

4. **How you use it day to day:** every booking appears as a row. Card bookings
   tick **Paid** automatically once payment clears. For **PayID** bookings, when
   you see the transfer land in the bank, open the row, tick **Paid** and set
   **Status** to `Confirmed`. To cancel/refuse a booking, set **Status** to
   `Cancelled` (that frees the seats back up for others).

5. Create a **Personal Access Token**: Airtable → *Builder hub → Personal access
   tokens → Create token*. Give it scopes **`data.records:read`** and
   **`data.records:write`**, and grant it access to this base. Copy the token
   (starts with `pat...`).

6. Find your **Base ID**: open the base, the URL contains `app...` — that's the
   base ID (or see airtable.com/api).

---

## 2. Stripe (card payments)

1. In your existing Stripe account, grab your **Secret key**
   (Developers → API keys). Use the **test** key (`sk_test_...`) first, then
   switch to the live key (`sk_live_...`) when you're ready to go live.
2. Create a **webhook endpoint**: Developers → Webhooks → *Add endpoint*.
   - URL: `https://YOUR-LIVE-DOMAIN/.netlify/functions/stripe-webhook`
   - Events to send: **`checkout.session.completed`**
   - After creating it, copy the **Signing secret** (`whsec_...`).
3. Card payments appear in Stripe as paid, and Stripe also keeps its own record —
   but our Airtable row is the single place that shows every booking (card + PayID).

---

## 3. Resend (confirmation emails)

1. In your Resend account, make sure the sending domain **thejackandcleaver.com.au**
   is **verified** (Resend → Domains → add the DNS records it shows you). This is
   what keeps emails out of spam.
2. Create an **API key** (Resend → API Keys) — starts with `re_`.
3. Emails are sent from **reservations@thejackandcleaver.com.au**.

---

## 4. Netlify environment variables

Netlify → your site → **Site configuration → Environment variables** → add:

| Key | Value | Required |
|-----|-------|----------|
| `AIRTABLE_TOKEN` | your `pat...` token | yes |
| `AIRTABLE_BASE_ID` | your `app...` base id | yes |
| `AIRTABLE_TABLE` | `Melbourne Cup Bookings` | optional (this is the default) |
| `STRIPE_SECRET_KEY` | `sk_test_...` then `sk_live_...` | for card payments |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | for card payments |
| `RESEND_API_KEY` | `re_...` | for confirmation emails |
| `FROM_EMAIL` | `reservations@thejackandcleaver.com.au` | optional (this is the default) |
| `PUBLIC_URL` | e.g. `https://www.thejackandcleaver.com.au` | optional (auto-detected otherwise) |

> Make sure these are available to **Production** *and* **Deploy previews** if you
> want to test on a preview URL. After adding/changing variables, trigger a
> redeploy so the functions pick them up.

---

## 5. Testing checklist

1. Open `/melbourne-cup.html` — the page should load with the form.
2. **PayID path:** choose PayID, fill in 2 guests, submit → you should land on
   the confirmation page with a reference + PayID details, and the guest email
   should arrive. A row should appear in Airtable with **Paid** unticked and
   **Status** `Awaiting PayID`.
3. **Card path (test mode):** choose card, submit → you should be sent to Stripe
   Checkout. Pay with Stripe's test card `4242 4242 4242 4242`, any future expiry,
   any CVC. You should return to the confirmed page, the Airtable row should tick
   **Paid** / `Confirmed`, and a confirmation email should arrive.
4. **Capacity:** the page shows "x seats left" when 12 or fewer remain, and
   blocks bookings once 60 guests are booked.
5. When everything works in test mode, swap the Stripe keys to live and
   repoint/recreate the webhook against the live domain.

---

## Notes & options

- **Capacity hold:** a card booking reserves its seats the moment it's created,
  even before payment finishes. If someone abandons Stripe checkout, their row
  sits as `Awaiting payment` and still counts toward the 60. If seats get tight,
  delete or set those stale rows to `Cancelled` to free them.
- **Refunds:** policy on the page is no refunds within 72 hours. Card refunds are
  done from the Stripe dashboard; PayID refunds you handle via your bank.
- Want a second venue (e.g. The Fairway) to use the same flow later? It's a small
  change — tell me and I'll parameterise it.
