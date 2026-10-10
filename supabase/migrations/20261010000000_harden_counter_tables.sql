-- ============================================================================
--  HARDEN COUNTER TABLES + ATOMIC NUMBERING + SAFE RESET / RESTORE
--  Sahil Road Lines ERP
-- ----------------------------------------------------------------------------
--  PROBLEM
--    1. `public.memo_counters` / `public.transport_list_counters` are wide open:
--       anon + authenticated hold direct INSERT/UPDATE/DELETE and an
--       unrestricted "Temporary open access" RLS policy, so any browser could
--       set a counter to any value and re-issue numbers.
--    2. Ordinary memo INSERTs could carry an arbitrary nonempty `memo_number`,
--       and ordinary transport INSERTs an arbitrary `entry_number`, bypassing
--       the sequential allocator entirely.
--    3. Allocation was split across transactions: the client called
--       `next_memo_number()` (advancing the counter) and then inserted the memo
--       in a SEPARATE request. A Reset All Data or backup restore between those
--       two steps could rewind the counter and let the in-flight insert
--       recreate an already-used number.
--    4. `jsonb_populate_record()` fills EVERY column absent from the JSON with
--       NULL. An `INSERT ... SELECT * FROM jsonb_populate_record(...)` therefore
--       writes NULL for omitted columns (id, created_at, updated_at, ...),
--       bypassing column DEFAULTs and violating NOT NULL constraints.
--    5. A raw client insert whose `entry_number` merely equalled some memo number
--       was accepted, so it was impossible to distinguish the genuine
--       memo->transport mirror from an arbitrary client write.
--
--  SOLUTIONS
--    A. Numbering is assigned by a BEFORE INSERT trigger on the row itself, in
--       the SAME transaction as the insert. The trigger ONLY accepts an explicit
--       number while a trusted, SECURITY DEFINER, Super-Admin-only restore RPC
--       has armed a transaction-local flag; any other ordinary insert that
--       supplies a nonempty number is rejected (errcode 42501).
--    B. TRANSPORT explicit values are accepted ONLY when:
--         (i)  the trusted restore flag `app.allow_explicit_entry_number` is
--              armed (restores, or the trusted mirror RPC), OR
--         (ii) `pg_trigger_depth() > 1`, i.e. the insert/update was driven by
--              another database trigger (a memo->transport mirror trigger).
--       A browser cannot fabricate trigger depth, and PostgREST cannot set the
--       `app.*` GUC, so ordinary client writes of an arbitrary entry_number are
--       impossible. The client mirror path goes through the trusted SECURITY
--       DEFINER RPC `mirror_memo_to_transport()` instead of a raw insert.
--    C. A transaction-level advisory lock guards every memo-number mutation
--       (`memo_numbering_lock_key`) and every transport-number mutation
--       (`transport_numbering_lock_key`). They can never interleave.
--    D. `reset_all_data()` clears the business tables and resets ONLY the active
--       year's memo counter to its baseline, in one transaction.
--    E. Restore is ATOMIC and validate-first (see 5 / 5b): formats and required
--       fields are validated before any counter or row is touched, every row is
--       inserted with only its PRESENT columns (so DEFAULTs apply), and any
--       failure rolls the entire restore back.
--    F. The counter reservation in each restore folds in the HIGHEST valid
--       sequence already present in the table as well as the highest restored
--       sequence and the protected current counter, so a counter can never fall
--       behind reality (req. 4).
--    G. Reconciliation is forward-only and server-derived; unique indexes on
--       `memos.memo_number` and `transport_list.entry_number` are the final
--       backstop against duplicates.
--
--  SUPPORTED NUMBER FORMATS (req. 2) — ANYTHING ELSE ABORTS THE RESTORE
--    memo_number     : ^SRL-[0-9]{4}-[0-9]+$   e.g. SRL-2026-003501
--    entry_number    : ^TRP-[0-9]{4}-[0-9]+$   e.g. TRP-2026-000042
--                    | ^SRL-[0-9]{4}-[0-9]+$   (the memo->transport mirror)
--    There are no other supported legacy formats. Unpadded sequences
--    (SRL-2026-123) are accepted; alphabetic or differently prefixed values are
--    NOT and must be normalised before restoring.
--
--  MIRROR / BACKUP INTERACTION (req. 3)
--    `restore_memos` inserts memos. If a memo->transport mirror trigger exists,
--    it creates the corresponding transport rows (allowed via trigger depth).
--    `restore_transport_entries` NEVER overwrites: if a row with the same
--    `entry_number` already exists (e.g. created by that mirror) the ENTIRE
--    restore is rejected with a per-row error and nothing is written. To
--    deliberately overwrite existing transport rows, call the separate
--    Super-Admin RPC `replace_transport_entries(jsonb)`.
--
--  IDEMPOTENT / RE-RUNNABLE (recovery)
--    This file can be applied over a partially-applied state. Every function is
--    `create or replace`; triggers are dropped-then-created; policies are
--    re-created after a scoped drop; indexes are created only when a verified
--    equivalent is absent; the 2026 seed uses `greatest(...)` so re-running can
--    never lower a counter. It never deletes business rows and never runs
--    reset/reconcile.
--
--  FOREIGN-KEY / RESET SCOPE
--    Operational tables: memos, memo_status_history, transport_list,
--    consignees, fleet_trucks, audit_log (cleared); settings, profiles,
--    memo_counters, transport_list_counters (preserved). `reset_all_data()`
--    deletes children before parents and `audit_log` LAST.
--
--  PRE-FLIGHT (run in the SQL editor FIRST; paste the output for review)
--    a) allocator + helper functions: signature, SECURITY DEFINER, OWNER, config
--       select p.proname, pg_get_function_identity_arguments(p.oid) as args,
--              p.prosecdef as security_definer, p.proowner::regrole as owner,
--              p.proconfig as settings, p.prorettype::regtype as returns
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public'
--         and p.proname in ('next_memo_number','next_transport_entry_number');
--    b) counter-table shape + constraints
--       select c.table_name, c.column_name, c.data_type, c.is_nullable,
--              c.column_default
--       from information_schema.columns c
--        where c.table_schema='public'
--          and c.table_name in ('memo_counters','transport_list_counters')
--        order by c.table_name, c.ordinal_position;
--       select conrelid::regclass as table_name, conname, contype,
--              pg_get_constraintdef(oid) as def
--       from pg_constraint
--        where conrelid in ('public.memo_counters'::regclass,
--                           'public.transport_list_counters'::regclass);
--    c) every trigger on the involved tables — CRUCIAL: confirm which trigger
--       (if any) writes into transport_list on memo insert/update, because that
--       is what the `pg_trigger_depth() > 1` exception exists for.
--       select t.tgname, c.relname as table_name, p.proname as function_name,
--              t.tgenabled
--       from pg_trigger t
--       join pg_class c on c.oid=t.tgrelid
--       join pg_proc  p on p.oid=t.tgfoid
--       where not t.tgisinternal
--         and c.relname in ('memos','transport_list','memo_counters',
--                           'transport_list_counters','memo_status_history',
--                           'audit_log');
--    d) existing duplicates (must be empty)
--       select 'memo' as kind, memo_number from public.memos
--        where memo_number is not null group by memo_number having count(*)>1
--       union all
--       select 'transport', entry_number from public.transport_list
--        where entry_number is not null group by entry_number having count(*)>1;
--    e) policies + grants on the counter tables
--       select tablename, policyname, cmd, roles from pg_policies
--        where schemaname='public'
--          and tablename in ('memo_counters','transport_list_counters');
--       select table_name, grantee, privilege_type
--        from information_schema.role_table_grants
--        where table_schema='public'
--          and table_name in ('memo_counters','transport_list_counters');
--    f) full table list
--       select tablename from pg_tables where schemaname='public' order by 1;
--    g) EVERY foreign key in public (reset deletion order)
--       select conrelid::regclass as table_name, conname,
--              pg_get_constraintdef(oid) as definition
--       from pg_constraint where contype='f' and connamespace='public'::regnamespace
--       order by 1;
--    h) RLS state (relforcerowsecurity must be false for the definer writer)
--       select relname, relrowsecurity, relforcerowsecurity
--       from pg_class
--       where relnamespace='public'::regnamespace
--         and relname in ('memos','transport_list','memo_counters',
--                         'transport_list_counters','memo_status_history',
--                         'audit_log','profiles','settings','consignees',
--                         'fleet_trucks');
--
--  VERIFY (after applying)
--    v1) select p.proname, p.prosecdef, p.proowner::regrole, p.proconfig
--        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--        where n.nspname='public' and p.proname in
--          ('is_super_admin','assign_memo_number','protect_memo_number_update',
--           'assign_transport_entry_number','protect_transport_entry_number_update',
--           'mirror_memo_to_transport','restore_memos','restore_transport_entries',
--           'replace_transport_entries','reconcile_memo_counter',
--           'reconcile_transport_counter','reset_all_data');
--    v2) select year, counter from public.memo_counters order by year;
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Helpers: baseline, advisory-lock keys, super-admin check.
-- ---------------------------------------------------------------------------
create or replace function public.memo_number_baseline(p_year integer)
returns bigint language sql immutable
as $$ select case when p_year = 2026 then 3500::bigint else 0::bigint end; $$;
revoke all on function public.memo_number_baseline(integer) from public, anon, authenticated;

create or replace function public.memo_numbering_lock_key()
returns bigint language sql immutable
as $$ select 826412357991::bigint; $$;
revoke all on function public.memo_numbering_lock_key() from public, anon, authenticated;

-- A SEPARATE lock for TRANSPORT numbering (independent of memo numbering).
create or replace function public.transport_numbering_lock_key()
returns bigint language sql immutable
as $$ select 826412357992::bigint; $$;
revoke all on function public.transport_numbering_lock_key() from public, anon, authenticated;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where auth_user_id = auth.uid() and role = 'Super Admin'
  );
$$;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Counter tables become READ-ONLY to the browser.
--    `memo_counters` keeps SELECT (the new-memo preview reads it); the
--    `transport_list_counters` table is not read by any client.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.memo_counters from anon, authenticated;
revoke insert, update, delete, truncate on public.transport_list_counters from anon, authenticated;
revoke all on public.transport_list_counters from anon, authenticated;
revoke all on public.memo_counters from anon;
grant select on public.memo_counters to authenticated;

do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('memo_counters', 'transport_list_counters')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

drop policy if exists counters_read_only on public.memo_counters;
create policy counters_read_only
  on public.memo_counters for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 3. Allocators: SECURITY DEFINER, pinned search_path, EXECUTE revoked from the
--    browser (only the SECURITY DEFINER triggers may call them). The function
--    OWNER must be able to write the counter tables — pre-flight (a)/(h).
-- ---------------------------------------------------------------------------
alter function public.next_memo_number() security definer;
alter function public.next_memo_number() set search_path = public, pg_temp;
alter function public.next_transport_entry_number() security definer;
alter function public.next_transport_entry_number() set search_path = public, pg_temp;

revoke all on function public.next_memo_number() from public, anon, authenticated;
revoke all on function public.next_transport_entry_number() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3b. One advisory lock per counter-table write. Transaction-scoped; the
--     (untouched) allocator bodies participate automatically. reset/reconcile/
--     restore take the same lock explicitly.
-- ---------------------------------------------------------------------------
create or replace function public.lock_memo_numbering()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(public.memo_numbering_lock_key());
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.lock_memo_numbering() from public, anon, authenticated;

drop trigger if exists lock_memo_numbering on public.memo_counters;
create trigger lock_memo_numbering
  before insert or update or delete on public.memo_counters
  for each row execute function public.lock_memo_numbering();

create or replace function public.lock_transport_numbering()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(public.transport_numbering_lock_key());
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.lock_transport_numbering() from public, anon, authenticated;

drop trigger if exists lock_transport_numbering on public.transport_list_counters;
create trigger lock_transport_numbering
  before insert or update or delete on public.transport_list_counters
  for each row execute function public.lock_transport_numbering();

-- The allocators are PRE-EXISTING (not defined by this migration). Fail early
-- with an exact message if either is missing, instead of a cryptic error from
-- the ALTER below / a runtime failure inside the assign triggers.
do $$
begin
  if to_regprocedure('public.next_memo_number()') is null then
    raise exception 'required function public.next_memo_number() is missing — create it before applying this migration';
  end if;
  if to_regprocedure('public.next_transport_entry_number()') is null then
    raise exception 'required function public.next_transport_entry_number() is missing — create it before applying this migration';
  end if;
end $$;

alter function public.next_memo_number() security definer;
alter function public.next_memo_number() set search_path = public, pg_temp;
alter function public.next_transport_entry_number() security definer;
alter function public.next_transport_entry_number() set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 3. ATOMIC + AUTHORIZED memo assignment.
-- ---------------------------------------------------------------------------
create or replace function public.assign_memo_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.memo_number is null or new.memo_number = '' then
    perform pg_advisory_xact_lock(public.memo_numbering_lock_key());
    new.memo_number := public.next_memo_number();
  elsif coalesce(current_setting('app.allow_explicit_memo_number', true), 'off') <> 'on' then
    raise exception
      'memo_number may not be supplied directly; it is assigned automatically by the system'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.assign_memo_number() from public, anon, authenticated;

drop trigger if exists assign_memo_number on public.memos;
create trigger assign_memo_number
  before insert on public.memos
  for each row execute function public.assign_memo_number();

create or replace function public.protect_memo_number_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.memo_number is distinct from old.memo_number
     and coalesce(current_setting('app.allow_explicit_memo_number', true), 'off') <> 'on' then
    raise exception 'memo_number cannot be changed after creation' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_memo_number_update() from public, anon, authenticated;

drop trigger if exists protect_memo_number_update on public.memos;
create trigger protect_memo_number_update
  before update of memo_number on public.memos
  for each row execute function public.protect_memo_number_update();

-- ---------------------------------------------------------------------------
-- 4b. ATOMIC + AUTHORIZED transport assignment (req. 1).
--     Explicit entry_number is accepted ONLY when the trusted restore flag is
--     armed OR the write is nested inside another trigger (a memo->transport
--     mirror trigger). An ordinary client insert/update can do neither.
-- ---------------------------------------------------------------------------
create or replace function public.assign_transport_entry_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.entry_number is null or new.entry_number = '' then
    perform pg_advisory_xact_lock(public.transport_numbering_lock_key());
    new.entry_number := public.next_transport_entry_number();
  elsif coalesce(current_setting('app.allow_explicit_entry_number', true), 'off') <> 'on'
        and pg_trigger_depth() <= 1 then
    raise exception
      'entry_number may not be supplied directly; it is assigned automatically or written by the memo mirror'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.assign_transport_entry_number() from public, anon, authenticated;

drop trigger if exists assign_transport_entry_number on public.transport_list;
create trigger assign_transport_entry_number
  before insert on public.transport_list
  for each row execute function public.assign_transport_entry_number();

create or replace function public.protect_transport_entry_number_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.entry_number is distinct from old.entry_number
     and coalesce(current_setting('app.allow_explicit_entry_number', true), 'off') <> 'on'
     and pg_trigger_depth() <= 1 then
    raise exception 'entry_number cannot be changed to an arbitrary value' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_transport_entry_number_update() from public, anon, authenticated;

drop trigger if exists protect_transport_entry_number_update on public.transport_list;
create trigger protect_transport_entry_number_update
  before update of entry_number on public.transport_list
  for each row execute function public.protect_transport_entry_number_update();

-- ---------------------------------------------------------------------------
-- 4c. TRUSTED MIRROR RPC (req. 1). The client no longer inserts a raw
--     transport row with an explicit entry_number. It calls this SECURITY
--     DEFINER function, which:
--       * requires an authenticated session,
--       * requires the entry_number to be an EXISTING memo number (so it can
--         never be arbitrary),
--     * is idempotent (skips when the mirror already exists), and
--       * arms the trusted flag only for its own INSERT.
-- ---------------------------------------------------------------------------
create or replace function public.mirror_memo_to_transport(p_entry_number text, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cols text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_entry_number is null or btrim(p_entry_number) = '' then
    raise exception 'entry_number is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.memos m where m.memo_number = p_entry_number) then
    raise exception 'entry_number must mirror an existing memo number' using errcode = '42501';
  end if;
  if exists (select 1 from public.transport_list t where t.entry_number = p_entry_number) then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;

  perform set_config('app.allow_explicit_entry_number', 'on', true);
  if p_row is null or p_row = 'null'::jsonb then
    insert into public.transport_list (entry_number) values (p_entry_number);
  else
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into v_cols
      from pg_attribute a
     where a.attrelid = 'public.transport_list'::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attgenerated = '' and a.attidentity = ''
       and a.attname <> 'entry_number'
       and p_row ? a.attname;
    if v_cols is null then
      insert into public.transport_list (entry_number) values (p_entry_number);
    else
      execute format(
        'insert into public.transport_list (entry_number, %1$s) select $2, %1$s from jsonb_populate_record(null::public.transport_list, $1)',
        v_cols
      ) using p_row, p_entry_number;
    end if;
  end if;
  perform set_config('app.allow_explicit_entry_number', 'off', true);

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.mirror_memo_to_transport(text, jsonb) from public, anon;
grant execute on function public.mirror_memo_to_transport(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. TRUSTED BACKUP RESTORE — memos. Super-Admin only, SECURITY DEFINER.
--    ATOMIC and validate-first:
--      PHASE 1 validates every row (format `^SRL-[0-9]{4}-[0-9]+$`, uniqueness
--      within payload, required non-default columns, not already present) and
--      aborts the ENTIRE call on any problem, listing every offending row.
--      PHASE 2 takes the shared lock, reserves each year's range forward-only
--      (folding in the highest existing memo sequence, req. 4), and inserts
--      every row with ONLY its present columns so DEFAULTs apply. Any error
--      rolls the whole transaction back: no counter change, no partial data.
-- ---------------------------------------------------------------------------
create or replace function public.restore_memos(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count    integer;
  v_idx      integer := -1;
  v_elem     jsonb;
  v_memo     text;
  v_required text[];
  v_missing  text;
  v_seen     text[] := '{}';
  v_errors   jsonb := '[]'::jsonb;
  v_cols     text;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin may restore memos' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'restore_memos: p_rows must be a JSON array' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_rows);

  select coalesce(array_agg(a.attname), '{}')
    into v_required
    from pg_attribute a
   where a.attrelid = 'public.memos'::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attnotnull and not a.atthasdef
     and a.attidentity = '' and a.attgenerated = '';

  -- Take the shared numbering lock BEFORE validating live conflicts, so a
  -- concurrent allocator cannot insert a colliding number between validation
  -- and insertion. The lock is transaction-scoped and released on rollback.
  perform pg_advisory_xact_lock(public.memo_numbering_lock_key());

  -- ---- PHASE 1: validate (read-only) --------------------------------------
  for v_elem in select value from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_elem) <> 'object' then
      v_errors := v_errors || jsonb_build_object('index', v_idx, 'error', 'row is not a JSON object');
      continue;
    end if;

    v_memo := v_elem->>'memo_number';
    if v_memo is null or btrim(v_memo) = '' then
      v_errors := v_errors || jsonb_build_object('index', v_idx, 'error', 'missing memo_number');
      continue;
    end if;

    if v_memo !~ '^SRL-[0-9]{4}-[0-9]+$' then
      v_errors := v_errors || jsonb_build_object('index', v_idx,
        'error', format('unsupported memo_number format: %s (expected SRL-YYYY-NNN)', v_memo));
      continue;
    end if;

    if v_memo = any(v_seen) then
      v_errors := v_errors || jsonb_build_object('index', v_idx,
        'error', format('duplicate memo_number in payload: %s', v_memo));
      continue;
    end if;
    v_seen := array_append(v_seen, v_memo);

    for v_missing in
      select k from unnest(v_required) as k where not (v_elem ? k)
    loop
      v_errors := v_errors || jsonb_build_object('index', v_idx,
        'error', format('missing required column: %s', v_missing));
    end loop;

    -- A key may be present yet carry JSON null, which violates NOT NULL just
    -- like a missing key. Reject both shapes so validation matches the table.
    for v_missing in
      select a.attname
        from pg_attribute a
       where a.attrelid = 'public.memos'::regclass
         and a.attnum > 0 and not a.attisdropped
         and a.attnotnull
         and a.attidentity = '' and a.attgenerated = ''
         and v_elem ? a.attname
         and v_elem -> a.attname = 'null'::jsonb
    loop
      v_errors := v_errors || jsonb_build_object('index', v_idx,
        'error', format('null value for NOT NULL column: %s', v_missing));
    end loop;

    if exists (select 1 from public.memos m where m.memo_number = v_memo) then
      v_errors := v_errors || jsonb_build_object('index', v_idx,
        'error', format('memo_number already exists: %s', v_memo));
    end if;
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    raise exception 'restore_memos validation failed: %', v_errors::text using errcode = '22023';
  end if;

  -- ---- PHASE 2: reserve, insert (all-or-nothing). Lock already held. -------
  -- Reserve forward-only, folding in: baseline, highest RESTORED sequence,
  -- highest EXISTING sequence, and the (protected) current counter.
  with restored as (
    select ((regexp_match(memo_number, '^SRL-([0-9]{4})-[0-9]+$'))[1])::integer as year,
           max(((regexp_match(memo_number, '^SRL-[0-9]{4}-([0-9]+)$'))[1])::bigint) as seq
    from (
      select elem->>'memo_number' as memo_number
      from jsonb_array_elements(p_rows) as elem
    ) x
    where memo_number ~ '^SRL-[0-9]{4}-[0-9]+$'
    group by 1
  ),
  existing as (
    select ((regexp_match(memo_number, '^SRL-([0-9]{4})-[0-9]+$'))[1])::integer as year,
           max(((regexp_match(memo_number, '^SRL-[0-9]{4}-([0-9]+)$'))[1])::bigint) as seq
    from public.memos
    where memo_number ~ '^SRL-[0-9]{4}-[0-9]+$'
    group by 1
  )
  insert into public.memo_counters (year, counter)
  select y.year,
         greatest(public.memo_number_baseline(y.year), coalesce(r.seq, 0), coalesce(e.seq, 0))
  from (select year from restored union select year from existing) y
  left join restored r on r.year = y.year
  left join existing e on e.year = y.year
  on conflict (year) do update
    set counter = greatest(public.memo_counters.counter, excluded.counter);

  perform set_config('app.allow_explicit_memo_number', 'on', true);
  for v_elem in select value from jsonb_array_elements(p_rows) loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into v_cols
      from pg_attribute a
     where a.attrelid = 'public.memos'::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attgenerated = '' and a.attidentity = ''
       and v_elem ? a.attname;
    if v_cols is null then
      raise exception 'restore_memos: row has no recognized columns: %', v_elem::text
        using errcode = '22023';
    end if;
    execute format(
      'insert into public.memos (%1$s) select %1$s from jsonb_populate_record(null::public.memos, $1)',
      v_cols
    ) using v_elem;
  end loop;
  perform set_config('app.allow_explicit_memo_number', 'off', true);

  return jsonb_build_object('ok', true, 'inserted', v_count);
end;
$$;
revoke all on function public.restore_memos(jsonb) from public, anon;
grant execute on function public.restore_memos(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5b. TRUSTED BACKUP RESTORE — transport entries. Same atomic/validate-first
--     shape on the INDEPENDENT transport counter/lock. Formats accepted:
--     TRP-YYYY-NNN or the SRL mirror. This function NEVER overwrites an
--     existing transport row: if a row with the same entry_number already
--     exists (e.g. one a memo restore created via a mirror trigger), the ENTIRE
--     restore is rejected with a per-row error and nothing is written — no
--     silent overwrite. Deliberate overwrite is the separate, explicit
--     replace_transport_entries() below.
-- ---------------------------------------------------------------------------
create or replace function public.restore_transport_entries(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count    integer;
  v_idx      integer := -1;
  v_elem     jsonb;
  v_entry    text;
  v_required text[];
  v_missing  text;
  v_seen     text[] := '{}';
  v_errors   jsonb := '[]'::jsonb;
  v_cols     text;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin may restore transport entries' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'restore_transport_entries: p_rows must be a JSON array' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_rows);

  select coalesce(array_agg(a.attname), '{}')
    into v_required
    from pg_attribute a
   where a.attrelid = 'public.transport_list'::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attnotnull and not a.atthasdef
     and a.attidentity = '' and a.attgenerated = '';

  -- Lock BEFORE validating live conflicts — see restore_memos.
  perform pg_advisory_xact_lock(public.transport_numbering_lock_key());

  -- ---- PHASE 1: validate (read-only) --------------------------------------
  for v_elem in select value from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_elem) <> 'object' then
      v_errors := v_errors || jsonb_build_object('index', v_idx, 'error', 'row is not a JSON object');
      continue;
    end if;

    v_entry := v_elem->>'entry_number';
    if v_entry is null or btrim(v_entry) = '' then
      v_errors := v_errors || jsonb_build_object('index', v_idx, 'error', 'missing entry_number');
      continue;
    end if;

    if v_entry !~ '^TRP-[0-9]{4}-[0-9]+$' and v_entry !~ '^SRL-[0-9]{4}-[0-9]+$' then
      v_errors := v_errors || jsonb_build_object('index', v_idx,
        'error', format('unsupported entry_number format: %s (expected TRP-YYYY-NNN or a memo mirror SRL-YYYY-NNN)', v_entry));
      continue;
    end if;

    if v_entry = any(v_seen) then
      v_errors := v_errors || jsonb_build_object('index', v_idx,
        'error', format('duplicate entry_number in payload: %s', v_entry));
      continue;
    end if;
    v_seen := array_append(v_seen, v_entry);

    for v_missing in
      select k from unnest(v_required) as k where not (v_elem ? k)
    loop
      v_errors := v_errors || jsonb_build_object('index', v_idx,
        'error', format('missing required column: %s', v_missing));
    end loop;

    -- A present key carrying JSON null is as invalid as a missing key.
    for v_missing in
      select a.attname
        from pg_attribute a
       where a.attrelid = 'public.transport_list'::regclass
         and a.attnum > 0 and not a.attisdropped
         and a.attnotnull
         and a.attidentity = '' and a.attgenerated = ''
         and v_elem ? a.attname
         and v_elem -> a.attname = 'null'::jsonb
    loop
      v_errors := v_errors || jsonb_build_object('index', v_idx,
        'error', format('null value for NOT NULL column: %s', v_missing));
    end loop;

    -- Reject (never overwrite) a collision with an existing transport row.
    if exists (select 1 from public.transport_list t where t.entry_number = v_entry) then
      v_errors := v_errors || jsonb_build_object('index', v_idx,
        'error', format('entry_number already exists: %s (use replace_transport_entries to overwrite deliberately)', v_entry));
    end if;
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    raise exception 'restore_transport_entries validation failed: %', v_errors::text
      using errcode = '22023';
  end if;

  -- ---- PHASE 2: reserve, insert (all-or-nothing). Lock already held. -------
  with restored as (
    select ((regexp_match(entry_number, '^TRP-([0-9]{4})-[0-9]+$'))[1])::integer as year,
           max(((regexp_match(entry_number, '^TRP-[0-9]{4}-([0-9]+)$'))[1])::bigint) as seq
    from (
      select elem->>'entry_number' as entry_number
      from jsonb_array_elements(p_rows) as elem
    ) x
    where entry_number ~ '^TRP-[0-9]{4}-[0-9]+$'
    group by 1
  ),
  existing as (
    select ((regexp_match(entry_number, '^TRP-([0-9]{4})-[0-9]+$'))[1])::integer as year,
           max(((regexp_match(entry_number, '^TRP-[0-9]{4}-([0-9]+)$'))[1])::bigint) as seq
    from public.transport_list
    where entry_number ~ '^TRP-[0-9]{4}-[0-9]+$'
    group by 1
  )
  insert into public.transport_list_counters (year, counter)
  select y.year, greatest(coalesce(r.seq, 0), coalesce(e.seq, 0))
  from (select year from restored union select year from existing) y
  left join restored r on r.year = y.year
  left join existing e on e.year = y.year
  on conflict (year) do update
    set counter = greatest(public.transport_list_counters.counter, excluded.counter);

  perform set_config('app.allow_explicit_entry_number', 'on', true);
  for v_elem in select value from jsonb_array_elements(p_rows) loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into v_cols
      from pg_attribute a
     where a.attrelid = 'public.transport_list'::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attgenerated = '' and a.attidentity = ''
       and v_elem ? a.attname;
    if v_cols is null then
      raise exception 'restore_transport_entries: row has no recognized columns: %', v_elem::text
        using errcode = '22023';
    end if;

    -- Plain INSERT. Conflicts were already rejected in PHASE 1, and the unique
    -- index on entry_number is the hard backstop; a collision aborts the whole
    -- transaction instead of silently overwriting an existing row.
    execute format(
      'insert into public.transport_list (%1$s) select %1$s from jsonb_populate_record(null::public.transport_list, $1)',
      v_cols
    ) using v_elem;
  end loop;
  perform set_config('app.allow_explicit_entry_number', 'off', true);

  return jsonb_build_object('ok', true, 'inserted', v_count);
end;
$$;
revoke all on function public.restore_transport_entries(jsonb) from public, anon;
grant execute on function public.restore_transport_entries(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5c. EXPLICIT OVERWRITE — transport entries. Super-Admin only, SECURITY
--     DEFINER. Identical validation to restore_transport_entries EXCEPT that a
--     collision is intentional: present non-key columns are updated from the
--     payload via `ON CONFLICT (entry_number) DO UPDATE`. This relies on the
--     PLAIN (non-partial) unique index `transport_list_entry_number_key` on
--     transport_list(entry_number) — NOT a partial index — so the arbiter
--     resolves without a predicate (a partial index is inferred only with a
--     matching WHERE clause, which the plain index rejects). The upsert is a
--     single atomic statement, so concurrent callers cannot race an
--     update-then-insert window; the surrounding transaction advisory lock also
--     serialises it against the other transport-numbering writers.
--     This is a separate, deliberately-named operation so a normal restore can
--     never silently clobber an existing transport row (req. 3/5). entry_number,
--     id and created_at are never rewritten, so identity and the
--     numbering-protection trigger are untouched.
-- ---------------------------------------------------------------------------
create or replace function public.replace_transport_entries(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count    integer;
  v_idx      integer := -1;
  v_elem     jsonb;
  v_entry    text;
  v_required text[];
  v_missing  text;
  v_seen     text[] := '{}';
  v_errors   jsonb := '[]'::jsonb;
  v_cols     text;
  v_update   text;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin may replace transport entries' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'replace_transport_entries: p_rows must be a JSON array' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_rows);

  select coalesce(array_agg(a.attname), '{}')
    into v_required
    from pg_attribute a
   where a.attrelid = 'public.transport_list'::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attnotnull and not a.atthasdef
     and a.attidentity = '' and a.attgenerated = '';

  perform pg_advisory_xact_lock(public.transport_numbering_lock_key());

  -- ---- PHASE 1: validate (read-only) --------------------------------------
  for v_elem in select value from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_elem) <> 'object' then
      v_errors := v_errors || jsonb_build_object('index', v_idx, 'error', 'row is not a JSON object');
      continue;
    end if;

    v_entry := v_elem->>'entry_number';
    if v_entry is null or btrim(v_entry) = '' then
      v_errors := v_errors || jsonb_build_object('index', v_idx, 'error', 'missing entry_number');
      continue;
    end if;

    if v_entry !~ '^TRP-[0-9]{4}-[0-9]+$' and v_entry !~ '^SRL-[0-9]{4}-[0-9]+$' then
      v_errors := v_errors || jsonb_build_object('index', v_idx,
        'error', format('unsupported entry_number format: %s (expected TRP-YYYY-NNN or a memo mirror SRL-YYYY-NNN)', v_entry));
      continue;
    end if;

    if v_entry = any(v_seen) then
      v_errors := v_errors || jsonb_build_object('index', v_idx,
        'error', format('duplicate entry_number in payload: %s', v_entry));
      continue;
    end if;
    v_seen := array_append(v_seen, v_entry);

    -- A present key carrying JSON null is as invalid as a missing key.
    for v_missing in
      select a.attname
        from pg_attribute a
       where a.attrelid = 'public.transport_list'::regclass
         and a.attnum > 0 and not a.attisdropped
         and a.attnotnull
         and a.attidentity = '' and a.attgenerated = ''
         and v_elem ? a.attname
         and v_elem -> a.attname = 'null'::jsonb
    loop
      v_errors := v_errors || jsonb_build_object('index', v_idx,
        'error', format('null value for NOT NULL column: %s', v_missing));
    end loop;
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    raise exception 'replace_transport_entries validation failed: %', v_errors::text
      using errcode = '22023';
  end if;

  -- ---- PHASE 2: reserve forward-only, then explicit upsert ----------------
  with restored as (
    select ((regexp_match(entry_number, '^TRP-([0-9]{4})-[0-9]+$'))[1])::integer as year,
           max(((regexp_match(entry_number, '^TRP-[0-9]{4}-([0-9]+)$'))[1])::bigint) as seq
    from (
      select elem->>'entry_number' as entry_number
      from jsonb_array_elements(p_rows) as elem
    ) x
    where entry_number ~ '^TRP-[0-9]{4}-[0-9]+$'
    group by 1
  ),
  existing as (
    select ((regexp_match(entry_number, '^TRP-([0-9]{4})-[0-9]+$'))[1])::integer as year,
           max(((regexp_match(entry_number, '^TRP-[0-9]{4}-([0-9]+)$'))[1])::bigint) as seq
    from public.transport_list
    where entry_number ~ '^TRP-[0-9]{4}-[0-9]+$'
    group by 1
  )
  insert into public.transport_list_counters (year, counter)
  select y.year, greatest(coalesce(r.seq, 0), coalesce(e.seq, 0))
  from (select year from restored union select year from existing) y
  left join restored r on r.year = y.year
  left join existing e on e.year = y.year
  on conflict (year) do update
    set counter = greatest(public.transport_list_counters.counter, excluded.counter);

  perform set_config('app.allow_explicit_entry_number', 'on', true);
  for v_elem in select value from jsonb_array_elements(p_rows) loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into v_cols
      from pg_attribute a
     where a.attrelid = 'public.transport_list'::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attgenerated = '' and a.attidentity = ''
       and v_elem ? a.attname;
    if v_cols is null then
      raise exception 'replace_transport_entries: row has no recognized columns: %', v_elem::text
        using errcode = '22023';
    end if;

    -- Overwrite every PRESENT non-key column; never touch entry_number, id or
    -- created_at (audit identity stays stable).
    select string_agg(format('%1$I = EXCLUDED.%1$I', a.attname), ', ' order by a.attnum)
      into v_update
      from pg_attribute a
     where a.attrelid = 'public.transport_list'::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attgenerated = '' and a.attidentity = ''
       and a.attname not in ('entry_number', 'id', 'created_at')
       and v_elem ? a.attname;
    v_update := case when v_update is null then 'do nothing' else format('do update set %s', v_update) end;

    -- Arbiter: `on conflict (entry_number)` WITHOUT a predicate, matching the
    -- plain unique index. v_update excludes entry_number / id / created_at and
    -- only names columns actually supplied in this row.
    execute format(
      'insert into public.transport_list (%1$s) select %1$s from jsonb_populate_record(null::public.transport_list, $1) on conflict (entry_number) %2$s',
      v_cols, v_update
    ) using v_elem;
  end loop;
  perform set_config('app.allow_explicit_entry_number', 'off', true);

  return jsonb_build_object('ok', true, 'replaced', v_count);
end;
$$;
revoke all on function public.replace_transport_entries(jsonb) from public, anon;
grant execute on function public.replace_transport_entries(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Restore reconciliation (req. 4/7). Server-derived, forward-only,
--    Super-Admin only. Takes the SAME lock as allocation BEFORE reading the
--    table. The caller supplies ONLY the year — never a value.
-- ---------------------------------------------------------------------------
drop function if exists public.reconcile_memo_counter(integer, bigint);

create or replace function public.reconcile_memo_counter(p_year integer)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_highest bigint;
  v_target  bigint;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin may reconcile memo numbering' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(public.memo_numbering_lock_key());

  select coalesce(max((regexp_match(memo_number, '^SRL-' || p_year::text || '-([0-9]+)$'))[1]::bigint), 0)
    into v_highest
    from public.memos
   where memo_number ~ ('^SRL-' || p_year::text || '-[0-9]+$');

  v_target := greatest(
    public.memo_number_baseline(p_year),
    coalesce(v_highest, 0),
    coalesce((select counter from public.memo_counters where year = p_year), 0)
  );

  insert into public.memo_counters (year, counter)
    values (p_year, v_target)
    on conflict (year) do update
      set counter = greatest(public.memo_counters.counter, excluded.counter);

  return (select counter from public.memo_counters where year = p_year);
end;
$$;
revoke all on function public.reconcile_memo_counter(integer) from public, anon;
grant execute on function public.reconcile_memo_counter(integer) to authenticated;

create or replace function public.reconcile_transport_counter(p_year integer)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_highest bigint;
  v_target  bigint;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin may reconcile transport numbering' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(public.transport_numbering_lock_key());

  select coalesce(max((regexp_match(entry_number, '^TRP-' || p_year::text || '-([0-9]+)$'))[1]::bigint), 0)
    into v_highest
    from public.transport_list
   where entry_number ~ ('^TRP-' || p_year::text || '-[0-9]+$');

  v_target := greatest(
    coalesce(v_highest, 0),
    coalesce((select counter from public.transport_list_counters where year = p_year), 0)
  );

  insert into public.transport_list_counters (year, counter)
    values (p_year, v_target)
    on conflict (year) do update
      set counter = greatest(public.transport_list_counters.counter, excluded.counter);

  return (select counter from public.transport_list_counters where year = p_year);
end;
$$;
revoke all on function public.reconcile_transport_counter(integer) from public, anon;
grant execute on function public.reconcile_transport_counter(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Reset (req. 4/5). Super-Admin only, SECURITY DEFINER, one transaction.
--    Takes the memo lock, guarantees + locks the active-year memo counter row,
--    clears the business tables (children before parents, audit_log LAST), then
--    sets that year's memo counter to its baseline -> first 2026 memo is
--    SRL-2026-003501. This is the ONLY operation allowed to lower a counter, and
--    it does so only AFTER the operational data has been cleared. The transport
--    counter and its lock are deliberately NOT touched: transport numbering is
--    independent and never rewound.
-- ---------------------------------------------------------------------------
create or replace function public.reset_all_data()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year     integer := extract(year from now())::integer;
  v_baseline bigint  := public.memo_number_baseline(extract(year from now())::integer);
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin may reset business data' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(public.memo_numbering_lock_key());

  insert into public.memo_counters (year, counter)
    values (v_year, v_baseline)
    on conflict (year) do update
      set counter = greatest(public.memo_counters.counter, excluded.counter);
  perform 1 from public.memo_counters where year = v_year for update;

  -- Children before parents so foreign keys never block the wipe.
  -- `audit_log` is cleared LAST so audit/status rows written by the deletes
  -- above are removed too. Safe ONLY while `audit_log` has no FK pointing into
  -- the tables below — confirm with pre-flight (g); if it does, move its delete
  -- before the referenced table.
  delete from public.memo_status_history where true;
  delete from public.transport_list where true;
  delete from public.memos where true;
  delete from public.consignees where true;
  delete from public.fleet_trucks where true;
  delete from public.audit_log where true;

  -- Operational data is gone: NOW the active-year memo counter may be lowered.
  update public.memo_counters set counter = v_baseline where year = v_year;
end;
$$;
revoke all on function public.reset_all_data() from public, anon;
grant execute on function public.reset_all_data() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Hard backstop against duplicate numbers, then the unique indexes.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from public.memos
    where memo_number is not null group by memo_number having count(*) > 1
  ) then
    raise exception 'Cannot add unique index memos_memo_number_key: duplicate memo_number rows exist — resolve them first';
  end if;
  if exists (
    select 1 from public.transport_list
    where entry_number is not null group by entry_number having count(*) > 1
  ) then
    raise exception 'Cannot add unique index transport_list_entry_number_key: duplicate entry_number rows exist — resolve them first';
  end if;
end $$;

-- Create each unique index only if it does not already exist, and if a
-- same-named index DOES exist, verify it really is a single-column, VALID,
-- UNIQUE index over the intended column before trusting it. `... IF NOT EXISTS`
-- alone would happily leave a wrong/partial/invalid index in place.
do $$
declare
  v_named oid;
  v_ok    boolean;
begin
  v_named := to_regclass('public.memos_memo_number_key');
  if v_named is null then
    execute 'create unique index memos_memo_number_key on public.memos (memo_number) where memo_number is not null';
  else
    select exists (
      select 1
        from pg_index i
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
       where i.indexrelid = v_named
         and i.indisunique and i.indisvalid
         and i.indnkeyatts = 1
         and a.attname = 'memo_number'
    ) into v_ok;
    if not coalesce(v_ok, false) then
      raise exception 'memos_memo_number_key exists but is not a valid single-column unique index on memos(memo_number) — drop it and re-run';
    end if;
  end if;

  v_named := to_regclass('public.transport_list_entry_number_key');
  if v_named is null then
    -- PLAIN unique index (no WHERE predicate): replace_transport_entries()
    -- arbitrates with `on conflict (entry_number)`, which cannot infer a
    -- partial index. Production already has this plain index, so this branch
    -- only runs on a fresh database and keeps the two shapes consistent.
    execute 'create unique index transport_list_entry_number_key on public.transport_list (entry_number)';
  else
    select exists (
      select 1
        from pg_index i
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
       where i.indexrelid = v_named
         and i.indisunique and i.indisvalid
         and i.indnkeyatts = 1
         and i.indpred is null
         and a.attname = 'entry_number'
    ) into v_ok;
    if not coalesce(v_ok, false) then
      raise exception 'transport_list_entry_number_key exists but is not a valid single-column, non-partial unique index on transport_list(entry_number) — replace_transport_entries() requires a plain unique index; drop it and re-run';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Seed the 2026 baseline. Idempotent; never lowers an existing counter and
--    leaves every other year alone.
-- ---------------------------------------------------------------------------
insert into public.memo_counters (year, counter)
values (2026, 3500)
on conflict (year) do update
  set counter = greatest(public.memo_counters.counter, excluded.counter);

commit;

notify pgrst, 'reload schema';
