import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from './csv.js';
import { importTurnosalaCustomers } from './customers.js';
import { createTestDb, type TestDb } from './testing.js';

let t: TestDb;
const AT = new Date('2026-11-10T10:00:00Z');
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.drop();
});

describe('parseCsv', () => {
  it('lee cabecera y filas, con comillas, comas dentro de comillas y saltos CRLF', () => {
    const rows = parseCsv('a,b,c\r\n1,"dos, con coma",3\r\n"x ""q"" y",,\r\n');
    expect(rows).toEqual([{ a: '1', b: 'dos, con coma', c: '3' }, { a: 'x "q" y', b: '', c: '' }]);
  });
  it('ignora líneas vacías y el BOM inicial', () => {
    expect(parseCsv('﻿a,b\n\n1,2\n\n')).toEqual([{ a: '1', b: '2' }]);
  });
});

describe('importTurnosalaCustomers (D-13, REQ-VER-02)', () => {
  const rows = async () => (await t.app.query('select org_id, name, name_norm, domain, phone_e164 from turnosala_customers order by org_id')).rows;

  it('normaliza nombre, dominio y teléfono al guardar', async () => {
    const r = await importTurnosalaCustomers(t.app, 'org_id,name,domain,phone\no1,Clínica Sol S.L.,https://www.ClinicaSol.es/inicio,954 12 34 56\no2,Sin datos,,\n', { at: AT });
    expect(r).toMatchObject({ imported: 2, errors: [] });
    expect(await rows()).toEqual([
      { org_id: 'o1', name: 'Clínica Sol S.L.', name_norm: 'clinica sol', domain: 'clinicasol.es', phone_e164: '+34954123456' },
      { org_id: 'o2', name: 'Sin datos', name_norm: 'sin datos', domain: null, phone_e164: null },
    ]);
  });

  it('reimportar actualiza por org_id (no duplica)', async () => {
    await importTurnosalaCustomers(t.app, 'org_id,name,domain,phone\no1,Clínica Sol Nueva,clinicasol.es,\n', { at: AT });
    const all = await rows();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ org_id: 'o1', name: 'Clínica Sol Nueva', phone_e164: null });
  });

  it('un CSV con errores no importa NADA y dice en qué líneas (todo o nada)', async () => {
    const before = (await rows()).length;
    const csv = 'org_id,name,domain,phone\no3,Bien,bien.es,\n,Sin id,x.es,\no4,,y.es,\no5,Teléfono malo,z.es,12345\n';
    const r = await importTurnosalaCustomers(t.app, csv, { at: AT });
    expect(r.imported).toBe(0);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(await rows()).toHaveLength(before);
  });

  it('exige la cabecera org_id,name (domain y phone opcionales)', async () => {
    await expect(importTurnosalaCustomers(t.app, 'id,nombre\n1,x\n', { at: AT })).rejects.toThrow(/cabecera/i);
  });
});
