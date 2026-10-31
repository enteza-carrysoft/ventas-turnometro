import { adminUrl, dropDatabase } from '@turnosala/db';
import { E2E_DB } from '../../playwright.config.js';

export default async function globalTeardown(): Promise<void> {
  await dropDatabase(adminUrl(), E2E_DB);
}
