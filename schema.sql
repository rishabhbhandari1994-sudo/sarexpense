-- ====================================================================
-- TRAIL CASH ENTERPRISE DATABASE SCHEMA (SUPABASE POSTGRESQL)
-- ====================================================================

-- Enable cryptographic extensions
create extension if not exists pgcrypto;

-- 1. Companies Table (Multi-tenant support)
create table if not exists public.companies (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    status text not null default 'Active' check (status in ('Active', 'Suspended')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on Companies
alter table public.companies enable row level security;

create policy "Allow read access to authenticated company tenant"
    on public.companies for select to authenticated using (true);

-- 2. Company Settings Table (Branding, timezone, currency, details)
create table if not exists public.company_settings (
    company_id uuid primary key references public.companies(id) on delete cascade,
    logo_url text,
    company_details jsonb not null default '{}'::jsonb,
    timezone text not null default 'Asia/Kolkata',
    currency text not null default 'INR',
    branding_colors jsonb not null default '{}'::jsonb,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on Company Settings
alter table public.company_settings enable row level security;

create policy "Allow read access to company settings"
    on public.company_settings for select to authenticated using (true);

create policy "Allow owners to edit settings"
    on public.company_settings for all to authenticated
    using (exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'Owner'
    ));

-- 3. Expense Categories Table (Normalized Lookup)
create table if not exists public.expense_categories (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    name text not null,
    emoji text not null default '📦',
    is_company_overhead boolean not null default false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    constraint unique_company_category_name unique (company_id, name)
);

-- Enable RLS on Categories
alter table public.expense_categories enable row level security;

create policy "Allow read access to expense categories"
    on public.expense_categories for select to authenticated using (true);

-- 4. Profiles Table (extending auth.users)
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    company_id uuid not null references public.companies(id) on delete cascade,
    name text not null, -- Removed UNIQUE constraint from name
    email text not null unique, -- Using email/phone as the unique identifier
    phone text,
    role text not null check (role in ('Owner', 'Manager', 'Staff')), -- Added Manager role
    pin text not null, -- Hashed Pin code via database triggers
    status text not null default 'Active' check (status in ('Active', 'Suspended')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    deleted_at timestamp with time zone,
    deleted_by uuid references public.profiles(id) on delete set null
);

-- Enable RLS on Profiles
alter table public.profiles enable row level security;

-- 5. RLS Security Definer Optimization Helpers
CREATE OR REPLACE FUNCTION public.is_company_owner(u_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = u_id AND role = 'Owner' AND status = 'Active' AND deleted_at IS NULL
    );
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_company_manager(u_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = u_id AND role in ('Owner', 'Manager') AND status = 'Active' AND deleted_at IS NULL
    );
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Profiles Policies
create policy "Allow read access to authenticated profiles"
    on public.profiles for select to authenticated using (deleted_at is null);

create policy "Allow updates to self profile or managers"
    on public.profiles for update to authenticated
    using (auth.uid() = id or public.is_company_manager(auth.uid()));

create policy "Allow insert access to managers"
    on public.profiles for insert to authenticated
    with check (public.is_company_manager(auth.uid()));

create policy "Allow delete access to managers"
    on public.profiles for delete to authenticated
    using (public.is_company_manager(auth.uid()));

-- Profile PIN Auto-Hashing Trigger
CREATE OR REPLACE FUNCTION public.trg_hash_profile_pin()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.pin <> OLD.pin) THEN
        IF length(NEW.pin) < 50 THEN
            NEW.pin := crypt(NEW.pin, gen_salt('bf'));
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

create trigger hash_profile_pin_trigger
    before insert or update on public.profiles
    for each row execute function public.trg_hash_profile_pin();

-- 6. Login History Table (Audit trace logins and user-agents)
create table if not exists public.login_history (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    login_at timestamp with time zone default timezone('utc'::text, now()) not null,
    ip_address text,
    user_agent text,
    device_info jsonb not null default '{}'::jsonb
);

-- Enable RLS on Login History
alter table public.login_history enable row level security;

create policy "Allow users to read own login history"
    on public.login_history for select to authenticated
    using (auth.uid() = user_id or public.is_company_manager(auth.uid()));

-- 7. Money Transfers Table (Owner sending money to staff)
create table if not exists public.money_transfers (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    date_time timestamp with time zone not null,
    amount numeric not null check (amount > 0),
    mode text not null check (mode in ('Cash', 'UPI', 'Bank')),
    ref_number text,
    staff_id uuid not null references public.profiles(id) on delete cascade,
    purpose text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    deleted_at timestamp with time zone,
    deleted_by uuid references public.profiles(id) on delete set null
);

-- Enable RLS on Money Transfers
alter table public.money_transfers enable row level security;

-- Money Transfers Policies
create policy "Allow read access to transfers"
    on public.money_transfers for select to authenticated using (deleted_at is null);

create policy "Allow full write access to manager and owners"
    on public.money_transfers for all to authenticated
    using (public.is_company_manager(auth.uid()));

-- 8. Incoming Money Table (Staff receiving money from clients/vendors)
create table if not exists public.incoming_money (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
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
    created_by_id uuid not null references public.profiles(id) on delete cascade,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    reviewed_by_id uuid references public.profiles(id) on delete set null,
    reviewed_at timestamp with time zone,
    comment text,
    deleted_at timestamp with time zone,
    deleted_by uuid references public.profiles(id) on delete set null
);

-- Enable RLS on Incoming Money
alter table public.incoming_money enable row level security;

-- Incoming Money Policies
create policy "Allow read access to incoming"
    on public.incoming_money for select to authenticated using (deleted_at is null);

create policy "Allow staff to insert their own incoming"
    on public.incoming_money for insert to authenticated
    with check (auth.uid() = created_by_id);

create policy "Allow staff to update their own pending incoming"
    on public.incoming_money for update to authenticated
    using (auth.uid() = created_by_id and status = 'Pending Approval');

create policy "Allow managers and owners full access to reviews"
    on public.incoming_money for all to authenticated
    using (public.is_company_manager(auth.uid()));

-- 9. Expenses Table
create table if not exists public.expenses (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    date_time timestamp with time zone not null,
    staff_id uuid references public.profiles(id) on delete cascade, -- null for direct company overhead
    category_id uuid not null references public.expense_categories(id) on delete restrict,
    custom_category text,
    amount numeric not null check (amount > 0),
    payment_method text not null check (payment_method in ('Cash', 'UPI', 'Bank')),
    vendor_name text,
    description text not null,
    receipt_photo_url text,
    gps_location jsonb,
    is_owner_expense boolean not null default false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    deleted_at timestamp with time zone,
    deleted_by uuid references public.profiles(id) on delete set null
);

-- Enable RLS on Expenses
alter table public.expenses enable row level security;

-- Expenses Policies
create policy "Allow read access to expenses"
    on public.expenses for select to authenticated using (deleted_at is null);

create policy "Allow staff to insert their own expenses"
    on public.expenses for insert to authenticated
    with check (auth.uid() = staff_id);

create policy "Allow managers and owners full write access to expenses"
    on public.expenses for all to authenticated
    using (public.is_company_manager(auth.uid()));

-- 10. Staff Balances Summary Table (Normalized Cache)
create table if not exists public.staff_balances (
    profile_id uuid primary key references public.profiles(id) on delete cascade,
    company_id uuid not null references public.companies(id) on delete cascade,
    total_received numeric not null default 0,
    total_spent numeric not null default 0,
    current_balance numeric not null default 0,
    last_updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on Staff Balances
alter table public.staff_balances enable row level security;

create policy "Allow read access to staff balances"
    on public.staff_balances for select to authenticated using (true);

-- Trigger functions for auto-recalculation of staff balances
CREATE OR REPLACE FUNCTION public.recalculate_staff_balance(p_id UUID)
RETURNS VOID AS $$
DECLARE
    v_received NUMERIC := 0;
    v_spent NUMERIC := 0;
    v_company_id UUID;
BEGIN
    SELECT company_id INTO v_company_id FROM public.profiles WHERE id = p_id;
    
    -- Sum transfers from owner
    SELECT COALESCE(SUM(amount), 0) INTO v_received 
    FROM public.money_transfers 
    WHERE staff_id = p_id AND deleted_at IS NULL;
    
    -- Sum approved incoming money
    v_received := v_received + COALESCE((
        SELECT SUM(amount) 
        FROM public.incoming_money 
        WHERE created_by_id = p_id AND status = 'Approved' AND deleted_at IS NULL
    ), 0);
    
    -- Sum expenses
    SELECT COALESCE(SUM(amount), 0) INTO v_spent 
    FROM public.expenses 
    WHERE staff_id = p_id AND is_owner_expense = FALSE AND deleted_at IS NULL;
    
    -- Upsert cache
    INSERT INTO public.staff_balances (profile_id, company_id, total_received, total_spent, current_balance, last_updated_at)
    VALUES (p_id, v_company_id, v_received, v_spent, (v_received - v_spent), now())
    ON CONFLICT (profile_id) DO UPDATE 
    SET total_received = v_received,
        total_spent = v_spent,
        current_balance = (v_received - v_spent),
        last_updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger triggers on Money Transfers
CREATE OR REPLACE FUNCTION public.trg_on_transfer_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.recalculate_staff_balance(OLD.staff_id);
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM public.recalculate_staff_balance(NEW.staff_id);
        IF OLD.staff_id <> NEW.staff_id THEN
            PERFORM public.recalculate_staff_balance(OLD.staff_id);
        END IF;
        RETURN NEW;
    ELSE
        PERFORM public.recalculate_staff_balance(NEW.staff_id);
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

create trigger trg_on_transfer_change_trigger
    after insert or update or delete on public.money_transfers
    for each row execute function public.trg_on_transfer_change();

-- Trigger triggers on Incoming Money
CREATE OR REPLACE FUNCTION public.trg_on_incoming_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.recalculate_staff_balance(OLD.created_by_id);
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM public.recalculate_staff_balance(NEW.created_by_id);
        IF OLD.created_by_id <> NEW.created_by_id THEN
            PERFORM public.recalculate_staff_balance(OLD.created_by_id);
        END IF;
        RETURN NEW;
    ELSE
        PERFORM public.recalculate_staff_balance(NEW.created_by_id);
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

create trigger trg_on_incoming_change_trigger
    after insert or update or delete on public.incoming_money
    for each row execute function public.trg_on_incoming_change();

-- Trigger triggers on Expenses
CREATE OR REPLACE FUNCTION public.trg_on_expense_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.staff_id IS NOT NULL THEN
            PERFORM public.recalculate_staff_balance(OLD.staff_id);
        END IF;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.staff_id IS NOT NULL THEN
            PERFORM public.recalculate_staff_balance(NEW.staff_id);
        END IF;
        IF OLD.staff_id IS NOT NULL AND OLD.staff_id <> NEW.staff_id THEN
            PERFORM public.recalculate_staff_balance(OLD.staff_id);
        END IF;
        RETURN NEW;
    ELSE
        IF NEW.staff_id IS NOT NULL THEN
            PERFORM public.recalculate_staff_balance(NEW.staff_id);
        END IF;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

create trigger trg_on_expense_change_trigger
    after insert or update or delete on public.expenses
    for each row execute function public.trg_on_expense_change();

-- 11. Notes Table (Shared bulletin posts)
create table if not exists public.notes (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    title text not null,
    content text not null,
    created_by_id uuid not null references public.profiles(id) on delete cascade,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on Notes
alter table public.notes enable row level security;

create policy "Allow read access to notes"
    on public.notes for select to authenticated using (true);

create policy "Allow managers and owners write access to notes"
    on public.notes for all to authenticated
    using (public.is_company_manager(auth.uid()));

-- 12. Audit Activity Logs Table
create table if not exists public.activity_logs (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    user_id uuid references public.profiles(id) on delete set null,
    action text not null,
    details jsonb not null default '{}'::jsonb,
    ip_address text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on Activity Logs
alter table public.activity_logs enable row level security;

create policy "Allow managers to view activity logs"
    on public.activity_logs for select to authenticated
    using (public.is_company_manager(auth.uid()));

-- 13. Push Notifications Table (With Notification Type check constraints)
create table if not exists public.notifications (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    title text not null,
    message text not null,
    type text not null default 'SYSTEM' check (type in ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SYSTEM', 'REMINDER')), -- Check constraint implemented
    is_read boolean not null default false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on Notifications
alter table public.notifications enable row level security;

create policy "Allow users to access their own notifications"
    on public.notifications for all to authenticated
    using (auth.uid() = user_id);

-- ====================================================================
-- SEED INITIAL LOOKUP DATA
-- ====================================================================

-- Seed Company
insert into public.companies (id, name, status)
values ('00000000-0000-0000-0000-000000000001', 'Sar Outdoors', 'Active')
on conflict (id) do nothing;

-- Seed default company settings
insert into public.company_settings (company_id, timezone, currency)
values ('00000000-0000-0000-0000-000000000001', 'Asia/Kolkata', 'INR')
on conflict (company_id) do nothing;

-- Seed Expense Categories
insert into public.expense_categories (company_id, name, emoji, is_company_overhead)
values 
    ('00000000-0000-0000-0000-000000000001', 'Ration', '🌾', false),
    ('00000000-0000-0000-0000-000000000001', 'Fuel / Diesel', '⛽', false),
    ('00000000-0000-0000-0000-000000000001', 'Transportation', '🚌', false),
    ('00000000-0000-0000-0000-000000000001', 'Mule', '🐴', false),
    ('00000000-0000-0000-0000-000000000001', 'Porter', '🎒', false),
    ('00000000-0000-0000-0000-000000000001', 'Guide', '🗺️', false),
    ('00000000-0000-0000-0000-000000000001', 'Hotel', '🏨', false),
    ('00000000-0000-0000-0000-000000000001', 'Homestay', '🏡', false),
    ('00000000-0000-0000-0000-000000000001', 'Food', '🍔', false),
    ('00000000-0000-0000-0000-000000000001', 'Medical', '💊', false),
    ('00000000-0000-0000-0000-000000000001', 'Equipment', '🛠️', false),
    ('00000000-0000-0000-0000-000000000001', 'Forest Permit', '🌲', false),
    ('00000000-0000-0000-0000-000000000001', 'Entry Fee', '🎟️', false),
    ('00000000-0000-0000-0000-000000000001', 'Miscellaneous', '📦', false),
    ('00000000-0000-0000-0000-000000000001', 'Other', '❓', false),
    -- Company Overhead Overhead Categories
    ('00000000-0000-0000-0000-000000000001', 'Office Rent', '🏢', true),
    ('00000000-0000-0000-0000-000000000001', 'Salary', '💰', true),
    ('00000000-0000-0000-0000-000000000001', 'Marketing', '📣', true),
    ('00000000-0000-0000-0000-000000000001', 'Fuel', '⛽', true),
    ('00000000-0000-0000-0000-000000000001', 'Software', '💻', true),
    ('00000000-0000-0000-0000-000000000001', 'Internet', '🌐', true),
    ('00000000-0000-0000-0000-000000000001', 'Electricity', '⚡', true),
    ('00000000-0000-0000-0000-000000000001', 'Travel', '✈️', true)
on conflict (company_id, name) do nothing;

-- ====================================================================
-- PERFORMANCE INDEXES
-- ====================================================================

-- Indexing foreign keys
create index if not exists idx_profiles_company on public.profiles(company_id);
create index if not exists idx_money_transfers_staff on public.money_transfers(staff_id);
create index if not exists idx_incoming_money_creator on public.incoming_money(created_by_id);
create index if not exists idx_expenses_staff on public.expenses(staff_id);
create index if not exists idx_expenses_category on public.expenses(category_id);

-- Indexing query dates
create index if not exists idx_money_transfers_date on public.money_transfers(date_time desc);
create index if not exists idx_expenses_date on public.expenses(date_time desc);
create index if not exists idx_incoming_money_date on public.incoming_money(date_time desc);

-- ====================================================================
-- STORAGE BUCKETS & POLICIES SETUP (PRIVATE)
-- ====================================================================
insert into storage.buckets (id, name, public)
values ('expense-bills', 'expense-bills', false) -- Private bucket
on conflict (id) do nothing;

-- Secure Storage policies
create policy "Allow read access to authenticated bills"
    on storage.objects for select to authenticated using (bucket_id = 'expense-bills');

create policy "Allow authenticated upload of bills"
    on storage.objects for insert to authenticated with check (bucket_id = 'expense-bills');

create policy "Allow manager deletion of bills"
    on storage.objects for delete to authenticated
    using (bucket_id = 'expense-bills' and public.is_company_manager(auth.uid()));
