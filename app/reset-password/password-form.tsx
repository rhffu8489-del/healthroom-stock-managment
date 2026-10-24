'use client';
import { useActionState } from 'react';
import { updatePassword, type AuthState } from '../login/actions';

export default function PasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, {} as AuthState);
  return <form className="auth-form" action={action}><label>새 비밀번호<input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label><label>비밀번호 확인<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>{state.error && <p className="auth-message error" role="alert">{state.error}</p>}{state.message && <p className="auth-message success" role="status">{state.message}</p>}<button className="button primary login-action" disabled={pending}>{pending ? '변경 중…' : '비밀번호 변경'}</button><a className="button secondary login-action" href="/">내 재고로 돌아가기</a></form>;
}
