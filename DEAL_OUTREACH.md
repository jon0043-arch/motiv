# Motiv — AI deal outreach (v1, email-first)

The app's "Let Motiv do the legwork" concierge collects the buyer's background
and, only with the buyer's explicit consent, asks the server to email the
dealer on the buyer's behalf. No firm offers, no invented trade-in values,
no claim a deal is closed — the email asks the dealer for their best price,
a trade-in appraisal, and availability, and asks them to reply to the buyer.

## Server endpoint

`POST /api/deal-outreach` — see the header comment in `api/deal-outreach.js`
for the full request body. Required: buyer name + email, target car
(year/make/model/VIN/listing URL/dealer name), `dealerEmail`, and
`consent: true`.

- `dealerEmail` is required and is **never guessed**. If no dealer email is
  known, the endpoint returns HTTP 422 `no_dealer_email` with the dealer
  phone and a call script, and the app shows "Needs dealer email — call
  instead". CarGurus listings carry no dealer email, so the app/server must
  get it from the dealer's public website, or fall back to phone.
- `dryRun: true` composes the email and returns it without sending — use it
  for testing. No real dealer is emailed in a dry run.
- Trade-in photos arrive as data URLs in the packet and are sent as email
  attachments (max 10 photos / 10 MB total).
- Reply-To is the buyer's email; the buyer is CC'd. Deal status in the app:
  Drafted → Sent (date/time + dealer contact used) → Awaiting reply →
  Reply received / Follow-up sent. Follow-ups are drafted, not auto-sent, in v1.

## Vercel env vars (Jon's step — not in this repo)

| Variable | Purpose |
| --- | --- |
| `API_SH_KEY` | Live CarGurus search (`api/search.js`) — already documented |
| `RESEND_API_KEY` | Sending dealer emails (`api/deal-outreach.js`) — from resend.com, API Keys |
| `MOTIV_FROM_EMAIL` | Optional sender, e.g. `Motiv <deals@motiv.app>` — the domain must be verified in Resend, otherwise Resend will reject the send. Default if unset: `Motiv <deals@motiv.app>` |

## Vercel setup (Jon's step)

1. In Vercel, open the Motiv project (imported from `jon0043-arch/motiv`),
   deploy it.
2. Settings → Environment Variables → add `RESEND_API_KEY` (and
   `API_SH_KEY` if not already there) for Production, then redeploy.
3. The app's server URL (set in More → Live Inventory Feed / deal settings)
   is the Vercel URL, e.g. `https://motiv-xxxx.vercel.app`. The app calls
   `{serverUrl}/api/search` for live search and `{serverUrl}/api/deal-outreach`
   for deal outreach. With no server URL configured the app honestly says
   "Server not connected — packet saved, share it yourself" and never claims
   it sent anything.

## Test (no real email sent)

```bash
node --check api/deal-outreach.js
# Dry run with node (no RESEND_API_KEY needed):
node -e "const fn=require('./api/deal-outreach.js'); const req={method:'POST',body:{buyer:{name:'Test Buyer',email:'buyer@example.com'},car:{year:2025,make:'Toyota',model:'RAV4',vin:'TESTVIN123',url:'https://www.cargurus.com/Cars/listing/123',dealer:{name:'Test Motors',phone:'(215) 555-0100'}},dealerEmail:'sales@testmotors.example',consent:true,dryRun:true}}; const res={setHeader(){},status(c){this.c=c;return this},json(o){console.log(JSON.stringify(o,null,2))}}; fn(req,res);"
```
