// Индексы «продать/сдать» из data/market9-cache.json по методике прежнего каталога.
// → data/market9.json {byId}
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, 'data') + path.sep;
const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const { units } = rd(D + 'units9.json');
const c2 = rd(D + 'market9-cache.json');

async function rates() {
  const out = { UAH: null, EUR: null };
  try {
    const d = await (await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json')).json();
    const usd = d.find(x => x.cc === 'USD'), eur = d.find(x => x.cc === 'EUR');
    if (usd) out.UAH = 1 / usd.rate;
    if (usd && eur) out.EUR = eur.rate / usd.rate;
  } catch { }
  if (!out.UAH) out.UAH = 1 / 44.5;
  if (!out.EUR) out.EUR = 1.17;
  return out;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function liquidity(z) {
  if (!z.sampleN || z.sampleN < 6 || z.medAge == null) return null;
  const A = 100 * (1 - clamp(Math.log(clamp(z.medAge, 60, 360) / 60) / Math.log(6), 0, 1));
  const B = 100 * clamp(((z.share30 ?? 0) - 0.05) / 0.30, 0, 1);
  const C = 100 * (1 - clamp(((z.stale ?? 0) - 0.10) / 0.30, 0, 1));
  return Math.round(0.45 * A + 0.30 * B + 0.25 * C);
}
function rentIndex(z) {
  const loc = (z.rentH || 0) + (z.rentF || 0);
  const near = (z.rentH15 || 0) + (z.rentF15 || 0);
  if (loc >= 1) return Math.round(clamp(20 + 80 * Math.log(loc) / Math.log(60), 20, 100));
  if (near >= 1) return Math.round(Math.min(15, 15 * Math.log(1 + near) / Math.log(60)));
  return 0;
}

(async () => {
  const R = await rates();
  const toUsd = x => x.c === 'UAH' ? x.p * R.UAH : x.c === 'EUR' ? x.p * R.EUR : x.p;
  const medPrice = arr => {
    const s = (arr || []).map(toUsd).filter(v => v > 40 && v < 4000).sort((a, b) => a - b);
    return s.length >= 3 ? Math.round(s[Math.floor(s.length / 2)]) : null;
  };
  const norm = s => String(s || '').toLowerCase().replace(/[’'ʼ`]/g, "'").trim();
  const byId = {};
  let filled = 0, missing = 0;
  for (const u of units) {
    let cid = u.src === 'olx' && u.cityId ? u.cityId : c2.city[norm(u.loc)];
    let z = cid ? c2.zone[cid + '|' + u.kind] : null;
    let viaCity = false;
    if (!z && u.city) {
      const cid2 = c2.city[norm(u.city)];
      const z2 = cid2 ? c2.zone[cid2 + '|' + u.kind] : null;
      if (z2) { cid = cid2; z = z2; viaCity = true; }
    }
    if (!z) { missing++; continue; }
    const rentLocN = (z.rentH || 0) + (z.rentF || 0);
    byId[u.id] = {
      z: cid, loc: viaCity ? u.city : u.loc, kind: u.kind, viaCity,
      buy: liquidity(z), rent: rentIndex(z),
      saleN: z.saleN, saleN10: z.saleN10, medAge: z.medAge,
      share30: z.share30 != null ? Math.round(z.share30 * 100) : null,
      stale: z.stale != null ? Math.round(z.stale * 100) : null,
      rentH: z.rentH, rentF: z.rentF, rentN: rentLocN,
      rentH15: z.rentH15, rentF15: z.rentF15, rentN15: (z.rentH15 || 0) + (z.rentF15 || 0),
      rentPrice: rentLocN >= 3 ? medPrice(z.rentPricesLoc) : null,
      rentPriceNear: medPrice(z.rentPricesNear),
    };
    filled++;
  }
  fs.writeFileSync(D + 'market9.json', JSON.stringify({ rates: { UAH: +R.UAH.toFixed(5), EUR: +R.EUR.toFixed(3) }, byId }));
  console.log('лотов с рынком:', filled, 'из', units.length, '| без зоны:', missing);
})();
