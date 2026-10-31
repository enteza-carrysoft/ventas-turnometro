import type { LlmRequest, LlmResult, RouteId } from '@turnosala/ai';
import {
  aggregate, DEFAULT_SCORING_MODEL, extractionOutputSchema, prepareExtraction, scoreEntry, verifyExtraction,
  type Aggregate, type EntryScore, type ExtractionOutput, type GoldenEntry,
} from '@turnosala/core';

// Evaluación de la extracción contra el conjunto dorado (F1.10). Usa el mismo camino que producción (minimización → modelo → verificación
// en código) sobre instantáneas congeladas de las webs, para que la anotación humana y el modelo vean exactamente el mismo texto.

export interface Snapshot {
  id: string;
  website: string;
  takenAt: string;
  pages: Array<{ url: string; finalUrl: string; text: string; links: string[] }>;
}
export interface EvalCase {
  golden: GoldenEntry;
  snapshot: Snapshot;
}
export interface EvalDeps {
  gateway: { run<T>(route: RouteId, req: LlmRequest<T>): Promise<LlmResult<T>> };
  route: RouteId;
  /** tope de gasto de la ejecución: al alcanzarlo se para (no se hacen más llamadas) */
  maxEur: number;
  onProgress?: ((line: string) => void) | undefined;
}
export interface EvalReport {
  scores: EntryScore[];
  aggregate: Aggregate;
  skipped: Array<{ id: string; reason: string }>;
  stoppedByBudget: boolean;
}

export async function runEval(deps: EvalDeps, cases: readonly EvalCase[]): Promise<EvalReport> {
  const vocabulary = Object.keys(DEFAULT_SCORING_MODEL.signals);
  const scores: EntryScore[] = [];
  const skipped: EvalReport['skipped'] = [];
  let spent = 0;
  let stoppedByBudget = false;
  for (const c of cases) {
    if (spent >= deps.maxEur) { stoppedByBudget = true; break; }
    const prepared = prepareExtraction(c.snapshot.pages, vocabulary);
    const res = await deps.gateway.run<ExtractionOutput>(deps.route, {
      system: prepared.request.system, messages: prepared.request.messages, schema: { name: 'ficha_empresa', zod: extractionOutputSchema },
    });
    spent += res.usage.costEur;
    if (res.status !== 'ok' || !res.data) {
      skipped.push({ id: c.golden.id, reason: res.reason ?? res.status });
      deps.onProgress?.(`${c.golden.id}: omitida (${res.reason ?? res.status})`);
      continue;
    }
    scores.push(scoreEntry(c.golden, verifyExtraction(res.data, prepared.pages, { signalVocabulary: vocabulary }), res.usage.costEur));
    deps.onProgress?.(`${c.golden.id}: hecha (${spent.toFixed(2)} € acumulados)`);
  }
  return { scores, aggregate: aggregate(scores), skipped, stoppedByBudget };
}
