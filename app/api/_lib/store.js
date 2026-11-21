// Хранилище аналитики: Upstash Redis / Vercel KV через REST API.
// Переменные: KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV) или UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
const crypto = require('node:crypto');
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const enabled = () => !!(URL_ && TOKEN);
const KEEP = 86400 * 400; // дневные ключи храним ~13 месяцев

async function pipe(cmds) {
  if (!enabled() || !cmds.length) return [];
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('KV ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return (await r.json()).map(x => (x && 'result' in x ? x.result : null));
}

// Время магазина — Москва (UTC+3)
function msk(ts = Date.now()) { const d = new Date(ts + 3 * 3600e3); return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() }; }
function lastDays(n) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(msk(Date.now() - i * 86400e3).day); return out; }
// Идентификаторы пользователей и телефонов храним только в виде хэша
const hid = s => crypto.createHmac('sha256', process.env.HASH_SALT || process.env.MAX_BOT_TOKEN || 'krabamore').update(String(s)).digest('hex').slice(0, 16);

async function trackVisit(uid) {
  const { day } = msk();
  const [isNew] = await pipe([['SADD', 'users', uid], ['PFADD', 'uv:' + day, uid], ['EXPIRE', 'uv:' + day, KEEP],
    ['HINCRBY', 'd:' + day, 'visits', 1], ['EXPIRE', 'd:' + day, KEEP]]);
  if (isNew === 1) await pipe([['HINCRBY', 'd:' + day, 'newUsers', 1]]);
}
async function trackEvent(type, id) {
  const { day } = msk();
  if (type === 'view') return pipe([['HINCRBY', 'd:' + day, 'views', 1], ['ZINCRBY', 'pv', 1, id]]);
  if (type === 'cart') return pipe([['HINCRBY', 'd:' + day, 'carts', 1], ['ZINCRBY', 'pc', 1, id]]);
}
async function recordOrder(o, uid, catalog) {
  const { day, hour } = msk();
  const cmds = [['HINCRBY', 'd:' + day, 'orders', 1], ['HINCRBY', 'd:' + day, 'revenue', Math.round(o.total)], ['EXPIRE', 'd:' + day, KEEP],
    ['HINCRBY', 'hours', String(hour), 1], ['HINCRBY', 'method', o.method, 1],
    ['HINCRBY', 'cust', hid(o.phone.replace(/\D/g, '').slice(-10)), 1],
    ['LPUSH', 'orders', JSON.stringify({ ...o, at: Date.now(), uid })], ['LTRIM', 'orders', 0, 499]];
  if (uid) cmds.push(['PFADD', 'ub:' + day, uid], ['EXPIRE', 'ub:' + day, KEEP]);
  for (const i of o.items) {
    cmds.push(['ZINCRBY', 'po', 1, i.id], ['ZINCRBY', 'prev', Math.round(i.sum), i.id]);
    const c = catalog[i.id]; cmds.push(['HINCRBY', 'catrev', (c && c[3]) || 'other', Math.round(i.sum)]);
  }
  return pipe(cmds);
}
const setStatus = (id, status) => pipe([['HSET', 'ostatus', id, status]]);

const toObj = a => { const o = {}; if (Array.isArray(a)) for (let i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1]; return o; };
const toTop = a => { const out = []; if (Array.isArray(a)) for (let i = 0; i < a.length; i += 2) out.push([a[i], Number(a[i + 1])]); return out; };

async function stats(n) {
  const days = lastDays(n);
  const cmds = [];
  days.forEach(d => cmds.push(['HGETALL', 'd:' + d], ['PFCOUNT', 'uv:' + d]));
  cmds.push(['PFCOUNT', ...days.map(d => 'uv:' + d)], ['PFCOUNT', ...days.map(d => 'ub:' + d)], ['SCARD', 'users'],
    ['ZREVRANGE', 'pv', 0, 9, 'WITHSCORES'], ['ZREVRANGE', 'po', 0, 9, 'WITHSCORES'], ['ZREVRANGE', 'prev', 0, 9, 'WITHSCORES'],
    ['HGETALL', 'hours'], ['HGETALL', 'method'], ['HGETALL', 'catrev'], ['HVALS', 'cust'], ['LRANGE', 'orders', 0, 99], ['HGETALL', 'ostatus']);
  const r = await pipe(cmds);
  const byDay = days.map((d, i) => { const h = toObj(r[i * 2]); return { day: d, visitors: Number(r[i * 2 + 1]) || 0,
    visits: +h.visits || 0, newUsers: +h.newUsers || 0, views: +h.views || 0, carts: +h.carts || 0, orders: +h.orders || 0, revenue: +h.revenue || 0 }; });
  const k = days.length * 2, st = toObj(r[k + 11]);
  const cust = (r[k + 9] || []).map(Number);
  return {
    enabled: true, days: byDay, uniqueVisitors: Number(r[k]) || 0, uniqueBuyers: Number(r[k + 1]) || 0, totalUsers: Number(r[k + 2]) || 0,
    topViews: toTop(r[k + 3]), topOrders: toTop(r[k + 4]), topRevenue: toTop(r[k + 5]),
    hours: toObj(r[k + 6]), method: toObj(r[k + 7]), catRevenue: toObj(r[k + 8]),
    customers: cust.length, repeatCustomers: cust.filter(x => x > 1).length,
    orders: (r[k + 10] || []).map(s => { try { const o = JSON.parse(s); o.status = st[o.id] || 'new'; return o; } catch (e) { return null; } }).filter(Boolean),
  };
}
module.exports = { enabled, pipe, msk, hid, trackVisit, trackEvent, recordOrder, setStatus, stats };
