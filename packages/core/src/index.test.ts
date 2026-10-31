import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@turnosala/core', () => {
  it('se carga y se identifica', () => {
    expect(PACKAGE_NAME).toBe('@turnosala/core');
  });
});
