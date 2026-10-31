// Carga la lista de clientes actuales de TurnoSala desde un CSV (D-13) para no prospectarlos. Todo o nada: si una fila es inválida no se importa ninguna.
//
//   Formato del CSV (cabecera obligatoria; domain y phone opcionales):
//     org_id,name,domain,phone
//     org-1,Clínica Sol S.L.,clinicasol.es,954 12 34 56
//
//   PowerShell:
//     $env:DATABASE_URL = 'postgres://app:<clave>@<host>:5432/prospector'
//     npm run customers:import -- .\clientes.csv
import { readFileSync } from 'node:fs';
import { importTurnosalaCustomers } from '@turnosala/db';
import pg from 'pg';

const file = process.argv[2];
const url = process.env.DATABASE_URL;
if (!file || !url) {
  console.error('Uso: $env:DATABASE_URL=...; npm run customers:import -- <archivo.csv>');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url });
try {
  const r = await importTurnosalaCustomers(pool, readFileSync(file, 'utf8'), { at: new Date() });
  if (r.errors.length) {
    console.error(`No se importó nada. Corrige estas líneas del CSV:\n${r.errors.map((e) => `  línea ${e.line}: ${e.message}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`Clientes importados o actualizados: ${r.imported}.`);
  }
} finally {
  await pool.end();
}
