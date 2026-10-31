import { z } from 'zod';

// Puntuación de encaje 0–100 (REQ-SCO-01). El LLM solo extrae SEÑALES; el número lo calcula este código, que es
// determinista y reproducible. Criterios y pesos: docs de ventas de TurnoSala §4 («Puntuación de oportunidades»).

export const CRITERIA = [
  'simultaneous_attention', 'flow', 'public_pain', 'easy_adoption', 'coverage', 'identifiable_decision_maker', 'inbound_interest',
] as const;
export type Criterion = (typeof CRITERIA)[number];

const CRITERION_LABEL: Record<Criterion, string> = {
  simultaneous_attention: 'atención presencial simultánea', flow: 'flujo de clientes', public_pain: 'dolor declarado públicamente',
  easy_adoption: 'implantación sencilla', coverage: 'cobertura y ubicación', identifiable_decision_maker: 'decisión local por cargo', inbound_interest: 'interés entrante',
};

export type Tier = 'hot' | 'warm' | 'nurture';
export const HOT_MIN = 75;
export const WARM_MIN = 50;

export const scoringModelSchema = z
  .object({
    version: z.number().int().positive(),
    weights: z.object(Object.fromEntries(CRITERIA.map((c) => [c, z.number().nonnegative()])) as Record<Criterion, z.ZodNumber>),
    /** señal → criterio al que aporta y fuerza (0–1) de la evidencia */
    signals: z.record(z.string(), z.object({ criterion: z.enum(CRITERIA), strength: z.number().min(0).max(1) })),
  })
  .refine((m) => Math.abs(Object.values(m.weights).reduce((a, b) => a + b, 0) - 100) < 1e-9, { message: 'los pesos deben sumar 100' });
export type ScoringModel = z.infer<typeof scoringModelSchema>;

/** Modelo v1 (pesos por defecto del §4). El modelo de cada segmento puede cambiar pesos y señales con una versión nueva. */
export const DEFAULT_SCORING_MODEL: ScoringModel = {
  version: 1,
  weights: { simultaneous_attention: 25, flow: 20, public_pain: 15, easy_adoption: 15, coverage: 10, identifiable_decision_maker: 10, inbound_interest: 5 },
  signals: {
    varias_consultas: { criterion: 'simultaneous_attention', strength: 1 },
    varios_mostradores: { criterion: 'simultaneous_attention', strength: 1 },
    varios_profesionales: { criterion: 'simultaneous_attention', strength: 0.7 },
    sala_espera_amplia: { criterion: 'flow', strength: 1 },
    sala_espera: { criterion: 'flow', strength: 0.8 },
    varias_especialidades: { criterion: 'flow', strength: 0.7 },
    cita_previa_online: { criterion: 'flow', strength: 0.6 },
    espera_declarada: { criterion: 'public_pain', strength: 1 },
    recepcion_compleja: { criterion: 'public_pain', strength: 0.7 },
    tv_en_sala: { criterion: 'easy_adoption', strength: 1 },
    wifi_o_app_movil: { criterion: 'easy_adoption', strength: 0.6 },
    ubicacion_en_territorio: { criterion: 'coverage', strength: 1 },
    varias_sedes: { criterion: 'coverage', strength: 0.7 },
    cargo_gerencia_visible: { criterion: 'identifiable_decision_maker', strength: 1 },
    inbound_interest: { criterion: 'inbound_interest', strength: 1 },
  },
};

export interface ScoredSignal {
  key: string;
  /** URL de la evidencia que respalda la señal */
  sourceUrl: string;
}
export interface CriterionBreakdown {
  weight: number;
  /** fuerza de la mejor señal del criterio (0–1) */
  value: number;
  points: number;
  signals: string[];
}
export interface ScoreResult {
  score: number;
  tier: Tier;
  modelVersion: number;
  breakdown: Record<Criterion, CriterionBreakdown>;
  ignoredSignals: string[];
  /** como mucho 2 líneas, con las URL de las evidencias que más puntúan */
  reasoning: string;
}

const round9 = (n: number): number => Math.round(n * 1e9) / 1e9;
const tierOf = (score: number): Tier => (score >= HOT_MIN ? 'hot' : score >= WARM_MIN ? 'warm' : 'nurture');

function buildReasoning(score: number, tier: Tier, breakdown: Record<Criterion, CriterionBreakdown>, urls: Map<string, string>, model: ScoringModel): string {
  const withPoints = CRITERIA.filter((c) => breakdown[c].points > 0).sort((a, b) => breakdown[b].points - breakdown[a].points || a.localeCompare(b));
  const top = withPoints.slice(0, 3).map((c) => {
    const key = [...breakdown[c].signals].sort((a, b) => (model.signals[b]?.strength ?? 0) - (model.signals[a]?.strength ?? 0) || a.localeCompare(b))[0] as string;
    return `${key.replace(/_/g, ' ')} (${urls.get(key)})`;
  });
  const line1 = top.length ? `Encaje ${score}/100 (${tier}): ${top.join('; ')}.` : `Encaje ${score}/100 (${tier}): sin señales con evidencia.`;
  const missing = CRITERIA.filter((c) => breakdown[c].points === 0).map((c) => CRITERION_LABEL[c]);
  return missing.length && top.length ? `${line1}\nSin evidencia de: ${missing.join(', ')}.` : line1;
}

/**
 * Puntúa una ficha. Por criterio cuenta SOLO la señal más fuerte (no se suman señales del mismo criterio) y cada señal una
 * vez. Las señales que el modelo no conoce se ignoran y se devuelven en `ignoredSignals`.
 */
export function scoreProspect(signals: readonly ScoredSignal[], rawModel: ScoringModel): ScoreResult {
  const model = scoringModelSchema.parse(rawModel);
  const urls = new Map<string, string>(); // la URL menor (orden alfabético) de cada señal, para que el resultado no dependa del orden
  for (const s of signals) {
    const cur = urls.get(s.key);
    if (cur === undefined || s.sourceUrl < cur) urls.set(s.key, s.sourceUrl);
  }
  const breakdown = Object.fromEntries(CRITERIA.map((c) => [c, { weight: model.weights[c], value: 0, points: 0, signals: [] as string[] }])) as Record<Criterion, CriterionBreakdown>;
  const ignored: string[] = [];
  for (const key of [...urls.keys()].sort()) {
    const def = model.signals[key];
    if (!def) { ignored.push(key); continue; }
    const b = breakdown[def.criterion];
    b.signals.push(key);
    b.value = Math.max(b.value, def.strength);
  }
  let total = 0;
  for (const c of CRITERIA) {
    breakdown[c].points = round9(breakdown[c].weight * breakdown[c].value);
    total += breakdown[c].weight * breakdown[c].value;
  }
  const score = Math.round(round9(total));
  const tier = tierOf(score);
  return { score, tier, modelVersion: model.version, breakdown, ignoredSignals: ignored, reasoning: buildReasoning(score, tier, breakdown, urls, model) };
}
