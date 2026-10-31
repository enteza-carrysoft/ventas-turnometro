// Siembra product_facts v1 de TurnoSala en BORRADOR (F0.10). Aprobarlo lo hace un admin en el panel.
//
//   PowerShell:
//     $env:DATABASE_URL = 'postgres://app:<clave>@127.0.0.1:5433/prospector'
//     npm run seed:product-facts
import { seedProductFactsDraft } from '@turnosala/db';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta la variable de entorno DATABASE_URL (ver el comentario de scripts/seed-product-facts.ts).');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url });
try {
  const r = await seedProductFactsDraft(pool, { actor: 'script:seed-product-facts' });
  console.log(r.created ? `product_facts v1 creado en borrador (id ${r.factsId}).` : `Ya existía la versión 1 (id ${r.factsId}); no se ha cambiado nada.`);
} finally {
  await pool.end();
}
