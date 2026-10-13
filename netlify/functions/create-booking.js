// Melbourne Cup lunch — booking intake for The Jack & Cleaver.
//
// GET  -> returns availability { open, remaining, cutoffPassed, soldOut }
// POST -> validates a booking, records it in Airtable, then either:
//           * card  -> creates a Stripe Checkout Session and returns { checkoutUrl }
//           * payid -> emails PayID instructions and returns { reference, amount }
//
// All secrets come from Netlify environment variables — nothing sensitive is
// stored in the repo. If a required variable is missing the function fails
// closed with a clear message rather than guessing.

const PRICE = 50;                 // AUD per person, GST inclusive
const MIN_GUESTS = 2;
const MAX_GUESTS = 60;            // total capacity for the event
const CURRENCY = "aud";
const EVENT_LABEL = "Melbourne Cup Lunch — The Jack & Cleaver (Tue 3 Nov 2026)";
const MAINS = ["Sticky Pork Belly", "Grilled Lamb Shoulder", "Baked Salmon Salad"];

// Bookings close 72 hours before the 11:30am start (AEDT, UTC+11).
const CUTOFF = new Date("2026-10-31T11:30:00+11:00");

// Resend sends from a verified domain (fshg.com.au); replies route to the
// venue's own inbox. Both can be overridden via Netlify env vars.
const FROM_EMAIL = process.env.FROM_EMAIL || "reservations@fshg.com.au";
const REPLY_TO = process.env.REPLY_TO || "reservations@thejackandcleaver.com.au";
const TABLE = process.env.AIRTABLE_TABLE || "Melbourne Cup Bookings";

const JSON_HEADERS = { "Content-Type": "application/json" };

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function reference() {
  // Unambiguous alphabet (no 0/O/1/I) — e.g. MC-7F3K9Q
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return "MC-" + s;
}

function clean(str, max) {
  return String(str == null ? "" : str).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max || 200);
}

function baseUrl(event) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host || event.headers.Host;
  return `${proto}://${host}`;
}

// ---- Airtable helpers -------------------------------------------------------

function airtableConfigured() {
  return Boolean(process.env.AIRTABLE_TOKEN && process.env.AIRTABLE_BASE_ID);
}

function atUrl(path) {
  return `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}${path || ""}`;
}

function atHeaders() {
  return { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, "Content-Type": "application/json" };
}

// Sum guests across all bookings that are not cancelled.
async function bookedCount() {
  let total = 0;
  let offset;
  do {
    const params = new URLSearchParams();
    params.set("fields[]", "Guests");
    params.append("filterByFormula", "NOT({Status}='Cancelled')");
    params.set("pageSize", "100");
    if (offset) params.set("offset", offset);
    const res = await fetch(atUrl("?" + params.toString()), { headers: atHeaders() });
    if (!res.ok) throw new Error("Airtable read failed: " + res.status);
    const data = await res.json();
    for (const rec of data.records || []) total += Number(rec.fields.Guests) || 0;
    offset = data.offset;
  } while (offset);
  return total;
}

async function createRecord(fields) {
  const res = await fetch(atUrl(), {
    method: "POST",
    headers: atHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error("Airtable create failed: " + res.status + " " + txt);
  }
  return res.json();
}

async function patchRecord(id, fields) {
  const res = await fetch(atUrl("/" + id), {
    method: "PATCH",
    headers: atHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  });
  return res.ok;
}

// ---- Email (Resend) ---------------------------------------------------------

async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `The Jack & Cleaver <${FROM_EMAIL}>`, to: [to], reply_to: REPLY_TO, subject, html }),
  });
  return res.ok;
}

function mainsSummary(guests) {
  const counts = {};
  guests.forEach((g) => { counts[g.main] = (counts[g.main] || 0) + 1; });
  return Object.keys(counts).map((m) => `${counts[m]} × ${m}`).join(", ");
}

function guestDetailLines(guests) {
  return guests.map((g, i) => {
    let line = `Guest ${i + 1}: ${g.main}`;
    if (g.name) line += ` — ${g.name}`;
    if (g.dietary) line += ` (dietary: ${g.dietary})`;
    return line;
  }).join("\n");
}

function dietarySummary(guests) {
  return guests.filter((g) => g.dietary)
    .map((g, i) => `${g.name || "Guest " + (guests.indexOf(g) + 1)}: ${g.dietary}`)
    .join("; ");
}

function bookingHtml({ name, ref, guests, amount, intro, payidBlock }) {
  const rows = guests.map((g, i) =>
    `<tr><td style="padding:4px 10px 4px 0;color:#4a4f3a">Guest ${i + 1}${g.name ? " — " + g.name : ""}</td>
     <td style="padding:4px 0;color:#2a2e1e;font-weight:600">${g.main}</td></tr>` +
    (g.dietary ? `<tr><td colspan="2" style="padding:0 0 6px;color:#8a9689;font-size:13px">↳ dietary: ${g.dietary}</td></tr>` : "")
  ).join("");
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2a2e1e">
    <h1 style="font-family:Georgia,serif;color:#4a4e69;font-size:24px">Melbourne Cup Lunch 2026</h1>
    <p style="color:#5a7d7c;font-weight:bold;letter-spacing:1px;text-transform:uppercase;font-size:12px;margin-top:-10px">The Jack &amp; Cleaver · Pennant Hills</p>
    <p style="font-size:15px;line-height:1.7">Hi ${name || "there"},</p>
    <p style="font-size:15px;line-height:1.7">${intro}</p>
    <table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:15px">
      <tr><td style="padding:6px 10px 6px 0;color:#8a9689">Reference</td><td style="padding:6px 0;font-weight:bold;color:#4a4e69;font-size:17px">${ref}</td></tr>
      <tr><td style="padding:6px 10px 6px 0;color:#8a9689">When</td><td style="padding:6px 0">Tuesday 3 November 2026, from 11:30am (wraps 4pm)</td></tr>
      <tr><td style="padding:6px 10px 6px 0;color:#8a9689">Where</td><td style="padding:6px 0">The Jack &amp; Cleaver, Pennant Hills Bowling Club</td></tr>
      <tr><td style="padding:6px 10px 6px 0;color:#8a9689">Guests</td><td style="padding:6px 0">${guests.length}</td></tr>
      <tr><td style="padding:6px 10px 6px 0;color:#8a9689">Total</td><td style="padding:6px 0;font-weight:bold">$${amount} (incl. GST)</td></tr>
    </table>
    <p style="font-size:13px;color:#8a9689;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Meal selections</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px">${rows}</table>
    <p style="font-size:15px;line-height:1.7">Each guest's main includes a glass of sparkling on arrival and sticky date pudding to finish. There'll be a live three-piece band from 12pm, and Best Dressed prizes on the day.</p>
    ${payidBlock || ""}
    <p style="font-size:13px;color:#8a9689;line-height:1.6;border-top:1px solid #eee;padding-top:14px">Bookings close 72 hours before the event. No refunds are given for cancellations within 72 hours. Questions? Call us on (02) 9484 2433 or reply to this email.</p>
    <p style="font-size:13px;color:#8a9689">The Jack &amp; Cleaver · Four Sausages Hospitality Group</p>
  </div>`;
}

function payidBlock(amount, ref) {
  return `
  <div style="background:#4a4e69;color:#faedcd;border-radius:10px;padding:18px 20px;margin:4px 0 18px">
    <p style="font-family:Georgia,serif;font-size:18px;font-weight:bold;margin:0 0 10px;color:#faedcd">Complete your payment by PayID</p>
    <table style="width:100%;border-collapse:collapse;font-size:15px;color:#faedcd">
      <tr><td style="padding:4px 0;opacity:0.75">PayID (ACN)</td><td style="padding:4px 0;text-align:right;font-weight:bold">682 276 820</td></tr>
      <tr><td style="padding:4px 0;opacity:0.75">Account name</td><td style="padding:4px 0;text-align:right;font-weight:bold">LL Club Catering Services Pty Ltd</td></tr>
      <tr><td style="padding:4px 0;opacity:0.75">Amount</td><td style="padding:4px 0;text-align:right;font-weight:bold">$${amount}</td></tr>
      <tr><td style="padding:4px 0;opacity:0.75">Reference</td><td style="padding:4px 0;text-align:right;font-weight:bold">${ref}</td></tr>
    </table>
    <p style="font-size:13px;opacity:0.8;margin:10px 0 0;line-height:1.6">Please include the reference <b>${ref}</b> in your payment description so we can match it to your table. Your booking is confirmed once we receive your transfer.</p>
  </div>`;
}

// ---- Handler ----------------------------------------------------------------

exports.handler = async (event) => {
  const now = new Date();
  const cutoffPassed = now >= CUTOFF;

  // ---- Availability (GET) ----
  if (event.httpMethod === "GET") {
    if (cutoffPassed) return json(200, { open: false, cutoffPassed: true });
    if (!airtableConfigured()) return json(200, { open: true, configured: false });
    try {
      const booked = await bookedCount();
      const remaining = Math.max(0, MAX_GUESTS - booked);
      return json(200, { open: remaining > 0, remaining, soldOut: remaining <= 0 });
    } catch (e) {
      // Don't block the page if the read fails — let the POST do the hard check.
      return json(200, { open: true, configured: true });
    }
  }

  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  // ---- Create booking (POST) ----
  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch (e) { return json(400, { error: "Invalid request." }); }

  // Honeypot — silently reject bots.
  if (payload.company) return json(400, { error: "Unable to process this booking." });

  if (cutoffPassed) return json(409, { error: "Bookings for the Melbourne Cup lunch have now closed." });

  const method = payload.method === "payid" ? "payid" : payload.method === "card" ? "card" : null;
  if (!method) return json(400, { error: "Please choose a payment method." });

  const name = clean(payload.name, 120);
  const email = clean(payload.email, 160);
  const phone = clean(payload.phone, 40);
  const notes = clean(payload.notes, 1000);
  if (!name || !email || !phone) return json(400, { error: "Please provide your name, email and phone number." });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Please provide a valid email address." });

  const rawGuests = Array.isArray(payload.guests) ? payload.guests : [];
  if (rawGuests.length < MIN_GUESTS) return json(400, { error: `Please book for at least ${MIN_GUESTS} guests.` });
  if (rawGuests.length > MAX_GUESTS) return json(400, { error: `Bookings are limited to ${MAX_GUESTS} guests.` });

  const guests = [];
  for (let i = 0; i < rawGuests.length; i++) {
    const g = rawGuests[i] || {};
    const main = clean(g.main, 60);
    if (!MAINS.includes(main)) return json(400, { error: `Please choose a valid main for Guest ${i + 1}.` });
    guests.push({ name: clean(g.name, 80), main, dietary: clean(g.dietary, 200) });
  }

  const amount = guests.length * PRICE; // computed server-side — never trust the client

  if (!airtableConfigured()) return json(503, { error: "Online bookings aren't available right now. Please call us on (02) 9484 2433." });

  // Capacity check (atomic enough for a 60-seat one-off event).
  try {
    const booked = await bookedCount();
    if (booked + guests.length > MAX_GUESTS) {
      const remaining = Math.max(0, MAX_GUESTS - booked);
      return json(409, {
        error: remaining <= 0
          ? "We're fully booked for the Melbourne Cup lunch — thank you!"
          : `Only ${remaining} seat${remaining === 1 ? "" : "s"} left — please reduce your group size.`,
        remaining,
      });
    }
  } catch (e) {
    return json(502, { error: "We couldn't check availability. Please try again shortly or call us on (02) 9484 2433." });
  }

  const ref = reference();
  const fields = {
    Reference: ref,
    Name: name,
    Email: email,
    Phone: phone,
    Guests: guests.length,
    Amount: amount,
    Mains: mainsSummary(guests),
    "Guest Details": guestDetailLines(guests),
    Dietary: dietarySummary(guests),
    "Payment Method": method === "card" ? "Card" : "PayID",
    Paid: false,
    Status: method === "card" ? "Awaiting payment" : "Awaiting PayID",
    Notes: notes,
  };

  let record;
  try { record = await createRecord(fields); }
  catch (e) { return json(502, { error: "We couldn't save your booking. Please try again or call us on (02) 9484 2433." }); }

  // ---- PayID path ----
  if (method === "payid") {
    try {
      await sendEmail(
        email,
        `Your Melbourne Cup lunch booking — payment details (${ref})`,
        bookingHtml({
          name, ref, guests, amount,
          intro: "Thank you for booking our Melbourne Cup lunch! Your table is held — to confirm it, please complete your PayID payment using the details below.",
          payidBlock: payidBlock(amount, ref),
        })
      );
    } catch (e) { /* booking is saved; email failure shouldn't block the response */ }
    return json(200, { reference: ref, amount });
  }

  // ---- Card path (Stripe Checkout) ----
  if (!process.env.STRIPE_SECRET_KEY) {
    return json(503, { error: "Card payments aren't available right now. Please choose PayID, or call us on (02) 9484 2433." });
  }
  let stripe;
  try { stripe = require("stripe")(process.env.STRIPE_SECRET_KEY); }
  catch (e) { return json(500, { error: "Payment system unavailable. Please choose PayID or call us." }); }

  const url = baseUrl(event);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      client_reference_id: record.id,
      metadata: { reference: ref, airtable_id: record.id, guests: String(guests.length) },
      line_items: [{
        quantity: guests.length,
        price_data: {
          currency: CURRENCY,
          unit_amount: PRICE * 100,
          product_data: { name: EVENT_LABEL, description: "Melbourne Cup lunch — $50 per guest (incl. GST)" },
        },
      }],
      success_url: `${url}/melbourne-cup-confirmed.html?ref=${encodeURIComponent(ref)}&method=card&paid=1`,
      cancel_url: `${url}/melbourne-cup.html?cancelled=1#book`,
    });
    // Best effort: record the Stripe session for support/matching.
    patchRecord(record.id, { "Stripe Session ID": session.id }).catch(() => {});
    return json(200, { checkoutUrl: session.url, reference: ref });
  } catch (e) {
    return json(502, { error: "We couldn't start the card payment. Please try PayID, or call us on (02) 9484 2433." });
  }
};
