// Punto de entrada para el panel web (Next/webpack): solo la lógica de revisión y segmentos. No incluye migraciones ni utilidades de
// pruebas, que dependen del sistema de archivos y no se pueden empaquetar.
export {
  listQueue, getCard, exportApprovedCsv, reviewProspect, correctField, addContactPoint, MANUAL_CONTACT_TYPES, bulkApprove, REVIEWABLE,
  type Card, type QueueItem, type Reviewer, type ReviewInput, type ReviewResult, type CorrectInput, type CorrectResult, type AddContactInput, type AddContactResult, type ManualContactType, type BulkResult,
} from './review.js';
export { approveSegment, retireSegment, editSegment, type Actor as SegmentActor, type SegmentPatch } from './segments.js';
export {
  createResearchJob, pauseJob, resumeJob, cancelJob, getProgress, listResearchJobs, getWorkerHeartbeat, MAX_BATCH, type JobSummary, type Heartbeat,
} from './research.js';
export { enrichBacklog, requestWork, listRequests, type EnrichBacklog, type RequestRow } from './worker-queue.js';
export { listTerritories, type TerritoryRow } from './territories.js';
export { submitDemoRequest, type SubmitInput, type SubmitResult } from './demo-request.js';
export { currentConsentTexts, createConsentTextDraft, approveConsentText, listConsentTexts, CONSENT_BOXES, type ConsentBox, type ConsentTextRow, type CurrentTexts, type ConsentTextListing } from './consent-texts.js';
export { resolvePublicToken, type ResolvedToken } from './tokens.js';
export { checkFormRate } from './form-limits.js';
export { landingSegment, landingFacts, type LandingSegment, type LandingFacts } from './landing.js';
export { unsubscribeByToken, type UnsubscribeResult, type UnsubscribeScope } from './unsubscribe.js';
export { moveDeal, loseDeal, winDeal, assignDeal, type DealActor, type DealResult, type DealFail } from './deal-actions.js';
export { listDeals, dealTotals, type DealFilters, type DealRow, type StageTotal } from './deal-list.js';
