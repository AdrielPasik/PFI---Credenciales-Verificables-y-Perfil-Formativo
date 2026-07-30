import type { Metadata } from 'next';

import { LoginScreen } from '@/features/auth/login-screen';

export const metadata: Metadata = {
  title: 'Iniciar sesión'
};

export default function LoginPage() {
  return <LoginScreen />;
}
