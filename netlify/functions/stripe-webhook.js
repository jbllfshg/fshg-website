// Stripe webhook for the Melbourne Cup lunch.
//
// On `checkout.session.completed` it marks the matching Airtable booking as
// Paid / Confirmed and emails the guest their confirmation. The webhook
// signing secret and all other credentials live in Netlify environment
// variables. Signature verification is mandatory — an unsigned or badly
// signed request is rejected.

const FROM_EMAIL = process.env.FROM_EMAIL || "reservations@fshg.com.au";
const REPLY_TO = process.env.REPLY_TO || "reservations@thejackandcleaver.com.au";
const TABLE = process.env.AIRTABLE_TABLE || "Melbourne Cup Bookings";

function atUrl(id) {
  return `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}/${id}`;
}
function atHeaders() {
  return { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, "Content-Type": "application/json" };
}

async function getRecord(id) {
  const res = await fetch(atUrl(id), { headers: atHeaders() });
  if (!res.ok) return null;
  return res.json();
}
async function markPaid(id) {
  const res = await fetch(atUrl(id), {
    method: "PATCH",
    headers: atHeaders(),
    body: JSON.stringify({ fields: { Paid: true, Status: "Confirmed" }, typecast: true }),
  });
  return res.ok;
}

async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `The Jack & Cleaver <${FROM_EMAIL}>`, to: [to], reply_to: REPLY_TO, subject, html }),
  });
  return res.ok;
}

function confirmationHtml(f) {
  const detail = (f["Guest Details"] || "").split("\n").filter(Boolean)
    .map((l) => `<tr><td style="padding:3px 0;color:#2a2e1e;font-size:14px">${l}</td></tr>`).join("");
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2a2e1e">
    <h1 style="font-family:Georgia,serif;color:#4a4e69;font-size:24px">You're booked in! 🏇</h1>
    <p style="color:#5a7d7c;font-weight:bold;letter-spacing:1px;text-transform:uppercase;font-size:12px;margin-top:-10px">Melbourne Cup Lunch · The Jack &amp; Cleaver</p>
    <p style="font-size:15px;line-height:1.7">Hi ${f.Name || "there"},</p>
    <p style="font-size:15px;line-height:1.7">Payment received — your table for the Melbourne Cup lunch is confirmed. We can't wait to see you trackside!</p>
    <table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:15px">
      <tr><td style="padding:6px 10px 6px 0;color:#8a9689">Reference</td><td style="padding:6px 0;font-weight:bold;color:#4a4e69;font-size:17px">${f.Reference || ""}</td></tr>
      <tr><td style="padding:6px 10px 6px 0;color:#8a9689">When</td><td style="padding:6px 0">Tuesday 3 November 2026, from 11:30am (wraps 4pm)</td></tr>
      <tr><td style="padding:6px 10px 6px 0;color:#8a9689">Where</td><td style="padding:6px 0">The Jack &amp; Cleaver, Pennant Hills Bowling Club</td></tr>
      <tr><td style="padding:6px 10px 6px 0;color:#8a9689">Guests</td><td style="padding:6px 0">${f.Guests || ""}</td></tr>
      <tr><td style="padding:6px 10px 6px 0;color:#8a9689">Paid</td><td style="padding:6px 0;font-weight:bold">$${f.Amount || ""} (incl. GST)</td></tr>
    </table>
    ${detail ? `<p style="font-size:13px;color:#8a9689;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Meal selections</p><table style="width:100%;border-collapse:collapse;margin-bottom:18px">${detail}</table>` : ""}
    <p style="font-size:15px;line-height:1.7">Your lunch includes a glass of sparkling on arrival and sticky date pudding to finish, with a live three-piece band from 12pm and Best Dressed prizes on the day.</p>
    <p style="font-size:13px;color:#8a9689;line-height:1.6;border-top:1px solid #eee;padding-top:14px">No refunds are given for cancellations within 72 hours of the event. Questions? Call us on (02) 9484 2433 or reply to this email.</p>
    <p style="font-size:13px;color:#8a9689">The Jack &amp; Cleaver · Four Sausages Hospitality Group</p>
  </div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !key) return { statusCode: 503, body: "Webhook not configured" };

  let stripe;
  try { stripe = require("stripe")(key); }
  catch (e) { return { statusCode: 500, body: "Stripe unavailable" }; }

  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    return { statusCode: 400, body: `Webhook signature verification failed` };
  }

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const recordId = session.client_reference_id;
    if (recordId && session.payment_status === "paid") {
      try {
        const record = await getRecord(recordId);
        // Idempotent: skip if we've already confirmed this booking.
        if (record && record.fields && record.fields.Paid !== true) {
          await markPaid(recordId);
          if (record.fields.Email) {
            await sendEmail(
              record.fields.Email,
              `Your Melbourne Cup lunch is confirmed! (${record.fields.Reference || ""})`,
              confirmationHtml(record.fields)
            );
          }
        }
      } catch (e) {
        // Log for Netlify function logs but still 200 so Stripe doesn't retry forever.
        console.error("Post-payment processing failed:", e && e.message);
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
