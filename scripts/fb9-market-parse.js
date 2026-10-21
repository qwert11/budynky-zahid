// Facebook Marketplace (сырьё — fb9-market.js) → кандидаты каталога в формате loadExt().
//
// Правила те же, что у постов групп (fb9-parse.js, разбор текста общий — lib-fb9.js):
//   • только дома, не дачи (покупателю дачи не нужны), $20–45 тыс.;
//   • только 9 областей, дома от 65 м² (если площадь указана), не доля, не недострой
//     и не «под ремонт»;
//   • расстояние до города не ограничиваем — правило покупателя 21.10.2026 («фильтр 10
//     можешь откинуть»), units9.js пропускает Facebook мимо KM_MAX.
//
// Цена. Поле цены Marketplace ненадёжно: продавцы вбивают доллары в поле гривен
// («215 000 ₴», в тексте «215 000 $»), тысячи («35 ₴») или заглушку «1 ₴». Поэтому главная —
// цена из текста (priceOf), поле — запасной вариант: до 1000 — тысячи долларов, до 600 тыс. —
// доллары, больше — гривны.
//
// Место. Точка Marketplace — город, который выбрал продавец (обычно областной центр), а
// дом бывает в селе за 20–30 км. Если в тексте названо село, ищем его в Nominatim в той
// области, что названа в тексте или где стоит точка Facebook, и берём, только если оно
// лежит в контуре этой области и не дальше 80 км от точки продавца. Иначе — точка Facebook.
//
// usage: node fb9-market-parse.js → data/fbm9-candidates.json (+ data/fb9-geocode.json, img/fbm/)
//        FB9_DRY=1 — только разбор без сети: что прошло и почему отсеяно
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib9');
const F = require('./lib-fb9');
const D = path.join(__dirname, 'data') + path.sep;
const RAW = D + 'fb9-raw' + path.sep + 'market' + path.sep;
const IMG = path.join(__dirname, '..', 'img', 'fbm') + path.sep;
const SINCE = '2026-04-01';   // старше полугода — Marketplace сам не снимает, продавцы не отмечают «продано»
const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const VET = fs.existsSync(D + 'photo-vet.json') ? rd(D + 'photo-vet.json') : {};
const feed = fs.existsSync(RAW + 'feed.json') ? rd(RAW + 'feed.json') : {};
const items = fs.existsSync(RAW + 'items.json') ? rd(RAW + 'items.json') : {};

// Отпечатки фото (dHash 8×8) — для дублей: один дом выкладывают разные агенты одного
// агентства под разными заголовками («Гвардійське» и «Продаж просторого будинку», 0 000).
// Кадры качаются в кэш выдачи (в git не идёт), отпечатки — в phash.json.
const PH = RAW + 'ph' + path.sep;
const PHF = RAW + 'phash.json';
const phash = fs.existsSync(PHF) ? rd(PHF) : {};
async function hashes(id, urls) {
  if (phash[id]) return phash[id];
  fs.mkdirSync(PH, { recursive: true });
  const out = [];
  for (const [i, u] of urls.slice(0, 4).entries()) {
    try {
      const f = PH + id + '_' + i + '.jpg';
      if (!fs.existsSync(f)) { const r = await fetch(u); if (!r.ok) continue; fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
      const px = execFileSync('D:/soft/video/ffmpeg.exe', ['-v', 'quiet', '-i', f, '-vf', 'scale=9:8,format=gray', '-f', 'rawvideo', '-']);
      let bits = '';
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? '1' : '0';
      out.push(bits);
    } catch (e) {}
  }
  if (out.length) { phash[id] = out; fs.writeFileSync(PHF, JSON.stringify(phash)); }
  return out;
}
const ham = (a, b) => { let n = 0; for (let i = 0; i < 64; i++) if (a[i] !== b[i]) n++; return n; };
// совпавших кадров: каждая пара отпечатков, отличающихся не больше чем на 6 бит из 64
const sameShots = (A, B) => A.filter(a => B.some(b => ham(a, b) <= 6)).length;

// «Шукаєте будинок, у який можна заїхати?» — реклама продавца, не «ищу»: общий WANT ловит «шукає»
const WANT = /(^|[^а-яіїєґ])(шукаю|шукаємо|куплю|купимо|викупимо|придбаю|придбаємо)(?![а-яіїєґ])/i;
const DACHA = /\bдач[аиіуне]\b|дачн|садов\S*\s+(будин|ділянк|товарист)|\bСТ\s+["«]/i;

function fieldUsd(a) {
  if (!a || a < 5) return null;                  // 0 и «1 ₴» — заглушка
  if (a < 1000) return { usd: a * 1000, cur: 'USD', raw: a * 1000 };
  if (a < 600000) return { usd: Math.round(a), cur: 'USD', raw: a };
  return { usd: Math.round(a / F.UAHRATE), cur: 'UAH', raw: a };
}

(async () => {
  fs.mkdirSync(IMG, { recursive: true });
  const why = {};
  const no = r => { why[r] = (why[r] || 0) + 1; return null; };
  const rows = [];
  for (const x of Object.values(feed)) {
    const d = items[x.id];
    if (!d) { no('карточка не открыта'); continue; }
    if (d.gone || d.sold || d.pending || d.live === false || x.sold) { no('снято/продано'); continue; }
    const date = x.time ? new Date(x.time * 1000).toISOString().slice(0, 10) : d.at;
    if (date < SINCE) { no('старше ' + SINCE); continue; }
    const title = L.deLatin(x.title.replace(/\s+/g, ' ').trim());
    const t = L.deLatin(title + '\n' + (d.desc || ''));
    const head = title + ' ' + (d.desc || '').slice(0, 300);
    if (!F.HOUSE.test(t)) { no('не дом'); continue; }
    if (F.FLAT.test(title) && !F.HOUSE.test(title) || F.FLAT.test(head) && head.search(F.FLAT) < head.search(F.HOUSE)) { no('квартира'); continue; }
    if (WANT.test(head)) { no('ищу/куплю'); continue; }
    if (F.RENT.test(head) || F.SOLD.test(head)) { no('аренда/продано'); continue; }
    if (F.LAND.test(title) || F.LAND.test(d.desc || '')) { no('участок'); continue; }
    if (DACHA.test(head)) { no('дача'); continue; }
    const pr = F.priceOf(t) || fieldUsd(d.amount != null ? d.amount : x.amount);
    if (!pr) { no('без цены'); continue; }
    if (!L.inBudgetKind(pr.usd, 'house')) { no('цена вне $20–45 тыс.'); continue; }
    const area = F.areaOf(t);
    if (area != null && area < 65) { no('меньше 65 м²'); continue; }
    if (L.SHARE.test(t.slice(0, 400))) { no('доля'); continue; }
    if (F.badText(t)) { no('недострой/под ремонт'); continue; }
    if (!(d.photos || []).length && !x.photo) { no('без фото'); continue; }
    if (d.lat == null) { no('без точки'); continue; }
    const fbObl = L.oblastOf(d.lat, d.lon, F.shapes);
    const txtObls = F.OBL_RE.filter(([, re]) => re.test(t)).map(([o]) => o);
    const obl = txtObls.length === 1 && !F.OTHER_OBL.test(t) ? txtObls[0] : fbObl;
    if (!obl || !F.ZONE[obl]) { no('не наши области'); continue; }
    rows.push({ x, d, t, title, date, pr, obl, area, loc: F.locOf(t) });
  }
  // перевыкладывания одного дома: тот же продавец и заголовок, или то же село, площадь и
  // начало текста — оставляем самое свежее
  const key = r => [r.x.seller || '', r.title.toLowerCase().replace(/[^а-яіїєґ0-9]/g, '').slice(0, 50)].join('|');
  const key2 = r => [r.loc || r.d.city || '', r.area || '', F.titleOf(r.d.desc || r.title).toLowerCase().replace(/[^а-яіїєґ]/g, '').slice(0, 40)].join('|');
  // Та же площадь при цене в пределах 5% — тот же дом у разных агентов или с новой ценой:
  // Великий Глибочок 66,3 м² по $25 000 «біля Тернополя» и «у В. Глибочку», Левків 126,5 м²
  // за $36 500 и через день за $35 000. Дробной площади (из техпаспорта) хватает области,
  // при круглой (100 м²) нужно ещё то же село.
  const sameArea = (r, k) => r.area && r.area === k.area && r.obl === k.obl &&
    Math.abs(r.pr.usd - k.pr.usd) <= 0.05 * k.pr.usd && (r.area % 1 || (r.loc || r.d.city) === (k.loc || k.d.city));
  const best = new Map(), seen2 = new Set(), byArea = [];
  for (const r of rows.sort((a, b) => b.date.localeCompare(a.date))) {
    if (best.has(key(r)) || seen2.has(key2(r)) || byArea.some(k => sameArea(r, k))) { no('перевыкладывание'); continue; }
    best.set(key(r), r); seen2.add(key2(r)); byArea.push(r);
  }
  // те же кадры: два совпавших кадра — один дом; один кадр — только при той же цене
  // (у агентства бывает общая заставка с телефоном на разных домах)
  if (!process.env.FB9_DRY) {
    const kept = [];
    for (const r of best.values()) {
      r.h = await hashes(r.x.id, (r.d.photos || []).length ? r.d.photos : [r.x.photo]);
      const twin = kept.find(k => { const n = sameShots(r.h, k.h); return n >= 2 || n >= 1 && k.pr.usd === r.pr.usd; });
      if (twin) { no('тот же дом по фото'); best.delete(key(r)); } else kept.push(r);
    }
  }
  if (process.env.FB9_DRY) {
    for (const r of best.values()) console.log(`${r.date} ${r.obl} $${r.pr.usd} (${r.pr.raw} ${r.pr.cur}) ${r.loc || '—'} / ${r.d.city} ${r.area || '?'}м² | ${r.title.slice(0, 70)}`);
    console.log('отсев:', JSON.stringify(why), '| прошло', best.size);
    return;
  }
  const out = [];
  for (const r of best.values()) {
    let lat = r.d.lat, lon = r.d.lon, exact = false, loc = r.d.city || null;
    if (r.loc) {
      const g = await F.geocode(r.loc, r.obl);
      if (g && L.hav(g.lat, g.lon, r.d.lat, r.d.lon) <= 80) { lat = g.lat; lon = g.lon; exact = true; loc = r.loc; }
    }
    const obl = L.oblastOf(lat, lon, F.shapes);
    if (!obl || !F.ZONE[obl]) { no('точка вне наших областей'); continue; }
    const id = 'FB' + r.x.id;
    if (VET[id] === 'no') { no('на фото не жильё'); continue; }
    const photos = (r.d.photos || []).length ? r.d.photos : [r.x.photo];
    const hasThumb = await F.thumb(id, photos, IMG);
    out.push({
      id, kind: 'house', title: r.title.slice(0, 90), url: `https://www.facebook.com/marketplace/item/${r.x.id}/`,
      price: r.pr.usd, cur: r.pr.cur, rawPrice: r.pr.raw,
      area: r.area, land: F.landOf(r.t), rooms: F.roomsOf(r.t),
      loc: (loc || '').replace(/ район$/, ''), zone: F.ZONE[obl], lat: +(+lat).toFixed(5), lon: +(+lon).toFixed(5), locExact: exact,
      date: r.date,
      photoList: [...(hasThumb ? ['img/fbm/' + id + '.jpg'] : []), ...photos.slice(0, 4)],
      text: r.t.replace(/\s+/g, ' ').slice(0, 900),
    });
  }
  fs.writeFileSync(D + 'fbm9-candidates.json', JSON.stringify(out, null, 1));
  const keep = new Set(out.map(r => r.id + '.jpg'));
  for (const f of fs.readdirSync(IMG)) if (!keep.has(f)) fs.unlinkSync(IMG + f);
  console.log('в выдаче', Object.keys(feed).length, '| карточек', Object.keys(items).length, '| кандидатов', out.length);
  console.log('отсев:', JSON.stringify(why));
  const by = {}; out.forEach(r => { by[r.zone] = (by[r.zone] || 0) + 1; });
  console.log('по областям:', JSON.stringify(by));
})();
