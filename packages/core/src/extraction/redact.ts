import { registrableDomain } from '../normalize/normalize.js';

// Minimización de datos personales (constitución P2.3): al modelo no se le envían nombres de personas ni emails personales, y nada de
// eso se guarda. Es una defensa por capas de mejor esfuerzo: tratamiento + nombre, y emails; la revisión humana y el conjunto dorado
// miden lo que se escape.

export const PERSONA = '[PERSONA]';
export const EMAIL_PERSONAL = '[EMAIL_PERSONAL]';

const TITLE = '(?:Dr|Dra|Doctor|Doctora|D|Dña|Sr|Sra|Lic|Ldo|Lda|Fdo|Prof|Profesor|Profesora)';
// Una palabra de tratamiento no es parte de un nombre («Ana Ruiz y Doctor Luis Mora» son dos personas) y la «y» tampoco es partícula.
const NAME_WORD = `(?!${TITLE}\\b)\\p{Lu}[\\p{L}'’-]+`;
// Separador de espacio horizontal: un nombre nunca se extiende a la línea siguiente (borraría contenido que no es un nombre).
const SP = '[^\\S\\n]+';
const PARTICLES = `(?:(?:de|del|la|las|los)${SP})*`;
const PERSON = new RegExp(`\\b${TITLE}\\.?${SP}${NAME_WORD}(?:${SP}${PARTICLES}${NAME_WORD}){0,3}`, 'gu');
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;

const GENERIC_LOCALS = new Set([
  'info', 'informacion', 'contacto', 'contact', 'hola', 'hello', 'administracion', 'admin', 'recepcion', 'citas', 'cita', 'reservas', 'reserva',
  'clinica', 'centro', 'secretaria', 'atencion', 'atencionalcliente', 'comercial', 'ventas', 'gerencia', 'direccion', 'consultas', 'pedidos',
  'soporte', 'ayuda', 'oficina', 'general', 'laboratorio', 'taller', 'tienda', 'correo', 'mail', 'web', 'rrhh', 'facturacion', 'calidad',
]);
const WEBMAIL = /^(gmail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|proton|protonmail|telefonica)\./i;

/** `generic_email` solo para buzones de empresa; todo lo que parece de una persona (o es dudoso) es `personal_email` y se descarta. */
export function classifyEmail(email: string): 'generic_email' | 'personal_email' {
  const m = /^([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(email.trim().toLowerCase());
  if (!m) return 'personal_email';
  const [, local, domain] = m as unknown as [string, string, string];
  if (GENERIC_LOCALS.has(local.replace(/\d+$/, ''))) return 'generic_email';
  if (WEBMAIL.test(domain)) return 'personal_email';
  const brand = (registrableDomain(domain) ?? domain).split('.')[0] ?? '';
  if (brand.length >= 4 && (local === brand || (local.length >= 4 && (brand.includes(local) || local.includes(brand))))) return 'generic_email';
  return 'personal_email';
}

/** Sustituye tratamientos con nombre y emails personales por marcadores. */
export function redactPersonalData(text: string): string {
  return text
    .replace(PERSON, PERSONA)
    .replace(EMAIL, (e) => (classifyEmail(e) === 'personal_email' ? EMAIL_PERSONAL : e));
}

/** ¿Contiene un tratamiento seguido de un nombre? Red de seguridad sobre lo que devuelve el modelo. */
export function containsPersonName(value: string): boolean {
  return new RegExp(PERSON.source, 'u').test(value);
}
