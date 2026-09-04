import { AuthLayout } from '../auth/AuthLayout';
import { RegisterPanel } from './RegisterPanel';

export function RegisterPage() {
  return <AuthLayout mode="register"><RegisterPanel /></AuthLayout>;
}
