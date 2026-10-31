import type { LlmRequest, LlmResult } from '@turnosala/ai';
import type { CrawlOptions, CrawlResult } from '@turnosala/connectors';
import { DEFAULT_SCORING_MODEL, EXTRACTOR_VERSION, extractionOutputSchema, prepareExtraction, verifyExtraction, type ExtractionOutput } from '@turnosala/core';
import { saveEnrichment } from '@turnosala/db';
import type pg from 'pg';

// Enriquecimiento de una ficha (REQ-ENR-01..03): rastrear → minimizar datos personales → modelo (solo extrae) → verificar en código → guardar.

export interface EnrichDeps {
  pool: pg.Pool;
  gateway: { run<T>(route: 'enrich.extract', req: LlmRequest<T>): Promise<LlmResult<T>> };
  crawl(url: string, opts: CrawlOptions): Promise<CrawlResult>;
  userAgent: string;
  now?: (() => Date) | undefined;
}

export type EnrichOutcome =
  | { status: 'enriched'; accepted: number; hallucinationRejected: number; personalEmailsDiscarded: number; costEur: number; pages: number; saved: { evidences: number; contactPoints: number; score: number; tier: string } }
  | { status: 'not_found' | 'not_enrichable' | 'no_website' }
  | { status: 'no_pages'; robots: CrawlResult['robots']; skipped: CrawlResult['skipped'] }
  | { status: 'llm_failed'; reason: string | undefined; costEur: number };

interface ProspectRow {
  status: string;
  website: string | null;
}

async function load(pool: pg.Pool, id: string): Promise<ProspectRow | undefined> {
  return (await pool.query('select status, website from prospects where id = $1', [id])).rows[0] as ProspectRow | undefined;
}

export async function enrichProspect(deps: EnrichDeps, prospectId: string): Promise<EnrichOutcome> {
  const p = await load(deps.pool, prospectId);
  if (!p) return { status: 'not_found' };
  if (['blocked', 'archived', 'discarded'].includes(p.status)) return { status: 'not_enrichable' };
  if (!p.website) return { status: 'no_website' };

  const crawled = await deps.crawl(p.website, { userAgent: deps.userAgent });
  if (crawled.pages.length === 0) return { status: 'no_pages', robots: crawled.robots, skipped: crawled.skipped };

  const vocabulary = Object.keys(DEFAULT_SCORING_MODEL.signals);
  const prepared = prepareExtraction(crawled.pages, vocabulary);
  const res = await deps.gateway.run<ExtractionOutput>('enrich.extract', {
    system: prepared.request.system, messages: prepared.request.messages, schema: { name: 'ficha_empresa', zod: extractionOutputSchema },
  });
  if (res.status !== 'ok' || !res.data) return { status: 'llm_failed', reason: res.reason ?? res.status, costEur: res.usage.costEur };

  const verified = verifyExtraction(res.data, prepared.pages, { signalVocabulary: vocabulary });
  const fetchedAt = (deps.now ?? (() => new Date()))();
  const saved = await saveEnrichment(deps.pool, prospectId, verified, { fetchedAt, extractorVersion: EXTRACTOR_VERSION });
  if (!saved.saved) return { status: saved.reason };
  return {
    status: 'enriched', accepted: verified.metrics.accepted, hallucinationRejected: verified.metrics.hallucinationRejected,
    personalEmailsDiscarded: verified.metrics.personalEmailsDiscarded, costEur: res.usage.costEur, pages: crawled.pages.length,
    saved: { evidences: saved.evidences, contactPoints: saved.contactPoints, score: saved.score, tier: saved.tier },
  };
}
