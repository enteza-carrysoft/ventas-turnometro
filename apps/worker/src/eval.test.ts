import type { LlmRequest, LlmResult } from '@turnosala/ai';
import type { ExtractionOutput, GoldenEntry } from '@turnosala/core';
import { describe, expect, it, vi } from 'vitest';
import { runEval, type EvalCase, type EvalDeps } from './eval.js';

const U = 'https://clinicasol.es/';
const TEXT = 'Clínica Dental Sol\nTenemos 3 consultas y sala de espera\nLlámanos al 954 12 34 56';
const golden = (id: string): GoldenEntry => ({
  id, website: U, annotated_by: 'Ana', annotated_at: '2026-11-20',
  expected: { fields: { consultation_rooms: '3' }, signals: ['varias_consultas'], contact_points: [{ type: 'switchboard_phone', value: '954 12 34 56' }] },
});
const kase = (id: string): EvalCase => ({ golden: golden(id), snapshot: { id, website: U, takenAt: '2026-11-19T10:00:00Z', pages: [{ url: U, finalUrl: U, text: TEXT, links: [] }] } });
const GOOD: ExtractionOutput = {
  fields: [{ key: 'consultation_rooms', value: '3', provenance: 'observed', explanation: null, source_url: U, quote: 'Tenemos 3 consultas' }],
  signals: [{ key: 'varias_consultas', source_url: U, quote: 'Tenemos 3 consultas' }],
  contact_points: [{ type: 'switchboard_phone', value: '954 12 34 56', source_url: U, quote: 'Llámanos al 954 12 34 56' }], legal_form: null,
};
const ok = (data: ExtractionOutput, costEur = 0.2): LlmResult<ExtractionOutput> => ({ status: 'ok', data, provider: 'openrouter', requestedModel: 'm', servedModel: 'm', fallbackUsed: false, usage: { input: 1, output: 1, cachedInput: 0, costEur, costSource: 'provider' } });
const err = (reason: string): LlmResult<ExtractionOutput> => ({ status: 'error', reason: reason as never, provider: null, requestedModel: null, servedModel: null, fallbackUsed: false, usage: { input: 0, output: 0, cachedInput: 0, costEur: 0, costSource: 'unknown' } });

function deps(results: Array<LlmResult<ExtractionOutput>>, maxEur = 100): { d: EvalDeps; run: ReturnType<typeof vi.fn> } {
  let i = 0;
  const run = vi.fn((...a: [string, LlmRequest<unknown>]) => {
    void a;
    return Promise.resolve(results[Math.min(i++, results.length - 1)] as LlmResult<unknown>);
  });
  return { d: { gateway: { run: run as unknown as EvalDeps['gateway']['run'] }, route: 'enrich.extract', maxEur }, run };
}

describe('runEval (F1.10)', () => {
  it('evalúa cada ficha con la ruta indicada y devuelve métricas, coste y la puerta superada con una extracción perfecta', async () => {
    const { d, run } = deps([ok(GOOD)]);
    const r = await runEval(d, [kase('a'), kase('b')]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0]).toBe('enrich.extract');
    expect(r.skipped).toEqual([]);
    expect(r.aggregate).toMatchObject({ entries: 2, precision: 1, passesGate: true, totalCostEur: 0.4, costPerEntryEur: 0.2, literalRejectionRate: 0 });
    expect(r.stoppedByBudget).toBe(false);
  });

  it('el modelo inventa una cita: se rechaza en la verificación, se cuenta como alucinación y baja la tasa', async () => {
    const bad: ExtractionOutput = { ...GOOD, signals: [...GOOD.signals, { key: 'tv_en_sala', source_url: U, quote: 'Pantallas en todas las salas' }] };
    const r = await runEval(deps([ok(bad)]).d, [kase('a')]);
    expect(r.aggregate.literalRejectionRate).toBeCloseTo(1 / 4, 6);
    expect(r.aggregate.precision).toBe(1); // lo inventado no llega a las métricas de precisión: ya se descartó
  });

  it('una respuesta incorrecta baja la precisión por debajo de la puerta', async () => {
    const wrong: ExtractionOutput = { ...GOOD, fields: [{ ...GOOD.fields[0]!, value: '9' }] };
    const r = await runEval(deps([ok(wrong)]).d, [kase('a')]);
    expect(r.aggregate.passesGate).toBe(false);
  });

  it('si el modelo falla en una ficha se anota y se sigue; su coste cuenta', async () => {
    const r = await runEval(deps([err('budget'), ok(GOOD)]).d, [kase('a'), kase('b')]);
    expect(r.skipped).toEqual([{ id: 'a', reason: 'budget' }]);
    expect(r.aggregate.entries).toBe(1);
  });

  it('para al llegar al tope de gasto y lo dice; no hace más llamadas', async () => {
    const { d, run } = deps([ok(GOOD, 0.6)], 1);
    const r = await runEval(d, [kase('a'), kase('b'), kase('c'), kase('d')]);
    expect(run).toHaveBeenCalledTimes(2); // 0,6 + 0,6 ≥ 1
    expect(r.stoppedByBudget).toBe(true);
    expect(r.aggregate.entries).toBe(2);
  });

  it('al modelo le llega el texto de la instantánea sin nombres de personas', async () => {
    const c = kase('a');
    c.snapshot.pages[0]!.text += '\nAtiende la Dra. María López';
    const { d, run } = deps([ok(GOOD)]);
    await runEval(d, [c]);
    expect(JSON.stringify(run.mock.calls[0]?.[1])).not.toContain('María López');
  });
});
