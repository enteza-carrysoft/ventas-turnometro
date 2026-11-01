import type { DealRow } from '@turnosala/db/web';
import { describe, expect, it } from 'vitest';
import { eur, filtersFromParams, madridDateTime, toCard } from './deal-view.js';

describe('eur', () => {
  it('formatea en euros sin decimales y usa un guion cuando no hay importe', () => {
    expect(eur(828)).toMatch(/828\s?€/);
    expect(eur(1500)).toMatch(/1\.?500\s?€/);
    expect(eur(0)).toMatch(/0\s?€/);
    expect(eur(null)).toBe('—');
  });
});

describe('madridDateTime (las fechas van en UTC en BD y en Europe/Madrid en pantalla)', () => {
  it('invierno UTC+1, verano UTC+2; sin fecha, un guion', () => {
    expect(madridDateTime(new Date('2026-11-10T10:00:00Z'))).toContain('11:00');
    expect(madridDateTime(new Date('2026-11-10T10:00:00Z'))).toContain('10/11/2026');
    expect(madridDateTime(new Date('2026-07-10T10:00:00Z'))).toContain('12:00');
    expect(madridDateTime(null)).toBe('—');
  });

  it('cruza la medianoche de Madrid, no la de UTC', () => {
    expect(madridDateTime(new Date('2026-11-10T23:30:00Z'))).toContain('11/11/2026');
  });
});

const row = (over: Partial<DealRow> = {}): DealRow => ({
  id: 'd1', prospectId: 'p1', prospectName: 'Clínica Sol', municipality: 'Sevilla', province: 'Sevilla', segmentName: 'Clínicas', campaignName: null, stageId: 'interested', stageName: 'Interesado',
  probability: 15, ownerUserId: 'u1', ownerName: 'Vera', estValueEur: 828, score: 70, tier: 'warm', openedAt: new Date('2026-11-01T10:00:00Z'), updatedAt: new Date('2026-11-02T10:00:00Z'),
  closedAt: null, lostReasonId: null, nextTaskDueAt: new Date('2026-11-05T10:00:00Z'), nextTaskTitle: 'Llamar', ...over,
});

describe('toCard', () => {
  it('pasa a datos planos (sin fechas ni objetos) y marca la tarea vencida respecto al momento dado', () => {
    const now = new Date('2026-11-10T10:00:00Z');
    const c = toCard(row(), now);
    expect(c).toMatchObject({ id: 'd1', name: 'Clínica Sol', where: 'Sevilla', value: expect.stringMatching(/828/), owner: 'Vera', stage: 'interested', taskTitle: 'Llamar', taskOverdue: true, closed: false });
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
    expect(toCard(row({ nextTaskDueAt: new Date('2026-11-12T10:00:00Z') }), now).taskOverdue).toBe(false);
    expect(toCard(row({ nextTaskDueAt: null, nextTaskTitle: null }), now)).toMatchObject({ taskTitle: null, taskOverdue: false, taskDue: '—' });
  });

  it('sin comercial dice «Sin asignar»; sin municipio usa la provincia; cerrada se marca', () => {
    expect(toCard(row({ ownerUserId: null, ownerName: null }), new Date()).owner).toBe('Sin asignar');
    expect(toCard(row({ municipality: null }), new Date()).where).toBe('Sevilla');
    expect(toCard(row({ municipality: null, province: null }), new Date()).where).toBe('—');
    expect(toCard(row({ closedAt: new Date() }), new Date()).closed).toBe(true);
  });
});

describe('filtersFromParams (la URL es entrada no fiable)', () => {
  it('lee solo los filtros conocidos y descarta valores raros', () => {
    expect(filtersFromParams({ owner: 'me', stage: 'trial', provincia: 'Sevilla', estado: 'closed', q: ' sol ' })).toMatchObject({ owner: 'me', stage: 'trial', province: 'Sevilla', status: 'closed', search: 'sol' });
    expect(filtersFromParams({ estado: 'cualquiera' }).status).toBeUndefined();
    expect(filtersFromParams({ segmento: 'no-es-uuid' }).segmentId).toBe('no-es-uuid'); // la consulta lo descarta sin romper
    expect(filtersFromParams({ owner: ['a', 'b'] }).owner).toBeUndefined(); // un parámetro repetido no es un valor
    expect(filtersFromParams({ q: 'x'.repeat(500) }).search?.length).toBeLessThanOrEqual(100);
  });

  it('fechas: «hasta» incluye todo el día elegido en Madrid; una fecha mal formada se ignora', () => {
    const f = filtersFromParams({ tareaHasta: '2026-11-10' });
    expect(f.nextTaskTo?.toISOString()).toBe('2026-11-10T22:59:59.999Z');
    expect(filtersFromParams({ tareaHasta: '10/11/2026' }).nextTaskTo).toBeUndefined();
    expect(filtersFromParams({ tareaHasta: '2026-13-45' }).nextTaskTo).toBeUndefined();
    expect(filtersFromParams({ sinTarea: '1' }).noTask).toBe(true);
  });
});
