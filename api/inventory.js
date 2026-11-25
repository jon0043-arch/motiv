module.exports = async function(req,res) {
 const urls=(process.env.DEALER_FEEDS||'').split(',').map(s=>s.trim()).filter(Boolean);
 if(!urls.length)return res.status(503).json({vehicles:[],error:'No authorized dealer feeds configured'});
 const results=await Promise.allSettled(urls.map(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Feed unavailable');const j=await r.json();return Array.isArray(j)?j:j.vehicles||[];}));
 const unique=new Map();for(const r of results)if(r.status==='fulfilled')for(const v of r.value){if(v.vin&&v.url&&v.available!==false&&Number.isFinite(Number(v.price)))unique.set(v.vin,{vin:v.vin,year:v.year,make:v.make,model:v.model,trim:v.trim,price:Number(v.price),mileage:v.mileage,photo:v.photo,url:v.url,dealer:v.dealer,zip:v.zip,features:v.features||[]});}
 const min=Number(req.query.min||0),max=Number(req.query.max||Infinity);
 res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');return res.status(results.some(r=>r.status==='fulfilled')?200:502).json({vehicles:[...unique.values()].filter(v=>v.price>=min&&v.price<=max),failedFeeds:results.filter(r=>r.status==='rejected').length});
};