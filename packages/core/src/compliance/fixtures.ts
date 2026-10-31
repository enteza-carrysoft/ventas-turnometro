// Fixtures de prueba de la puerta (solo se importan desde *.test.ts).
import type {
  Channel, CheckInput, ComplianceContext, ConsentRow, PriorAttempt, Purpose,
} from './types.js';

export const P = '00000000-0000-7000-8000-00000000000a'; // ficha
export const PHONE = '+34600111222';
export const EMAIL_ADDR = 'recepcion@clinicaejemplo.es';
export const ADDR_ID = '00000000-0000-7000-8000-0000000000ad';
export const DEMO_ID = '00000000-0000-7000-8000-0000000000de';
export const CAMP = '00000000-0000-7000-8000-0000000000c1';

/** martes 10-nov-2026, 11:00 en Madrid (CET = UTC+1) */
export const TUE_11 = new Date('2026-11-10T10:00:00Z');
/** sábado 14-nov-2026, 11:00 en Madrid */
export const SAT_11 = new Date('2026-11-14T10:00:00Z');

export const days = (d: number, from: Date = TUE_11): Date => new Date(from.getTime() - d * 86_400_000);
export const hours = (h: number, from: Date = TUE_11): Date => new Date(from.getTime() - h * 3_600_000);

export function ctx(over: Partial<ComplianceContext> = {}): ComplianceContext {
  return {
    now: TUE_11,
    settings: {
      killSwitch: false,
      killSwitchByChannel: {},
      appMode: 'production',
      b2bHumanCallsApproved: false,
      postalB2bApproved: false,
      lssiCustomerExceptionApproved: false,
      robinsonMaxAgeDays: 30,
      timeWindows: {
        timezone: 'Europe/Madrid',
        call: [['10:00', '14:00'], ['16:00', '19:00']],
        visit: [['10:00', '13:30'], ['17:00', '19:30']],
        email: { blockedFrom: '21:00', blockedUntil: '08:00', weekends: false },
      },
      cadences: {
        postalLetter: { maxPerCampaign: 2, minDaysBetween: 21 },
        humanCall: { maxAnsweredPerCampaign: 1, maxUnanswered: 3 },
        visit: { maxPerCampaign: 1 },
        aiCall: { maxPerDay: 1, maxAttemptsPerConsent: 2, minHoursBetween: 48 },
        emailMarketing: { maxPerWeek: 1, maxPerCampaign: 4 },
        transactionalDemo: { max: 2 },
      },
    },
    testContacts: { phones: [], emails: [], postal: [] },
    prospect: { id: P, status: 'approved', legalForm: 'company', domain: 'clinicaejemplo.es', isCustomer: false },
    phoneType: 'switchboard_phone',
    postalAddress: { id: ADDR_ID, prospectId: P, value: 'calle sierpes 1 41004 sevilla' },
    demo: null,
    letter: { addressedToCompany: true, templateApproved: true },
    suppressions: [],
    consents: [],
    closedCampaignIds: [],
    priorAttempts: [],
    robinson: null,
    channelBudget: { spentTodayEur: 0, limitEur: 10 },
    holidays: ['2026-12-08'],
    ...over,
  };
}

export function input(channel: Channel, purpose: Purpose, over: Partial<CheckInput> = {}): CheckInput {
  const base: CheckInput = { prospectId: P, channel, purpose, direction: 'outbound', at: TUE_11, campaignId: CAMP };
  const dest: Partial<CheckInput> =
    channel === 'postal_letter' || channel === 'visit' ? { postalAddressId: ADDR_ID }
    : channel === 'email_marketing' || channel === 'email_transactional' ? { email: EMAIL_ADDR }
    : { phone: PHONE };
  return { ...base, ...dest, ...over };
}

export function grant(channel: ConsentRow['channel'], over: Partial<ConsentRow> = {}): ConsentRow {
  return {
    id: `consent-${channel}-1`, channel, purpose: 'prospecting', action: 'grant',
    phone: channel === 'email' ? null : PHONE, email: channel === 'email' ? EMAIL_ADDR : null,
    campaignId: CAMP, createdAt: days(5), ...over,
  };
}

export function withdraw(channel: ConsentRow['channel'], over: Partial<ConsentRow> = {}): ConsentRow {
  return grant(channel, { id: `withdraw-${channel}-1`, action: 'withdraw', createdAt: days(1), ...over });
}

export function attempt(channel: Channel, purpose: Purpose, over: Partial<PriorAttempt> = {}): PriorAttempt {
  return {
    channel, purpose, campaignId: CAMP, demoId: null, consentId: null,
    status: 'sent', outcome: null, at: days(30), ...over,
  };
}

export function demo(over: Partial<NonNullable<ComplianceContext['demo']>> = {}): NonNullable<ComplianceContext['demo']> {
  return {
    id: DEMO_ID, prospectId: P, requestedByInterested: true, status: 'booked',
    requesterEmail: EMAIL_ADDR, requesterPhone: PHONE, ...over,
  };
}
