// Tipos de la puerta de cumplimiento (spec/compliance.md «Interfaz»). Dominio puro: sin E/S, sin reloj.

export type Channel =
  | 'postal_letter' | 'visit' | 'human_call' | 'ai_call'
  | 'email_marketing' | 'email_transactional' | 'sms_transactional' | 'whatsapp_transactional';
export type Purpose = 'prospecting' | 'demo_followup' | 'demo_confirmation' | 'trial_help';
export type Direction = 'outbound' | 'inbound';
export type Decision = 'ALLOW' | 'BLOCK' | 'REVIEW';

export const CHANNELS: readonly Channel[] = [
  'postal_letter', 'visit', 'human_call', 'ai_call',
  'email_marketing', 'email_transactional', 'sms_transactional', 'whatsapp_transactional',
];

export interface CheckInput {
  prospectId: string;
  channel: Channel;
  purpose: Purpose;
  direction: Direction;
  phone?: string | undefined;
  email?: string | undefined;
  /** = contact_points.id (type 'postal_address') */
  postalAddressId?: string | undefined;
  /** obligatorio en demo_confirmation / demo_followup (CG-40, CG-51) */
  demoId?: string | undefined;
  campaignId?: string | undefined;
  /** UTC; si falta se usa ctx.now */
  at?: Date | undefined;
}

export interface CheckResult {
  decision: Decision;
  ruleIds: string[];
  reasons: string[];
  consentId: string | null;
  decisionId: string;
}

export type EvaluateResult = Omit<CheckResult, 'decisionId'>;

export type TimeRange = readonly [start: string, end: string]; // 'HH:MM' en la zona horaria de la configuración

export interface TimeWindows {
  timezone: string;
  call: readonly TimeRange[];
  visit: readonly TimeRange[];
  email: { blockedFrom: string; blockedUntil: string; weekends: boolean };
}

export interface Cadences {
  postalLetter: { maxPerCampaign: number; minDaysBetween: number };
  humanCall: { maxAnsweredPerCampaign: number; maxUnanswered: number };
  visit: { maxPerCampaign: number };
  aiCall: { maxPerDay: number; maxAttemptsPerConsent: number; minHoursBetween: number };
  emailMarketing: { maxPerWeek: number; maxPerCampaign: number };
  transactionalDemo: { max: number };
}

export interface ComplianceSettings {
  killSwitch: boolean;
  killSwitchByChannel: Partial<Record<Channel, boolean>>;
  appMode: 'sandbox' | 'production';
  b2bHumanCallsApproved: boolean;
  postalB2bApproved: boolean;
  lssiCustomerExceptionApproved: boolean;
  robinsonMaxAgeDays: number;
  timeWindows: TimeWindows;
  cadences: Cadences;
}

export interface ProspectCtx {
  id: string;
  status: 'candidate' | 'enriched' | 'pending_review' | 'approved' | 'discarded' | 'blocked' | 'archived';
  legalForm: 'company' | 'sole_trader' | 'public_body' | 'unknown';
  domain: string | null;
  /** cliente actual de TurnoSala (turnosala_customers) */
  isCustomer: boolean;
}

export interface DemoCtx {
  id: string;
  prospectId: string;
  /** la pidió el propio interesado (formulario o agente de voz), no la creó un comercial por su cuenta */
  requestedByInterested: boolean;
  status: 'booked' | 'confirmed' | 'cancelled' | 'held' | 'no_show' | 'rescheduled';
  requesterEmail: string | null;
  requesterPhone: string | null;
}

export interface PostalAddressCtx {
  id: string;
  prospectId: string;
  /** dirección normalizada (value_norm) */
  value: string;
}

export interface ConsentRow {
  id: string;
  channel: 'email' | 'human_call' | 'ai_call' | 'sms' | 'whatsapp';
  purpose: string;
  action: 'grant' | 'withdraw';
  phone: string | null;
  email: string | null;
  campaignId: string | null;
  createdAt: Date;
}

export interface SuppressionRow {
  kind: 'phone' | 'email' | 'domain' | 'prospect';
  value: string;
}

export interface PriorAttempt {
  channel: Channel;
  purpose: Purpose;
  campaignId: string | null;
  demoId: string | null;
  /** consentimiento con el que se decidió (compliance_decisions.consent_id) */
  consentId: string | null;
  status: 'sending' | 'sent' | 'delivered' | 'failed' | 'returned';
  /** resultado conocido; null = desconocido (se trata como contestado: lo más restrictivo) */
  outcome: 'answered' | 'unanswered' | 'not_interested' | null;
  at: Date;
}

export interface ComplianceContext {
  /** reloj inyectado por el cargador; evaluate() nunca llama a Date.now() */
  now: Date;
  settings: ComplianceSettings;
  testContacts: { phones: string[]; emails: string[]; postal: string[] };
  prospect: ProspectCtx | null;
  /** tipo del contact_point al que corresponde input.phone */
  phoneType: 'switchboard_phone' | 'mobile_phone' | null;
  postalAddress: PostalAddressCtx | null;
  demo: DemoCtx | null;
  /** carta: dirigida a la empresa y plantilla aprobada (identidad, privacidad y baja) */
  letter: { addressedToCompany: boolean; templateApproved: boolean };
  /** exclusiones que afectan a este teléfono, email, dominio o ficha */
  suppressions: SuppressionRow[];
  /** concesiones y retiradas de consentimiento para este canal y destino */
  consents: ConsentRow[];
  closedCampaignIds: string[];
  priorAttempts: PriorAttempt[];
  /** última consulta Robinson de la ficha */
  robinson: { result: 'clear' | 'listed' | 'error'; checkedAt: Date } | null;
  /** gasto del día del proveedor del canal; limitEur null = el canal no tiene tope diario */
  channelBudget: { spentTodayEur: number; limitEur: number | null };
  /** fechas locales 'YYYY-MM-DD' festivas (nacionales y autonómicas conocidas) */
  holidays: string[];
}
