# 보건실 살림

보건실의 물품·재고·유효기간·입출고 이력을 관리하는 Next.js 앱입니다.
Vercel에 배포하고, Supabase 이메일·비밀번호 인증과 PostgreSQL에 연결합니다.

## 기능

- 이메일 회원가입, 이메일 인증, 로그인·로그아웃, 비밀번호 재설정
- 로그인 계정 표시와 계정별 재고·사용 이력·보건실 설정 저장
- 물품 등록·편집, 즐겨찾기, 검색·필터·정렬, 위치별 보기
- 빠른 +1 입고 / −1 사용, 상세 입출고, 학급·사유 기록, 한 번만 되돌리기
- 재고 부족·유효기간 알림, 엑셀 일괄 등록 및 내보내기, 사용 통계·구매 목록

## 설치와 로컬 실행

Node.js 22.13 이상이 필요합니다.

```sh
npm ci
```

`.env.example`을 `.env.local`로 복사하고 아래 값을 지정합니다.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Supabase의 publishable key(또는 legacy anon key)를 사용합니다. `service_role` 키는 필요하지 않으며 브라우저용 환경변수에 넣지 않습니다.

전용 Supabase 프로젝트에서 `supabase/migrations/202610240001_inventory.sql`을 한 번 적용합니다.
이미 적용된 SQL을 반복 실행하지 않습니다. 기존 프로젝트에 동일 테이블이 있다면 새 전용 프로젝트를 사용하세요.

```sh
npm run dev
```

## Vercel 배포

1. 이 저장소를 Vercel에서 Import하고 Framework Preset을 Next.js로 선택합니다.
2. 위 Supabase URL·publishable key를 Vercel의 Production 환경변수로 등록합니다.
3. 배포 URL을 확인한 후 `NEXT_PUBLIC_SITE_URL`을 실제 HTTPS 주소로 설정하고 다시 배포합니다.
4. Supabase Authentication → URL Configuration의 Site URL을 같은 HTTPS 주소로 지정합니다.
5. Redirect URLs에 `https://YOUR_DOMAIN/auth/callback`과 `http://localhost:3000/auth/callback`을 등록합니다. Supabase Email provider와 이메일 확인을 활성화합니다.
6. 배포 후 회원가입 → 이메일 인증 → 로그인 → 물품 등록 → 로그아웃 → 재로그인 순서로 기록 보존을 확인합니다.

이메일 인증·비밀번호 재설정은 기본 Supabase 이메일 템플릿과 `/auth/callback`을 사용합니다.
다른 브라우저에서도 인증 링크를 처리하려면 이메일 템플릿을 token hash 방식으로 설정할 수 있습니다.

회원가입 확인 링크:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup">이메일 인증</a>
```

비밀번호 재설정 링크:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">비밀번호 재설정</a>
```

실사용 이메일 발송량이 필요하면 Supabase의 SMTP 설정을 확인하세요.

## 데이터 접근과 보존

- 서버에서 검증한 Supabase 사용자 ID로 계정을 구분합니다. 브라우저가 보낸 owner 값이나 사용자 헤더를 신뢰하지 않습니다.
- 테이블의 Row Level Security는 자신의 기록 조회만 허용합니다.
- 쓰기는 검증된 `inventory_mutate` 함수로만 허용합니다. 함수는 로그인 사용자 ID를 직접 읽고, 한 트랜잭션 안에서 재고와 이력을 함께 변경합니다.
- 동시 입출고·되돌리기는 PostgreSQL 행 잠금으로 처리하며, 음수 재고와 중복 되돌리기를 방지합니다.
- 로그아웃은 저장된 재고를 삭제하지 않습니다. 물품 보관 처리는 이력을 남깁니다.
- 이전 Sites 앱과 별도 데이터베이스입니다. 기존 기록을 가져오려면 이전 앱에서 엑셀로 내보낸 뒤 새 계정에서 가져오세요. 이전 사용 이력은 자동 이전되지 않습니다.

통계는 최근 10,000건을 사용합니다. 엑셀 가져오기는 한 번에 50행, 파일은 최대 5MB입니다.
카메라 스캔·백그라운드 푸시·문자·이메일 알림은 제공하지 않습니다. 브라우저 알림은 사이트를 열어 둔 동안만 동작합니다.

## 검증

```sh
npm run typecheck
npm run test:db
npm run build
```

`scripts/test-http.py`는 127.0.0.1:3000에서 실행 중인 빌드 서버에 대해 로그인 화면·익명 접근 차단·위조 사용자 헤더 차단·요청 Origin 검사·리디렉션을 읽기 전용으로 검증합니다. Supabase URL과 publishable key 설정이 필요하며 회원가입이나 이메일 발송은 수행하지 않습니다.

환경변수가 없으면 실제 로그인·저장을 가장하지 않고 로그인 연결 준비 상태를 표시합니다.
