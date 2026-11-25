// Deal outreach for Motiv's AI agent (v1, email-first).
//
// The app collects the buyer's background (name, email, target car, lease/
// finance targets, trade-in incl. amount owed + photos) and, only with the
// buyer's explicit consent, POSTs the packet here. This serverless function
// emails the dealer on the buyer's behalf via the Resend HTTPS API — the
// same pattern proven in Helios. The Resend key lives in
// process.env.RESEND_API_KEY and is never committed, never sent to the
// browser, and never logged.
//
// POST /api/deal-outreach
//   Body (JSON):
//     {
//       "buyer":   { "name": "…", "email": "…", "phone": "…" },   // name + email required
//       "car":     { "year": 2025, "make": "…", "model": "…", "trim": "…",
//                    "price": 52345, "mileage": 12345, "vin": "…",
//                    "url": "https://www.cargurus.com/Cars/listing/…",
//                    "dealer": { "name": "…", "city": "…", "phone": "…" } },
//       "deal":    { "type": "lease" | "finance", "monthlyTarget": 650,
//                    "down": 2000, "termMonths": 36, "maxOtd": 55000 },
//       "tradeIn": { "hasTrade": true, "year": 2019, "make": "…", "model": "…",
//                    "vin": "…", "mileage": 61234, "owed": 9800,
//                    "condition": "…", "photos": [{ "name": "exterior.jpg",
//                    "dataUrl": "data:image/jpeg;base64,…" }] },
//       "notes": "…",
//       "dealerEmail": "sales@dealer.example",   // required — never guessed server-side
//       "consent": true,                          // required — buyer authorised outreach
//       "dryRun": false                           // true => compose + return, do not send
//     }
//
// Responses:
//   200 { ok: true, sent: true, messageId, dealerEmail, sentAt }
//   200 { ok: true, dryRun: true, email: { to, from, replyTo, subject, text } }
//   400 { ok: false, error: "Missing required field(s): …" }
//   422 { ok: false, error: "no_dealer_email", dealerPhone, callScript }
//         — no email address is known for this dealer; do NOT guess one.
//         The app shows the dealer phone + call script instead.
//   503 { ok: false, error: "Deal outreach is not configured yet (RESEND_API_KEY missing)" }
//
// Rules baked in: no invented trade-in value (only user-entered numbers are
// stated; any estimate is labelled as an estimate), no firm offer, no claim
// a deal is closed — the email asks the dealer for their best price, a
// trade-in appraisal, and availability, and asks them to reply to the buyer.
// Trade-in photos are attached as files, capped at 10 photos / 10 MB total.
module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Use POST with a deal packet (see api/deal-outreach.js header)' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {
      return res.status(400).json({ ok: false, error: 'Body must be valid JSON' });
    }
  }
  body = body || {};

  // --- Validation: never send without the essentials + consent. ---
  const missing = [];
  const buyer = body.buyer || {};
  if (!buyer.name || !String(buyer.name).trim()) missing.push('buyer.name');
  if (!buyer.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(buyer.email))) missing.push('buyer.email');
  const car = body.car || {};
  if (!car.year) missing.push('car.year');
  if (!car.make) missing.push('car.make');
  if (!car.model) missing.push('car.model');
  if (!car.vin) missing.push('car.vin');
  if (!car.url) missing.push('car.url');
  const dealer = car.dealer || {};
  if (!dealer.name) missing.push('car.dealer.name');
  if (body.consent !== true) missing.push('consent (buyer must authorise outreach)');
  if (missing.length) {
    return res.status(400).json({ ok: false, error: 'Missing required field(s): ' + missing.join(', ') });
  }

  // --- Dealer email: never guess one. ---
  const dealerEmail = (body.dealerEmail || '').trim();
  if (!dealerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dealerEmail)) {
    const carLabel = [car.year, car.make, car.model, car.trim].filter(Boolean).join(' ');
    return res.status(422).json({
      ok: false,
      error: 'no_dealer_email',
      dealerName: dealer.name,
      dealerPhone: dealer.phone || null,
      callScript: 'Hi, my name is ' + buyer.name + '. I am interested in your '
        + carLabel + ' (VIN ' + car.vin + ', listed at $'
        + Number(car.price || 0).toLocaleString('en-US')
        + '). Could you confirm it is still available and give me your best out-the-door price? '
        + 'You can reach me at ' + buyer.email
        + (buyer.phone ? (' or ' + buyer.phone) : '') + '.',
    });
  }

  // --- Compose the dealer email (buyer's numbers only, nothing invented). ---
  const carLabel = [car.year, car.make, car.model, car.trim].filter(Boolean).join(' ');
  const money = (n) => (n === undefined || n === null || n === '') ? '—'
    : '$' + Number(n).toLocaleString('en-US');
  const deal = body.deal || {};
  const trade = body.tradeIn || {};
  const tradeLabel = trade.hasTrade
    ? [trade.year, trade.make, trade.model].filter(Boolean).join(' ') : null;

  const lines = [];
  lines.push('Hi ' + dealer.name + ' team,');
  lines.push('');
  lines.push('I am writing on behalf of ' + buyer.name + ', who is interested in the following vehicle you have listed:');
  lines.push('');
  lines.push('  ' + carLabel);
  lines.push('  Price: ' + money(car.price) + '  |  Mileage: '
    + (car.mileage === undefined || car.mileage === null ? '—' : Number(car.mileage).toLocaleString('en-US') + ' miles'));
  lines.push('  VIN: ' + car.vin);
  lines.push('  Listing: ' + car.url);
  lines.push('');
  if (deal.type) {
    lines.push('What ' + buyer.name + ' is looking for:');
    lines.push('  ' + (deal.type === 'lease' ? 'Lease' : 'Finance')
      + (deal.monthlyTarget ? (' — target around ' + money(deal.monthlyTarget) + '/month') : '')
      + (deal.down !== undefined && deal.down !== '' ? (' with ' + money(deal.down) + ' down') : '')
      + (deal.termMonths ? (' over ' + deal.termMonths + ' months') : '') + '.');
    if (deal.type === 'finance' && deal.maxOtd) {
      lines.push('  Max out-the-door price: ' + money(deal.maxOtd) + '.');
    }
    lines.push('');
  }
  if (trade.hasTrade) {
    lines.push('Trade-in:');
    lines.push('  ' + (tradeLabel || 'Vehicle') + (trade.vin ? (' — VIN ' + trade.vin) : ''));
    lines.push('  Mileage: ' + (trade.mileage === undefined || trade.mileage === null ? '—' : Number(trade.mileage).toLocaleString('en-US') + ' miles')
      + '  |  Amount owed / payoff: ' + money(trade.owed));
    if (trade.condition) lines.push('  Condition notes: ' + trade.condition);
    lines.push('  Photos of the trade-in are attached to this email.');
    lines.push('  Please note: no trade-in value has been agreed — please give us your appraisal.');
    lines.push('');
  }
  if (body.notes) { lines.push('Anything else: ' + body.notes); lines.push(''); }
  lines.push('Could you please confirm the car is still available, and send your best out-the-door price'
    + (deal.type === 'lease' ? ' / monthly' : '')
    + (trade.hasTrade ? ', plus your trade-in appraisal' : '') + '?');
  lines.push('');
  lines.push('Please reply directly to ' + buyer.name + ' at ' + buyer.email
    + (buyer.phone ? (' (phone ' + buyer.phone + ')') : '') + '.');
  lines.push('');
  lines.push('Thanks,');
  lines.push('Motiv — on behalf of ' + buyer.name);
  const text = lines.join('\n');
  const subject = 'Interested buyer: ' + carLabel + ' (VIN ' + car.vin + ')';

  // --- Trade-in photo attachments (data URLs -> base64), capped. ---
  const attachments = [];
  const photos = Array.isArray(trade.photos) ? trade.photos.slice(0, 10) : [];
  let photoBytes = 0;
  for (const p of photos) {
    if (!p || typeof p.dataUrl !== 'string') continue;
    const m = p.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) continue;
    const buf = Buffer.from(m[2], 'base64');
    photoBytes += buf.length;
    if (photoBytes > 10 * 1024 * 1024) break;
    attachments.push({ filename: p.name || 'trade-in-photo.jpg', content: m[2] });
  }

  const from = process.env.MOTIV_FROM_EMAIL || 'Motiv <deals@motiv.app>';
  const emailPayload = {
    from: from,
    to: [dealerEmail],
    reply_to: buyer.email,
    cc: [buyer.email],
    subject: subject,
    text: text,
    attachments: attachments,
  };

  // --- Dry run: compose + return, send nothing. ---
  if (body.dryRun === true) {
    return res.status(200).json({
      ok: true,
      dryRun: true,
      email: {
        to: dealerEmail,
        from: from,
        replyTo: buyer.email,
        cc: [buyer.email],
        subject: subject,
        text: text,
        attachmentCount: attachments.length,
      },
    });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return res.status(503).json({ ok: false, error: 'Deal outreach is not configured yet (RESEND_API_KEY missing)' });
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + resendKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(502).json({ ok: false, error: 'Email send failed (' + r.status + '): ' + (j.message || 'Resend error') });
    }
    return res.status(200).json({
      ok: true,
      sent: true,
      messageId: j.id || null,
      dealerEmail: dealerEmail,
      sentAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'Email send failed' });
  }
};
