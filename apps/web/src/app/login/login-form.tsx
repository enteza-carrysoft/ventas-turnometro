'use client';

import { createAuthClient } from 'better-auth/react';
import { useState, type FormEvent } from 'react';

const authClient = createAuthClient();

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const { error: err } = await authClient.signIn.email({ email: String(f.get('email')), password: String(f.get('password')) });
    if (err) {
      setError('Correo o contraseña incorrectos.');
      setBusy(false);
      return;
    }
    window.location.href = '/';
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, width: 320 }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>Acceso al panel</h1>
      <label>Correo<input name="email" type="email" required autoComplete="username" style={{ display: 'block', width: '100%' }} /></label>
      <label>Contraseña<input name="password" type="password" required autoComplete="current-password" style={{ display: 'block', width: '100%' }} /></label>
      {error ? <p role="alert" style={{ color: '#b00020', margin: 0 }}>{error}</p> : null}
      <button type="submit" disabled={busy}>Entrar</button>
    </form>
  );
}
