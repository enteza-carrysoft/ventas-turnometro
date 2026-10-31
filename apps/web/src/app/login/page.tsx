import { LoginForm } from './login-form.js';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <LoginForm />
    </main>
  );
}
