# WFS Enterprise — Operations Platform

Industry-agnostic, multi-tenant ERP by **WorkFlow Solutions**. One codebase serves
mining, oil & gas, manufacturing, logistics, and general high-production operations.
Each client is a *tenant* with its own data, branding, and switched-on modules.

**Stack:** React + Vite · Supabase (Postgres + RLS + Realtime) · Netlify (host + functions) · Brevo (email) · Recharts.

---

## What's inside

| Layer | Files |
|---|---|
| Database | `supabase/migrations/0001_core_platform.sql`, `0002_erp_modules.sql`, `0003_hr_accounting_procurement.sql` (incl. structured departments) |
| Auth + tenancy | `src/context/AuthContext.jsx` (deadlock-safe), `my_memberships()` RPC |
| White-label | `src/context/ThemeContext.jsx` + per-tenant `accent_color` |
| Module registry | `src/lib/modules.js` — drives nav, routes, and Settings toggles |
| Modules | Dashboard, Assets, Work Orders, Inventory, Procurement, Workforce, HSE (+ Compliance docs), Reports, Settings |
| Notifications | `netlify/functions/` — Brevo sender, daily alert sweep, AI report |

Add a module = build a page in `src/pages`, add one line to `src/lib/modules.js`,
import it in `src/App.jsx`. Nav and per-tenant toggles pick it up automatically.

---

## Deploy — numbered steps

### 1. Supabase (database)
1. Open your project (ref `wucvejrenltzinhamgmx`) → **SQL Editor**.
2. Paste **all** of `0001_core_platform.sql`, run it.
3. Paste **all** of `0002_erp_modules.sql`, run it. (This seeds a demo "Pamicor Ltd" tenant.)
4. Paste **all** of `0003_hr_accounting_procurement.sql`, run it. (Structured departments, HR, accounting, and procure-to-pay tables + seed.)
5. **Settings → API**: copy the **Project URL**, **anon public** key, and **service_role** key.
6. Link your login to the demo tenant: create your user under **Authentication → Users**, then in SQL Editor run:
   ```sql
   insert into public.org_members (org_id, user_id, role, full_name, email)
   select id, 'YOUR-AUTH-UUID', 'owner', 'Your Name', 'you@email.com'
   from public.organizations where slug = 'pamicor';
   ```

### 2. GitHub (code)
1. Create a new repo, e.g. `wfs-erp`.
2. Using the GitHub **web interface**, upload the project files. Upload folders by
   navigating into them first (`src/`, `src/pages/`, `netlify/functions/`, `supabase/migrations/`)
   so the structure is preserved. **Do not** upload `node_modules/` or `dist/`.

### 3. Netlify (host + functions)
1. **Add new site → Import from Git** → pick the repo.
2. Build settings are auto-read from `netlify.toml` (build `npm run build`, publish `dist`, functions `netlify/functions`).
3. **Site configuration → Environment variables** — add:
   ```
   VITE_SUPABASE_URL          = https://wucvejrenltzinhamgmx.supabase.co
   VITE_SUPABASE_ANON_KEY     = <anon public key>
   SUPABASE_URL               = https://wucvejrenltzinhamgmx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY  = <service_role key>   ← server-side only, never VITE_*
   BREVO_API_KEY              = <brevo key>
   BREVO_SENDER_EMAIL         = admin@workflow-app.net
   BREVO_SENDER_NAME          = WFS Enterprise
   ANTHROPIC_API_KEY          = <claude api key>      ← for AI reports
   ```
4. **Deploy**. The two cron jobs in `netlify.toml` register automatically:
   - `scheduled-alerts` — daily 06:00 UTC operational sweep
   - `scheduled-report` — monthly AI report on the 1st, 05:00 UTC

### 4. First login
Visit the site, sign in with the user from step 1.5. You'll land on the Command Deck
with the seeded Pamicor data. **Settings** lets you rebrand (accent colour), pick an
industry, and toggle modules live.

---

## Add a new tenant (WFS owners only)
Provisioning is invite-only via the `platform_owners` allowlist (seeded with your UUID):
```sql
select public.provision_org('New Client Ltd', 'new-client', 'oil_gas', 'OWNER-AUTH-UUID');
```
Then add their staff to `org_members` with appropriate roles
(`owner` > `admin` > `manager` > `supervisor` > `operator` > `viewer`).

---

## Roles & security
- All tenant tables enforce **Row-Level Security**; users only ever see their org's rows.
- Reads gate on `user_org_ids()`; writes require `operator`+ (viewers are read-only).
- `org_members` self-policy is intentionally a **direct** `user_id = auth.uid()` check
  (no helper functions) to avoid RLS recursion.
- The service-role key lives **only** in Netlify function env, never in the browser bundle.

---

## Local dev
```bash
npm install
cp .env.example .env      # fill VITE_SUPABASE_* (functions need a Netlify context to run)
npm run dev
```

---
*Powered by WorkFlow Solutions · workflow-app.net*
