export const PACKAGE_NAME = '@turnosala/db';
export { uuidv7 } from './uuid.js';
export { migrate, MIGRATIONS_DIR } from './migrate.js';
export { bootstrapDatabase, ensureExtensions } from './bootstrap.js';
export { consentInputSchema, insertConsent, type ConsentInput } from './consents.js';
export { approveProductFacts, approveProductFactsByEmail, type ApproveFactsInput, type ApproveByEmailInput, type ApproveByEmailResult } from './product-facts.js';
export { check, type CheckOptions } from './compliance-check.js';
export { loadContext, budgetProviderFor, type Db } from './compliance-context.js';
export { createTestDb, dropDatabase, adminUrl, urlFor, TEST_APP_PW, TEST_MIGRATOR_PW, type TestDb } from './testing.js'; // solo para pruebas
export { applyOpposition, type OppositionInput, type OppositionResult } from './opposition.js';
export { seedProductFactsDraft, PRODUCT_FACTS_V1_PATH } from './seed-product-facts.js';
export { ingestCandidate, type IngestCandidate, type IngestResult } from './ingest.js';
export { importTurnosalaCustomers, type CustomerImportResult } from './customers.js';
export { parseCsv } from './csv.js';
export { annotateVerification, type VerificationResults } from './verification.js';
export { saveEnrichment, type SaveEnrichmentOptions, type SaveEnrichmentResult } from './enrichment.js';
export {
  createResearchJob, claimTask, finishTask, failTask, pauseJob, resumeJob, cancelJob, getProgress, MAX_BATCH, MAX_ATTEMPTS,
  type CreateJobInput, type ClaimOptions, type ClaimedTask, type FinishInfo, type Progress,
} from './research.js';
export { saveSegmentDrafts, approveSegment, editSegment, retireSegment, type Actor as SegmentActor, type SegmentPatch } from './segments.js';
export { importTerritories, listTerritories, saveSizing, type TerritoryImportResult, type TerritoryRow, type SaveSizingInput } from './territories.js';
export {
  listQueue, getCard, exportApprovedCsv, reviewProspect, correctField, bulkApprove, REVIEWABLE,
  type Card, type QueueItem, type Reviewer, type ReviewInput, type ReviewResult, type CorrectInput, type CorrectResult, type BulkResult,
} from './review.js';
