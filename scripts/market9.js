// Рынок вокруг лотов каталога v3: те же зоны cityId|kind, что и раньше
// (кэш прошлых сборок переиспользуется). Категории: продажа домов 1602 /
// квартир 1758; аренда домов 330, квартир 1760. → data/market9-cache.json
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, 'data') + path.sep;
const OLD_CACHE = 'C:/Users/xetr11/AppData/Local/Temp/claude/c--Users-xetr11-Documents-New-folder/5e19b764-3f94-4fb8-8c59-b1d354783282/scratchpad/market2-cache.json';
const CACHE = D + 'market9-cache.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const H = { 'user-agent': UA, 'accept-language': 'uk-UA,uk;q=0.9' };
const A = 'https://www.olx.ua/api/v1/offers/';
const NOW = Date.now();
const SALE = { house: 1602, flat: 1758 };
const RENT_H = 330, RENT_F = 1760;
const RADIUS_SALE = 10, RADIUS_RENT = 15, VERSION = 1;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const { units } = JSON.parse(fs.readFileSync(D + 'units9.json', 'utf8'));
let cache;
if (fs.existsSync(CACHE)) cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
else if (fs.existsSync(OLD_CACHE)) { cache = JSON.parse(fs.readFileSync(OLD_CACHE, 'utf8')); console.log('кэш зон унаследован от прошлой сборки'); }
else cache = {};
for (const k of ['city', 'zone', 'list']) if (!cache[k]) cache[k] = {};
const save = () => fs.writeFileSync(CACHE, JSON.stringify(cache));
const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const norm = s => String(s || '').toLowerCase().replace(/[’'ʼ`]/g, "'").trim();

async function getJson(u, tries = 3) {
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(u, { headers: H });
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (t + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(700 * (t + 1)); }
  }
  return null;
}
async function listing(cat, cityId, dist, pages = 1) {
  const key = `${cat}|${cityId}|${dist}|${pages}`;
  if (cache.list[key]) return cache.list[key];
  const out = { total: null, items: [] };
  for (let p = 0; p < pages; p++) {
    const d = await getJson(`${A}?offset=${p * 40}&limit=40&category_id=${cat}&city_id=${cityId}` + (dist ? `&distance=${dist}` : ''));
    if (!d) break;
    if (out.total == null) out.total = d.metadata ? d.metadata.total_elements : null;
    for (const o of (d.data || [])) {
      const pr = (o.params || []).find(x => x.key === 'price');
      const v = pr && pr.value ? pr.value : null;
      out.items.push({
        price: v ? v.value : null, cur: v ? v.currency : null,
        ageD: o.created_time ? Math.max(1, Math.round((NOW - Date.parse(o.created_time)) / 86400000)) : null,
      });
    }
    if ((d.data || []).length < 40) break;
    await sleep(170);
  }
  cache.list[key] = out;
  return out;
}
async function cityIdFor(u) {
  if (u.src === 'olx' && u.cityId) return u.cityId;
  const nm = norm(u.loc);
  if (!nm) return null;
  if (cache.city[nm] !== undefined) return cache.city[nm];
  const d = await getJson(A + '?limit=25&category_id=1602&query=' + encodeURIComponent(u.loc));
  const hit = (d && d.data || []).map(o => o.location && o.location.city).filter(Boolean).find(c => norm(c.name) === nm);
  cache.city[nm] = hit ? hit.id : null;
  await sleep(250);
  return cache.city[nm];
}

(async () => {
  const need = new Map();
  for (const u of units) {
    const cid = await cityIdFor(u);
    u._zone = cid ? cid + '|' + u.kind : null;
    if (cid) need.set(u._zone, { cid, kind: u.kind });
  }
  save();
  const todo = [...need.entries()].filter(([z]) => !cache.zone[z] || cache.zone[z].v !== VERSION);
  console.log('зон нужно:', need.size, '| собрать:', todo.length);
  let n = 0;
  for (const [zone, { cid, kind }] of todo) {
    n++;
    const sale = await listing(SALE[kind], cid, RADIUS_SALE, 3);
    const saleLoc = await listing(SALE[kind], cid, 0, 1);
    const rentFLoc = await listing(RENT_F, cid, 0, 1);
    const rentFNear = await listing(RENT_F, cid, RADIUS_RENT, 1);
    let rentHLoc = { total: 0, items: [] }, rentHNear = { total: 0, items: [] };
    if (kind === 'house') {
      rentHLoc = await listing(RENT_H, cid, 0, 1);
      rentHNear = await listing(RENT_H, cid, RADIUS_RENT, 1);
    }
    const ages = sale.items.map(i => i.ageD).filter(Boolean);
    const rentLoc = [...rentHLoc.items, ...rentFLoc.items];
    const rentNear = [...rentHNear.items, ...rentFNear.items];
    cache.zone[zone] = {
      v: VERSION, kind,
      saleN: saleLoc.total, saleN10: sale.total, sampleN: ages.length,
      medAge: med(ages),
      share30: ages.length ? +(ages.filter(a => a <= 30).length / ages.length).toFixed(3) : null,
      stale: ages.length ? +(ages.filter(a => a > 365).length / ages.length).toFixed(3) : null,
      rentH: rentHLoc.total, rentF: rentFLoc.total,
      rentH15: rentHNear.total, rentF15: rentFNear.total,
      rentPricesLoc: rentLoc.map(i => ({ p: i.price, c: i.cur })).filter(x => x.p),
      rentPricesNear: rentNear.map(i => ({ p: i.price, c: i.cur })).filter(x => x.p),
    };
    save();
    if (n % 20 === 0 || n === todo.length) console.log(`  [${n}/${todo.length}] ${zone}`);
  }
  save();
  console.log('готово. зон в кэше:', Object.keys(cache.zone).length);
})();
