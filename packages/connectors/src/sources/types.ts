// Contrato común de los adaptadores de fuentes (REQ-RES-02). Cada adaptador devuelve candidatos listos para `ingestCandidate`.

export interface SourceEvidence {
  field: string;
  value?: string | null | undefined;
  provenance: 'observed' | 'inferred';
  explanation?: string | undefined;
  sourceUrl: string;
  quote?: string | undefined;
  fetchedAt: Date;
}
export interface SourceCandidate {
  name: string;
  website?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  address?: string | undefined;
  municipality?: string | undefined;
  province?: string | undefined;
  sourceId: string;
  externalId: string;
  sourceUrl: string;
  fetchedAt: Date;
  extractorVersion: string;
  evidences: SourceEvidence[];
}
export interface SourceRequest {
  sourceId: string;
  ineCode: string | null;
  cursor: unknown;
  /** candidatos que aún caben en el lote del trabajo */
  limit: number;
  territory?: { name: string; province: string } | undefined;
  /** pares etiqueta=valor de OpenStreetMap del segmento del trabajo; mandan sobre los de la configuración del adaptador */
  osmFilters?: Array<[string, string]> | undefined;
}
export interface SourceResult {
  candidates: SourceCandidate[];
  costEur: number;
  cursor?: unknown;
}
export interface SourceAdapter {
  fetch(req: SourceRequest): Promise<SourceResult>;
}
