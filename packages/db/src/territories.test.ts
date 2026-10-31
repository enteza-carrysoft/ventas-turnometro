import { sizeMarket } from '@turnosala/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importTerritories, listTerritories, saveSizing } from './territories.js';
import { createTestDb, type TestDb } from './testing.js';
import { uuidv7 } from './uuid.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.drop();
});

const CSV = `ine_code,name,province,region,population
41091,Sevilla,Sevilla,Andalucía,680000
41038,Dos Hermanas,Sevilla,Andalucía,135000
41004,Alcalá de Guadaíra,Sevilla,Andalucía,
`;
const count = async (): Promise<number> => Number(((await t.app.query('select count(*) n from territories')).rows[0] as { n: string }).n);

describe('importTerritories (F1.3)', () => {
  it('carga los municipios desde un CSV (la población puede faltar) y es idempotente: reimportar actualiza', async () => {
    expect(await importTerritories(t.app, CSV)).toEqual({ imported: 3, errors: [] });
    expect(await count()).toBe(3);
    expect(await importTerritories(t.app, CSV.replace('680000', '690000'))).toEqual({ imported: 3, errors: [] });
    expect(await count()).toBe(3);
    const rows = await listTerritories(t.app, { province: 'Sevilla' });
    expect(rows.find((r) => r.ineCode === '41091')).toMatchObject({ name: 'Sevilla', population: 690000, region: 'Andalucía' });
    expect(rows.find((r) => r.ineCode === '41004')?.population).toBeNull();
  });

  it('todo o nada: una fila inválida (código INE no de 5 dígitos, población negativa, provincia vacía) no importa ninguna y dice en qué línea', async () => {
    const bad = `ine_code,name,province,region,population\n41999,Bien,Sevilla,Andalucía,10\n4109,Mal,Sevilla,Andalucía,10\n41100,Neg,Sevilla,Andalucía,-5\n41101,SinProv,,Andalucía,5\n`;
    const r = await importTerritories(t.app, bad);
    expect(r.imported).toBe(0);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(await count()).toBe(3);
  });

  it('exige la cabecera; el BOM de Excel no la rompe', async () => {
    await expect(importTerritories(t.app, 'a,b\n1,2\n')).rejects.toThrow(/cabecera/i);
    expect((await importTerritories(t.app, '﻿' + CSV)).imported).toBe(3);
  });

  it('lista por provincia, o los códigos pedidos', async () => {
    expect((await listTerritories(t.app, { ineCodes: ['41038'] })).map((r) => r.name)).toEqual(['Dos Hermanas']);
    expect((await listTerritories(t.app, { province: 'Cádiz' }))).toEqual([]);
  });
});

describe('saveSizing (REQ-MKT-03)', () => {
  it('guarda el resultado completo con su fuente y licencia y quién lo pidió', async () => {
    const productId = uuidv7();
    await t.admin.query(`insert into products (id, slug, name, website) values ($1,'turnosala','T','https://x.es')`, [productId]);
    const segId = uuidv7();
    await t.admin.query(`insert into segments (id, product_id, slug, name, status, definition) values ($1,$2,'c','C','approved','{}')`, [segId, productId]);
    const territories = await listTerritories(t.app, { province: 'Sevilla' });
    const result = sizeMarket({ territories, counted: new Map([['41091', 300]]), provincialTotals: new Map([['Sevilla', 500]]) });
    const id = await saveSizing(t.app, { segmentId: segId, territory: { province: 'Sevilla' }, activity: 'CNAE 86', result, createdBy: 'marketing@x.es' });
    const row = (await t.app.query('select * from market_sizings where id = $1', [id])).rows[0] as { result: { source: { license: string }; totals: { total: number } }; created_by: string; activity: string };
    expect(row).toMatchObject({ created_by: 'marketing@x.es', activity: 'CNAE 86', result: { totals: { total: 500 }, source: { license: expect.stringContaining('CC BY-SA 4.0') } } });
  });
});
