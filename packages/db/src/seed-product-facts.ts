import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { productFactsSchema } from '@turnosala/core';
import type pg from 'pg';
import { uuidv7 } from './uuid.js';

export const PRODUCT_FACTS_V1_PATH = fileURLToPath(new URL('../seeds/product-facts.v1.json', import.meta.url));

/**
 * F0.10: crea el producto TurnoSala y su `product_facts` v1 **en borrador**. Nunca aprueba: aprobarlo es una decisión
 * del promotor (rol admin, REQ-MKT-01 CA1). Idempotente: si la versión 1 ya existe no hace nada.
 */
export async function seedProductFactsDraft(pool: pg.Pool, opts: { actor: string }): Promise<{ created: boolean; factsId: string | null }> {
  const facts = productFactsSchema.parse(JSON.parse(readFileSync(PRODUCT_FACTS_V1_PATH, 'utf8')));
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into products (id, slug, name, website) values ($1, 'turnosala', 'TurnoSala', $2) on conflict (slug) do nothing`,
      [uuidv7(), facts.urls.web],
    );
    const product = (await client.query(`select id from products where slug = 'turnosala'`)).rows[0] as { id: string };
    const existing = await client.query('select id from product_facts where product_id = $1 and version = 1', [product.id]);
    if (existing.rowCount) {
      await client.query('rollback');
      return { created: false, factsId: (existing.rows[0] as { id: string }).id };
    }
    const id = uuidv7();
    await client.query(`insert into product_facts (id, product_id, version, status, facts) values ($1, $2, 1, 'draft', $3)`, [id, product.id, JSON.stringify(facts)]);
    await client.query(
      `insert into audit_log (actor, action, entity, entity_id, payload) values ($1, 'product_facts.seed', 'product_facts', $2, $3)`,
      [opts.actor, id, JSON.stringify({ version: 1, status: 'draft', source: 'turnosala.com 2026-10-31' })],
    );
    await client.query('commit');
    return { created: true, factsId: id };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
