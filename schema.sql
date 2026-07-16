-- ====================================================================
-- TRAIL CASH DATABASE SCHEMA (SUPABASE POSTGRESQL)
-- ====================================================================

-- 1. Profiles Table (extending auth.users)
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    name text not null unique,
    role text not null check (role in ('Owner', 'Staff')),
    pin text not null,
    company_id text not null default 'sar-outdoors',
    status text not null default 'Active' check (status in ('Active', 'Suspended')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on Profiles
alter table public.profiles enable row level security;

-- Profiles Policies
create policy "Allow read access to authenticated profiles"
    on public.profiles for select
    to authenticated
    using (true);

create policy "Allow updates to own profile"
    on public.profiles for update
    to authenticated
    using (auth.uid() = id);

create policy "Allow insert access to owner"
    on public.profiles for insert
    to authenticated
    with check (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'Owner'
        )
    );

create policy "Allow delete access to owner"
    on public.profiles for delete
    to authenticated
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'Owner'
        )
    );

-- 2. Money Transfers Table (Owner sending money to staff)
create table if not exists public.money_transfers (
    id uuid primary key default gen_random_uuid(),
    date_time timestamp with time zone not null,
    amount numeric not null check (amount > 0),
    mode text not null check (mode in ('Cash', 'UPI', 'Bank')),
    ref_number text,
    staff_name text not null references public.profiles(name) on delete cascade,
    purpose text,
    company_id text not null default 'sar-outdoors',
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on Money Transfers
alter table public.money_transfers enable row level security;

-- Money Transfers Policies
create policy "Allow read access to authenticated transfers"
    on public.money_transfers for select
    to authenticated
    using (true);

create policy "Allow write access to owners only"
    on public.money_transfers for all
    to authenticated
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'Owner'
        )
    );

-- 3. Incoming Money Table (Staff receiving money from clients/vendors)
create table if not exists public.incoming_money (
    id uuid primary key default gen_random_uuid(),
    date_time timestamp with time zone not null,
    amount numeric not null check (amount > 0),
    received_from text not null check (received_from in ('Customer', 'Guide', 'Vendor', 'Other')),
    received_from_category text,
    custom_received_from text,
    name text,
    payment_method text not null check (payment_method in ('Cash', 'UPI', 'Bank')),
    remarks text,
    proof_photo_url text,
    status text not null default 'Pending Approval' check (status in ('Pending Approval', 'Approved', 'Rejected')),
    created_by text not null references public.profiles(name) on delete cascade,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    reviewed_by text references public.profiles(name) on delete set null,
    reviewed_at timestamp with time zone,
    comment text,
    company_id text not null default 'sar-outdoors'
);

-- Enable RLS on Incoming Money
alter table public.incoming_money enable row level security;

-- Incoming Money Policies
create policy "Allow read access to authenticated incoming"
    on public.incoming_money for select
    to authenticated
    using (true);

create policy "Allow staff to insert their own incoming records"
    on public.incoming_money for insert
    to authenticated
    with check (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and name = created_by
        )
    );

create policy "Allow owner full write access to incoming records"
    on public.incoming_money for all
    to authenticated
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'Owner'
        )
    );

-- 4. Expenses Table
create table if not exists public.expenses (
    id uuid primary key default gen_random_uuid(),
    date_time timestamp with time zone not null,
    staff_name text not null, -- Can be a staff name or 'Company' for owner expenses
    category text not null,
    custom_category text,
    amount numeric not null check (amount > 0),
    payment_method text not null check (payment_method in ('Cash', 'UPI', 'Bank')),
    vendor_name text,
    description text not null,
    receipt_photo_url text,
    gps_location jsonb,
    is_owner_expense boolean not null default false,
    company_id text not null default 'sar-outdoors',
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on Expenses
alter table public.expenses enable row level security;

-- Expenses Policies
create policy "Allow read access to authenticated expenses"
    on public.expenses for select
    to authenticated
    using (true);

create policy "Allow staff to insert their own expenses"
    on public.expenses for insert
    to authenticated
    with check (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and name = staff_name
        )
    );

create policy "Allow owner full access to expenses"
    on public.expenses for all
    to authenticated
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'Owner'
        )
    );

-- 5. Notes Table (Bulletin board updates)
create table if not exists public.notes (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    content text not null,
    created_by text not null references public.profiles(name) on delete cascade,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    company_id text not null default 'sar-outdoors'
);

-- Enable RLS on Notes
alter table public.notes enable row level security;

-- Notes Policies
create policy "Allow read access to notes"
    on public.notes for select
    to authenticated
    using (true);

create policy "Allow owner full access to notes"
    on public.notes for all
    to authenticated
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'Owner'
        )
    );

-- ====================================================================
-- STORAGE BUCKETS & POLICIES SETUP
-- ====================================================================

-- Create Storage Bucket
insert into storage.buckets (id, name, public)
values ('trailcash-proofs', 'trailcash-proofs', true)
on conflict (id) do nothing;

-- Storage Bucket Policies
create policy "Allow public file view"
    on storage.objects for select
    using (bucket_id = 'trailcash-proofs');

create policy "Allow authenticated uploads"
    on storage.objects for insert
    to authenticated
    with check (bucket_id = 'trailcash-proofs');

create policy "Allow owner to delete files"
    on storage.objects for delete
    to authenticated
    using (
        bucket_id = 'trailcash-proofs' and
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'Owner'
        )
    );
