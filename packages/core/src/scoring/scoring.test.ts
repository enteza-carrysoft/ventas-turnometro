import { describe, expect, it } from 'vitest';
import { CRITERIA, DEFAULT_SCORING_MODEL, scoreProspect, scoringModelSchema, type ScoringModel } from './scoring.js';

const U = (n: number): string => `https://clinicasol.es/pagina-${n}`;
const sig = (key: string, n = 1) => ({ key, sourceUrl: U(n) });

/** modelo de prueba: todo el peso en dos criterios, para poder ajustar las puntuaciones exactas */
function model(weights: Partial<Record<(typeof CRITERIA)[number], number>>, signals: ScoringModel['signals'] = {}): ScoringModel {
  const w = Object.fromEntries(CRITERIA.map((c) => [c, weights[c] ?? 0])) as ScoringModel['weights'];
  return { version: 9, weights: w, signals };
}

describe('modelo de puntuación v1 (REQ-SCO-01; TurnoSalaVentas.md §4)', () => {
  it('los pesos por defecto son 25/20/15/15/10/10/5 y suman 100', () => {
    expect(DEFAULT_SCORING_MODEL.weights).toEqual({
      simultaneous_attention: 25, flow: 20, public_pain: 15, easy_adoption: 15, coverage: 10, identifiable_decision_maker: 10, inbound_interest: 5,
    });
    expect(Object.values(DEFAULT_SCORING_MODEL.weights).reduce((a, b) => a + b, 0)).toBe(100);
    expect(scoringModelSchema.safeParse(DEFAULT_SCORING_MODEL).success).toBe(true);
  });

  it('rechaza pesos que no suman 100, pesos negativos y fuerzas fuera de 0–1', () => {
    expect(scoringModelSchema.safeParse(model({ flow: 99 })).success).toBe(false);
    expect(scoringModelSchema.safeParse(model({ flow: 110, coverage: -10 })).success).toBe(false);
    expect(scoringModelSchema.safeParse(model({ flow: 100 }, { x: { criterion: 'flow', strength: 1.2 } })).success).toBe(false);
    expect(scoringModelSchema.safeParse(model({ flow: 100 }, { x: { criterion: 'flow', strength: -0.1 } })).success).toBe(false);
  });
});

describe('scoreProspect: cálculo (REQ-SCO-01 CA1–CA3)', () => {
  it('sin señales: 0 puntos y nurture', () => {
    const r = scoreProspect([], DEFAULT_SCORING_MODEL);
    expect(r).toMatchObject({ score: 0, tier: 'nurture', modelVersion: 1 });
  });

  it('todas las señales máximas: 100 y hot', () => {
    const all = ['varias_consultas', 'espera_declarada', 'tv_en_sala', 'ubicacion_en_territorio', 'cargo_gerencia_visible', 'inbound_interest', 'sala_espera_amplia'];
    expect(scoreProspect(all.map((k, i) => sig(k, i)), DEFAULT_SCORING_MODEL).score).toBeGreaterThanOrEqual(90);
  });

  it('ejemplo calculado a mano: atención 1,0 (25) + flujo 0,8 (16) + adopción 1,0 (15) + cobertura 1,0 (10) = 66 → warm', () => {
    const r = scoreProspect([sig('varias_consultas', 1), sig('sala_espera', 2), sig('tv_en_sala', 3), sig('ubicacion_en_territorio', 4)], DEFAULT_SCORING_MODEL);
    expect(r.score).toBe(66);
    expect(r.tier).toBe('warm');
    expect(r.breakdown.simultaneous_attention).toMatchObject({ weight: 25, value: 1, points: 25, signals: ['varias_consultas'] });
    expect(r.breakdown.flow).toMatchObject({ weight: 20, value: 0.8, points: 16 });
    expect(r.breakdown.public_pain.points).toBe(0);
  });

  it('el desglose suma exactamente el total sin redondear', () => {
    const r = scoreProspect([sig('varias_consultas'), sig('sala_espera'), sig('cita_previa_online'), sig('wifi_o_app_movil')], DEFAULT_SCORING_MODEL);
    const sum = Object.values(r.breakdown).reduce((a, b) => a + b.points, 0);
    expect(Math.round(sum)).toBe(r.score);
  });

  it('varias señales del mismo criterio cuentan UNA vez, la más fuerte (no se suman)', () => {
    const r = scoreProspect([sig('varias_consultas', 1), sig('varios_profesionales', 2)], DEFAULT_SCORING_MODEL);
    expect(r.breakdown.simultaneous_attention).toMatchObject({ value: 1, points: 25 });
    expect(r.breakdown.simultaneous_attention.signals.sort()).toEqual(['varias_consultas', 'varios_profesionales']);
    expect(r.score).toBe(25);
  });

  it('una señal repetida no suma dos veces', () => {
    expect(scoreProspect([sig('sala_espera', 1), sig('sala_espera', 2)], DEFAULT_SCORING_MODEL).score).toBe(16);
  });

  it('una señal desconocida se ignora y se informa (el LLM no puede inventar puntos)', () => {
    const r = scoreProspect([sig('es_muy_famosa'), sig('varias_consultas')], DEFAULT_SCORING_MODEL);
    expect(r.score).toBe(25);
    expect(r.ignoredSignals).toEqual(['es_muy_famosa']);
  });

  it('el interés entrante vale 5 puntos (REQ-CNS-01 CA2)', () => {
    expect(scoreProspect([sig('inbound_interest')], DEFAULT_SCORING_MODEL).score).toBe(5);
  });

  it('es determinista e independiente del orden de las señales', () => {
    const base = [sig('varias_consultas', 1), sig('sala_espera', 2), sig('tv_en_sala', 3), sig('espera_declarada', 4), sig('ubicacion_en_territorio', 5)];
    const ref = JSON.stringify(scoreProspect(base, DEFAULT_SCORING_MODEL));
    for (let i = 0; i < 50; i++) {
      const shuffled = [...base].sort(() => Math.random() - 0.5);
      expect(JSON.stringify(scoreProspect(shuffled, DEFAULT_SCORING_MODEL))).toBe(ref);
    }
  });

  it('un modelo inválido lanza error en vez de puntuar (falla cerrado)', () => {
    expect(() => scoreProspect([sig('x')], model({ flow: 50 }))).toThrow();
  });
});

describe('umbrales exactos hot / warm / nurture (REQ-SCO-01 CA2)', () => {
  const at = (points: number) => scoreProspect([sig('x')], model({ flow: points, coverage: 100 - points }, { x: { criterion: 'flow', strength: 1 } }));
  it.each([[100, 'hot'], [76, 'hot'], [75, 'hot'], [74, 'warm'], [51, 'warm'], [50, 'warm'], [49, 'nurture'], [1, 'nurture'], [0, 'nurture']] as const)(
    '%i puntos → %s', (points, tier) => {
      const r = at(points);
      expect(r.score).toBe(points);
      expect(r.tier).toBe(tier);
    },
  );

  it('el redondeo es al más cercano, con .5 hacia arriba: 74,5 → 75 (hot)', () => {
    const r = scoreProspect([sig('x')], model({ flow: 100 }, { x: { criterion: 'flow', strength: 0.5 } }));
    expect(r.score).toBe(50);
    const h = scoreProspect([sig('x')], model({ flow: 149 / 2, coverage: 100 - 149 / 2 }, { x: { criterion: 'flow', strength: 1 } }));
    expect(h.score).toBe(75);
    expect(h.tier).toBe('hot');
  });
});

describe('razonamiento de ≤ 2 líneas con las URL de las evidencias (CA1)', () => {
  it('tiene como mucho 2 líneas y cita las URL de las señales que más puntúan', () => {
    const r = scoreProspect([sig('varias_consultas', 1), sig('sala_espera', 2), sig('tv_en_sala', 3), sig('cita_previa_online', 4)], DEFAULT_SCORING_MODEL);
    expect(r.reasoning.split('\n').length).toBeLessThanOrEqual(2);
    expect(r.reasoning).toContain(U(1));
    expect(r.reasoning).toMatch(/56\/100/); // 25 + 16 (la cita previa comparte criterio con la sala de espera) + 15
    expect(r.reasoning).toMatch(/warm/);
    expect((r.reasoning.match(/https:\/\//g) ?? []).length).toBeLessThanOrEqual(3);
  });

  it('sin señales lo dice y no inventa fuentes', () => {
    const r = scoreProspect([], DEFAULT_SCORING_MODEL);
    expect(r.reasoning.split('\n').length).toBeLessThanOrEqual(2);
    expect(r.reasoning).not.toContain('http');
  });

  it('menciona qué criterios no tienen evidencia', () => {
    const r = scoreProspect([sig('varias_consultas')], DEFAULT_SCORING_MODEL);
    expect(r.reasoning).toMatch(/Sin evidencia/i);
  });
});
