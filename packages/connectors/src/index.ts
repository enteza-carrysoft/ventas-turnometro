export const PACKAGE_NAME = '@turnosala/connectors';
export { crawlSite, extractVisible, sameSite, type CrawlOptions, type CrawlResult, type CrawledPage, type Skipped, type Category } from './crawler/crawler.js';
export { createHttpProbe, createMxResolver, type HttpProbeOptions } from './crawler/probes.js';
export { createOsmAdapter, OSM_ATTRIBUTION, type OsmOptions, type OverpassResponse } from './sources/osm.js';
export { createMemoryCache, type QueryCache } from './sources/cache.js';
export { withRetry, SourceError, MAX_ATTEMPTS as SOURCE_MAX_ATTEMPTS, type SourceErrorKind } from './sources/retry.js';
export { isVetoedUrl, VETOED_DOMAINS } from './sources/veto.js';
export type { SourceAdapter, SourceCandidate, SourceEvidence, SourceRequest, SourceResult } from './sources/types.js';
