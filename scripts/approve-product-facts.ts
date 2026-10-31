// Aprueba product_facts v1 de TurnoSala como un admin (REQ-MKT-01 CA1). Solo lo ejecuta una persona con rol admin.
//
//   PowerShell:
//     $env:DATABASE_URL = 'postgres://app:<clave>@<host>:5432/prospector'
//     npm run approve:product-facts -- admin@empresa.es
import { approveProductFactsByEmail } from '@turnosala/db';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const email = process.argv[2];
if (!url || !email) {
  console.error('Uso: $env:DATABASE_URL=...; npm run approve:product-facts -- <correo-del-admin>');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url });
try {
  const r = await approveProductFactsByEmail(pool, { email });
  console.log(r.alreadyApproved ? 'La versión ya estaba aprobada; no se ha cambiado nada.' : `product_facts aprobado por ${r.approvedBy}.`);
} catch (e) {
  console.error(`No se aprobó: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
