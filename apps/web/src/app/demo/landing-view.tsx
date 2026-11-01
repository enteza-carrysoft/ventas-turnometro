import { SANDBOX_TEST_TOKEN } from '@turnosala/connectors/turnstile';
import { currentConsentTexts, landingFacts } from '@turnosala/db/web';
import { headers } from 'next/headers';
import type { ReactElement } from 'react';
import { publicConfig } from '../../lib/public-config.js';
import { issueFormStamp } from '../../lib/public-handlers.js';
import { getServer } from '../../lib/server.js';
import { DemoForm, type BoxText } from './demo-form.js';
import { PUBLIC_CSS } from './public-styles.js';

const BOX_ORDER: BoxText['key'][] = ['email', 'human_call', 'ai_call', 'sms_whatsapp'];

/** Página pública de solicitud de demo (sector o enlace personalizado). Sin sesión ni datos personales: el contenido comercial sale solo de `product_facts` aprobado. */
export async function LandingView(p: { heading: string; landing: { sector: string } | { token: string } }): Promise<ReactElement> {
  const cfg = publicConfig();
  const { pool } = getServer();
  const nonce = (await headers()).get('x-nonce');
  const [texts, facts] = await Promise.all([currentConsentTexts(pool, { requireApproved: cfg.mode === 'production' }), landingFacts(pool)]);
  return (
    <main className="pub">
      <style nonce={nonce ?? undefined}>{PUBLIC_CSS}</style>
      <h1>{p.heading}</h1>
      {facts ? (
        <>
          <p className="lead">Plan {facts.plan.name}{facts.plan.priceMonthExVat !== null ? `, desde ${facts.plan.priceMonthExVat} € al mes (IVA no incluido)` : ''}.{facts.trialDays ? ` Prueba gratuita de ${facts.trialDays} días.` : ''}</p>
          <ul className="facts">{facts.plan.includes.map((i) => <li key={i}>{i}</li>)}</ul>
        </>
      ) : null}
      {!texts.ok ? (
        <p className="info">El formulario no está disponible por ahora.</p>
      ) : (
        <>
          {texts.allApproved ? null : <p className="draft" role="note">Texto legal sin aprobar: entorno de pruebas. No se contacta con nadie.</p>}
          <DemoForm
            landing={p.landing} hasToken={'token' in p.landing} stamp={issueFormStamp(cfg.formSecret, new Date())}
            boxes={BOX_ORDER.map((key) => ({ key, text: texts.texts[key].text }))} privacyText={texts.texts.privacy.text}
            siteKey={cfg.siteKey} sandboxToken={cfg.captcha === 'sandbox-test' ? SANDBOX_TEST_TOKEN : null} nonce={nonce}
          />
        </>
      )}
    </main>
  );
}
