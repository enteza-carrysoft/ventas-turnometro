import { describe, expect, it } from 'vitest';
import { maskEmail, maskPhone } from './mask.js';

describe('enmascarado de destinos', () => {
  it('el correo conserva la inicial y el dominio, y nunca el resto del usuario', () => {
    expect(maskEmail('rosa.garcia@clinica.es')).toBe('r***@clinica.es');
    expect(maskEmail('rosa.garcia@clinica.es')).not.toContain('garcia');
    expect(maskEmail('a@b.es')).toBe('a***@b.es');
  });

  it('el teléfono conserva el prefijo y las dos últimas cifras', () => {
    expect(maskPhone('+34955123456')).toBe('+34*****56');
    expect(maskPhone('+34955123456')).not.toContain('12345');
  });
});
