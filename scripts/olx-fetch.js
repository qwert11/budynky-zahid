// Запросы к OLX — через системный curl, а не через fetch.
//
// 12.09.2026 сбор встал: OLX начал отвечать 403 на все запросы из Node. Дело не в
// заголовках и не в частоте — проверено прямым сравнением на одном и том же URL
// в одну и ту же секунду:
//   curl с теми же заголовками  → 200, 200, 200
//   node fetch                  → 403
// Отличается только TLS-рукопожатие: у Node (undici) свой отпечаток, и антибот OLX
// режет его. Заголовок 'accept' при этом обязателен обоим — без него 403 и у curl.
//
// Поэтому все обращения к olx.ua идут через curl.exe (есть в Windows 10 из коробки,
// C:\Windows\System32\curl.exe, и в любом Linux-раннере).
const { execFile } = require('child_process');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const HEADERS = ['-H', `user-agent: ${UA}`, '-H', 'accept: */*', '-H', 'accept-language: uk-UA,uk;q=0.9'];

// Возвращает { status, body }. Сетевая ошибка curl — status 0.
function curlGet(url, { timeout = 45000, maxBuffer = 64 * 1024 * 1024, headOnly = false } = {}) {
  // код ответа дописывается последней строкой через -w, тело идёт до неё
  const args = ['-sS', '--compressed', '--max-time', String(Math.round(timeout / 1000)), ...HEADERS];
  if (headOnly) args.push('-o', process.platform === 'win32' ? 'NUL' : '/dev/null');
  args.push('-w', '\n%{http_code}', '-L', url);
  return new Promise((resolve) => {
    execFile('curl', args, { maxBuffer, windowsHide: true }, (err, stdout) => {
      if (err && !stdout) return resolve({ status: 0, body: '' });
      const text = String(stdout);
      const cut = text.lastIndexOf('\n');
      const status = Number(text.slice(cut + 1).trim()) || 0;
      resolve({ status, body: text.slice(0, cut) });
    });
  });
}

// JSON с ретраями. 403/429/5xx — повод повторить: у OLX это плавающая защита,
// повтор через паузу обычно проходит.
async function curlJson(url, tries = 6) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let t = 0; t < tries; t++) {
    const { status, body } = await curlGet(url);
    if (status === 200) {
      try { return JSON.parse(body); } catch { return null; }
    }
    if (status === 404 || status === 410) return null;
    await sleep(900 * (t + 1));
  }
  return null;
}

// Только код ответа — для проверки, снято ли объявление.
async function curlStatus(url, tries = 4) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let t = 0; t < tries; t++) {
    const { status } = await curlGet(url, { headOnly: true });
    if (status === 200 || status === 404 || status === 410) return status;
    await sleep(700 * (t + 1));
  }
  return 0;
}

module.exports = { curlGet, curlJson, curlStatus, UA, HEADERS };
