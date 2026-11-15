create table if not exists public.table_inventory (
    tier text primary key check (tier in ('normal', 'classic', 'vip')),
    table_count integer check (table_count is null or table_count >= 0)
);

insert into public.table_inventory (tier, table_count)
values ('normal', 50), ('classic', 20), ('vip', 10)
on conflict (tier) do nothing;

create table if not exists public.reservations (
    id uuid primary key default gen_random_uuid(),
    customer_name text not null,
    customer_email text not null,
    phone_number text not null,
    reservation_date date not null,
    reservation_time time not null,
    guests integer not null check (guests > 0),
    table_tier text not null check (table_tier in ('normal', 'classic', 'vip')),
    price_kes integer not null check (
        (table_tier = 'normal' and price_kes = 1000)
        or (table_tier = 'classic' and price_kes = 2500)
        or (table_tier = 'vip' and price_kes = 3500)
    ),
    created_at timestamptz not null default now()
);

create index if not exists reservations_slot_tier_idx
    on public.reservations (reservation_date, reservation_time, table_tier);

alter table public.table_inventory enable row level security;
alter table public.reservations enable row level security;

revoke all on public.table_inventory from public, anon, authenticated;
revoke all on public.reservations from public, anon, authenticated;

create or replace function public.create_table_reservation(
    p_customer_name text,
    p_customer_email text,
    p_phone_number text,
    p_reservation_date date,
    p_reservation_time time,
    p_guests integer,
    p_table_tier text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_table_count integer;
    v_booked_count integer;
    v_price_kes integer;
    v_reservation_id uuid;
begin
    v_price_kes := case p_table_tier
        when 'normal' then 1000
        when 'classic' then 2500
        when 'vip' then 3500
        else null
    end;

    if v_price_kes is null then
        raise exception 'Invalid table tier';
    end if;

    perform pg_advisory_xact_lock(
        hashtextextended(
            p_reservation_date::text || ':' || p_reservation_time::text || ':' || p_table_tier,
            0
        )
    );

    select table_count
    into v_table_count
    from public.table_inventory
    where tier = p_table_tier;

    if not found or v_table_count is null then
        return jsonb_build_object('status', 'unconfigured');
    end if;

    select count(*)::integer
    into v_booked_count
    from public.reservations
    where reservation_date = p_reservation_date
      and reservation_time = p_reservation_time
      and table_tier = p_table_tier;

    if v_booked_count >= v_table_count then
        return jsonb_build_object('status', 'full');
    end if;

    insert into public.reservations (
        customer_name,
        customer_email,
        phone_number,
        reservation_date,
        reservation_time,
        guests,
        table_tier,
        price_kes
    )
    values (
        p_customer_name,
        p_customer_email,
        p_phone_number,
        p_reservation_date,
        p_reservation_time,
        p_guests,
        p_table_tier,
        v_price_kes
    )
    returning id into v_reservation_id;

    return jsonb_build_object(
        'status', 'received',
        'reservationId', v_reservation_id,
        'tier', p_table_tier,
        'priceKes', v_price_kes
    );
end;
$$;

revoke all on function public.create_table_reservation(text, text, text, date, time, integer, text)
    from public, anon, authenticated;
grant execute on function public.create_table_reservation(text, text, text, date, time, integer, text)
    to service_role;
