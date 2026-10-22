// Cloudflare Worker: вебхук прогноза для TorroCRM (или любого другого конструктора ботов).
//
//   POST /forecast  {"name": "...", "birth_date": "...", "birth_place": "..."}
//   GET  /forecast?name=...&birth_date=...&birth_place=...
//
// Ответ: {"ok": true, "forecast": "текст для отправки клиенту", "zodiac": "...", ...}
// Ошибка ввода: HTTP 422, {"ok": false, "error": "bad_date", "message": "что переспросить у клиента"}
//
// Переменные окружения (необязательные):
//   API_KEY     — если задан, запрос должен содержать заголовок X-Api-Key или параметр ?key=
//   UPSELL_TEXT — свой текст в конце прогноза (предложение платного разбора)

import { makeForecast, InputError } from './forecast.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'esoteric-forecast', usage: 'POST /forecast {name, birth_date, birth_place}' });
    }
    if (url.pathname !== '/forecast') return json({ ok: false, error: 'not_found' }, 404);

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
  },
};
