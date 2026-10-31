// Dominios vetados (constitución P2.6): no se rastrean ni se guardan como web de una empresa. Se aplica en código sobre cualquier URL que
// llegue de una fuente o de una búsqueda, porque el filtro del proveedor no está garantizado (REQ-LLM-05 CA3).
// Lista inicial CONSERVADORA: LinkedIn (vetado expresamente) y buscadores de personas. Hay que revisarla con el asesor (D-04) y ampliarla
// con los directorios cuyas condiciones prohíban la extracción tras leerlas una a una.
export const VETOED_DOMAINS: readonly string[] = ['linkedin.com', 'pipl.com', 'spokeo.com', 'peekyou.com', 'whitepages.com'];

/** ¿Es la URL de un dominio vetado o de un subdominio suyo? Una URL que no se puede interpretar se trata como vetada. */
export function isVetoedUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return true;
  }
  return VETOED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}
