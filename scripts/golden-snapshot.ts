// Congela el texto de una web para el conjunto dorado (F1.10): rastrea con las mismas reglas educadas del producto (robots.txt, 1 petición/s,
// ≤ 6 páginas), quita los datos personales con el mismo código que usa el modelo y guarda el resultado en tests/golden/snapshots/<id>.json
// (local, fuera de git). También deja <id>.txt para leerlo mientras se anota y la plantilla tests/golden/entries/<id>.json si no existe.
//
//   PowerShell:
//     npm run golden:snapshot -- clinica-sol https://www.clinicasol.es
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crawlSite } from '@turnosala/connectors';
import { DEFAULT_SCORING_MODEL, prepareExtraction } from '@turnosala/core';
import { TEMPLATE_ENTRY } from '../apps/worker/src/golden-files.js';

const [id, website] = process.argv.slice(2);
if (!id || !website || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
  console.error('Uso: npm run golden:snapshot -- <id-en-minusculas-y-guiones> <https://web-de-la-empresa>');
  process.exit(1);
}
const dir = join('tests', 'golden');
const userAgent = process.env.CRAWLER_USER_AGENT ?? 'TurnoSalaProspectorBot/1.0 (+https://turnosala.com/bot)';
const crawled = await crawlSite(website, { userAgent });
if (crawled.pages.length === 0) {
  console.error(`No se pudo rastrear ${website} (robots: ${crawled.robots}; omitidas: ${crawled.skipped.map((s) => s.reason).join(', ') || 'ninguna'}). No se guarda nada.`);
  process.exit(2);
}
const pages = prepareExtraction(crawled.pages, Object.keys(DEFAULT_SCORING_MODEL.signals)).pages;
mkdirSync(join(dir, 'snapshots'), { recursive: true });
mkdirSync(join(dir, 'entries'), { recursive: true });
writeFileSync(join(dir, 'snapshots', `${id}.json`), JSON.stringify({ id, website, takenAt: new Date().toISOString(), pages }, null, 2));
writeFileSync(join(dir, 'snapshots', `${id}.txt`), pages.map((p) => `=== ${p.url}\n${p.text}`).join('\n\n'));
const entryPath = join(dir, 'entries', `${id}.json`);
if (!existsSync(entryPath)) writeFileSync(entryPath, JSON.stringify(TEMPLATE_ENTRY(id, website), null, 2));
console.log(`Instantánea guardada (${pages.length} páginas). Anota ${entryPath} leyendo tests/golden/snapshots/${id}.txt.`);
