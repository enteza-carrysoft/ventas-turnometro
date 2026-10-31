export const PACKAGE_NAME = '@turnosala/db';
export { uuidv7 } from './uuid.js';
export { migrate, MIGRATIONS_DIR } from './migrate.js';
export { bootstrapDatabase, ensureExtensions } from './bootstrap.js';
export { consentInputSchema, insertConsent, type ConsentInput } from './consents.js';
export { approveProductFacts, type ApproveFactsInput } from './product-facts.js';
export { check, type CheckOptions } from './compliance-check.js';
export { loadContext, budgetProviderFor, type Db } from './compliance-context.js';
export { createTestDb, type TestDb } from './testing.js'; // solo para pruebas
export { applyOpposition, type OppositionInput, type OppositionResult } from './opposition.js';
