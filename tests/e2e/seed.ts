import { adminUrl, ingestCandidate, saveEnrichment, saveSegmentDrafts, TEST_APP_PW, urlFor } from '@turnosala/db';
import pg from 'pg';
import { E2E_DB } from '../../playwright.config.js';

// Datos de prueba del e2e: fichas distintas (la deduplicación fusionaría nombres, webs o teléfonos parecidos).
const AT = new Date('2026-11-10T10:00:00Z');
let n = 0;

export const appPool = (): pg.Pool => new pg.Pool({ connectionString: urlFor(adminUrl(), 'app', TEST_APP_PW, E2E_DB) });

function word(k: number): string {
  let x = (k * 2654435761) % 4294967296;
  let w = '';
  for (let i = 0; i < 7; i++) { w += 'bcdfghjklmnpqrstvwxyz'.charAt(x % 21) + 'aeiou'.charAt((x >> 5) % 5); x = (x * 1103515245 + 12345) % 2147483648; }
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** Ficha enriquecida con una señal observada y una sede inferida, lista para revisar. Devuelve su id y su nombre. */
export async function seedProspect(pool: pg.Pool, over: { legal?: 'company' | 'sole_trader' } = {}): Promise<{ id: string; name: string }> {
  n += 1;
  const name = `${word(n + 100)} ${word(n * 31 + 7)} S.L.`;
  const url = `https://e2e-${n}.es/`;
  const r = await ingestCandidate(pool, { name, website: url, phone: `955 ${String(300 + n).padStart(3, '0')} 0${String(10 + n)}`, municipality: 'Sevilla', province: 'Sevilla', sourceId: 'corporate_web', externalId: `e2e${n}`, sourceUrl: url, fetchedAt: AT, extractorVersion: 'e2e', evidences: [] });
  await saveEnrichment(pool, r.prospectId, {
    fields: [{ key: 'sites_count', value: '2', provenance: 'inferred', explanation: 'se deduce de «dos centros»', sourceUrl: url, quote: 'dos centros' }],
    signals: [{ key: 'varias_consultas', quote: 'tres consultas', sourceUrl: url }],
    contactPoints: [{ type: 'switchboard_phone', value: '+34955300000', sourceUrl: `${url}contacto`, quote: 'llámanos' }], legalForm: null,
    metrics: { accepted: 3, rejected: {} as never, personalEmailsDiscarded: 0, hallucinationRejected: 0 },
  }, { fetchedAt: AT, extractorVersion: 'extract-v1' });
  if (over.legal) await pool.query('update prospects set legal_form = $2 where id = $1', [r.prospectId, over.legal]);
  return { id: r.prospectId, name };
}

export async function seedSegment(pool: pg.Pool, slug: string): Promise<void> {
  await pool.query(`insert into products (id, slug, name, website) values ('00000000-0000-7000-8000-0000000000e1','turnosala','TurnoSala','https://turnosala.com') on conflict (slug) do nothing`);
  const productId = ((await pool.query(`select id from products where slug = 'turnosala'`)).rows[0] as { id: string }).id;
  await saveSegmentDrafts(pool, productId, [{ slug, name: `Segmento ${slug}`, status: 'draft', definition: { vertical: 'salud', description: 'Clínicas con varias consultas', signals: ['varias_consultas'], decisionMakerRole: 'Gerente', message: 'Menos esperas', bestDemo: 'Pantalla en sala', fit: { score: 80, provenance: 'inferred', reasoning: 'Varias consultas simultáneas.' }, sourceUrls: ['https://turnosala.com/'], osmFilters: [] } }], { actor: 'e2e' });
}
