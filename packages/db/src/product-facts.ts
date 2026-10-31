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

export interface ApproveByEmailInput {
  email: string;
  /** versión de product_facts de TurnoSala; por defecto la 1 */
  version?: number | undefined;
}
export interface ApproveByEmailResult {
  approved: true;
  alreadyApproved: boolean;
  approvedBy: string;
  factsId: string;
}

/**
 * Aprueba una versión de `product_facts` de TurnoSala **como el admin identificado por su correo**. Falla si el
 * usuario no existe o su rol no es `admin` (la comprobación real la repite `approveProductFacts`). Repetirla es inocua.
 */
export async function approveProductFactsByEmail(pool: pg.Pool, input: ApproveByEmailInput): Promise<ApproveByEmailResult> {
  const user = (
    await pool.query(
      `select u.id, r.role from "user" u left join app_user_roles r on r.user_id = u.id where lower(u.email) = lower($1)`,
      [input.email.trim()],
    )
  ).rows[0] as { id: string; role: string | null } | undefined;
  if (!user) throw new Error(`no existe ningún usuario con el correo ${input.email}`);
  if (user.role !== 'admin') throw new Error('solo un usuario con rol admin puede aprobar product_facts');
  const version = input.version ?? 1;
  const facts = (
    await pool.query(
      `select f.id, f.status from product_facts f join products p on p.id = f.product_id where p.slug = 'turnosala' and f.version = $1`,
      [version],
    )
  ).rows[0] as { id: string; status: string } | undefined;
  if (!facts) throw new Error(`no existe la versión ${version} de product_facts de TurnoSala`);
  if (facts.status === 'approved') return { approved: true, alreadyApproved: true, approvedBy: user.id, factsId: facts.id };
  await approveProductFacts(pool, { factsId: facts.id, actor: user.id, role: user.role });
  return { approved: true, alreadyApproved: false, approvedBy: user.id, factsId: facts.id };
}
