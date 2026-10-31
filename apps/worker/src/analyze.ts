import type { LlmRequest, LlmResult } from '@turnosala/ai';
import type { CrawlOptions, CrawlResult } from '@turnosala/connectors';
import { DEFAULT_SCORING_MODEL, marketAnalysisSchema, prepareMarketAnalysis, verifySegments, type MarketAnalysis, type SegmentRejection } from '@turnosala/core';
import { saveSegmentDrafts } from '@turnosala/db';
import type pg from 'pg';

// market.analyze (REQ-MKT-02): web del producto + hechos aprobados → segmentos ICP en borrador. El modelo propone; el código verifica las fuentes.

export interface AnalyzeDeps {
  pool: pg.Pool;
  gateway: { run<T>(route: 'market.analyze', req: LlmRequest<T>): Promise<LlmResult<T>> };
  crawl(url: string, opts: CrawlOptions): Promise<CrawlResult>;
  userAgent: string;
  actor: string;
}

export type AnalyzeOutcome =
  | { status: 'analyzed'; created: number; updated: number; kept: number; rejected: SegmentRejection[]; droppedSignals: string[]; costEur: number }
  | { status: 'not_found' | 'no_approved_facts' | 'no_pages' }
  | { status: 'llm_failed'; reason: string | undefined; costEur: number };

export async function analyzeMarket(deps: AnalyzeDeps, productId: string): Promise<AnalyzeOutcome> {
  const product = (await deps.pool.query('select website from products where id = $1', [productId])).rows[0] as { website: string } | undefined;
  if (!product) return { status: 'not_found' };
  const facts = (await deps.pool.query(`select facts from product_facts where product_id = $1 and status = 'approved'`, [productId])).rows[0] as { facts: unknown } | undefined;
  if (!facts) return { status: 'no_approved_facts' };

  const crawled = await deps.crawl(product.website, { userAgent: deps.userAgent });
  if (crawled.pages.length === 0) return { status: 'no_pages' };

  const vocabulary = Object.keys(DEFAULT_SCORING_MODEL.signals);
  const prepared = prepareMarketAnalysis(crawled.pages, facts.facts, vocabulary);
  const res = await deps.gateway.run<MarketAnalysis>('market.analyze', {
    system: prepared.request.system, messages: prepared.request.messages, schema: { name: 'segmentos_icp', zod: marketAnalysisSchema },
  });
  if (res.status !== 'ok' || !res.data) return { status: 'llm_failed', reason: res.reason ?? res.status, costEur: res.usage.costEur };

  const verified = verifySegments(res.data, { crawledUrls: prepared.pages.flatMap((p) => [p.url, p.finalUrl]), signalVocabulary: vocabulary });
  const saved = await saveSegmentDrafts(deps.pool, productId, verified.accepted, { actor: deps.actor });
  return { status: 'analyzed', ...saved, rejected: verified.rejected, droppedSignals: verified.droppedSignals, costEur: res.usage.costEur };
}
