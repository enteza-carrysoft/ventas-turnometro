// Carga los municipios del INE desde un CSV (F1.3). Todo o nada; reimportar actualiza por código INE.
//
//   Formato del CSV (cabecera obligatoria; population opcional):
//     ine_code,name,province,region,population
//     41091,Sevilla,Sevilla,Andalucía,684234
//
//   PowerShell:
//     $env:DATABASE_URL = 'postgres://app:<clave>@<host>:5432/prospector'
//     npm run territories:import -- .\municipios.csv
import { readFileSync } from 'node:fs';
import { importTerritories } from '@turnosala/db';
import pg from 'pg';

const file = process.argv[2];
const url = process.env.DATABASE_URL;
if (!file || !url) {
  console.error('Uso: $env:DATABASE_URL=...; npm run territories:import -- <archivo.csv>');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url });
try {
  const r = await importTerritories(pool, readFileSync(file, 'utf8'));
  if (r.errors.length) {
    console.error(`No se importó nada. Corrige estas líneas del CSV:\n${r.errors.map((e) => `  línea ${e.line}: ${e.message}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`Municipios importados o actualizados: ${r.imported}.`);
  }
} finally {
  await pool.end();
}
