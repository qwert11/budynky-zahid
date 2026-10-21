// Посты групп Facebook (сырьё — fb9-group.js) → кандидаты каталога в формате loadExt().
//
// Правила покупателя 20.10.2026:
//   • берём только дома и только посты С ЯВНОЙ ЦЕНОЙ в тексте: «в фейсбуке научились
//     поднимать объявы в топ» — пост без цены это реклама агентства или подъём старого
//     лота, а не предложение;
//   • цена — $20–45 тыс. (в первую очередь ради полосы $20–30 тыс.), грн и евро
//     пересчитываются по тем же курсам, что у Телеграма (tg9.js);
//   • остальное — как у всех источников: только 9 областей, дома от 65 м² (если площадь
//     указана), не доля, не недострой и не «под ремонт» (UNFIN/BAD_TEXT/SHARE из lib9.js).
//     Предела 10 км от города у Facebook с 21.10.2026 нет (units9.js, gate()).
//
// Место — по тексту: село/город + область. Nominatim ищет «<село>, <область>», и ответ
// принимается, только если точка лежит в контуре этой области (одноимённых сёл много).
// Миниатюра скачивается сразу в img/fb/<id>.jpg: ссылки scontent подписаны и протухают
// через несколько дней, а внешний URL на Pages потом показал бы битую картинку.
//
// usage: node fb9-parse.js → data/fb9-candidates.json (+ data/fb9-geocode.json, img/fb/)
const fs = require('fs');
const path = require('path');
const L = require('./lib9');
const { OBL_RE, ZONE, OTHER_OBL, HOUSE, SALE, WANT, RENT, SOLD, LAND, FLAT, priceOf, locOf, areaOf, landOf, roomsOf,
  badText, titleOf, geocode, thumb } = require('./lib-fb9');   // разбор текста — общий с Marketplace
const D = path.join(__dirname, 'data') + path.sep;
const RAW = (process.env.FB9_RAW || D + 'fb9-raw') + path.sep;
const IMG = path.join(__dirname, '..', 'img', 'fb') + path.sep;
const SINCE = '2026-06-01';              // старше — скорее всего продано: FB не снимает посты сам
const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));
// Фото проверяются глазами, как у домов OLX (вердикт в общем photo-vet.json: «no» — в
// посте нет жилья, только план или участок). fb9-pick.json — номер кадра для миниатюры,
// если первым в посте идёт пейзаж, карта или реклама с телефоном, а не дом.
const VET = fs.existsSync(D + 'photo-vet.json') ? rd(D + 'photo-vet.json') : {};
const PICK = fs.existsSync(D + 'fb9-pick.json') ? rd(D + 'fb9-pick.json') : {};

/* ── 1. посты из сырых ответов ленты ── */
function* jsonChunks(txt) {
  for (const line of txt.split('\n')) {
    const s = line.trim();
    if (!s || (s[0] !== '{' && s[0] !== '[')) continue;
    try { yield JSON.parse(s); } catch (e) {}
  }
}
const posts = {};
// Репост в группу: у поста-обёртки своя дата и ссылка в группе, а текст и фото лежат во
// вложенной истории (attached_story). Вложение даёт только текст и фото (inner), и они
// берутся, лишь если у самой обёртки своего текста нет.
function walkStory(o, p, depth, inner) {
  if (!o || typeof o !== 'object' || depth > 40) return;
  if (Array.isArray(o)) { for (const x of o) walkStory(x, p, depth + 1, inner); return; }
  for (const k in o) {
    if (/comment|feedback|reaction|actors/i.test(k)) continue;   // комментарии — не текст лота
    const v = o[k];
    if (k === 'attached_story') { walkStory(v, p, depth + 1, true); continue; }
    const tk = inner ? 'atext' : 'text', pk = inner ? 'aphotos' : 'photos';
    if (k === 'message' && v && typeof v.text === 'string' && (!p[tk] || v.text.length > p[tk].length)) p[tk] = v.text;
    else if (!inner && k === 'creation_time' && typeof v === 'number' && !p.time) p.time = v;
    else if (!inner && (k === 'url' || k === 'wwwURL') && typeof v === 'string' && /\/(permalink|posts)\/\d+/.test(v) && !p.url) p.url = v;
    else if ((k === 'photo_image' || k === 'image' || k === 'viewer_image') && v && typeof v.uri === 'string' && /scontent|fbcdn/.test(v.uri)) {
      if (!p[pk].includes(v.uri) && (v.width || 999) >= 300) p[pk].push(v.uri);
    } else walkStory(v, p, depth + 1, inner);
  }
}
function collect(o) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { for (const x of o) collect(x); return; }
  if (typeof o.post_id === 'string') {
    const p = posts[o.post_id] = posts[o.post_id] || { id: o.post_id, photos: [], aphotos: [] };
    walkStory(o, p, 0, false);
  }
  for (const k in o) collect(o[k]);
}
const groups = fs.existsSync(RAW) ? fs.readdirSync(RAW) : [];
for (const g of groups) {
  for (const f of fs.readdirSync(RAW + g).filter(f => f.endsWith('.txt'))) {
    for (const j of jsonChunks(fs.readFileSync(path.join(RAW, g, f), 'utf8'))) collect(j);
  }
}
for (const p of Object.values(posts)) {
  if (!p.text && p.atext) { p.text = p.atext; p.shared = true; }
  if (!p.photos.length) p.photos = p.aphotos;
}


(async () => {
  fs.mkdirSync(IMG, { recursive: true });
  const all = Object.values(posts).filter(p => p.text);
  const why = {};
  const no = r => { why[r] = (why[r] || 0) + 1; return null; };
  const rows = [];
  for (const p of all) {
    const t = L.deLatin(p.text);
    const date = p.time ? new Date(p.time * 1000).toISOString().slice(0, 10) : null;
    // без даты — это исходник репоста: его текст уже взят постом-обёрткой в группе
    if (!date) { no('исходник репоста'); continue; }
    if (date < SINCE) { no('старше ' + SINCE); continue; }
    if (!SALE.test(t) || !HOUSE.test(t)) { no('не продажа дома'); continue; }
    if (WANT.test(t)) { no('ищу/куплю'); continue; }
    if (RENT.test(t) || SOLD.test(t)) { no('аренда/продано'); continue; }
    if (LAND.test(t)) { no('участок'); continue; }
    if (FLAT.test(t) && t.search(FLAT) < t.search(HOUSE)) { no('квартира'); continue; }
    const pr = priceOf(t);
    if (!pr) { no('без цены'); continue; }
    if (!L.inBudgetKind(pr.usd, 'house')) { no('цена вне $20–45 тыс.'); continue; }
    const obls = OBL_RE.filter(([, re]) => re.test(t)).map(([o]) => o);
    if (obls.length !== 1 || OTHER_OBL.test(t)) { no(obls.length ? 'несколько областей' : 'не наши области'); continue; }
    const obl = obls[0];
    const area = areaOf(t);
    if (area != null && area < 65) { no('меньше 65 м²'); continue; }
    if (L.SHARE.test(t.slice(0, 400))) { no('доля'); continue; }
    if (badText(t)) { no('недострой/под ремонт'); continue; }
    const loc = locOf(t);
    if (!loc) { no('нет села в тексте'); continue; }
    if (!p.photos.length) { no('без фото'); continue; }   // проверить дом нечем
    rows.push({ p, t, date, pr, obl, loc, area });
  }
  // один и тот же пост продавец публикует по нескольку раз, бывает с новой ценой
  // (Єрчики: $26 000 в сентябре, $22 000 в октябре) — оставляем самый свежий
  const key = r => r.loc + '|' + (r.area || '') + '|' + titleOf(r.t).toLowerCase().replace(/[^а-яіїєґ]/g, '').slice(0, 40);
  const best = new Map();
  for (const r of rows.sort((a, b) => b.date.localeCompare(a.date))) if (!best.has(key(r))) best.set(key(r), r);
  if (process.env.FB9_DRY) {   // проверка разбора без сети: что прошло и почему отсеяно
    for (const r of best.values()) console.log(`${r.date} ${r.obl} $${r.pr.usd} (${r.pr.raw} ${r.pr.cur}) ${r.loc} ${r.area || '?'}м² | ${titleOf(r.t)}`);
    console.log('отсев:', JSON.stringify(why), '| прошло', best.size);
    return;
  }
  const out = [];
  for (const r of best.values()) {
    const g = await geocode(r.loc, r.obl);
    if (!g) { no('село не нашлось в области'); continue; }
    const id = 'FB' + r.p.id;
    if (VET[id] === 'no') { no('на фото не жильё'); continue; }
    const pick = PICK[id];
    const hasThumb = await thumb(id, pick != null ? [r.p.photos[pick], ...r.p.photos].filter(Boolean) : r.p.photos, IMG);
    out.push({
      id, kind: 'house', title: titleOf(r.t), url: r.p.url || `https://www.facebook.com/groups/${groups[0]}/permalink/${r.p.id}/`,
      price: r.pr.usd, cur: r.pr.cur, rawPrice: r.pr.raw,
      area: r.area, land: landOf(r.t), rooms: roomsOf(r.t),
      loc: r.loc, zone: ZONE[r.obl], lat: g.lat, lon: g.lon, locExact: true,
      date: r.date,
      // первой — локальная миниатюра (ссылки scontent протухают), дальше оригиналы для фотопроверки
      photoList: [...(hasThumb ? ['img/fb/' + id + '.jpg'] : []), ...r.p.photos.slice(0, 4)],
      text: r.t.replace(/\s+/g, ' ').slice(0, 900),
    });
  }
  fs.writeFileSync(D + 'fb9-candidates.json', JSON.stringify(out, null, 1));
  // миниатюры выбывших (перепост схлопнулся, пост отсеян) в репозитории не держим
  const keep = new Set(out.map(r => r.id + '.jpg'));
  for (const f of fs.readdirSync(IMG)) if (!keep.has(f)) fs.unlinkSync(IMG + f);
  console.log('постов', all.length, '| дублей-перепостов схлопнуто', rows.length - best.size, '| кандидатов', out.length);
  console.log('отсев:', JSON.stringify(why));
  const by = {}; out.forEach(r => { by[r.zone] = (by[r.zone] || 0) + 1; });
  console.log('по областям:', JSON.stringify(by));
})();
