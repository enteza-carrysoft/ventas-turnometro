import { z } from 'zod';
import { localParts } from '../compliance/time.js';

// Esquema de `product_facts.facts` (REQ-MKT-01). Todo contenido comercial sale SOLO de aquí (constitución P2.7).

const source = z.object({ url: z.string().min(1), fetched_at: z.string().min(1) });
const positiveInt = z.number().int().positive();

const plan = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** euros sin IVA */
    price_month_ex_vat: z.number().nonnegative().nullable(),
    price_year_ex_vat: z.number().nonnegative().nullable(),
    /** Enterprise: solo presupuesto, sin precio */
    quote_only: z.boolean(),
    limits: z.object({
      centers: positiveInt.optional(),
      rooms: positiveInt.optional(),
      workstations: positiveInt.optional(),
      screens: z.union([positiveInt, z.literal('unlimited')]).optional(),
    }),
    includes: z.array(z.string().min(1)),
    source,
  })
  .refine(
    (p) => {
      const noPrice = p.price_month_ex_vat === null && p.price_year_ex_vat === null;
      const priced = p.price_month_ex_vat !== null;
      return p.quote_only ? noPrice : priced;
    },
    { message: 'un plan con precio no es «solo presupuesto» y uno «solo presupuesto» no lleva precio' },
  );

const addon = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  price_ex_vat: z.number().nonnegative(),
  billing: z.enum(['monthly', 'one_off']),
  min_plan: z.string().nullable(),
  /** `indicative`: orientativo, requiere validación comercial antes de prometerlo */
  status: z.enum(['indicative', 'confirmed']),
  source: z.string().min(1),
});

const trial = z.object({
  id: z.string().min(1),
  channel: z.string().min(1),
  days: positiveInt,
  /** `true` solo si está publicado hoy de cara al cliente: es lo único que el contenido puede prometer */
  published: z.boolean(),
  source: z.string().min(1),
});

/** Una promoción SIEMPRE caduca (REQ-MKT-01 CA3): `until` es obligatorio. */
const promotion = z.object({
  code: z.string().min(1),
  description: z.string().min(1),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  published: z.boolean(),
});

export const productFactsSchema = z.object({
  vat_rate: z.number().min(0).max(1),
  prices_include_vat_on_web: z.boolean(),
  plans: z.array(plan).min(1),
  addons: z.array(addon),
  trials: z.array(trial),
  promotions: z.array(promotion),
  terms: z.object({ no_lock_in: z.boolean(), cancel_anytime: z.boolean() }),
  urls: z.object({ web: z.string().url(), app: z.string().url() }),
  /** datos que difieren entre fuentes y siguen sin resolver: el promotor decide (decisions.md) */
  discrepancies: z.array(z.object({ field: z.string(), values: z.array(z.string()), note: z.string() })),
});

export type ProductFacts = z.infer<typeof productFactsSchema>;
export type Promotion = z.infer<typeof promotion>;

/** Promociones que el contenido nuevo puede citar: publicadas y no caducadas (el último día cuenta, hora de Madrid). */
export function activePromotions(facts: ProductFacts, at: Date): Promotion[] {
  const today = localParts(at, 'Europe/Madrid').date;
  return facts.promotions.filter((p) => p.published && p.until >= today);
}

/** Días de prueba que el contenido puede prometer: solo los publicados. */
export function claimableTrialDays(facts: ProductFacts): number[] {
  return facts.trials.filter((t) => t.published).map((t) => t.days);
}
