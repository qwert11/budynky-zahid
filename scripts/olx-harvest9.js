// Полный сбор OLX по 9 областям (Запад + Хмельницкая, Житомирская, Винницкая):
// дома (1602) и квартиры (1758). Потолок выдачи 1000 обходится рекурсивной
// бисекцией цены (см. pokupka_doma/prompt_tochka_vkhoda.md).
// usage: node olx-harvest9.js houses|flats [from] [to]
// Полоса по умолчанию — весь бюджет каталога ($29–45 тыс.); можно догрузить
// только новый кусок: node olx-harvest9.js houses 41000 45000 — накопительный
// store дополнится, лоты дедуплицируются по id объявления.
const fs = require('fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const H = { 'user-agent': UA, 'accept-language': 'uk-UA,uk;q=0.9' };
const A = 'https://www.olx.ua/api/v1/offers/';
const CAP = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MODE = process.argv[2];
if (!['houses', 'flats'].includes(MODE)) { console.error('usage: node olx-harvest9.js houses|flats'); process.exit(2); }
const CAT = MODE === 'houses' ? 1602 : 1758;
const FROM = Number(process.argv[3] || 29000);
const TO = Number(process.argv[4] || 45000);
if (!(FROM > 0 && TO > FROM)) { console.error('плохая полоса цены: from < to, оба > 0'); process.exit(2); }
const OUT = __dirname + `/data/olx9-${MODE}.json`;

const REGIONS = [
  [22, 'Волинська'], [14, 'Рівненська'], [5, 'Львівська'], [11, 'Тернопільська'],
  [13, 'Івано-Франківська'], [18, 'Чернівецька'],
  [20, 'Хмельницька'], [6, 'Житомирська'], [24, 'Вінницька'],
];

async function getJson(u, tries = 4) {
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(u, { headers: H });
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * (t + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(900 * (t + 1)); }
  }
  return null;
}

const q = (regionId, from, to, offset, limit) =>
  `${A}?offset=${offset}&limit=${limit}&category_id=${CAT}&region_id=${regionId}` +
  `&filter_float_price%3Afrom=${from}&filter_float_price%3Ato=${to}&currency=USD`;

function shape(o, regionId) {
  const params = {};
  for (const p of o.params || []) {
    if (p.key === 'price') continue;
    params[p.key] = p.value ? (p.value.label || p.value.key || null) : null;
    if (p.value && p.value.key && p.value.label && p.value.key !== p.value.label) params[p.key + ':key'] = String(p.value.key);
  }
  const price = (o.params || []).find((x) => x.key === 'price');
  const pv = price && price.value ? price.value : {};
  const idm = (o.url || '').match(/-ID([A-Za-z0-9]+)\.html/);
  return {
    id: idm ? 'ID' + idm[1] : String(o.id), sku: String(o.id), src: 'olx',
    kind: MODE === 'houses' ? 'house' : 'flat', regionId,
    title: o.title, link: o.url,
    price: pv.value ?? null, cur: pv.currency || null,
    priceConv: pv.converted_value ?? null, curConv: pv.converted_currency || null,
    negotiable: !!pv.negotiable,
    loc: o.location && o.location.city ? o.location.city.name : null,
    cityId: o.location && o.location.city ? o.location.city.id : null,
    district: o.location && o.location.district ? o.location.district.name : null,
    region: o.location && o.location.region ? o.location.region.name : null,
    lat: o.map ? o.map.lat : null, lon: o.map ? o.map.lon : null, mapZoom: o.map ? o.map.zoom : null,
    created: o.created_time, refreshed: o.last_refresh_time,
    photos: (o.photos || []).slice(0, 8).map((p) => p.link),
    desc: (o.description || '').replace(/\s+/g, ' ').slice(0, 4000),
    business: !!o.business,
    params,
  };
}

const store = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { items: {}, bands: {} };
let calls = 0;

async function countBand(regionId, from, to) {
  calls++;
  const d = await getJson(q(regionId, from, to, 0, 1));
  if (!d || !d.metadata) throw new Error(`count fail r${regionId} ${from}-${to}`);
  await sleep(300);
  return d.metadata.total_elements;
}

async function drainBand(regionId, from, to, expect) {
  let got = 0;
  for (let off = 0; off < CAP; off += 40) {
    calls++;
    const d = await getJson(q(regionId, from, to, off, 40));
    if (!d) break;
    const arr = d.data || [];
    for (const o of arr) { const s = shape(o, regionId); store.items[s.id] = s; }
    got += arr.length;
    if (arr.length < 40) break;
    await sleep(300);
  }
  return got;
}

async function harvest(regionId, name, from, to, depth) {
  const n = await countBand(regionId, from, to);
  if (n >= CAP && to - from > 1) {
    const mid = Math.floor((from + to) / 2);
    console.log(`${name} $${from}-${to}: ${n} (потолок) → режем`);
    await harvest(regionId, name, from, mid, depth + 1);
    await harvest(regionId, name, mid, to, depth + 1); // перекрытие на границе, дедуп по id
    return;
  }
  const got = await drainBand(regionId, from, to, n);
  store.bands[`${regionId}:${from}-${to}`] = { n, got };
  console.log(`${name} $${from}-${to}: заявлено ${n}, забрано ${got}, в базе ${Object.keys(store.items).length}`);
  fs.writeFileSync(OUT, JSON.stringify(store));
}

(async () => {
  console.log(`Сбор: ${MODE} (категория ${CAT}), $${FROM}–${TO}, 9 областей\n`);
  for (const [rid, name] of REGIONS) {
    await harvest(rid, name, FROM, TO, 0);
    await sleep(400);
  }
  const byReg = {};
  Object.values(store.items).forEach((x) => { byReg[x.region] = (byReg[x.region] || 0) + 1; });
  console.log('\nИтого', Object.keys(store.items).length, 'уникальных лотов; запросов', calls);
  console.log(Object.entries(byReg).map(([k, v]) => `${k}: ${v}`).join('\n'));
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
