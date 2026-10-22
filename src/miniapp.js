// Telegram Mini App: страница /app и её API.
//
//   GET  /app                  — страница приложения
//   POST /app/api/forecast     — {initData, name, birth_date, birth_place} → прогноз + запись в карточку
//   POST /app/api/full         — {initData} → клиент хочет полный разбор
//
// initData подписан Telegram: проверяем подпись токеном бота, и только тогда пишем в CRM.
// Без initData (страница открыта в обычном браузере) прогноз считается, но никуда не сохраняется.

import { makeForecast, InputError } from './forecast.js';
import { kvStore, newLead, recordForecast, recordWantsFull, cardText, NOTIFY, KB_DONE, BOT_UPSELL } from './telegram.js';
import PAGE from './miniapp-page.js';

const FIELD_BY_ERROR = { bad_name: 'name', bad_date: 'birth_date', bad_place: 'birth_place' };
const MAX_AGE_SECONDS = 24 * 60 * 60;

async function hmac(key, message) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message)));
}

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Проверяет Telegram.WebApp.initData. Возвращает пользователя или null.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export async function verifyInitData(initData, botToken, nowMs = Date.now()) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  const secret = await hmac(new TextEncoder().encode('WebAppData'), botToken);
  const checkString = (skip) => [...params.entries()]
    .filter(([k]) => !skip.includes(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  // Документация не уточняет, входит ли поле signature в строку проверки, поэтому пробуем оба варианта.
  let valid = false;
  for (const skip of [['hash'], ['hash', 'signature']]) {
    if (hex(await hmac(secret, checkString(skip))) === hash) { valid = true; break; }
  }
  if (!valid) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || nowMs / 1000 - authDate > MAX_AGE_SECONDS) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

async function readBody(request) {
  return request.json().catch(() => ({}));
}

// Пользователь из initData: null — открыто вне Telegram, false — подпись не сошлась.
async function resolveUser(body, env) {
  if (!body.initData) return null;
  return (await verifyInitData(body.initData, env.BOT_TOKEN)) || false;
}

async function forecastApi(request, env, deps) {
  const body = await readBody(request);
  const user = await resolveUser(body, env);
  if (user === false) return json({ ok: false, error: 'bad_init_data', message: 'Не удалось подтвердить вход через Telegram. Закройте приложение и откройте его снова из бота.' }, 401);

  let result;
  try {
    result = makeForecast(
      { name: body.name, birthDate: body.birth_date, birthPlace: body.birth_place },
      { upsell: env.UPSELL_TEXT || BOT_UPSELL },
    );
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    return json({ ok: false, error: e.code, field: FIELD_BY_ERROR[e.code], message: e.message }, 422);
  }

  let saved = false;
  if (user && env.LEADS) {
    const store = kvStore(env.LEADS);
    const now = new Date();
    const lead = (await store.get(user.id)) ?? newLead(user, now);
    recordForecast(lead, result, now, 'Mini App');
    await store.put(lead);
    saved = true;
    // Прогноз дублируется в чат, чтобы остался в переписке, и там же работает кнопка «Хочу полный разбор».
    await deps.tg('sendMessage', { chat_id: user.id, text: result.text, ...KB_DONE });
    if (env.ADMIN_CHAT_ID) await deps.tg('sendMessage', { chat_id: env.ADMIN_CHAT_ID, text: cardText(lead, NOTIFY.forecast('Mini App')) });
  }
  return json({ ok: true, saved, sections: result.sections, data: result.data });
}

async function fullApi(request, env, deps) {
  const body = await readBody(request);
  const user = await resolveUser(body, env);
  if (user === false) return json({ ok: false, error: 'bad_init_data' }, 401);
  if (!user || !env.LEADS) return json({ ok: true, saved: false });

  const store = kvStore(env.LEADS);
  const now = new Date();
  const lead = (await store.get(user.id)) ?? newLead(user, now);
  const first = recordWantsFull(lead, now);
  await store.put(lead);
  if (first) {
    await deps.tg('sendMessage', { chat_id: user.id, text: 'Заявка на полный разбор принята ✨ Астролог напишет вам здесь в течение дня.', ...KB_DONE });
    if (env.ADMIN_CHAT_ID) await deps.tg('sendMessage', { chat_id: env.ADMIN_CHAT_ID, text: cardText(lead, NOTIFY.wantsFull) });
  }
  return json({ ok: true, saved: true });
}

export async function handleMiniApp(request, env, pathname, deps) {
  if (pathname === '/app' || pathname === '/app/') {
    return new Response(PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
  }
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  if (pathname === '/app/api/forecast') return forecastApi(request, env, deps);
  if (pathname === '/app/api/full') return fullApi(request, env, deps);
  return json({ ok: false, error: 'not_found' }, 404);
}
