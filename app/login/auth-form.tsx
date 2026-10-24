'use client';

import { useActionState, useState } from 'react';
import { ArrowRight, KeyRound, Mail } from 'lucide-react';
import { forgotPassword, login, signup, type AuthState } from './actions';

type Mode = 'login' | 'signup' | 'forgot';
const initialState: AuthState = {};

function Form({ mode }: { mode: Mode }) {
  const [state, action, pending] = useActionState(mode === 'signup' ? signup : mode === 'forgot' ? forgotPassword : login, initialState);
  return <form action={action} className="auth-form">
    {mode === 'signup' && <label>이름 (선택)<input name="name" autoComplete="name" maxLength={80} placeholder="보건 선생님" /></label>}
    <label>이메일<div className="auth-input"><Mail size={17} /><input name="email" type="email" autoComplete="email" maxLength={254} required placeholder="you@example.com" /></div></label>
    {mode !== 'forgot' && <label>비밀번호<div className="auth-input"><KeyRound size={17} /><input name="password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={mode === 'signup' ? 8 : 1} maxLength={128} required placeholder={mode === 'signup' ? '8자 이상 입력하세요' : '비밀번호를 입력하세요'} /></div></label>}
    {mode === 'signup' && <label>비밀번호 확인<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required placeholder="비밀번호를 한 번 더 입력하세요" /></label>}
    {state.error && <p className="auth-message error" role="alert">{state.error}</p>}
    {state.message && <p className="auth-message success" role="status">{state.message}</p>}
    <button className="button primary login-action" disabled={pending}>{pending ? '처리 중…' : mode === 'signup' ? '회원가입' : mode === 'forgot' ? '재설정 안내 받기' : '이메일로 로그인'}<ArrowRight size={17} /></button>
  </form>;
}

export default function AuthForm() {
  const [mode, setMode] = useState<Mode>('login');
  return <>
    <div className="auth-tabs" aria-label="계정 이용 방식"><button aria-pressed={mode === 'login'} onClick={() => setMode('login')}>로그인</button><button aria-pressed={mode === 'signup'} onClick={() => setMode('signup')}>회원가입</button></div>
    {mode === 'forgot' && <p className="account-description">가입한 이메일로 비밀번호 재설정 링크를 보내드려요.</p>}
    <Form key={mode} mode={mode} />
    <button className="auth-text-button" onClick={() => setMode(mode === 'forgot' ? 'login' : 'forgot')}>{mode === 'forgot' ? '로그인으로 돌아가기' : '비밀번호를 잊으셨나요?'}</button>
  </>;
}
