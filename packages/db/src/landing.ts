import { productFactsSchema } from '@turnosala/core';
import type pg from 'pg';

// Datos que muestran las páginas públicas. Todo contenido comercial sale SOLO de `product_facts` aprobado (constitución P2.7); sin datos aprobados no se muestra nada.

export interface LandingSegment {
  slug: string;
  name: string;
}
export interface LandingFacts {
  plan: { name: string; priceMonthExVat: number | null; includes: string[] };
  /** días de prueba, solo si la prueba está publicada hoy de cara al cliente */
  trialDays: number | null;
}

/** Segmento APROBADO por su slug (un borrador no tiene landing). Un slug mal formado ni siquiera llega a la BD. */
export async function landingSegment(pool: pg.Pool, slug: string): Promise<LandingSegment | null> {
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  const r = (await pool.query(`select slug, name from segments where slug = $1 and status = 'approved' limit 1`, [slug])).rows[0] as LandingSegment | undefined;
  return r ?? null;
}

export async function landingFacts(pool: pg.Pool, planId = 'pro'): Promise<LandingFacts | null> {
  const row = (await pool.query(`select facts from product_facts where status = 'approved' order by approved_at desc limit 1`)).rows[0] as { facts: unknown } | undefined;
  const parsed = row ? productFactsSchema.safeParse(row.facts) : null;
  if (!parsed?.success) return null;
  const plan = parsed.data.plans.find((p) => p.id === planId);
  if (!plan) return null;
  const trial = parsed.data.trials.find((x) => x.published);
  return { plan: { name: plan.name, priceMonthExVat: plan.price_month_ex_vat, includes: plan.includes }, trialDays: trial ? trial.days : null };
}
