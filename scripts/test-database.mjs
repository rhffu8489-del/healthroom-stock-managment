import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// A fresh in-memory PostgreSQL database. No production connection is used.
const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
`);
await db.exec(await readFile(new URL('../supabase/migrations/202610240001_inventory.sql', import.meta.url), 'utf8'));
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
await db.query('insert into auth.users(id) values ($1), ($2)', [alice, bob]);

async function asUser(id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec('set role authenticated');
}
async function mutate(payload) {
  const result = await db.query('select public.inventory_mutate($1::jsonb) as result', [JSON.stringify(payload)]);
  return result.rows[0].result;
}
async function items() {
  return (await db.query('select * from public.items order by created, id')).rows;
}
async function failure(run, pattern) {
  await assert.rejects(run, pattern);
}
const record = { name: '멸균 거즈', category: '응급처치', unit: '팩', minimum: 3, expiry: '2027-01-01', location: '보관함 A', barcode: '001234' };

await db.exec('set role anon');
await failure(() => mutate({ action: 'create', item: record }), /permission denied/);
await asUser('');
await failure(() => mutate({ action: 'create', item: record }), /로그인/);

await asUser(alice);
await mutate({ action: 'create', owner: bob, item: { ...record, quantity: 999 } });
const item = (await items())[0];
assert.equal(item.owner, alice, 'The owner must come from the authenticated identity');
assert.equal(item.quantity, 0, 'New inventory always starts at zero');
assert.equal(item.barcode, '001234');
await failure(() => db.query('update public.items set quantity=99 where id=$1', [item.id]), /permission denied/);
await failure(() => mutate({ action: 'adjust', id: item.id, delta: -1 }), /재고/);
await failure(() => mutate({ action: 'adjust', id: item.id, delta: 1.5 }), /정수/);
await failure(() => mutate({ action: 'adjust', id: item.id, delta: 0 }), /변경 수량/);
await mutate({ action: 'adjust', id: item.id, delta: 5, class_name: '1-2', reason: '입고' });
for (let n = 0; n < 5; n++) await mutate({ action: 'adjust', id: item.id, delta: -1 });
await failure(() => mutate({ action: 'adjust', id: item.id, delta: -1 }), /재고/);
assert.equal((await items())[0].quantity, 0);
const movement = (await db.query('select id from public.movements where delta=-1 limit 1')).rows[0];
await mutate({ action: 'undo', id: movement.id });
assert.equal((await items())[0].quantity, 1);
await failure(() => mutate({ action: 'undo', id: movement.id }), /되돌/);
await failure(() => mutate({ action: 'edit', id: item.id, item: { ...record, unit: '개' } }), /단위/);
await failure(() => mutate({ action: 'adjust', id: item.id, delta: 1, date: '2099-01-01' }), /과거 날짜/);
await failure(() => mutate({ action: 'create', item: { ...record, name: ' ' } }), /물품명/);
await failure(() => mutate({ action: 'import', items: [{ ...record, quantity: 2 }, { ...record, expiry: '2026-02-30' }] }), /날짜/);
assert.equal((await items()).length, 1, 'An invalid import must roll back every row');
await failure(() => mutate({ action: 'import', items: Array(51).fill(record) }), /50개/);
await mutate({ action: 'settings', warning_days: 14, room_name: '나의 보건실' });
await mutate({ action: 'favorite', id: item.id });
assert.equal((await items())[0].favorite, 1);

await asUser(bob);
assert.equal((await items()).length, 0, 'RLS must hide another account inventory');
assert.equal((await db.query('select * from public.movements')).rows.length, 0);
assert.equal((await db.query('select * from public.settings')).rows.length, 0);
for (const action of ['adjust', 'favorite', 'archive']) {
  await failure(() => mutate({ action, id: item.id, delta: 1 }), /찾을 수 없/);
}
await failure(() => mutate({ action: 'edit', id: item.id, item: record }), /찾을 수 없/);
await failure(() => mutate({ action: 'undo', id: movement.id }), /찾을 수 없/);
await mutate({ action: 'create', item: { ...record, name: '다른 계정의 물품' } });
assert.equal((await items())[0].owner, bob);

await asUser(alice);
assert.equal((await items()).length, 1);
assert.equal((await db.query('select warning_days from public.settings')).rows[0].warning_days, 14);
const historyCount = (await db.query('select count(*)::int as count from public.movements')).rows[0].count;
await mutate({ action: 'archive', id: item.id });
assert.equal((await db.query('select * from public.items where archived=0')).rows.length, 0);
assert.equal((await db.query('select count(*)::int as count from public.movements')).rows[0].count, historyCount);
await failure(() => mutate({ action: 'adjust', id: item.id, delta: 1 }), /찾을 수 없/);
await db.close();
console.log('PASS: migration, anonymous denial, authenticated ownership, RLS isolation, RPC-only writes, quantity validation, no overdraw, undo once, immutable used units, atomic imports, settings, archive retains history');
