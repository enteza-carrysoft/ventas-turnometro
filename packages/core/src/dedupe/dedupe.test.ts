import { describe, expect, it } from 'vitest';
import { decideIngest, NAME_SIMILARITY_MIN, CUSTOMER_NAME_SIMILARITY_MIN, type Candidate, type CustomerRow, type ExistingProspect, type SuppressionLite } from './dedupe.js';

const cand = (over: Partial<Candidate> = {}): Candidate => ({ nameNorm: 'clinica dental sol', domain: 'clinicasol.es', phones: ['+34954123456'], emails: [], ineCode: 'T0001', ...over });
const ex = (over: Partial<ExistingProspect> = {}): ExistingProspect => ({ id: 'p1', nameNorm: 'otra empresa distinta', domain: 'otra.es', phones: ['+34955000000'], ineCode: 'T0009', status: 'approved', ...over });
const cust = (over: Partial<CustomerRow> = {}): CustomerRow => ({ orgId: 'org1', nameNorm: 'cliente actual', domain: 'cliente.es', phone: '+34955111111', ...over });

describe('decideIngest: crear o fusionar (REQ-VER-02 CA1)', () => {
  it('sin coincidencias → crear', () => {
    expect(decideIngest(cand(), [ex()], [], [])).toEqual({ action: 'create' });
  });

  it('mismo dominio → fusionar', () => {
    expect(decideIngest(cand(), [ex({ id: 'p7', domain: 'clinicasol.es' })], [], [])).toEqual({ action: 'merge', prospectId: 'p7', matchedBy: 'domain' });
  });

  it('mismo teléfono E.164 → fusionar', () => {
    expect(decideIngest(cand(), [ex({ id: 'p8', phones: ['+34600000000', '+34954123456'] })], [], [])).toEqual({ action: 'merge', prospectId: 'p8', matchedBy: 'phone' });
  });

  it('nombre muy parecido (una errata) en el MISMO municipio → fusionar', () => {
    const r = decideIngest(cand({ nameNorm: 'clinica dental sol', domain: null, phones: [] }), [ex({ id: 'p9', nameNorm: 'clinica dental soll', domain: null, phones: [], ineCode: 'T0001' })], [], []);
    expect(r).toEqual({ action: 'merge', prospectId: 'p9', matchedBy: 'name_municipality' });
  });

  it('LIMITACIÓN conocida: si una fuente añade la ciudad al nombre («… sol sevilla», similitud ≈ 0,74) no se fusiona solo por nombre; lo cazan el dominio o el teléfono, o el revisor', () => {
    const r = decideIngest(cand({ nameNorm: 'clinica dental sol', domain: null, phones: [] }), [ex({ nameNorm: 'clinica dental sol sevilla', domain: null, phones: [], ineCode: 'T0001' })], [], []);
    expect(r).toEqual({ action: 'create' });
  });

  it('el mismo nombre en OTRO municipio no se fusiona (dos sucursales no son la misma ficha)', () => {
    const r = decideIngest(cand({ domain: null, phones: [] }), [ex({ nameNorm: 'clinica dental sol', domain: null, phones: [], ineCode: 'T0002' })], [], []);
    expect(r).toEqual({ action: 'create' });
  });

  it('sin municipio conocido no hay coincidencia por nombre', () => {
    const r = decideIngest(cand({ ineCode: null, domain: null, phones: [] }), [ex({ nameNorm: 'clinica dental sol', ineCode: null, domain: null, phones: [] })], [], []);
    expect(r).toEqual({ action: 'create' });
  });

  it('un nombre por debajo del umbral no se fusiona', () => {
    const r = decideIngest(cand({ nameNorm: 'clinica dental sol', domain: null, phones: [] }), [ex({ nameNorm: 'centro de fisioterapia luna', domain: null, phones: [], ineCode: 'T0001' })], [], []);
    expect(r.action).toBe('create');
    expect(NAME_SIMILARITY_MIN).toBe(0.8);
  });

  it('dominio o teléfono nulos nunca coinciden entre sí', () => {
    expect(decideIngest(cand({ domain: null, phones: [] }), [ex({ domain: null, phones: [] })], [], [])).toEqual({ action: 'create' });
  });

  it('las fichas archivadas, descartadas o bloqueadas también se encuentran (REQ-VER-02: «incluidas archivadas»)', () => {
    for (const status of ['archived', 'discarded', 'blocked']) {
      expect(decideIngest(cand(), [ex({ id: 'pa', domain: 'clinicasol.es', status })], [], [])).toMatchObject({ action: 'merge', prospectId: 'pa' });
    }
  });

  it('prioriza el dominio sobre el teléfono y el teléfono sobre el nombre', () => {
    const list = [ex({ id: 'por-nombre', nameNorm: 'clinica dental sol', ineCode: 'T0001', domain: null, phones: [] }), ex({ id: 'por-telefono', phones: ['+34954123456'] }), ex({ id: 'por-dominio', domain: 'clinicasol.es' })];
    expect(decideIngest(cand(), list, [], [])).toMatchObject({ prospectId: 'por-dominio', matchedBy: 'domain' });
    expect(decideIngest(cand(), list.slice(0, 2), [], [])).toMatchObject({ prospectId: 'por-telefono', matchedBy: 'phone' });
  });
});

describe('decideIngest: clientes y oposiciones bloquean (REQ-VER-02 CA2)', () => {
  it('cliente actual de TurnoSala por dominio, teléfono o nombre muy parecido → blocked «customer»', () => {
    expect(decideIngest(cand({ domain: 'cliente.es' }), [], [cust()], [])).toEqual({ action: 'blocked', reason: 'customer', matchedBy: 'domain' });
    expect(decideIngest(cand({ phones: ['+34955111111'] }), [], [cust()], [])).toEqual({ action: 'blocked', reason: 'customer', matchedBy: 'phone' });
    expect(decideIngest(cand({ nameNorm: 'cliente actual', domain: null, phones: [] }), [], [cust()], [])).toEqual({ action: 'blocked', reason: 'customer', matchedBy: 'name' });
    expect(CUSTOMER_NAME_SIMILARITY_MIN).toBe(0.9);
  });

  it('un nombre solo algo parecido a un cliente NO bloquea', () => {
    expect(decideIngest(cand({ nameNorm: 'cliente distinto', domain: null, phones: [] }), [], [cust()], []).action).toBe('create');
  });

  it('oposición sobre el teléfono, el dominio o el email del candidato → blocked «opposition»', () => {
    const s = (kind: SuppressionLite['kind'], value: string): SuppressionLite[] => [{ kind, value }];
    expect(decideIngest(cand(), [], [], s('phone', '+34954123456'))).toEqual({ action: 'blocked', reason: 'opposition', matchedBy: 'phone' });
    expect(decideIngest(cand(), [], [], s('domain', 'clinicasol.es'))).toEqual({ action: 'blocked', reason: 'opposition', matchedBy: 'domain' });
    expect(decideIngest(cand({ emails: ['info@clinicasol.es'] }), [], [], s('email', 'info@clinicasol.es'))).toEqual({ action: 'blocked', reason: 'opposition', matchedBy: 'email' });
  });

  it('una oposición sobre la ficha existente que coincide también bloquea, y se indica en qué ficha', () => {
    const r = decideIngest(cand(), [ex({ id: 'p5', domain: 'clinicasol.es' })], [], [{ kind: 'prospect', value: 'p5' }]);
    expect(r).toEqual({ action: 'blocked', reason: 'opposition', matchedBy: 'prospect', mergeIntoId: 'p5' });
  });

  it('un cliente que además coincide con una ficha existente bloquea esa ficha (no se prospecta)', () => {
    const r = decideIngest(cand({ domain: 'cliente.es' }), [ex({ id: 'p6', domain: 'cliente.es' })], [cust()], []);
    expect(r).toEqual({ action: 'blocked', reason: 'customer', matchedBy: 'domain', mergeIntoId: 'p6' });
  });

  it('las exclusiones ajenas no bloquean', () => {
    expect(decideIngest(cand(), [], [], [{ kind: 'phone', value: '+34600000000' }, { kind: 'domain', value: 'otra.es' }])).toEqual({ action: 'create' });
  });

  it('cliente y oposición a la vez: gana «customer»', () => {
    const r = decideIngest(cand({ domain: 'cliente.es' }), [], [cust()], [{ kind: 'domain', value: 'cliente.es' }]);
    expect(r).toMatchObject({ reason: 'customer' });
  });
});
