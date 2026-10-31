import type pg from 'pg';

export interface ApproveFactsInput {
  factsId: string;
  actor: string;
  role: string;
}

/** REQ-MKT-01 CA1: solo `admin` aprueba; la versión anterior pasa a `retired`; todo queda en audit_log. */
export async function approveProductFacts(pool: pg.Pool, input: ApproveFactsInput): Promise<void> {
  if (input.role !== 'admin') throw new Error('aprobar product_facts exige el rol admin');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const cur = await client.query('select product_id, status from product_facts where id = $1 for update', [input.factsId]);
    const row = cur.rows[0];
    if (!row) throw new Error('product_facts no encontrado');
    if (row.status === 'retired') throw new Error('una versión retirada no se puede aprobar');
    await client.query(
      `update product_facts set status = 'retired' where product_id = $1 and status = 'approved' and id <> $2`,
      [row.product_id, input.factsId],
    );
    await client.query(`update product_facts set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [
      input.factsId,
      input.actor,
    ]);
    await client.query(
      `insert into audit_log (actor, action, entity, entity_id, payload) values ($1,'product_facts.approve','product_facts',$2,$3)`,
      [input.actor, input.factsId, JSON.stringify({ product_id: row.product_id })],
    );
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
