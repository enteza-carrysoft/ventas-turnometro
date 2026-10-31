import type { SegmentDraft } from '@turnosala/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approveSegment, editSegment, retireSegment, saveSegmentDrafts } from './segments.js';
import { createTestDb, type TestDb } from './testing.js';
import { uuidv7 } from './uuid.js';

let t: TestDb;
let productId: string;
const MKT = { userId: 'u-mkt', role: 'marketing' as const };
const ADMIN = { userId: 'u-adm', role: 'admin' as const };

beforeAll(async () => {
  t = await createTestDb();
  productId = uuidv7();
  await t.admin.query(`insert into products (id, slug, name, website) values ($1,'turnosala','TurnoSala','https://turnosala.com')`, [productId]);
}, 60_000);
afterAll(async () => {
  await t.drop();
});

const draft = (slug: string, over: Partial<SegmentDraft['definition']> = {}): SegmentDraft => ({
  slug, name: `Segmento ${slug}`, status: 'draft',
  definition: { vertical: 'salud', description: 'd', signals: ['varias_consultas'], decisionMakerRole: 'Gerente', message: 'm', bestDemo: 'demo', fit: { score: 80, provenance: 'inferred', reasoning: 'razón suficiente' }, sourceUrls: ['https://turnosala.com/'], osmFilters: [['healthcare', 'dentist']], ...over },
});
const row = async (slug: string) => (await t.app.query('select * from segments where slug = $1', [slug])).rows[0] as { id: string; status: string; name: string; definition: Record<string, unknown> };
const audit = async (action: string) => (await t.app.query('select actor, entity_id, payload from audit_log where action = $1 order by id desc', [action])).rows as Array<{ actor: string; entity_id: string; payload: Record<string, unknown> }>;

describe('saveSegmentDrafts (REQ-MKT-02 CA2)', () => {
  it('crea los segmentos en «draft» con su definición y lo registra', async () => {
    const r = await saveSegmentDrafts(t.app, productId, [draft('a'), draft('b')], { actor: 'system:market.analyze' });
    expect(r).toEqual({ created: 2, updated: 0, kept: 0 });
    expect(await row('a')).toMatchObject({ status: 'draft', name: 'Segmento a', definition: { fit: { provenance: 'inferred', score: 80 }, sourceUrls: ['https://turnosala.com/'] } });
    expect((await audit('segment.drafted'))[0]).toMatchObject({ actor: 'system:market.analyze', payload: { created: 2 } });
  });

  it('un borrador se actualiza al repetir el análisis, pero un segmento aprobado o retirado NO se sobrescribe', async () => {
    await saveSegmentDrafts(t.app, productId, [draft('c'), draft('d'), draft('e')], { actor: 'x' });
    await approveSegment(t.app, (await row('d')).id, MKT);
    await approveSegment(t.app, (await row('e')).id, MKT);
    await retireSegment(t.app, (await row('e')).id, MKT);
    const r = await saveSegmentDrafts(t.app, productId, [draft('c', { message: 'nuevo' }), draft('d', { message: 'nuevo' }), draft('e', { message: 'nuevo' })], { actor: 'x' });
    expect(r).toEqual({ created: 0, updated: 1, kept: 2 });
    expect((await row('c')).definition.message).toBe('nuevo');
    expect((await row('d')).definition.message).toBe('m');
    expect((await row('e')).status).toBe('retired');
  });
});

describe('approveSegment (REQ-MKT-02 CA2, F1.2)', () => {
  it('marketing y admin aprueban; queda en audit_log con quién y cuándo', async () => {
    await saveSegmentDrafts(t.app, productId, [draft('f'), draft('g')], { actor: 'x' });
    expect(await approveSegment(t.app, (await row('f')).id, MKT)).toEqual({ ok: true });
    expect(await approveSegment(t.app, (await row('g')).id, ADMIN)).toEqual({ ok: true });
    expect((await row('f')).status).toBe('approved');
    const fid = (await row('f')).id;
    expect((await audit('segment.approved')).find((a) => a.entity_id === fid)).toMatchObject({ actor: 'u-mkt', payload: { slug: 'f' } });
  });

  it.each(['sales', 'auditor', 'voice'] as const)('el rol %s no puede aprobar', async (role) => {
    await saveSegmentDrafts(t.app, productId, [draft(`h-${role}`)], { actor: 'x' });
    expect(await approveSegment(t.app, (await row(`h-${role}`)).id, { userId: 'u', role })).toEqual({ ok: false, reason: 'forbidden' });
    expect(await approveSegment(t.app, (await row(`h-${role}`)).id, { userId: 'u', role: null })).toEqual({ ok: false, reason: 'forbidden' });
    expect((await row(`h-${role}`)).status).toBe('draft');
  });

  it('solo se aprueba un borrador; un segmento inexistente o ya aprobado se informa sin cambiar nada', async () => {
    await saveSegmentDrafts(t.app, productId, [draft('i')], { actor: 'x' });
    const id = (await row('i')).id;
    await approveSegment(t.app, id, MKT);
    const before = (await audit('segment.approved')).length;
    expect(await approveSegment(t.app, id, MKT)).toEqual({ ok: false, reason: 'not_draft' });
    expect(await approveSegment(t.app, uuidv7(), MKT)).toEqual({ ok: false, reason: 'not_found' });
    expect((await audit('segment.approved')).length).toBe(before);
  });
});

describe('editSegment y retireSegment', () => {
  it('se edita un borrador (descripción, mensaje, demo, señales, filtros) sin tocar el encaje inferido; queda auditado', async () => {
    await saveSegmentDrafts(t.app, productId, [draft('j')], { actor: 'x' });
    const id = (await row('j')).id;
    expect(await editSegment(t.app, id, { message: 'Mensaje editado', signals: ['sala_espera'] }, MKT)).toEqual({ ok: true });
    expect((await row('j')).definition).toMatchObject({ message: 'Mensaje editado', signals: ['sala_espera'], fit: { provenance: 'inferred', score: 80 } });
    expect((await audit('segment.edited'))[0]).toMatchObject({ actor: 'u-mkt', payload: { fields: ['message', 'signals'] } });
  });

  it('un rol sin permiso, un segmento aprobado o un campo no editable (encaje) se rechazan', async () => {
    await saveSegmentDrafts(t.app, productId, [draft('k')], { actor: 'x' });
    const id = (await row('k')).id;
    expect(await editSegment(t.app, id, { message: 'x' }, { userId: 'u', role: 'sales' })).toEqual({ ok: false, reason: 'forbidden' });
    expect(await editSegment(t.app, id, { fit: { score: 100 } } as never, MKT)).toEqual({ ok: false, reason: 'invalid_patch' });
    expect(await editSegment(t.app, id, { osmFilters: [['a"', 'b']] }, MKT)).toEqual({ ok: false, reason: 'invalid_patch' });
    await approveSegment(t.app, id, MKT);
    expect(await editSegment(t.app, id, { message: 'x' }, MKT)).toEqual({ ok: false, reason: 'not_draft' });
  });

  it('se retira un segmento aprobado (solo marketing/admin) y deja rastro', async () => {
    await saveSegmentDrafts(t.app, productId, [draft('l')], { actor: 'x' });
    const id = (await row('l')).id;
    expect(await retireSegment(t.app, id, MKT)).toEqual({ ok: false, reason: 'not_approved' });
    await approveSegment(t.app, id, MKT);
    expect(await retireSegment(t.app, id, { userId: 'u', role: 'sales' })).toEqual({ ok: false, reason: 'forbidden' });
    expect(await retireSegment(t.app, id, MKT)).toEqual({ ok: true });
    expect((await row('l')).status).toBe('retired');
    expect((await audit('segment.retired'))[0]).toMatchObject({ actor: 'u-mkt' });
  });
});
