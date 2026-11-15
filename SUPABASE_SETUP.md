# Supabase reservation setup

The website calls the `reserve-table` Edge Function. Never put a database password or secret/service-role key in website code.

## 1. Create the database objects

Run [`supabase/migrations/20261115000000_reservations.sql`](./supabase/migrations/20261115000000_reservations.sql) in the Supabase SQL Editor.

The migration configures the inventory you provided: 50 Normal, 20 Classic, and 10 VIP tables. `NULL` means a tier has not been configured; `0` means no tables are available. If you already ran an earlier version of this migration, apply these counts manually:

```sql
update public.table_inventory set table_count = 50 where tier = 'normal';
update public.table_inventory set table_count = 20 where tier = 'classic';
update public.table_inventory set table_count = 10 where tier = 'vip';
```

Availability is checked for an exact date, time, and table tier. Each accepted reservation occupies one table for that time slot.

## 2. Deploy the Edge Function

From PowerShell in the project folder, authenticate the Supabase CLI, link this project, and deploy the function:

```powershell
npx --yes supabase@latest login
npx --yes supabase@latest link --project-ref zutanbbpbbbomhophven
npx --yes supabase@latest functions deploy reserve-table
```

The CLI may ask for a Supabase access token and database password. Enter them only into the local CLI prompts. Create an access token in [Supabase Account Tokens](https://supabase.com/dashboard/account/tokens); never paste it into chat or source code.

The function reads the project URL and secret API key from Supabase's Edge Function environment. You do not need to configure a database password or service-role key manually.

## 3. Optional: enable automatic email

Reservation saving and table-availability checks work without email. To send automatic customer emails, first verify a domain with Resend, then set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in the Supabase Dashboard under **Edge Functions → Secrets**. Keep the Resend API key private. If these secrets are absent, the page still reports whether the reservation was accepted, but no email is sent.

## 4. Configure the website

`index.html` is configured with the project's publishable key. Publishable keys are intended for browser use; secret/service-role keys and database passwords are not.

The website submits reservations to the Edge Function. The function checks availability and inserts the booking atomically. When Resend is configured, it emails the customer whether the reservation was received or the selected tier is full. If email is not configured or delivery fails, the page reports the database result and makes clear that no confirmation email was sent.
