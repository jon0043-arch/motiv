// Live CarGurus search proxy for Motiv.
//
// The browser app cannot call api.api.sh directly — the feed sends no
// CORS headers — so this serverless function holds the API key
// server-side and answers the app. The key comes from
// process.env.API_SH_KEY and is never committed, never sent to the
// browser, and never logged.
//
// GET /api/search?zip=19090&distance=50&min_price=20000&max_price=25000&page=1
// Optional: make, model, mileage_max, body_type.
// Features (CarPlay, heated seats, ...) are filtered client-side from
// each listing's options list — the feed has no server-side feature filter.
// Returns the feed's JSON as-is: { count, page, next_page, listings: [...] }.
module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const key = process.env.API_SH_KEY;
  if (!key) {
    return res.status(503).json({ listings: [], count: 0, error: 'Live search is not configured yet (API_SH_KEY missing)' });
  }

  const q = req.query || {};
  const params = new URLSearchParams();
  params.set('zip', String(q.zip || '19090'));
  params.set('distance', String(q.distance || '50'));
  params.set('page', String(q.page || '1'));
  if (q.make) params.set('make', String(q.make));
  if (q.model) params.set('model', String(q.model));
  if (q.min_price) params.set('min_price', String(q.min_price));
  if (q.max_price) params.set('max_price', String(q.max_price));
  if (q.mileage_max) params.set('mileage_max', String(q.mileage_max));
  if (q.body_type) params.set('body_type', String(q.body_type));

  try {
    const r = await fetch('https://api.api.sh/cargurus/v1/search?' + params.toString(), {
      headers: { 'x-api-key': key },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      return res.status(502).json({ listings: [], count: 0, error: 'Feed unavailable (' + r.status + ')' });
    }
    const j = await r.json();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(j);
  } catch (e) {
    return res.status(502).json({ listings: [], count: 0, error: 'Feed unavailable' });
  }
};
