-- Payment transactions table for ICICI UPI payment gateway integration
-- Tracks all payment transactions initiated through ICICI gateway
-- Links payments to rentals, battery swaps, and other rider-related actions
create extension if not exists pgcrypto;
create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- ICICI transaction identifiers
  merchant_tran_id text not null,
  ref_id text,
  bank_rrn text,
  -- Transaction details
  amount numeric(12, 2) not null,
  status text not null default 'PENDING',
  transaction_type text not null,
  -- 'NEW_RIDER', 'RETAIN_RIDER', 'RETURN_RIDER', 'BATTERY_SWAP'
  -- Payment context - links to business entities
  rental_id uuid references public.rentals(id) on delete
  set null,
    battery_swap_id uuid references public.battery_swaps(id) on delete
  set null,
    rider_id uuid references public.riders(id) on delete
  set null,
    -- ICICI API response data
    icici_response jsonb,
    callback_data jsonb,
    -- Verification and status tracking
    verified_at timestamptz,
    verification_attempts integer not null default 0,
    last_status_check_at timestamptz,
    -- Metadata for tracking and debugging
    meta jsonb not null default '{}'::jsonb,
    -- Constraints
    constraint payment_transactions_status_check check (
      status in ('PENDING', 'SUCCESS', 'FAILURE', 'CANCELLED')
    ),
    constraint payment_transactions_type_check check (
      transaction_type in (
        'NEW_RIDER',
        'RETAIN_RIDER',
        'RETURN_RIDER',
        'BATTERY_SWAP'
      )
    )
);
-- Indexes for efficient querying
create unique index if not exists payment_transactions_merchant_tran_id_uq on public.payment_transactions (merchant_tran_id);
create index if not exists payment_transactions_ref_id_idx on public.payment_transactions (ref_id)
where ref_id is not null;
create index if not exists payment_transactions_bank_rrn_idx on public.payment_transactions (bank_rrn)
where bank_rrn is not null;
create index if not exists payment_transactions_status_idx on public.payment_transactions (status);
create index if not exists payment_transactions_type_idx on public.payment_transactions (transaction_type);
create index if not exists payment_transactions_rental_id_idx on public.payment_transactions (rental_id)
where rental_id is not null;
create index if not exists payment_transactions_battery_swap_id_idx on public.payment_transactions (battery_swap_id)
where battery_swap_id is not null;
create index if not exists payment_transactions_rider_id_idx on public.payment_transactions (rider_id)
where rider_id is not null;
create index if not exists payment_transactions_created_at_idx on public.payment_transactions (created_at desc);
-- Updated_at trigger
drop trigger if exists set_payment_transactions_updated_at on public.payment_transactions;
create trigger set_payment_transactions_updated_at before
update on public.payment_transactions for each row execute function public.set_updated_at();