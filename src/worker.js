// Cloudflare Worker: Telegram-бот, мини-CRM и вебхук прогноза для TorroCRM.
//
//   POST /telegram         — вебхук Telegram-бота (ставится автоматически через /setup)
//   GET  /app              — Telegram Mini App (кнопка «Прогноз» в боте), API — /app/api/*
//   GET  /setup?key=...    — подключить бота: прописывает вебхук и меню команд
//   GET  /crm?key=...      — карточки клиентов из бота
//   POST /forecast         — {"name", "birth_date", "birth_place"} → прогноз (для TorroCRM)
//   GET  /forecast?name=...&birth_date=...&birth_place=...
//
// Ответ /forecast: {"ok": true, "forecast": "текст для отправки клиенту", "zodiac": "...", ...}
// Ошибка ввода: HTTP 422, {"ok": false, "error": "bad_date", "message": "что переспросить у клиента"}
//
// Переменные окружения:
//   BOT_TOKEN     — токен бота от @BotFather (для Telegram-бота)
//   ADMIN_KEY     — пароль для /setup и /crm
//   LEADS         — привязка KV-хранилища для карточек клиентов
//   ADMIN_CHAT_ID — необязательно: куда присылать уведомления о новых лидах (узнать: написать боту /id)
//   API_KEY       — необязательно: если задан, /forecast требует заголовок X-Api-Key или ?key=
//   UPSELL_TEXT   — необязательно: свой текст в конце прогноза (предложение платного разбора)

import { makeForecast, InputError } from './forecast.js';
import { handleUpdate, telegramApi, kvStore, webhookSecret } from './telegram.js';
import { renderCrmPage } from './crm.js';
import { handleMiniApp } from './miniapp.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

// Конструкторы называют поля по-разному — принимаем самые частые варианты.
function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim() !== '') return String(obj[k]);
  }
  return '';
}

async function readParams(request, url) {
  const params = Object.fromEntries(url.searchParams);
  if (request.method !== 'POST') return params;
  const type = request.headers.get('Content-Type') || '';
  if (type.includes('application/json')) {
    const body = await request.json().catch(() => ({}));
    // Некоторые конструкторы оборачивают поля: {"data": {...}} или {"fields": {...}}
    return { ...params, ...(body.data || body.fields || body) };
  }
  if (type.includes('form')) {
    return { ...params, ...Object.fromEntries(await request.formData()) };
  }
  return params;
}

function missingConfig(env) {
  const missing = [];
  if (!env.BOT_TOKEN) missing.push('BOT_TOKEN');
  if (!env.ADMIN_KEY) missing.push('ADMIN_KEY');
  if (!env.LEADS) missing.push('LEADS (KV-хранилище)');
  return missing;
}

async function forecast(request, url, env) {
  if (env.API_KEY) {
    const key = request.headers.get('X-Api-Key') || url.searchParams.get('key');
    if (key !== env.API_KEY) return json({ ok: false, error: 'unauthorized' }, 401);
  }
  const p = await readParams(request, url);
  try {
    const result = makeForecast(
      {
        name: pick(p, ['name', 'full_name', 'fio', 'фио']),
        firstName: pick(p, ['first_name']),
        birthDate: pick(p, ['birth_date', 'birthDate', 'dob', 'date']),
        birthPlace: pick(p, ['birth_place', 'birthPlace', 'place', 'city']),
      },
      { upsell: env.UPSELL_TEXT || undefined },
    );
    return json({ ok: true, forecast: result.text, ...result.data });
  } catch (e) {
    if (e instanceof InputError) return json({ ok: false, error: e.code, message: e.message }, 422);
    return json({ ok: false, error: 'internal' }, 500);
  }
}

async function telegramWebhook(request, env) {
  if (missingConfig(env).length) return new Response('not configured', { status: 503 });
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (secret !== await webhookSecret(env.BOT_TOKEN)) return new Response('forbidden', { status: 403 });
  const update = await request.json().catch(() => null);
  try {
    await handleUpdate(update ?? {}, {
      tg: telegramApi(env.BOT_TOKEN, env.TELEGRAM_API),
      store: kvStore(env.LEADS),
      adminChatId: env.ADMIN_CHAT_ID,
      upsell: env.UPSELL_TEXT || undefined,
      appUrl: `${new URL(request.url).origin}/app`,
    });
  } catch (e) {
    // Отвечаем 200 в любом случае, иначе Telegram будет бесконечно повторять то же сообщение.
    console.log('update failed', e.stack || e);
  }
  return new Response('ok');
}

async function setup(url, env) {
  const missing = missingConfig(env);
  if (missing.length) return json({ ok: false, error: `Не заданы переменные: ${missing.join(', ')}` }, 503);
  const tg = telegramApi(env.BOT_TOKEN, env.TELEGRAM_API);
  const me = await tg('getMe', {});
  if (!me.ok) return json({ ok: false, error: 'Telegram не принял BOT_TOKEN — проверьте токен от @BotFather' }, 400);
  const hook = await tg('setWebhook', {
    url: `${url.origin}/telegram`,
    secret_token: await webhookSecret(env.BOT_TOKEN),
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });
  await tg('setMyCommands', {
    commands: [
      { command: 'start', description: 'Получить бесплатный прогноз' },
      { command: 'card', description: 'Моя карточка в CRM' },
    ],
  });
  await tg('setMyShortDescription', { short_description: 'Бесплатный персональный прогноз по имени, дате и месту рождения 🔮' });
  // Кнопка слева от поля ввода открывает Mini App.
  const menu = await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Прогноз', web_app: { url: `${url.origin}/app` } } });
  return json({
    ok: hook.ok,
    bot: `https://t.me/${me.result.username}`,
    crm: `${url.origin}/crm?key=${encodeURIComponent(env.ADMIN_KEY)}`,
    app: `${url.origin}/app`,
    webhook: hook.ok ? 'подключён' : hook.description,
    menu_button: menu.ok ? 'подключена' : menu.description,
  });
}

async function crm(env) {
  const missing = missingConfig(env).filter((m) => m !== 'BOT_TOKEN');
  if (missing.length) return json({ ok: false, error: `Не заданы переменные: ${missing.join(', ')}` }, 503);
  const leads = await kvStore(env.LEADS).list();
  return new Response(renderCrmPage(leads, { timeZone: env.TIMEZONE || 'Europe/Moscow' }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    switch (url.pathname) {
      case '/':
      case '/health':
        return json({ ok: true, service: 'esoteric-forecast', usage: 'POST /forecast {name, birth_date, birth_place}' });
      case '/forecast':
        return forecast(request, url, env);
      case '/telegram':
        if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
        return telegramWebhook(request, env);
      case '/app':
      case '/app/':
      case '/app/api/forecast':
      case '/app/api/full':
        return handleMiniApp(request, env, url.pathname, { tg: telegramApi(env.BOT_TOKEN, env.TELEGRAM_API) });
      case '/setup':
      case '/crm':
        if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) {
          return json({ ok: false, error: 'unauthorized', hint: 'Добавьте ?key=ваш_ADMIN_KEY' }, 401);
        }
        return url.pathname === '/setup' ? setup(url, env) : crm(env);
      default:
        return json({ ok: false, error: 'not_found' }, 404);
    }
  },
};
