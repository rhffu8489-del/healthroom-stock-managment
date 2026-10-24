import { ArrowRight, Check, LogOut, Plus, ShieldCheck } from 'lucide-react';
import { getCurrentUser, userDisplayName } from '@/lib/auth';
import { getSupabaseConfig } from '@/lib/supabase/config';
import AuthForm from './auth-form';

export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await getCurrentUser();
  const configured = !!getSupabaseConfig();
  const params = await searchParams;
  return <main className="login-page"><section className="login-card" aria-labelledby="login-title">
    <a className="brand" href="/" aria-label="보건실 살림 홈"><span className="brand-symbol"><Plus size={24} strokeWidth={3} /></span><span>보건실 <b>살림</b><small>HEALTH ROOM INVENTORY</small></span></a>
    <span className="login-icon"><ShieldCheck size={30} /></span><p className="eyebrow">나의 보건실, 나의 기록</p>
    <h1 id="login-title">{user ? '다시 만나 반가워요' : '나의 보건실에 로그인'}</h1>
    <p className="login-description">물품과 재고, 사용 이력을 계정에 저장해요.<br />같은 이메일로 로그인해 어디서든 기록을 이어가세요.</p>
    {params.error && <p className="auth-message error" role="alert">인증 링크가 만료되었거나 유효하지 않습니다. 다시 요청해 주세요.</p>}
    {user ? <><div className="account-summary"><span className="account-status"><Check size={15} />이메일 로그인됨</span><strong>{userDisplayName(user)}</strong><p>{user.email}</p></div><a className="button primary login-action" href="/">내 재고로 계속하기<ArrowRight size={17} /></a><form action="/auth/signout" method="post"><button className="button secondary login-action"><LogOut size={16} />로그아웃</button></form></> : configured ? <AuthForm /> : <div className="auth-message setup" role="status"><strong>로그인 연결을 준비하고 있어요</strong><p>서비스 설정이 완료되면 이곳에서 이메일로 가입하고 로그인할 수 있어요.</p></div>}
    <p className="login-note">재고와 사용 기록은 로그인한 본인 계정에서 관리합니다.<br />비밀번호는 인증 서비스에서 안전하게 처리합니다.</p>
  </section></main>;
}
