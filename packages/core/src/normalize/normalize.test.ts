import { describe, expect, it } from 'vitest';
import {
  detectLegalForm, matchMunicipality, normalizeAddress, normalizeName, normalizePhone, postalCodeOf, registrableDomain, trigramSimilarity,
  type Territory,
} from './normalize.js';

describe('normalizePhone → E.164 (REQ-VER-01)', () => {
  it.each([
    ['954 12 34 56', '+34954123456', 'fixed'],
    ['954123456', '+34954123456', 'fixed'],
    ['+34 954 12 34 56', '+34954123456', 'fixed'],
    ['0034954123456', '+34954123456', 'fixed'],
    ['(954) 123-456', '+34954123456', 'fixed'],
    ['600 11 22 33', '+34600112233', 'mobile'],
  ] as const)('%s → %s (%s)', (raw, e164, kind) => {
    expect(normalizePhone(raw)).toEqual({ e164, valid: true, kind, notCallable: false });
  });

  it('un número inválido o vacío es no llamable y no se inventa', () => {
    for (const raw of ['12345', '', '   ', 'llamar a recepción', '954 12 34', '+34 5']) {
      const r = normalizePhone(raw);
      expect(r, raw).toMatchObject({ e164: null, valid: false, notCallable: true });
    }
  });

  it('un número válido que no es fijo ni móvil (902 coste compartido, 900 gratuito) es no llamable como centralita', () => {
    expect(normalizePhone('902 12 34 56')).toMatchObject({ e164: '+34902123456', valid: true, kind: 'other', notCallable: true });
    expect(normalizePhone('900 12 34 56')).toMatchObject({ kind: 'other', notCallable: true });
  });

  it('un número extranjero válido se conserva con su prefijo', () => {
    expect(normalizePhone('+44 20 7946 0958')).toMatchObject({ e164: '+442079460958', valid: true, notCallable: false });
  });
});

describe('registrableDomain (REQ-VER-01)', () => {
  it.each([
    ['https://www.ClinicaSol.es/contacto?x=1', 'clinicasol.es'],
    ['clinicasol.es', 'clinicasol.es'],
    ['www.clinicasol.es', 'clinicasol.es'],
    ['http://citas.clinicasol.es:8080/x', 'clinicasol.es'],
    ['https://sub.empresa.co.uk', 'empresa.co.uk'],
    ['https://clinicasol.wixsite.com/inicio', 'clinicasol.wixsite.com'], // plataformas compartidas: el subdominio ES la empresa
  ])('%s → %s', (raw, expected) => expect(registrableDomain(raw)).toBe(expected));

  it('devuelve null para lo que no es un dominio de empresa: localhost, IP, vacío, y redes sociales/directorios compartidos', () => {
    for (const raw of ['http://localhost', 'http://192.168.1.1', '', '   ', 'no es una url', 'https://www.facebook.com/clinicasol', 'https://instagram.com/x', 'https://es.linkedin.com/company/x', 'https://goo.gl/maps/abc']) {
      expect(registrableDomain(raw), raw).toBeNull();
    }
  });
});

describe('normalizeName: sin tildes ni forma jurídica (REQ-VER-01)', () => {
  it.each([
    ['Clínica Dental Sol, S.L.', 'clinica dental sol'],
    ['POLICLÍNICA  Sevilla  Este S.L.U.', 'policlinica sevilla este'],
    ['Óptica Ruiz S.A.', 'optica ruiz'],
    ['"Fisio & Salud" C.B.', 'fisio salud'],
    ['Centro Médico Aljarafe S.L.P.', 'centro medico aljarafe'],
    ['Clínica SA Vicente', 'clinica sa vicente'], // «SA» en medio del nombre no es forma jurídica
    ['Ñandú Veterinaria', 'nandu veterinaria'],
  ])('%s → %s', (raw, expected) => expect(normalizeName(raw)).toBe(expected));
});

describe('normalizeAddress y código postal (REQ-VER-01)', () => {
  it.each([
    ['C/ Sierpes, nº 12, 2º B. 41004 Sevilla', 'calle sierpes 12 2 b 41004 sevilla'],
    ['Avda. de la Constitución, 5', 'avenida de la constitucion 5'],
    ['Pza. Nueva 3', 'plaza nueva 3'],
    ['Ctra. de Utrera km 4', 'carretera de utrera km 4'],
  ])('%s → %s', (raw, expected) => expect(normalizeAddress(raw)).toBe(expected));

  it('extrae el código postal español válido (01–52) y rechaza los que no lo son', () => {
    expect(postalCodeOf('Calle X 1, 41004 Sevilla')).toBe('41004');
    expect(postalCodeOf('Calle X 1, 00123 Nada')).toBeNull();
    expect(postalCodeOf('Calle X 1, 53000 Nada')).toBeNull();
    expect(postalCodeOf('sin código')).toBeNull();
  });
});

describe('matchMunicipality: nombre → código INE (REQ-VER-01)', () => {
  const T: Territory[] = [
    { ineCode: 'T0001', name: 'Sevilla', province: 'Sevilla' },
    { ineCode: 'T0002', name: 'Dos Hermanas', province: 'Sevilla' },
    { ineCode: 'T0003', name: 'Alcalá de Guadaíra', province: 'Sevilla' },
    { ineCode: 'T0004', name: 'San Fernando', province: 'Cádiz' },
    { ineCode: 'T0005', name: 'San Fernando', province: 'Madrid' },
  ];
  it('ignora tildes, mayúsculas y espacios', () => {
    expect(matchMunicipality('alcala de guadaira', T)).toBe('T0003');
    expect(matchMunicipality('  DOS  HERMANAS ', T)).toBe('T0002');
  });
  it('un nombre ambiguo entre provincias solo se resuelve con la provincia', () => {
    expect(matchMunicipality('San Fernando', T)).toBeNull();
    expect(matchMunicipality('San Fernando', T, 'Cádiz')).toBe('T0004');
  });
  it('un municipio desconocido devuelve null (no se inventa)', () => {
    expect(matchMunicipality('Atlantis', T)).toBeNull();
  });
});

describe('detectLegalForm con su explicación (REQ-VER-03)', () => {
  it.each([
    ['Clínica Dental Sol, S.L.', 'company'], ['Óptica Ruiz S.A.', 'company'], ['Centro Médico S.L.P.', 'company'], ['Fisio Norte S.L.U.', 'company'],
    ['Ayuntamiento de Utrera', 'public_body'], ['Consorcio Sanitario del Aljarafe', 'public_body'], ['Mancomunidad de Servicios', 'public_body'],
    ['Fisio & Salud C.B.', 'sole_trader'], ['Comunidad de bienes Taller Ruiz', 'sole_trader'],
  ] as const)('%s → %s', (name, form) => {
    const r = detectLegalForm(name);
    expect(r.legalForm).toBe(form);
    expect(r.explanation).toMatch(/.+/);
  });

  it('sin indicio claro es «unknown» (y se trata como autónomo a efectos de cumplimiento)', () => {
    for (const name of ['Clínica Dental Sol', 'Dr. Juan Pérez', 'Óptica Ruiz']) expect(detectLegalForm(name).legalForm).toBe('unknown');
  });
});

describe('trigramSimilarity (misma definición que pg_trgm)', () => {
  it('idénticos = 1; sin nada en común = 0; parecidos entre medias', () => {
    expect(trigramSimilarity('clinica sol', 'clinica sol')).toBe(1);
    expect(trigramSimilarity('abc', 'xyz')).toBe(0);
    const s = trigramSimilarity('clinica dental sol', 'clinica dental sol sevilla');
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(1);
  });
  it('es simétrica y no distingue mayúsculas', () => {
    expect(trigramSimilarity('Clinica Sol', 'clinica SOL')).toBe(1);
    expect(trigramSimilarity('optica ruiz', 'optica ruis')).toBe(trigramSimilarity('optica ruis', 'optica ruiz'));
  });
});
