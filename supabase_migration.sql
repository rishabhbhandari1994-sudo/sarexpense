-- Apply this once in the Supabase SQL editor after schema.sql. It replaces
-- permissive cross-tenant policies with policies based on the signed-in user's
-- active profile. Do not put SUPABASE_SERVICE_ROLE_KEY in browser code.

create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles
  where id = auth.uid() and status = 'Active' and deleted_at is null
$$;

create or replace function public.is_company_manager(u_id uuid, c_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = u_id and company_id = c_id and role in ('Owner', 'Manager')
      and status = 'Active' and deleted_at is null
  )
$$;

create or replace function public.is_company_owner(u_id uuid, c_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = u_id and company_id = c_id and role = 'Owner'
      and status = 'Active' and deleted_at is null
  )
$$;

drop policy if exists "Allow public select access to active profiles" on public.profiles;
drop policy if exists "Allow updates to self profile or managers" on public.profiles;
drop policy if exists "Allow insert access to managers" on public.profiles;
drop policy if exists "Allow delete access to managers" on public.profiles;
create policy "Profiles are visible within a tenant" on public.profiles for select to authenticated
  using (company_id = public.current_company_id() and deleted_at is null);
create policy "Managers manage tenant profiles" on public.profiles for all to authenticated
  using (public.is_company_manager(auth.uid(), company_id))
  with check (public.is_company_manager(auth.uid(), company_id));

drop policy if exists "Allow read access to authenticated company tenant" on public.companies;
create policy "Users read their company" on public.companies for select to authenticated
  using (id = public.current_company_id());

drop policy if exists "Allow read access to company settings" on public.company_settings;
drop policy if exists "Allow owners to edit settings" on public.company_settings;
create policy "Tenant reads settings" on public.company_settings for select to authenticated
  using (company_id = public.current_company_id());
create policy "Owners manage settings" on public.company_settings for all to authenticated
  using (public.is_company_owner(auth.uid(), company_id))
  with check (public.is_company_owner(auth.uid(), company_id));

drop policy if exists "Allow read access to expense categories" on public.expense_categories;
create policy "Tenant reads categories" on public.expense_categories for select to authenticated
  using (company_id = public.current_company_id());

drop policy if exists "Allow read access to staff balances" on public.staff_balances;
create policy "Tenant reads staff balances" on public.staff_balances for select to authenticated
  using (company_id = public.current_company_id());

drop policy if exists "Allow read access to transfers" on public.money_transfers;
drop policy if exists "Allow full write access to manager and owners" on public.money_transfers;
create policy "Tenant reads transfers" on public.money_transfers for select to authenticated
  using (company_id = public.current_company_id());
create policy "Managers manage transfers" on public.money_transfers for all to authenticated
  using (public.is_company_manager(auth.uid(), company_id))
  with check (public.is_company_manager(auth.uid(), company_id));

drop policy if exists "Allow read access to incoming" on public.incoming_money;
drop policy if exists "Allow staff to insert their own incoming" on public.incoming_money;
drop policy if exists "Allow staff to update their own pending incoming" on public.incoming_money;
drop policy if exists "Allow managers and owners full access to reviews" on public.incoming_money;
create policy "Tenant reads incoming" on public.incoming_money for select to authenticated
  using (company_id = public.current_company_id());
create policy "Staff create their incoming records" on public.incoming_money for insert to authenticated
  with check (company_id = public.current_company_id() and auth.uid() = created_by_id);
create policy "Staff update pending incoming" on public.incoming_money for update to authenticated
  using (company_id = public.current_company_id() and auth.uid() = created_by_id and status = 'Pending Approval')
  with check (company_id = public.current_company_id() and auth.uid() = created_by_id);
create policy "Managers manage incoming" on public.incoming_money for all to authenticated
  using (public.is_company_manager(auth.uid(), company_id))
  with check (public.is_company_manager(auth.uid(), company_id));

drop policy if exists "Allow read access to expenses" on public.expenses;
drop policy if exists "Allow staff to insert their own expenses" on public.expenses;
drop policy if exists "Allow managers and owners full write access to expenses" on public.expenses;
create policy "Tenant reads expenses" on public.expenses for select to authenticated
  using (company_id = public.current_company_id());
create policy "Staff create their expenses" on public.expenses for insert to authenticated
  with check (company_id = public.current_company_id() and auth.uid() = staff_id);
create policy "Managers manage expenses" on public.expenses for all to authenticated
  using (public.is_company_manager(auth.uid(), company_id))
  with check (public.is_company_manager(auth.uid(), company_id));

drop policy if exists "Allow read access to notes" on public.notes;
drop policy if exists "Allow managers and owners write access to notes" on public.notes;
create policy "Tenant reads notes" on public.notes for select to authenticated
  using (company_id = public.current_company_id());
create policy "Managers manage notes" on public.notes for all to authenticated
  using (public.is_company_manager(auth.uid(), company_id))
  with check (public.is_company_manager(auth.uid(), company_id));

drop policy if exists "Allow read access to authenticated bills" on storage.objects;
drop policy if exists "Allow authenticated upload of bills" on storage.objects;
drop policy if exists "Allow manager deletion of bills" on storage.objects;
create policy "Tenant reads bills" on storage.objects for select to authenticated
  using (bucket_id = 'expense-bills' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy "Tenant uploads bills" on storage.objects for insert to authenticated
  with check (bucket_id = 'expense-bills' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy "Managers delete bills" on storage.objects for delete to authenticated
  using (bucket_id = 'expense-bills' and public.is_company_manager(auth.uid(), public.current_company_id()));

-- Realtime is opt-in per table. The subscription in app.js then receives
-- inserts/updates/deletes permitted by the policies above on every device.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['profiles', 'money_transfers', 'expenses', 'incoming_money', 'notes'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
