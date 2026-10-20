// Лента группы Facebook о продаже домов — сырые ответы ленты для fb9-parse.js.
// Просьба покупателя 20.10.2026: «загони сюда дома, например [пост группы budynochok4]».
//
// Группы FB без входа не читаются: краулерский User-Agent отдаёт только сам пост
// с обрезанным описанием, ленту — нет. Поэтому работаем через браузер br (CDP, порт 9333),
// где покупатель вошёл в Facebook сам. Скрипт открывает ленту в хронологическом порядке
// (?sorting_setting=CHRONOLOGICAL), листает вниз и сохраняет ответы /api/graphql/ —
// в них полный текст поста, дата и фото (в DOM длинный текст обрезан на «Ещё»).
// Первая страница ленты приходит не графкуэлем, а JSON-блоками в самом HTML.
// Личные сообщения и профили не открываются; темп — как у человека, 2–4 с на прокрутку.
//
// usage: node fb9-group.js <slug группы> [прокруток] — сначала `br start` и вход в FB
// → data/fb9-raw/<slug>/g*.txt (кэш, в git не идёт)
const fs = require('fs');
const path = require('path');
const { connect } = require('C:/Users/xetr11/Documents/tools/browser-cli/lib/cdp.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SLUG = process.argv[2] || 'budynochok4';
const N = +(process.argv[3] || 300);
const OUT = path.join(__dirname, 'data', 'fb9-raw', SLUG);
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const t = list.find(x => x.type === 'page' && x.url.includes('facebook.com'));
  if (!t) throw new Error('нет вкладки facebook.com в браузере br — откройте и войдите');
  const c = await connect(t.webSocketDebuggerUrl);
  const ev = async expr => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  let k = fs.readdirSync(OUT).length;
  const want = new Set();
  c.on('Network.responseReceived', p => { if (/\/api\/graphql\//.test(p.response.url)) want.add(p.requestId); });
  c.on('Network.loadingFinished', async p => {
    if (!want.has(p.requestId)) return;
    want.delete(p.requestId);
    try {
      const r = await c.send('Network.getResponseBody', { requestId: p.requestId });
      const body = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
      if (/post_id/.test(body)) fs.writeFileSync(path.join(OUT, `g${String(++k).padStart(5, '0')}.txt`), body);
    } catch (e) {}
  });
  await c.send('Network.enable', { maxResourceBufferSize: 50e6, maxTotalBufferSize: 400e6 });
  await c.send('Page.enable');
  await c.send('Page.navigate', { url: `https://www.facebook.com/groups/${SLUG}/?sorting_setting=CHRONOLOGICAL` });
  await sleep(8000);
  const blobs = await ev(`[...document.querySelectorAll('script[type="application/json"]')].map(s => s.textContent).filter(t => t.includes('post_id')).join('\\n')`);
  fs.writeFileSync(path.join(OUT, `g${String(++k).padStart(5, '0')}.txt`), blobs);
  let last = 0, still = 0;
  for (let i = 0; i < N; i++) {
    await ev('window.scrollTo(0, document.body.scrollHeight)');
    await sleep(2200 + Math.random() * 1500);
    const h = await ev('document.body.scrollHeight');
    if (h === last) { if (++still >= 6) { console.log('лента кончилась на шаге', i); break; } } else still = 0;
    last = h;
    if (i % 10 === 0) console.log('шаг', i, 'файлов', k);
  }
  await sleep(3000);
  console.log('готово, файлов', k);
  c.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
