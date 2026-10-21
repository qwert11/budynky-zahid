// Facebook Marketplace, продажа недвижимости по девяти областям — сырьё для fb9-market-parse.js.
// Просьба покупателя 21.10.2026: «из фейсбука просто нужно цепочкой открывать без групп или
// поиском забивать» — в группе «Будиночок у селі» за год 1 397 постов на всю Украину, а
// основной объём Facebook — Marketplace.
//
// Работаем через браузер br (CDP, порт 9333), где покупатель вошёл в Facebook сам. Скрипт
// открывает поиск Marketplace и кликает одно объявление — так страница сама делает запрос
// карточки, и мы берём из него форму с токенами сессии. Дальше все запросы идут из этой же
// вкладки через fetch, doc_id каждого — из реестра модулей страницы (require(...)):
//   1. выдача вокруг каждого города CITIES9 (радиус RADIUS км):
//      поиск по словам — CometMarketplaceSearchContentContainerQuery (QUERIES). Лента категории
//      «Продажа недвижимости» отдаёт впятеро меньше (вокруг Франковска 77 против 403) — не берём;
//   2. объявления по очереди — MarketplacePDPContainerQuery (описание, точка, цена)
//      и MarketplacePDPC2CMediaViewerWithImagesQuery (фото).
// Темп — как у человека: 1,5–3,5 с между запросами. Личные сообщения не открываются.
//
// Вилку цены в запрос не ставим: продавцы пишут в поле гривен что попало — доллары
// («215 000 ₴» при «215 000 $» в тексте), тысячи («35 ₴» = $35 000), заглушку «1 ₴».
// Цену разбирает fb9-market-parse.js — из текста, а поле только как запасной вариант.
//
// usage: node fb9-market.js [feed|items|all] [радиус км, по умолч. 30]
// → data/fb9-raw/market/feed.json, items.json (кэш, в git не идёт; повторный запуск докачивает,
//   feed-done.json помнит пройденные точки — удалить его, чтобы пройти выдачу заново)
const fs = require('fs');
const path = require('path');
const { connect } = require('C:/Users/xetr11/Documents/tools/browser-cli/lib/cdp.js');
const L = require('./lib9');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pause = () => sleep(1500 + Math.random() * 2000);
const MODE = process.argv[2] || 'all';
const RADIUS = +(process.argv[3] || 30);
const ONLY = process.env.FBM_ONLY;     // отладка: один город
const LIMIT = +(process.env.FBM_LIMIT || 0);   // отладка: сколько карточек открыть
const OUT = path.join(__dirname, 'data', 'fb9-raw', 'market') + path.sep;
fs.mkdirSync(OUT, { recursive: true });
const rdj = (f, d) => fs.existsSync(OUT + f) ? JSON.parse(fs.readFileSync(OUT + f, 'utf8')) : d;
const wrj = (f, o) => fs.writeFileSync(OUT + f, JSON.stringify(o));
const CATEGORY = '821056594720130';   // propertyforsale
// только дома, как и из групп: квартир поиск находит единицы («продаж квартири» вокруг
// Франковска — 6 объявлений против 190 по «продаж будинку»)
const QUERIES = ['продаж будинку', 'будинок', 'хата'];
const MAX_PAGES = 40;
// Что точно не дом и не квартира — карточку не открываем
const NOT_HOME = /ділянк|участ|земельн|оренд|аренд|здам|здаю|подобов|посуточ|комерц|приміщен|помещен|офіс|офис|магазин|склад|гараж|паркомісц|машиноміс|кафе|ресторан|бізнес|готел|база відпоч|МАФ|кіоск/i;
const UAH = 43.5;
// Цена из поля: < 1000 — «тысячи» или заглушка (понятно только из текста), до 600 тыс. —
// доллары под видом гривен, больше — настоящие гривны.
const guessUsd = a => !a || a < 1000 ? null : a < 600000 ? a : Math.round(a / UAH);

let c, ev, tab;
async function open() {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  // FBM_NEWTAB=1 — своя вкладка: так выдача и карточки идут двумя процессами параллельно
  // (bootstrap уводит вкладку на поиск и кликает объявление — в общей вкладке это сбило бы соседа)
  const t = process.env.FBM_NEWTAB ? await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json()
    : list.find(x => x.type === 'page' && x.url.includes('facebook.com')) || list.find(x => x.type === 'page');
  if (!t) throw new Error('нет вкладки в браузере br — `br start` и войти в Facebook');
  tab = t;
  c = await connect(t.webSocketDebuggerUrl);
  ev = async expr => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
}

// Форма запроса с токенами сессии — из настоящего запроса карточки (клик внутри SPA).
// Подгрузку выдачи прокруткой не ловим: в фоновом окне Facebook её не запрашивает.
async function bootstrap() {
  const tpl = {};
  c.on('Network.requestWillBeSent', async p => {
    if (!/\/api\/graphql\//.test(p.request.url)) return;
    let body = p.request.postData || '';
    if (!body && p.request.hasPostData) try { body = (await c.send('Network.getRequestPostData', { requestId: p.requestId })).postData; } catch (e) {}
    const m = body.match(/fb_api_req_friendly_name=([^&]+)/);
    if (m && /PDPContainerQuery|MediaViewerWithImages/.test(m[1]) && !tpl[m[1]]) tpl[m[1]] = { body, headers: p.request.headers };
  });
  await c.send('Network.enable', {});
  await c.send('Page.enable');
  await c.send('Page.navigate', { url: 'https://www.facebook.com/marketplace/search/?query=' + encodeURIComponent(QUERIES[0]) });
  await sleep(8000);
  if (!(await ev('!!document.querySelector(\'a[href*="/marketplace/item/"]\')'))) throw new Error('Marketplace не открылся — вход в Facebook?');
  // клик иногда уходит в полную навигацию (карточка тогда приходит в HTML, без запроса) —
  // тогда назад и другое объявление
  const got = () => tpl.MarketplacePDPContainerQuery && tpl.MarketplacePDPC2CMediaViewerWithImagesQuery;
  for (let k = 1; k <= 3 && !got(); k++) {
    await ev(`[...document.querySelectorAll('a[href*="/marketplace/item/"]')][${k}].click()`);
    for (let i = 0; i < 15 && !got(); i++) await sleep(1000);
    if (!got()) { await ev('history.back()'); await sleep(5000); }
  }
  for (const n of ['MarketplacePDPContainerQuery', 'MarketplacePDPC2CMediaViewerWithImagesQuery'])
    if (!tpl[n]) throw new Error('не подсмотрел запрос ' + n);
  await ev(`history.back()`);
  await sleep(3000);
  await ev(`window.__mp = ${JSON.stringify(tpl)}; 1`);
}

// Запрос name из вкладки: форма от запроса карточки, doc_id из реестра модулей страницы.
// vars — объект переменных целиком или функция, правящая переменные подсмотренного запроса.
async function gql(name, vars) {
  const expr = `(async () => {
    const base = window.__mp.MarketplacePDPContainerQuery;
    const own = window.__mp[${JSON.stringify(name)}];
    const f = new URLSearchParams((own || base).body);
    f.set('doc_id', require(${JSON.stringify(name + '_facebookRelayOperation')}));
    f.set('fb_api_req_friendly_name', ${JSON.stringify(name)});
    const vars = ${typeof vars === 'function' ? `(${vars.toString()})(JSON.parse(f.get('variables')))` : JSON.stringify(vars)};
    f.set('variables', JSON.stringify(vars));
    const h = { 'X-FB-Friendly-Name': ${JSON.stringify(name)} };
    for (const [k, val] of Object.entries(base.headers)) if (/^(content-type|x-fb-lsd|x-asbd-id)$/i.test(k)) h[k] = val;
    const r = await fetch('/api/graphql/', { method: 'POST', body: f.toString(), headers: h, credentials: 'include' });
    return { status: r.status, text: await r.text() };
  })()`;
  const r = await ev(expr);
  if (r.status !== 200) throw new Error(name + ' HTTP ' + r.status);
  const out = [];
  for (const line of r.text.split('\n')) { try { out.push(JSON.parse(line)); } catch (e) {} }
  if (!out.length) throw new Error(name + ': не JSON ' + r.text.slice(0, 200));
  const err = out.find(o => o.errors);
  if (err && !out.some(o => o.data)) throw new Error(name + ': ' + JSON.stringify(err.errors).slice(0, 300));
  return out;
}

const find = (o, pred, acc = []) => {
  if (!o || typeof o !== 'object') return acc;
  if (!Array.isArray(o) && pred(o)) acc.push(o);
  for (const k in o) find(o[k], pred, acc);
  return acc;
};

// переменные выдачи — как у настоящих запросов страницы (подсмотрены 21.10.2026)
const PV = { __relay_internal__pv__GHLShouldChangeMarketplaceSponsoredDataFieldNamerelayprovider: false };
const searchVars = (q, lat, lon, cursor) => ({
  buyLocation: { latitude: lat, longitude: lon }, contextual_data: null, count: 24, cursor,
  params: {
    bqf: { callsite: 'COMMERCE_MKTPLACE_WWW', query: q },
    browse_request_params: {
      commerce_enable_local_pickup: true, commerce_enable_shipping: true, commerce_search_and_rp_available: true,
      commerce_search_and_rp_category_id: [], commerce_search_and_rp_condition: null, commerce_search_and_rp_ctime_days: null,
      filter_location_latitude: lat, filter_location_longitude: lon,
      filter_price_lower_bound: 0, filter_price_upper_bound: 214748364700, filter_radius_km: RADIUS,
    },
    custom_request_params: {
      browse_context: null, contextual_filters: [], referral_code: null, referral_ui_component: null,
      saved_search_strid: null, search_vertical: 'C2C', seo_url: null, serp_landing_settings: { virtual_category_id: '' },
      surface: 'SEARCH', virtual_contextual_filters: [],
    },
  },
  savedSearchID: null, savedSearchQuery: q, scale: 2, shouldDeferNonCritical: false, shouldIncludePopularSearches: false,
  topicPageParams: { location_id: null, url: null }, ...PV,
});

/* ── 1. выдача: точки CITIES9 × поисковые слова ── */
async function feed() {
  const lots = rdj('feed.json', {});
  const done = rdj('feed-done.json', {});
  let fails = 0;
  const runs = [...QUERIES.map(q => ({ key: 'q:' + q, name: 'CometMarketplaceSearchContentContainerQuery', vars: (lat, lon, cur) => searchVars(q, lat, lon, cur) }))];
  for (const [city, lat, lon] of L.CITIES9) {
    if (ONLY && city !== ONLY) continue;
    for (const run of runs) {
      const key = `${city}|${RADIUS}|${run.key}`;
      if (done[key]) continue;
      let cursor = null, page = 0, got = 0, fresh = 0, failed = false;
      for (; page < MAX_PAGES; page++) {
        let res;
        try { res = await gql(run.name, run.vars(lat, lon, cursor)); } catch (e) { console.log('  ошибка', run.key, e.message.slice(0, 200)); failed = true; break; }
        const conn = find(res, o => Array.isArray(o.edges) && o.page_info)[0];
        if (!conn) break;
        let pageFresh = 0;
        for (const e of conn.edges) {
          const x = e.node && e.node.listing;
          if (!x || !x.id || !x.marketplace_listing_title) continue;
          if (x.marketplace_listing_category_id && x.marketplace_listing_category_id !== CATEGORY) continue;   // не недвижимость
          if (!lots[x.id]) { pageFresh++; fresh++; }
          lots[x.id] = {
            id: x.id, title: x.marketplace_listing_title,
            amount: +(x.listing_price && x.listing_price.amount || 0), fmt: x.listing_price && x.listing_price.formatted_amount,
            city: x.location && x.location.reverse_geocode && x.location.reverse_geocode.city,
            time: x.creation_time || (lots[x.id] && lots[x.id].time) || null,
            photo: x.primary_listing_photo && x.primary_listing_photo.image && x.primary_listing_photo.image.uri,
            sold: !!x.is_sold, pending: !!x.is_pending, seller: x.marketplace_listing_seller && x.marketplace_listing_seller.name,
            near: (lots[x.id] && lots[x.id].near) || city,
          };
          got++;
        }
        cursor = conn.page_info.end_cursor;
        await pause();
        // выдача дальше уходит в соседние города, которые уже пройдены своей точкой
        if (!conn.page_info.has_next_page || !conn.edges.length || page >= 2 && !pageFresh) break;
      }
      if (failed && ++fails >= 3) throw new Error('три ошибки выдачи подряд — стоп (вход в Facebook?), кэш сохранён');
      if (!failed) { fails = 0; done[key] = { page: page + 1, got, fresh, at: new Date().toISOString() }; }   // с ошибкой — пройти заново
      wrj('feed.json', lots); wrj('feed-done.json', done);
      console.log(`${city} ${run.key}: страниц ${page + 1}, лотов ${got}, новых ${fresh}, всего ${Object.keys(lots).length}`);
    }
  }
  return lots;
}

/* ── 2. объявления по очереди: описание, точка, фото ── */
function worthOpening(x) {
  if (x.sold || NOT_HOME.test(x.title)) return false;
  const usd = guessUsd(x.amount);
  return usd == null || usd >= 15000 && usd <= 50000;
}
// Поиск расползается по всей стране (Київ, Кропивницький, Ужгородський район…). Город
// продавца из выдачи один раз ищем в Nominatim и карточки чужих областей не открываем —
// меньше запросов к Facebook. Не нашёлся город — карточку открываем: решит разбор.
async function cityOblasts(cities) {
  const shapes = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'oblast-shapes9.json'), 'utf8'));
  const cache = rdj('city-obl.json', {});
  for (const city of cities) {
    if (!city || cache[city] !== undefined) continue;
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ua&q=' + encodeURIComponent(city + ', Україна');
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'house-catalog-builder/1.0 (personal build)' } });
      const js = r.ok ? await r.json() : null;
      if (js) cache[city] = js.length ? (L.oblastOf(+js[0].lat, +js[0].lon, shapes) || 'other') : null;
    } catch (e) {}
    wrj('city-obl.json', cache);
    await sleep(1200);
  }
  return cache;
}
async function items() {
  const lots = rdj('feed.json', {});
  const det = rdj('items.json', {});
  let todo = Object.values(lots).filter(x => !det[x.id] && worthOpening(x));
  const obl = await cityOblasts([...new Set(todo.map(x => x.city))]);
  const n0 = todo.length;
  todo = todo.filter(x => !['other', 'zak'].includes(obl[x.city])).slice(0, LIMIT || Infinity);
  console.log('чужие области по городу продавца:', n0 - todo.length);
  console.log('карточек открыть:', todo.length, '(уже открыто', Object.keys(det).length + ')');
  let k = 0, fails = 0;
  for (const x of todo) {
    try {
      const a = await gql('MarketplacePDPContainerQuery', new Function('v', `v.targetId = ${JSON.stringify(x.id)}; return v;`));
      const t = find(a, o => o.redacted_description !== undefined && o.marketplace_listing_title)[0];
      if (!t) det[x.id] = { gone: true, at: new Date().toISOString().slice(0, 10) };
      else {
        await sleep(400 + Math.random() * 600);
        const b = await gql('MarketplacePDPC2CMediaViewerWithImagesQuery', new Function('v', `v.targetId = ${JSON.stringify(x.id)}; return v;`));
        const ph = find(b, o => Array.isArray(o.listing_photos))[0];
        det[x.id] = {
          desc: (t.redacted_description && t.redacted_description.text) || '',
          lat: t.location && t.location.latitude, lon: t.location && t.location.longitude,
          city: t.location && t.location.reverse_geocode_detailed && t.location.reverse_geocode_detailed.city,
          amount: t.listing_price && +t.listing_price.amount, cur: t.listing_price && t.listing_price.currency,
          sold: !!t.is_sold, live: t.is_live !== false, pending: !!t.is_pending,
          photos: ph ? ph.listing_photos.map(p => p.image && p.image.uri).filter(Boolean).slice(0, 8) : [],
          at: new Date().toISOString().slice(0, 10),
        };
      }
      fails = 0;
    } catch (e) {
      console.log('ошибка', x.id, e.message.slice(0, 200));
      if (++fails >= 5) { console.log('пять ошибок подряд — стоп, кэш сохранён'); break; }
    }
    if (++k % 20 === 0) { wrj('items.json', det); console.log('открыто', k, '/', todo.length); }
    await pause();
  }
  wrj('items.json', det);
  console.log('карточек в кэше:', Object.keys(det).length);
}

(async () => {
  await open();
  await bootstrap();
  if (MODE === 'feed' || MODE === 'all') await feed();
  if (MODE === 'items' || MODE === 'all') await items();
  c.close();
  if (process.env.FBM_NEWTAB) await fetch('http://127.0.0.1:9333/json/close/' + tab.id).catch(() => {});
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
