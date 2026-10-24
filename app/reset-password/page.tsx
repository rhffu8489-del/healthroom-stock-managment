import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import PasswordForm from './password-form';

export const dynamic = 'force-dynamic';
export default async function ResetPassword() {
  if (!await getCurrentUser()) redirect('/login?error=invalid-link');
  return <main className="login-page"><section className="login-card"><p className="eyebrow">보건실 살림</p><h1>새 비밀번호 설정</h1><p className="login-description">다음 로그인부터 사용할 비밀번호를 입력하세요.</p><PasswordForm /></section></main>;
}
