// Страница /crm — мини-CRM, пока TorroCRM не подключён: список карточек клиентов из бота.

import { STAGES } from './telegram.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderCrmPage(leads, { timeZone = 'Europe/Moscow' } = {}) {
  const fmt = new Intl.DateTimeFormat('ru-RU', { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const time = (iso) => fmt.format(new Date(iso));
  const counts = STAGES.map((s) => [s, leads.filter((l) => l.stage === s).length]);

  const rows = leads.map((l) => `
    <tr>
      <td class="num">${esc(time(l.updated_at))}</td>
      <td><b>${esc(l.full_name ?? '—')}</b><br><span class="muted">${esc(l.tg_username ? '@' + l.tg_username : l.tg_name)}</span></td>
      <td class="mono">${esc(l.birth_date ?? '—')}</td>
      <td>${esc(l.birth_place ?? '—')}</td>
      <td>${esc(l.zodiac ?? '—')}</td>
      <td class="num">${esc(l.life_path_number ?? '—')}</td>
      <td><span class="stage s${STAGES.indexOf(l.stage)}">${esc(l.stage)}</span></td>
      <td><details><summary>${l.history.length} событий</summary><ul>${l.history.map((h) => `<li><span class="num muted">${esc(time(h.at))}</span> ${esc(h.text)}</li>`).join('')}</ul></details></td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="15">
<meta name="robots" content="noindex">
<title>Астра — CRM</title>
<style>
  :root { --bg:#EDEFF5; --surface:#fff; --ink:#1B1E38; --muted:#5D6180; --line:#D8DBE7; --accent:#8A5F12; --ok:#1F7A4D; --ok-soft:#DDF1E6; --hot:#B4372B; --hot-soft:#F8E1DE; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0D0F21; --surface:#161931; --ink:#E8E6F1; --muted:#9B9DB9; --line:#2A2E4E; --accent:#D9AB52; --ok:#5FCB93; --ok-soft:#173A2A; --hot:#F08A7E; --hot-soft:#3D1F1C; color-scheme: dark; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; padding:24px max(16px, env(safe-area-inset-left)); }
  .wrap { max-width:1200px; margin:0 auto; display:grid; gap:16px; }
  h1 { margin:0; font-size:24px; font-weight:600; }
  .muted { color:var(--muted); }
  .summary { display:flex; flex-wrap:wrap; gap:8px; }
  .summary span { background:var(--surface); border:1px solid var(--line); border-radius:999px; padding:4px 12px; }
  .table { background:var(--surface); border:1px solid var(--line); border-radius:12px; overflow-x:auto; }
  table { border-collapse:collapse; width:100%; min-width:900px; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
  .num { font-variant-numeric:tabular-nums; white-space:nowrap; }
  .mono { font-family:ui-monospace,Menlo,monospace; }
  .stage { display:inline-block; border-radius:999px; padding:2px 10px; font-size:12.5px; font-weight:600; border:1px solid var(--line); white-space:nowrap; }
  .s1, .s2 { color:var(--ok); border-color:var(--ok); background:var(--ok-soft); }
  .s3 { color:var(--hot); border-color:var(--hot); background:var(--hot-soft); }
  details ul { margin:6px 0 0; padding-left:16px; font-size:13px; }
  summary { cursor:pointer; color:var(--accent); }
  .empty { padding:32px; text-align:center; color:var(--muted); }
</style></head>
<body><div class="wrap">
  <h1>Карточки клиентов</h1>
  <div class="summary">${counts.map(([s, n]) => `<span>${esc(s)}: <b>${n}</b></span>`).join('')}</div>
  <div class="table">${leads.length ? `<table>
    <thead><tr><th>Обновлено</th><th>Клиент</th><th>Дата рождения</th><th>Место рождения</th><th>Знак</th><th>Число судьбы</th><th>Стадия</th><th>История</th></tr></thead>
    <tbody>${rows}</tbody></table>` : '<div class="empty">Пока нет ни одной карточки. Напишите боту /start — карточка появится здесь.</div>'}
  </div>
  <p class="muted">Страница обновляется сама каждые 15 секунд.</p>
</div></body></html>`;
}
