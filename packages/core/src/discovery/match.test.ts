import { describe, expect, it } from 'vitest';
import { matchBusiness } from './match.js';

const PAGE = `Clínica Dental Sol Sevilla
Calle Sierpes 12, 41004 Sevilla
Teléfono: 954 12 34 56
Urgencias: +34 600 11 22 33
Abierto de lunes a viernes`;

const biz = (over: Partial<Parameters<typeof matchBusiness>[1]> = {}) => ({ name: 'Clínica Dental Sol, S.L.', municipality: 'Sevilla', phones: [] as string[], ...over });

describe('matchBusiness: ¿esta web es la del negocio? (decide el código, no el modelo)', () => {
  it('coincide por teléfono, con cualquier formato de escritura, y cita la línea literal', () => {
    for (const phone of ['+34954123456', '954123456', '+34 954 12 34 56']) {
      const r = matchBusiness(PAGE, biz({ phones: [phone], name: 'Otro nombre distinto' }));
      expect(r).toEqual({ matched: true, by: 'phone', quote: 'Teléfono: 954 12 34 56' });
    }
  });

  it('coincide por nombre + localidad si no hay teléfono; ignora forma jurídica, mayúsculas y acentos', () => {
    const r = matchBusiness(PAGE, biz({ name: 'CLINICA DENTAL SOL SL' }));
    expect(r).toEqual({ matched: true, by: 'name_and_place', quote: 'Clínica Dental Sol Sevilla' });
  });

  it('el nombre sin la localidad NO basta (podría ser otra sede, otra ciudad o una homónima)', () => {
    expect(matchBusiness('Clínica Dental Sol\nMadrid, Gran Vía 1', biz()).matched).toBe(false);
  });

  it('la localidad sin el nombre NO basta, ni un nombre incompleto', () => {
    expect(matchBusiness('Dentistas en Sevilla\nClínica Luna', biz()).matched).toBe(false);
    expect(matchBusiness('Clínica Dental Sevilla', biz()).matched).toBe(false); // falta «Sol»
  });

  it('un teléfono que solo aparece dentro de un número más largo no cuenta', () => {
    // con un dígito antes, con un dígito después, y con las dos cosas: ninguno es el teléfono 954 123 456
    for (const text of ['Ref. 99541234567', 'Ref. 19541234560', 'Ref. 9541234567', 'Ref. 954123456789', 'Ref. 1954123456', 'Ref. 8954123456']) {
      expect(matchBusiness(text, biz({ phones: ['954123456'], name: 'Zzz Qqq' })).matched, text).toBe(false);
    }
  });

  it('un teléfono distinto no coincide', () => {
    expect(matchBusiness(PAGE, biz({ phones: ['955999999'], name: 'Zzz Qqq' })).matched).toBe(false);
  });

  it('el teléfono tiene prioridad sobre el nombre', () => {
    expect(matchBusiness(PAGE, biz({ phones: ['954123456'] })).by).toBe('phone');
  });

  it('palabras de enlace y de una letra no cuentan como nombre distintivo', () => {
    // «La Clínica de la Y» → solo «clinica» es distintivo, y por sí solo es demasiado genérico
    expect(matchBusiness('Clínica en Sevilla, calle Mayor', biz({ name: 'La Clínica de la Y' })).matched).toBe(false);
  });

  it('un nombre de una sola palabra distintiva y larga sí puede coincidir con la localidad', () => {
    expect(matchBusiness('Bienvenido a VisionLab\nSevilla', biz({ name: 'VisionLab' }))).toMatchObject({ matched: true, by: 'name_and_place', quote: 'Bienvenido a VisionLab' });
  });

  it('sin nombre utilizable, sin localidad y sin teléfonos: nunca coincide', () => {
    expect(matchBusiness(PAGE, { name: '', municipality: 'Sevilla', phones: [] }).matched).toBe(false);
    expect(matchBusiness(PAGE, { name: 'Clínica Dental Sol', municipality: null, phones: [] }).matched).toBe(false);
    expect(matchBusiness('', biz({ phones: ['954123456'] })).matched).toBe(false);
  });

  it('la cita es literal (está en la página) y no pasa de 300 caracteres', () => {
    const long = `Clínica Dental Sol Sevilla ${'x'.repeat(500)}`;
    const r = matchBusiness(long, biz());
    expect(r.quote!.length).toBeLessThanOrEqual(300);
    expect(long).toContain(r.quote!);
  });

  it('palabras como parte de otra no cuentan (“sol” dentro de “solución”)', () => {
    expect(matchBusiness('Clínica Dental Solución Sevilla', biz()).matched).toBe(false);
  });
});
