import type { DealFilters, DealRow } from '@turnosala/db/web';

// Vista del pipeline: datos planos para los componentes de cliente, formatos de pantalla (euros; fechas en Europe/Madrid) y lectura segura de los filtros de la URL.

const MADRID = 'Europe/Madrid';
const MONEY = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const DATETIME = new Intl.DateTimeFormat('es-ES', { timeZone: MADRID, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export const eur = (v: number | null): string => (v === null ? '—' : MONEY.format(v));
export const madridDateTime = (d: Date | null): string => (d ? DATETIME.format(d) : '—');

export interface DealCard {
  id: string;
  prospectId: string;
  name: string;
  where: string;
  segment: string;
  value: string;
  owner: string;
  ownerUserId: string | null;
  stage: string;
  stageName: string;
  probability: number;
  score: number | null;
  taskTitle: string | null;
  taskDue: string;
  taskOverdue: boolean;
  closed: boolean;
  lostReasonId: string | null;
}

export function toCard(r: DealRow, now: Date): DealCard {
  return {
    id: r.id, prospectId: r.prospectId, name: r.prospectName, where: r.municipality ?? r.province ?? '—', segment: r.segmentName ?? '—', value: eur(r.estValueEur),
    owner: r.ownerName ?? 'Sin asignar', ownerUserId: r.ownerUserId, stage: r.stageId, stageName: r.stageName, probability: r.probability, score: r.score,
    taskTitle: r.nextTaskTitle, taskDue: madridDateTime(r.nextTaskDueAt), taskOverdue: r.nextTaskDueAt !== null && r.nextTaskDueAt.getTime() < now.getTime(),
    closed: r.closedAt !== null, lostReasonId: r.lostReasonId,
  };
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Fin del día elegido EN MADRID (23:59:59.999 hora local), en UTC. Una fecha inexistente se ignora. */
function endOfMadridDay(day: string): Date | undefined {
  const m = ISO_DAY.exec(day);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d, 12));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return undefined;
  const offsetH = Number(new Intl.DateTimeFormat('en-GB', { timeZone: MADRID, hour: '2-digit', hour12: false }).format(probe)) - 12; // +1 invierno, +2 verano
  return new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999) - offsetH * 3600_000);
}

/** La URL es entrada no fiable: solo se leen los filtros conocidos, un parámetro repetido no cuenta y los textos se acotan. */
export function filtersFromParams(p: Params): DealFilters {
  const status = one(p.estado);
  const to = one(p.tareaHasta);
  return {
    owner: one(p.owner), stage: one(p.stage), segmentId: one(p.segmento), province: one(p.provincia), campaignId: one(p.campana),
    search: one(p.q)?.trim().slice(0, 100) || undefined,
    status: status === 'open' || status === 'closed' || status === 'all' ? status : undefined,
    nextTaskTo: to ? endOfMadridDay(to) : undefined,
    noTask: one(p.sinTarea) === '1' ? true : undefined,
  };
}
