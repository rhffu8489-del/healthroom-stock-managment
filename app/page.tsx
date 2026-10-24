import { redirect } from 'next/navigation';
import Dashboard from './dashboard';
import { getCurrentUser, userDisplayName } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <Dashboard userName={userDisplayName(user)} userEmail={user.email || ''} signOutHref="/auth/signout" />;
}
