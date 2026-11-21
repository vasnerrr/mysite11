// Подписка бота на вебхук: node scripts/setup-webhook.mjs https://ваш-домен.vercel.app
// Нужны переменные окружения MAX_BOT_TOKEN и (желательно) WEBHOOK_SECRET.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { request } = require('../api/_lib/max.js');
const site = process.argv[2];
if (!site) { console.error('Укажите адрес сайта: node scripts/setup-webhook.mjs https://...'); process.exit(1); }
const me = await request('GET', '/me');
console.log('Бот:', me && (me.name || me.username), me && me.user_id);
const body = { url: site.replace(/\/$/, '') + '/api/bot', update_types: ['message_created', 'bot_started'] };
if (process.env.WEBHOOK_SECRET) body.secret = process.env.WEBHOOK_SECRET;
console.log(await request('POST', '/subscriptions', body));
