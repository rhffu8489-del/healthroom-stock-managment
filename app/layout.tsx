import type { Metadata } from 'next';
import './globals.css';
import './account.css';
export const metadata: Metadata = { title: '보건실 살림 · 재고관리', description: '매일의 재고 관리가 가벼워지는 곳. 물품, 유효기간, 사용 기록을 한눈에 관리하세요.', icons: {icon:'/favicon.svg'} };
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="ko"><body>{children}</body></html>}
