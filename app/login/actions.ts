'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';

export type AuthState = { error?: string; message?: string };

function credentials(form: FormData) {
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: '이메일 주소를 확인해 주세요.' } as const;
  if (!password || password.length > 128) return { error: '비밀번호를 입력해 주세요.' } as const;
  return { email, password };
}

async function callbackUrl(next = '/') {
  const requestHeaders = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL || requestHeaders.get('origin') || 'http://localhost:3000';
  const callback = new URL('/auth/callback', origin);
  callback.searchParams.set('next', next);
  return callback.toString();
}

export async function login(_state: AuthState, form: FormData): Promise<AuthState> {
  if (!getSupabaseConfig()) return { error: '로그인 서비스 연결을 준비하고 있습니다.' };
  const values = credentials(form);
  if ('error' in values) return { error: values.error };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(values);
  if (error) return { error: error.code === 'email_not_confirmed' ? '이메일의 인증 링크를 먼저 눌러 주세요.' : error.status === 429 ? '요청이 많습니다. 잠시 뒤 다시 시도해 주세요.' : '이메일 또는 비밀번호를 확인해 주세요.' };
  redirect('/');
}

export async function signup(_state: AuthState, form: FormData): Promise<AuthState> {
  if (!getSupabaseConfig()) return { error: '회원가입 서비스 연결을 준비하고 있습니다.' };
  const values = credentials(form);
  if ('error' in values) return { error: values.error };
  if (values.password.length < 8) return { error: '비밀번호는 8자 이상 입력해 주세요.' };
  if (values.password !== form.get('confirmPassword')) return { error: '비밀번호가 서로 다릅니다.' };
  const name = String(form.get('name') || '').trim().slice(0, 80);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ ...values, options: { data: { display_name: name }, emailRedirectTo: await callbackUrl() } });
  if (error) return { error: error.status === 429 ? '요청이 많습니다. 잠시 뒤 다시 시도해 주세요.' : '회원가입을 완료하지 못했습니다. 입력 내용을 확인하거나 잠시 뒤 다시 시도해 주세요.' };
  if (data.session) redirect('/');
  return { message: '이메일로 인증 안내를 보냈습니다. 받은 편지함의 링크를 누른 뒤 로그인해 주세요. 이미 가입했다면 로그인 또는 비밀번호 재설정을 이용하세요.' };
}

export async function forgotPassword(_state: AuthState, form: FormData): Promise<AuthState> {
  if (!getSupabaseConfig()) return { error: '로그인 서비스 연결을 준비하고 있습니다.' };
  const email = String(form.get('email') || '').trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: '이메일 주소를 확인해 주세요.' };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: await callbackUrl('/reset-password') });
  return { message: '가입된 이메일이면 비밀번호 재설정 안내가 발송됩니다. 받은 편지함을 확인해 주세요.' };
}

export async function updatePassword(_state: AuthState, form: FormData): Promise<AuthState> {
  if (!getSupabaseConfig()) return { error: '로그인 서비스 연결을 준비하고 있습니다.' };
  const password = String(form.get('password') || '');
  if (password.length < 8 || password.length > 128) return { error: '비밀번호는 8~128자로 입력해 주세요.' };
  if (password !== form.get('confirmPassword')) return { error: '비밀번호가 서로 다릅니다.' };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: '재설정 링크가 만료되었습니다. 로그인 화면에서 다시 요청해 주세요.' };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: '비밀번호를 변경하지 못했습니다. 이전과 다른 비밀번호로 다시 시도해 주세요.' };
  return { message: '비밀번호를 변경했습니다. 내 재고로 돌아가서 계속 이용하세요.' };
}
