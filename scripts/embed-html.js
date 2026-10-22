// Встраивает src/miniapp.html в src/miniapp-page.js, чтобы воркер собирался в один файл.
// Запускается из npm run build; после правок страницы — `npm run build`.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync(new URL('../src/miniapp.html', import.meta.url), 'utf8');
writeFileSync(
  new URL('../src/miniapp-page.js', import.meta.url),
  `// Сгенерировано из src/miniapp.html скриптом scripts/embed-html.js — не редактируйте вручную.\nexport default ${JSON.stringify(html)};\n`,
);
