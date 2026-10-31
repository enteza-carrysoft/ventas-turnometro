// Punto de entrada para el panel web (Next/webpack): solo la lógica de revisión y segmentos. No incluye migraciones ni utilidades de
// pruebas, que dependen del sistema de archivos y no se pueden empaquetar.
export {
  listQueue, getCard, exportApprovedCsv, reviewProspect, correctField, bulkApprove, REVIEWABLE,
  type Card, type QueueItem, type Reviewer, type ReviewInput, type ReviewResult, type CorrectInput, type CorrectResult, type BulkResult,
} from './review.js';
export { approveSegment, retireSegment, editSegment, type Actor as SegmentActor, type SegmentPatch } from './segments.js';
