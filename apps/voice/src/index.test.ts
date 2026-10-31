import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@turnosala/voice', () => {
  it('se carga y se identifica', () => {
    expect(PACKAGE_NAME).toBe('@turnosala/voice');
  });
});
