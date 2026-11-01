'use client';
import Script from 'next/script';
import { useState, type FormEvent, type ReactElement } from 'react';

export interface BoxText {
  key: 'email' | 'human_call' | 'ai_call' | 'sms_whatsapp';
  /** texto EXACTO que la persona acepta (el servidor guarda copia literal de esta versión) */
  text: string;
}
interface Props {
  landing: { sector: string } | { token: string };
  stamp: string;
  hasToken: boolean;
  boxes: BoxText[];
  privacyText: string;
  siteKey: string | null;
  sandboxToken: string | null;
  nonce: string | null;
}
type Errors = Record<string, string>;

function Field(p: { name: string; label: string; type?: string; autoComplete?: string; required?: boolean; error: string | undefined }): ReactElement {
  return (
    <label className="field">
      {p.label}
      <input type={p.type ?? 'text'} name={p.name} autoComplete={p.autoComplete} required={p.required} aria-invalid={p.error ? true : undefined} />
      {p.error ? <span className="err" role="alert">{p.error}</span> : null}
    </label>
  );
}

function Consents({ boxes, errors }: { boxes: BoxText[]; errors: Errors }): ReactElement {
  return (
    <fieldset>
      <legend>¿Cómo quieres que te contactemos? (opcional)</legend>
      {boxes.map((b) => (
        <div key={b.key}>
          <label className="box">
            <input type="checkbox" name={`box_${b.key}`} />
            <span>{b.text}</span>
          </label>
          {errors[`box_${b.key}`] ? <span className="err" role="alert">{errors[`box_${b.key}`]}</span> : null}
        </div>
      ))}
    </fieldset>
  );
}

function utmParams(): Record<string, string> {
  return Object.fromEntries([...new URLSearchParams(window.location.search)].filter(([k]) => k.startsWith('utm_')));
}

async function send(form: HTMLFormElement, p: Props): Promise<{ status: number; errors: Errors; error: string | undefined }> {
  const fd = new FormData(form);
  const body: Record<string, unknown> = { landing: p.landing, stamp: p.stamp, utm: utmParams() };
  for (const [k, v] of fd.entries()) if (typeof v === 'string') body[k] = v;
  const res = await fetch('/api/public/demo-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as { errors?: Errors; error?: string };
  return { status: res.status, errors: j.errors ?? {}, error: j.error };
}

const MESSAGES: Record<string, string> = {
  demasiado_rapido: 'Has enviado el formulario demasiado rápido. Espera un momento e inténtalo de nuevo.',
  formulario_caducado: 'El formulario ha caducado. Recarga la página e inténtalo de nuevo.',
  captcha: 'No hemos podido comprobar que eres una persona. Inténtalo de nuevo.',
  demasiadas_solicitudes: 'Has enviado demasiadas solicitudes. Inténtalo más tarde.',
  formulario_no_disponible: 'El formulario no está disponible por ahora.',
};

export function DemoForm(p: Props): ReactElement {
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [errors, setErrors] = useState<Errors>({});
  const [general, setGeneral] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget;
    setState('sending');
    setGeneral(null);
    const r = await send(form, p).catch(() => null);
    if (r?.status === 200) return setState('done');
    setErrors(r?.errors ?? {});
    setGeneral(r ? (MESSAGES[r.error ?? ''] ?? 'No hemos podido enviar tu solicitud. Inténtalo de nuevo.') : 'No hemos podido conectar. Inténtalo de nuevo.');
    setState('idle');
  }

  if (state === 'done') return <p className="ok" role="status">Gracias. Hemos recibido tu solicitud de demo. Si has marcado alguna forma de contacto, la usaremos para ponernos en contacto contigo.</p>;
  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate>
      <Field name="name" label="Tu nombre" autoComplete="name" required error={errors.name} />
      {p.hasToken ? null : <Field name="company" label="Nombre de tu empresa" autoComplete="organization" required error={errors.company} />}
      <Field name="email" label="Correo electrónico" type="email" autoComplete="email" error={errors.email} />
      <Field name="phone" label="Teléfono" type="tel" autoComplete="tel" error={errors.phone} />
      {errors.contact ? <span className="err" role="alert">{errors.contact}</span> : null}
      <Consents boxes={p.boxes} errors={errors} />
      <p className="info">{p.privacyText}</p>
      <div className="trap" aria-hidden="true"><label>No rellenar<input type="text" name="website_url" tabIndex={-1} autoComplete="off" /></label></div>
      {p.siteKey ? <><div className="cf-turnstile" data-sitekey={p.siteKey} /><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" nonce={p.nonce ?? undefined} /></> : null}
      {p.sandboxToken ? <input type="hidden" name="cf-turnstile-response" value={p.sandboxToken} /> : null}
      {general ? <p className="err" role="alert">{general}</p> : null}
      <button type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Enviando…' : 'Solicitar demo'}</button>
    </form>
  );
}
