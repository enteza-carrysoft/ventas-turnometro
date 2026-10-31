import { describe, expect, it } from 'vitest';
import { extractionOutputSchema, normalizeQuoteText, verifyExtraction, type ExtractionOutput, type PageText } from './extraction.js';

const U1 = 'https://clinicasol.es/';
const U2 = 'https://clinicasol.es/contacto';
const TEXT1 = 'Clínica Dental Sol\nTenemos 3 consultas  y una sala de espera\nTV en sala con turnos';
const TEXT2 = 'Llámanos al 954 12 34 56 o escribe a info@clinicasol.es\nescribe a maria@clinicasol.es\nescribe a juan.perez@clinicasol.es\nCalle Sierpes 12, 41004 Sevilla\nPide cita';
const pages: PageText[] = [
  { url: U1, finalUrl: U1, text: TEXT1, links: [U2, 'https://clinicasol.es/pide-cita'] },
  { url: U2, finalUrl: U2, text: TEXT2, links: [] },
];
const VOCAB = ['varias_consultas', 'sala_espera', 'tv_en_sala'];

const empty = (): ExtractionOutput => ({ fields: [], signals: [], contact_points: [], legal_form: null });
const run = (o: Partial<ExtractionOutput>) => verifyExtraction({ ...empty(), ...o }, pages, { signalVocabulary: VOCAB });
const sig = (key: string, quote: string, source_url = U1) => ({ key, quote, source_url });

describe('extractionOutputSchema (salida estructurada del modelo)', () => {
  it('acepta una salida válida y rechaza citas vacías, demasiado largas o tipos desconocidos', () => {
    expect(extractionOutputSchema.safeParse(empty()).success).toBe(true);
    expect(extractionOutputSchema.safeParse({ ...empty(), signals: [sig('x', 'ab')] }).success).toBe(false); // < 4 caracteres
    expect(extractionOutputSchema.safeParse({ ...empty(), signals: [sig('x', 'a'.repeat(301))] }).success).toBe(false);
    expect(extractionOutputSchema.safeParse({ ...empty(), contact_points: [{ type: 'whatsapp', value: 'x', source_url: U1, quote: 'xxxx' }] }).success).toBe(false);
  });
});

describe('verificación literal de citas (REQ-ENR-01 CA1/CA2)', () => {
  it('normalizeQuoteText: espacios, saltos de línea y NBSP no cuentan; las mayúsculas sí', () => {
    expect(normalizeQuoteText('  Tenemos 3\n consultas ')).toBe('Tenemos 3 consultas');
  });

  it('una señal con cita literal (aunque cambien los espacios) y URL rastreada se acepta', () => {
    const r = run({ signals: [sig('varias_consultas', 'Tenemos 3 consultas y una sala de espera')] });
    expect(r.signals).toEqual([{ key: 'varias_consultas', quote: 'Tenemos 3 consultas y una sala de espera', sourceUrl: U1 }]);
    expect(r.metrics.accepted).toBe(1);
  });

  it('una cita que NO está en la página se descarta y se cuenta como alucinación', () => {
    const r = run({ signals: [sig('varias_consultas', 'Contamos con diez consultas modernas')] });
    expect(r.signals).toEqual([]);
    expect(r.metrics.rejected.quote_not_found).toBe(1);
    expect(r.metrics.hallucinationRejected).toBe(1);
  });

  it('una cita que existe pero en OTRA página que la señalada se descarta', () => {
    expect(run({ signals: [sig('sala_espera', 'Calle Sierpes 12', U1)] }).metrics.rejected.quote_not_found).toBe(1);
  });

  it('distingue mayúsculas: cambiar una letra de la cita la invalida', () => {
    expect(run({ signals: [sig('varias_consultas', 'tenemos 3 consultas')] }).signals).toEqual([]);
  });

  it('una URL que no se rastreó se descarta (el modelo no puede citar páginas inventadas)', () => {
    const r = run({ signals: [sig('varias_consultas', 'Tenemos 3 consultas', 'https://inventada.es/')] });
    expect(r.signals).toEqual([]);
    expect(r.metrics.rejected.unknown_url).toBe(1);
  });

  it('una señal que no está en el vocabulario del modelo de puntuación se descarta', () => {
    const r = run({ signals: [sig('es_muy_famosa', 'Clínica Dental Sol')] });
    expect(r.signals).toEqual([]);
    expect(r.metrics.rejected.unknown_signal).toBe(1);
  });
});

describe('campos (REQ-ENR-01 CA1/CA3)', () => {
  const field = (over: Record<string, unknown> = {}) => ({ key: 'consultation_rooms' as const, value: '3', provenance: 'observed' as const, explanation: null, source_url: U1, quote: 'Tenemos 3 consultas', ...over });

  it('un campo observado con cita literal se acepta con su fuente', () => {
    expect(run({ fields: [field()] }).fields).toEqual([{ key: 'consultation_rooms', value: '3', provenance: 'observed', explanation: null, sourceUrl: U1, quote: 'Tenemos 3 consultas' }]);
  });

  it('un dato inferido exige explicación', () => {
    const r = run({ fields: [field({ provenance: 'inferred', explanation: null })] });
    expect(r.fields).toEqual([]);
    expect(r.metrics.rejected.inferred_without_explanation).toBe(1);
    expect(run({ fields: [field({ provenance: 'inferred', explanation: 'se deduce de «3 consultas»' })] }).fields).toHaveLength(1);
  });

  it('un número de consultas o sedes que no es un entero se descarta', () => {
    expect(run({ fields: [field({ value: 'unas cuantas' })] }).metrics.rejected.invalid_value).toBe(1);
    expect(run({ fields: [field({ key: 'sites_count', value: '2' })] }).metrics.rejected.quote_not_found ?? 0).toBe(0);
  });

  it('un nombre de persona en el valor o en la cita se descarta (la razón social del negocio sí vale)', () => {
    const personal = run({ fields: [{ ...field({ key: 'specialties', value: 'Atiende el Dr. Luis Mora', quote: 'Tenemos 3 consultas' }) }] });
    expect(personal.fields).toEqual([]);
    expect(personal.metrics.rejected.person_name).toBe(1);
    const name = run({ fields: [field({ key: 'name', value: 'Clínica Dental Sol', quote: 'Clínica Dental Sol' })] });
    expect(name.fields).toHaveLength(1);
  });
});

describe('puntos de contacto (REQ-ENR-03)', () => {
  const cp = (type: string, value: string, quote: string, source_url = U2) => ({ type, value, quote, source_url }) as ExtractionOutput['contact_points'][number];

  it('el tipo de teléfono lo decide el código, no el modelo: un fijo declarado como móvil sale como centralita', () => {
    const r = run({ contact_points: [cp('mobile_phone', '954 12 34 56', 'Llámanos al 954 12 34 56')] });
    expect(r.contactPoints).toEqual([{ type: 'switchboard_phone', value: '+34954123456', sourceUrl: U2, quote: 'Llámanos al 954 12 34 56' }]);
  });

  it('un teléfono cuyo número no aparece en la cita se descarta (cifras inventadas)', () => {
    const r = run({ contact_points: [cp('switchboard_phone', '955 99 99 99', 'Llámanos al 954 12 34 56')] });
    expect(r.contactPoints).toEqual([]);
    expect(r.metrics.rejected.value_not_in_quote).toBe(1);
  });

  it('un teléfono inválido o no llamable (902, 900) se descarta', () => {
    expect(run({ contact_points: [cp('switchboard_phone', '12345', 'Llámanos al 12345')] }).contactPoints).toEqual([]);
  });

  it('el email genérico se acepta en minúsculas y el personal se DESCARTA y se cuenta', () => {
    const ok = run({ contact_points: [cp('generic_email', 'INFO@clinicasol.es', 'escribe a info@clinicasol.es')] });
    expect(ok.contactPoints).toEqual([{ type: 'generic_email', value: 'info@clinicasol.es', sourceUrl: U2, quote: 'escribe a info@clinicasol.es' }]);
    const personal = run({ contact_points: [cp('personal_email', 'maria@clinicasol.es', 'escribe a maria@clinicasol.es')] });
    expect(personal.contactPoints).toEqual([]);
    expect(personal.metrics.personalEmailsDiscarded).toBe(1);
  });

  it('un email que el modelo llama «genérico» pero parece personal se descarta igualmente', () => {
    const r = run({ contact_points: [cp('generic_email', 'juan.perez@clinicasol.es', 'escribe a juan.perez@clinicasol.es')] });
    expect(r.contactPoints).toEqual([]);
    expect(r.metrics.personalEmailsDiscarded).toBe(1);
  });

  it('la dirección debe aparecer (normalizada) en la cita', () => {
    expect(run({ contact_points: [cp('postal_address', 'C/ Sierpes 12, 41004 Sevilla', 'Calle Sierpes 12, 41004 Sevilla')] }).contactPoints).toHaveLength(1);
    expect(run({ contact_points: [cp('postal_address', 'Avenida Inventada 99', 'Calle Sierpes 12, 41004 Sevilla')] }).metrics.rejected.value_not_in_quote).toBe(1);
  });

  it('una URL de reserva o formulario debe ser un enlace REAL de la página citada', () => {
    const ok = run({ contact_points: [cp('booking_url', 'https://clinicasol.es/pide-cita', 'Tenemos 3 consultas', U1)] });
    expect(ok.contactPoints).toEqual([{ type: 'booking_url', value: 'https://clinicasol.es/pide-cita', sourceUrl: U1, quote: 'Tenemos 3 consultas' }]);
    const fake = run({ contact_points: [cp('booking_url', 'https://clinicasol.es/inventada', 'Tenemos 3 consultas', U1)] });
    expect(fake.contactPoints).toEqual([]);
    expect(fake.metrics.rejected.link_not_in_page).toBe(1);
  });
});

describe('forma jurídica (REQ-VER-03)', () => {
  it('se acepta con cita literal, y se descarta si la cita no está', () => {
    const pagesLegal: PageText[] = [{ url: U1, finalUrl: U1, text: 'Titular: Clínica Dental Sol, S.L. — CIF B41000000', links: [] }];
    const good = verifyExtraction({ ...empty(), legal_form: { value: 'company', source_url: U1, quote: 'Titular: Clínica Dental Sol, S.L.' } }, pagesLegal, { signalVocabulary: VOCAB });
    expect(good.legalForm).toEqual({ value: 'company', sourceUrl: U1, quote: 'Titular: Clínica Dental Sol, S.L.' });
    const bad = verifyExtraction({ ...empty(), legal_form: { value: 'company', source_url: U1, quote: 'Sociedad Anónima Inventada' } }, pagesLegal, { signalVocabulary: VOCAB });
    expect(bad.legalForm).toBeNull();
  });
});

describe('métricas', () => {
  it('cuenta aceptadas y rechazadas por motivo en una misma salida', () => {
    const r = run({
      signals: [sig('varias_consultas', 'Tenemos 3 consultas'), sig('sala_espera', 'inventado total'), sig('nada', 'Clínica Dental Sol')],
    });
    expect(r.metrics.accepted).toBe(1);
    expect(r.metrics.rejected).toMatchObject({ quote_not_found: 1, unknown_signal: 1 });
  });
});
