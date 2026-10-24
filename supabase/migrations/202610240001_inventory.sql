-- Run once on the dedicated Supabase project. Application writes only use
-- inventory_mutate: one PostgreSQL transaction per inventory action.
begin;

create table public.items (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  category text not null check (length(category) between 1 and 40),
  unit text not null check (length(unit) between 1 and 20),
  quantity integer not null default 0 check (quantity between 0 and 1000000),
  minimum integer not null default 5 check (minimum between 0 and 1000000),
  expiry date,
  location text not null default '' check (length(location) <= 100),
  barcode text not null default '' check (length(barcode) <= 100),
  note text not null default '' check (length(note) <= 1000),
  favorite smallint not null default 0 check (favorite in (0, 1)),
  archived smallint not null default 0 check (archived in (0, 1)),
  created timestamptz not null default now(),
  unique (id, owner)
);
create index items_owner_active on public.items(owner, archived, created desc, id);

create table public.movements (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null,
  item_name text not null,
  delta integer not null check (delta between -1000000 and 1000000 and delta <> 0),
  reason text not null check (length(reason) between 1 and 100),
  class_name text not null default '' check (length(class_name) <= 80),
  date date not null,
  created timestamptz not null default now(),
  undone smallint not null default 0 check (undone in (0, 1)),
  undo_of uuid references public.movements(id),
  foreign key (item_id, owner) references public.items(id, owner)
);
create index movements_owner_created on public.movements(owner, created desc, id);
create unique index movements_undo_once on public.movements(owner, undo_of) where undo_of is not null;

create table public.settings (
  owner uuid primary key references auth.users(id) on delete cascade,
  warning_days integer not null default 30 check (warning_days between 1 and 365),
  room_name text not null default '우리 학교 보건실' check (length(room_name) between 1 and 80)
);

alter table public.items enable row level security;
alter table public.movements enable row level security;
alter table public.settings enable row level security;
create policy items_read_own on public.items for select to authenticated using ((select auth.uid()) = owner);
create policy movements_read_own on public.movements for select to authenticated using ((select auth.uid()) = owner);
create policy settings_read_own on public.settings for select to authenticated using ((select auth.uid()) = owner);
revoke all on public.items, public.movements, public.settings from anon, authenticated;
grant select on public.items, public.movements, public.settings to authenticated;

create function public.inventory_integer(p_value jsonb, p_min integer, p_max integer)
returns integer language plpgsql immutable set search_path = '' as $$
declare v numeric;
begin
  begin v := (p_value #>> '{}')::numeric;
  exception when others then raise exception '수량은 범위 안의 정수로 입력해 주세요.'; end;
  if v is null or v <> trunc(v) or v < p_min or v > p_max then
    raise exception '수량은 범위 안의 정수로 입력해 주세요.';
  end if;
  return v::integer;
end;
$$;
revoke all on function public.inventory_integer(jsonb, integer, integer) from public, anon, authenticated;

create function public.inventory_date(p_value text, p_optional boolean default false)
returns date language plpgsql immutable set search_path = '' as $$
declare v date;
begin
  if coalesce(p_value, '') = '' and p_optional then return null; end if;
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '날짜를 정확히 입력해 주세요.'; end if;
  begin v := p_value::date;
  exception when others then raise exception '날짜를 정확히 입력해 주세요.'; end;
  return v;
end;
$$;
revoke all on function public.inventory_date(text, boolean) from public, anon, authenticated;

create function public.inventory_mutate(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_action text := p_payload->>'action';
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_rows jsonb; v_row jsonb; v_id uuid; v_mid uuid;
  v_item public.items%rowtype; v_movement public.movements%rowtype;
  v_name text; v_category text; v_unit text; v_location text; v_barcode text; v_note text;
  v_minimum integer; v_quantity integer; v_favorite smallint; v_expiry date;
  v_delta integer; v_date date; v_reason text; v_class text; v_days integer; v_room text;
begin
  if v_owner is null then raise exception '로그인이 필요합니다.' using errcode = '28000'; end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception '요청 내용을 확인해 주세요.'; end if;

  if v_action in ('create', 'import', 'edit') then
    if v_action = 'import' then
      v_rows := p_payload->'items';
      if jsonb_typeof(v_rows) is distinct from 'array' then raise exception '물품 목록을 확인해 주세요.'; end if;
      if jsonb_array_length(v_rows) not between 1 and 50 then raise exception '한 번에 1~50개 물품을 등록할 수 있습니다.'; end if;
    else
      if jsonb_typeof(p_payload->'item') is distinct from 'object' then raise exception '물품 정보를 확인해 주세요.'; end if;
      v_rows := jsonb_build_array(p_payload->'item');
    end if;

    for v_row in select value from jsonb_array_elements(v_rows) loop
      if jsonb_typeof(v_row) is distinct from 'object' then raise exception '물품 정보를 확인해 주세요.'; end if;
      v_name := left(btrim(coalesce(v_row->>'name', '')), 100);
      if v_name = '' then raise exception '물품명을 입력해 주세요.'; end if;
      v_category := coalesce(nullif(left(btrim(v_row->>'category'), 40), ''), '기타');
      v_unit := coalesce(nullif(left(btrim(v_row->>'unit'), 20), ''), '개');
      v_minimum := public.inventory_integer(coalesce(v_row->'minimum', '5'::jsonb), 0, 1000000);
      v_expiry := public.inventory_date(v_row->>'expiry', true);
      v_location := left(btrim(coalesce(v_row->>'location', '')), 100);
      v_barcode := left(btrim(coalesce(v_row->>'barcode', '')), 100);
      v_note := left(btrim(coalesce(v_row->>'note', '')), 1000);
      v_favorite := case when v_row->>'favorite' in ('true', '1') then 1 else 0 end;

      if v_action = 'edit' then
        v_id := (p_payload->>'id')::uuid;
        select * into v_item from public.items where id = v_id and owner = v_owner and archived = 0 for update;
        if not found then raise exception '물품을 찾을 수 없습니다.' using errcode = 'P0002'; end if;
        if v_unit <> v_item.unit and exists(select 1 from public.movements where item_id = v_id and owner = v_owner) then
          raise exception '사용 이력이 있는 물품의 단위는 바꿀 수 없습니다. 새 단위로 별도 물품을 등록해 주세요.';
        end if;
        update public.items set name = v_name, category = v_category, unit = v_unit, minimum = v_minimum,
          expiry = v_expiry, location = v_location, barcode = v_barcode, note = v_note, favorite = v_favorite
          where id = v_id and owner = v_owner;
      else
        v_id := gen_random_uuid();
        v_quantity := case when v_action = 'create' then 0 else public.inventory_integer(coalesce(v_row->'quantity', '0'::jsonb), 0, 1000000) end;
        insert into public.items(id, owner, name, category, unit, quantity, minimum, expiry, location, barcode, note, favorite)
          values(v_id, v_owner, v_name, v_category, v_unit, v_quantity, v_minimum, v_expiry, v_location, v_barcode, v_note, v_favorite);
        if v_quantity > 0 then
          insert into public.movements(owner, item_id, item_name, delta, reason, date)
            values(v_owner, v_id, v_name, v_quantity, '엑셀 초기 재고', v_today);
        end if;
      end if;
    end loop;
    return jsonb_build_object('ok', true, 'count', jsonb_array_length(v_rows));
  end if;

  if v_action = 'settings' then
    v_days := public.inventory_integer(p_payload->'warning_days', 1, 365);
    v_room := coalesce(nullif(left(btrim(p_payload->>'room_name'), 80), ''), '우리 학교 보건실');
    insert into public.settings(owner, warning_days, room_name) values(v_owner, v_days, v_room)
      on conflict(owner) do update set warning_days = excluded.warning_days, room_name = excluded.room_name;
    return jsonb_build_object('ok', true);
  end if;

  if v_action = 'undo' then
    select * into v_movement from public.movements where id = (p_payload->>'id')::uuid and owner = v_owner for update;
    if not found then raise exception '기록을 찾을 수 없습니다.' using errcode = 'P0002'; end if;
    if v_movement.undone = 1 or v_movement.undo_of is not null then raise exception '이미 되돌렸거나 되돌릴 수 없는 기록입니다.'; end if;
    select * into v_item from public.items where id = v_movement.item_id and owner = v_owner and archived = 0 for update;
    if not found then raise exception '물품을 찾을 수 없습니다.' using errcode = 'P0002'; end if;
    if v_item.quantity - v_movement.delta not between 0 and 1000000 then raise exception '현재 재고로 되돌릴 수 없는 기록입니다.'; end if;
    update public.items set quantity = quantity - v_movement.delta where id = v_item.id and owner = v_owner;
    update public.movements set undone = 1 where id = v_movement.id and owner = v_owner;
    insert into public.movements(owner, item_id, item_name, delta, reason, class_name, date, undo_of)
      values(v_owner, v_item.id, v_movement.item_name, -v_movement.delta, '되돌리기', v_movement.class_name, v_today, v_movement.id);
    return jsonb_build_object('ok', true);
  end if;

  if v_action not in ('adjust', 'favorite', 'archive') or v_action is null then raise exception '지원하지 않는 작업입니다.'; end if;
  select * into v_item from public.items where id = (p_payload->>'id')::uuid and owner = v_owner and archived = 0 for update;
  if not found then raise exception '물품을 찾을 수 없습니다.' using errcode = 'P0002'; end if;
  if v_action = 'adjust' then
    v_delta := public.inventory_integer(p_payload->'delta', -1000000, 1000000);
    if v_delta = 0 then raise exception '변경 수량을 입력해 주세요.'; end if;
    if v_item.quantity + v_delta not between 0 and 1000000 then raise exception '재고가 부족하거나 허용 수량을 초과했습니다.'; end if;
    v_date := public.inventory_date(coalesce(nullif(p_payload->>'date', ''), v_today::text));
    if v_date > v_today then raise exception '사용일은 오늘 또는 과거 날짜로 입력해 주세요.'; end if;
    v_reason := coalesce(nullif(left(btrim(p_payload->>'reason'), 100), ''), case when v_delta > 0 then '입고' else '사용' end);
    v_class := left(btrim(coalesce(p_payload->>'class_name', '')), 80);
    v_mid := gen_random_uuid();
    update public.items set quantity = quantity + v_delta where id = v_item.id and owner = v_owner;
    insert into public.movements(id, owner, item_id, item_name, delta, reason, class_name, date)
      values(v_mid, v_owner, v_item.id, v_item.name, v_delta, v_reason, v_class, v_date);
    return jsonb_build_object('ok', true, 'movementId', v_mid);
  elsif v_action = 'favorite' then
    update public.items set favorite = 1 - favorite where id = v_item.id and owner = v_owner;
  elsif v_action = 'archive' then
    update public.items set archived = 1 where id = v_item.id and owner = v_owner;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.inventory_mutate(jsonb) from public, anon;
grant execute on function public.inventory_mutate(jsonb) to authenticated;
commit;
