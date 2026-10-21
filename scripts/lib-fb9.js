// Общий разбор текста объявлений Facebook — посты групп (fb9-parse.js) и Marketplace
// (fb9-market-parse.js): цена, село и область, площадь, участок, комнаты, «недострой»,
// заголовок; геокод села с проверкой контура области и миниатюра в репозиторий.
// Вынесено из fb9-parse.js 21.10.2026, когда появился второй источник Facebook.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib9');
const D = path.join(__dirname, 'data') + path.sep;
const GEO = D + 'fb9-geocode.json';
const FF = 'D:/soft/video/ffmpeg.exe';
const UAHRATE = 43.5, EURUSD = 1.17;     // как в tg9.js
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));

/* ── 2. разбор текста ── */
const W = "[а-яіїєґʼ'’-]*";
const OBL_RE = [
  ['vol', new RegExp(`волинськ${W}\\s+обл|волинь|волині`, 'i')],
  ['rov', new RegExp(`рівненськ${W}\\s+обл|рівненщин`, 'i')],
  ['lv', new RegExp(`львівськ${W}\\s+обл|львівщин`, 'i')],
  ['ter', new RegExp(`тернопільськ${W}\\s+обл|тернопільщин`, 'i')],
  ['if', new RegExp(`івано[\\s-]франківськ${W}\\s+обл|прикарпатт`, 'i')],
  ['chv', new RegExp(`чернівецьк${W}\\s+обл|буковин`, 'i')],
  ['khm', new RegExp(`хмельницьк${W}\\s+обл|хмельниччин`, 'i')],
  ['zht', new RegExp(`житомирськ${W}\\s+обл|житомирщин`, 'i')],
  ['vin', new RegExp(`вінницьк${W}\\s+обл|вінниччин`, 'i')],
];
const ZONE = { vol: 'Волынь', rov: 'Ровенщина', lv: 'Львовщина', ter: 'Тернопольщина', if: 'Прикарпатье',
  chv: 'Буковина', khm: 'Хмельниччина', zht: 'Житомирщина', vin: 'Винничина' };
const REGION_UA = { vol: 'Волинська', rov: 'Рівненська', lv: 'Львівська', ter: 'Тернопільська', if: 'Івано-Франківська',
  chv: 'Чернівецька', khm: 'Хмельницька', zht: 'Житомирська', vin: 'Вінницька' };
// чужая область в том же посте — значит, это сводка «продаю в нескольких местах», место не определить
const OTHER_OBL = new RegExp(`(київськ|черкаськ|одеськ|полтавськ|кіровоградськ|миколаївськ|чернігівськ|сумськ|харківськ|дніпропетровськ|закарпатськ|запорізьк|херсонськ)${W}\\s+обл`, 'i');

const HOUSE = /будин|будиноч|\bдім\b|\bхат[аиу]\b|котедж|садиб|господарк|обійст/i;
const SALE = /прода/i;
const WANT = /шука(ю|ємо|є)|куплю|купимо|викупимо|придбаю|придбаємо/i;
const RENT = /оренд|здам\b|здається|зніму|винайм|на добу|подобово/i;
const SOLD = /продано|неактуальн|зарезервован/i;
const LAND = /^\s*(продам|продається|продаж)\s+(земельн\S*\s+)?ділянк|ділянк\S*\s+під\s+(забудов|будівництв)/i;
const FLAT = /квартир/i;

// Цена. Число с множителем «тис/к» и валютой после него («22 тис дол», «25000у.о»,
// «15000$», «22000 Євро») или валютой перед ним («$25 000»). Без валюты принимаем
// только «Ціна 25 тис.» — подпись «ціна» плюс множитель, это доллары.
const NUM = "(\\d{1,3}(?:[\\s.,'`]\\d{3})+|\\d+(?:[.,]\\d+)?)";
const MULT = '(\\s?(?:тисяч[аі]?|тис\\.?|т\\.|k|к)(?![а-яіїєґa-z]))?';
const CUR = '\\s?(\\$+|usd|дол(?:ар(?:ів|а|и)?)?\\.?|у\\.\\s?о\\.?|у\\.?о\\.?|уо|€|eur|євро|евро|є(?![а-яіїєґ])|грн\\.?|гривень|₴)';
const RE_AFTER = new RegExp(NUM + MULT + CUR, 'gi');
const RE_BEFORE = new RegExp('(\\$|€|usd)\\s?' + NUM + MULT, 'gi');
const RE_LABEL = new RegExp('(?:ціна|вартість|ц\\.)\\s*[:\\-–]?\\s*' + NUM + '\\s?(тисяч[аі]?|тис\\.?)(?!\\s?(?:грн|гривень|€|євро|евро))', 'gi');
const numOf = s => /^\d{1,3}([\s.,'`]\d{3})+$/.test(s) ? +s.replace(/[\s.,'`]/g, '') : parseFloat(s.replace(',', '.'));
const curOf = c => /^(\$|usd|дол|у\.?\s?о|уо)/i.test(c) ? 'USD' : /^(€|eur|євро|евро|є)/i.test(c) ? 'EUR' : 'UAH';
const toUsd = (v, cur) => cur === 'UAH' ? Math.round(v / UAHRATE) : cur === 'EUR' ? Math.round(v * EURUSD) : Math.round(v);
function priceOf(t) {
  const found = [];
  const push = (idx, v, mult, cur) => {
    let x = numOf(v);
    if (!(x > 0)) return;
    if (mult && mult.trim()) x *= 1000;
    const usd = toUsd(x, cur);
    if (usd >= 3000 && usd <= 400000) found.push({ idx, usd, cur, raw: x });
  };
  for (const m of t.matchAll(RE_AFTER)) push(m.index, m[1], m[2], curOf(m[3]));
  for (const m of t.matchAll(RE_BEFORE)) push(m.index, m[2], m[3], curOf(m[1]));
  for (const m of t.matchAll(RE_LABEL)) push(m.index, m[1], m[2], 'USD');
  if (!found.length) return null;
  found.sort((a, b) => a.idx - b.idx);
  // цена под подписью «ціна/вартість/за» важнее первой попавшейся суммы
  const labeled = found.find(f => /(ціна|вартість|ц\.|\bза)\s*[:\-–]?\s*$/i.test(t.slice(Math.max(0, f.idx - 14), f.idx)) ||
    /(ціна|вартість)/i.test(t.slice(Math.max(0, f.idx - 14), f.idx)));
  return labeled || found[0];
}

// Название — одно слово; второе берётся только у составных («Нова Ушиця», «Великий
// Кучурів»), иначе за селом цеплялось «Житомирської» или «Івано-».
const PLACE = "([А-ЯІЇЄҐ][а-яіїєґʼ'’]{2,24}(?:-[А-ЯІЇЄҐ][а-яіїєґʼ'’]{2,24})?)(?: ([А-ЯІЇЄҐ][а-яіїєґʼ'’]{2,24}))?";
const COMPOUND = /^(Нов|Стар|Велик|Мал|Верхн|Нижн|Нижч|Вищ|Середн|Горішн|Долішн|Червон|Зелен|Біл|Чорн|Сух|Мокр|Висок|Глибок|Добр|Золот|Кам)[а-яіїє]{0,4}$/;
const LOC_RE = [
  // «Село Раковець» с заглавной — тоже село (так пишут в начале строки)
  new RegExp('(?:^|[\\s,(.])(?:[сС]\\.|[сС]-ще|[сС]ел[оі]|[сС]елищ[еі]|смт\\.?|СМТ)\\s*' + PLACE),
  new RegExp('(?:^|[\\s,(.])(?:м\\.|[мМ]іст[оі])\\s*' + PLACE),
];
function locOf(t) {
  for (const re of LOC_RE) {
    const m = t.match(re);
    if (m) return ((m[2] && COMPOUND.test(m[1])) ? m[1] + ' ' + m[2] : m[1]).replace(/[’']/g, 'ʼ');
  }
  return null;
}
// падеж: «в селі Жукові» → «Жуків», «у Теофилівці» → «Теофилівка»
function locForms(s) {
  const v = [s];
  for (const [re, to] of [[/ові$/, 'ів'], [/еві$/, 'ів'], [/ці$/, 'ка'], [/ні$/, 'на'], [/рі$/, 'ра'], [/і$/, 'а'], [/і$/, 'и'], [/ому$/, 'е']])
    if (re.test(s)) v.push(s.replace(re, to));
  return [...new Set(v)];
}
const areaOf = t => { const m = t.match(/(\d{2,3}(?:[.,]\d)?)\s*(?:м2|м²|кв\.?\s?м|квадрат)/i); return m ? +m[1].replace(',', '.') : null; };
function landOf(t) {
  let m = t.match(/(\d{1,3}(?:[.,]\d+)?)\s*сот/i); if (m) return +m[1].replace(',', '.');
  m = t.match(/(\d(?:[.,]\d+)?)\s*га\b/i); if (m) return Math.round(+m[1].replace(',', '.') * 100);
  return null;
}
const ROOMW = { одно: 1, дво: 2, двох: 2, три: 3, трьох: 3, чотири: 4, чотирьох: 4, пяти: 5, 'п’яти': 5, "п'яти": 5 };
function roomsOf(t) {
  const m = t.match(/(\d)\s*-?\s*(?:х\s*)?кімнат/i); if (m) return +m[1];
  const w = t.match(/(одно|двох|дво|трьох|три|чотирьох|чотири|п['’]?яти)кімнатн/i);
  return w ? ROOMW[w[1].toLowerCase().replace('’', "'")] || null : null;
}
// «Недострой / под ремонт» — но не про хозпостройку: в длинном посте «Є льох (потребує
// ремонту)» выбрасывал дом со свежим ремонтом (пример покупателя, Гвіздівці, 20.10.2026).
// Совпадение не считается, если в 40 символах перед ним названа постройка во дворе.
const OUTBUILD = /(льох|погріб|погреб|пивниц|сарай|хлів|стодол|гараж|літн\S*\s+кухн|баня|лазн|альтанк|флігел|паркан|огорож|криниц|колодяз)[^.!?\n]{0,40}$/i;
function badText(t) {
  for (const re of [L.UNFIN, L.BAD_TEXT]) {
    for (const m of t.matchAll(new RegExp(re.source, 'gi'))) {
      if (!OUTBUILD.test(t.slice(Math.max(0, m.index - 40), m.index))) return true;
    }
  }
  return false;
}
// заголовок — первая содержательная строка: не телефон и не подпись «ваш рієлтор»
const PHONE = /\d{3}[\s-]?\d{2,3}[\s-]?\d{2}[\s-]?\d{2}/;
function titleOf(t) {
  const lines = t.split(/\n|(?<=[.!?])\s/).map(s => s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, '').replace(/\s+/g, ' ').trim());
  const good = lines.find(s => (s.match(/[а-яіїєґ]/gi) || []).length >= 15 && !PHONE.test(s) && !/рієлтор|ріелтор|агенці/i.test(s));
  return (good || lines.find(Boolean) || '').slice(0, 90);
}

/* ── 3. геокод с проверкой контура области ── */
const shapes = rd(D + 'oblast-shapes9.json');
const geo = fs.existsSync(GEO) ? rd(GEO) : {};
async function geocode(loc, obl) {
  const key = loc + '|' + obl;
  if (geo[key] !== undefined) return geo[key];
  let hit = null;
  for (const form of locForms(loc)) {
    const q = `${form}, ${REGION_UA[obl]} область, Україна`;
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=ua&q=' + encodeURIComponent(q);
    let js = null;
    for (let t = 0; t < 4 && js == null; t++) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'house-catalog-builder/1.0 (personal build)' } });
        if (r.status === 429 || r.status >= 500) { await sleep(20000 * (t + 1)); continue; }
        js = r.ok ? await r.json() : [];
      } catch { await sleep(10000); }
    }
    await sleep(1500);
    if (js == null) return null;   // сеть/429 — не кэшируем, следующий прогон повторит
    hit = js.find(h => /village|town|city|hamlet|municipality|suburb|administrative/.test(h.type || h.addresstype || '') &&
      L.oblastOf(+h.lat, +h.lon, shapes) === obl);
    if (hit) break;
  }
  geo[key] = hit ? { lat: +(+hit.lat).toFixed(5), lon: +(+hit.lon).toFixed(5) } : null;
  fs.writeFileSync(GEO, JSON.stringify(geo, null, 1));
  return geo[key];
}

/* ── 4. миниатюра в репозиторий ── */
async function thumb(id, urls, IMG) {
  const out = IMG + id + '.jpg';
  if (fs.existsSync(out)) return true;
  for (const u of urls.slice(0, 3)) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000) continue;
      const tmp = IMG + id + '.src';
      fs.writeFileSync(tmp, buf);
      execFileSync(FF, ['-y', '-i', tmp, '-vf', 'scale=200:150:force_original_aspect_ratio=increase,crop=200:150', '-q:v', '5', out], { stdio: 'ignore' });
      fs.unlinkSync(tmp);
      return true;
    } catch (e) {}
  }
  return false;
}

module.exports = { UAHRATE, EURUSD, OBL_RE, ZONE, REGION_UA, OTHER_OBL, HOUSE, SALE, WANT, RENT, SOLD, LAND, FLAT,
  priceOf, toUsd, locOf, locForms, areaOf, landOf, roomsOf, badText, titleOf, PHONE, geocode, thumb, shapes };
