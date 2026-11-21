// Мини-клиент MAX Bot API + проверка initData мини-приложения.
// Документация: https://dev.max.ru/docs-api  (домен platform-api2.max.ru, токен в заголовке Authorization)
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BASE = process.env.MAX_API_BASE || 'https://platform-api2.max.ru';

// MAX (platform-api2.max.ru) использует сертификаты Минцифры: Russian Trusted Root CA + Russian Trusted Sub CA.
let agent;
// Берёт все сертификаты (*.pem, *.crt) из папки certs и/или из переменной MAX_EXTRA_CA.
function loadExtraCA() {
  const pems = [];
  if (process.env.MAX_EXTRA_CA) pems.push(process.env.MAX_EXTRA_CA.replace(/\\n/g, '\n'));
  for (const dir of [path.join(__dirname, '..', '..', 'certs'), path.join(process.cwd(), 'certs')]) {
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => /\.(pem|crt)$/i.test(f)); } catch (e) { continue; }
    for (const f of files) {
      const t = fs.readFileSync(path.join(dir, f), 'utf8');
      if (t.includes('BEGIN CERTIFICATE')) pems.push(t);
      else console.error('certs/' + f + ': не PEM — переведите в PEM (см. README)');
    }
    if (files.length) break;
  }
  return pems;
}
function getAgent() {
  if (agent !== undefined) return agent;
  const pems = loadExtraCA();
  agent = pems.length ? new https.Agent({ ca: [...tls.rootCertificates, ...pems], keepAlive: true }) : null;
  return agent;
}

function request(method, pathAndQuery, body) {
  const token = process.env.MAX_BOT_TOKEN;
  if (!token) return Promise.reject(new Error('MAX_BOT_TOKEN не задан'));
  const url = new URL(pathAndQuery, BASE);
  const lib = url.protocol === 'http:' ? http : https;
  const data = body ? Buffer.from(JSON.stringify(body)) : null;
  return new Promise((resolve, reject) => {
    const opts = { method, headers: { Authorization: token, 'Content-Type': 'application/json' }, timeout: 8000 };
    if (data) opts.headers['Content-Length'] = data.length;
    if (lib === https && getAgent()) opts.agent = getAgent();
    const req = lib.request(url, opts, res => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => {
        let json = null; try { json = JSON.parse(buf); } catch (e) {}
        if (res.statusCode >= 200 && res.statusCode < 300 && !(json && json.success === false)) resolve(json);
        else reject(new Error(`MAX ${res.statusCode}: ${buf.slice(0, 300)}`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('MAX timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const sendToUser = (userId, text, format = 'html') =>
  request('POST', `/messages?user_id=${encodeURIComponent(userId)}`, { text: String(text).slice(0, 4000), format });

// Проверка initData (WebAppData) по https://dev.max.ru/docs/webapps/validation
function validateInitData(initData, botToken, maxAgeSec = 24 * 3600) {
  if (!initData || !botToken) return null;
  const pairs = String(initData).split('&');
  const map = new Map();
  for (const pair of pairs) {
    const i = pair.indexOf('=');
    if (i < 0) return null;
    const k = pair.slice(0, i);
    if (map.has(k)) return null; // каждый параметр ровно один раз
    map.set(k, decodeURIComponent(pair.slice(i + 1).replace(/\+/g, '%20')));
  }
  const hash = map.get('hash');
  if (!hash) return null;
  map.delete('hash');
  const check = [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(check).digest('hex');
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  const authDate = Number(map.get('auth_date') || 0);
  if (maxAgeSec && authDate && Date.now() / 1000 - authDate > maxAgeSec) return null;
  let user = null; try { user = JSON.parse(map.get('user') || 'null'); } catch (e) {}
  return { user, authDate };
}

const adminIds = () => (process.env.ADMIN_IDS || '').split(/[\s,;]+/).filter(Boolean);
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

module.exports = { request, sendToUser, validateInitData, adminIds, esc };
