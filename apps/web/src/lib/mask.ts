/** a***@dominio.es: se reconoce el destino sin enseñarlo entero por si el enlace se reenvía. */
export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}***@${domain}`;
}

/** +34955123456 → +34*****56 */
export const maskPhone = (p: string): string => `${p.slice(0, 3)}*****${p.slice(-2)}`;
