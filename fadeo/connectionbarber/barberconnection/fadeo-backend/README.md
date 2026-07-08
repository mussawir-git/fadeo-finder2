# Fadeo Finder — Backend (Auth + Shop Approval)

## What this covers right now

`login.html` is the **only** part of your frontend that currently calls a backend
(`POST /api/auth/login`, `POST /api/auth/register`). Everything else in `script.js`
(bookings, reviews, shop listings, admin dashboard, owner dashboard) still runs on
`localStorage`. So this backend covers exactly what's wired up today:

- `POST /api/auth/register` — customer signup (instant login) or owner signup
  (creates a `pending` shop, no login until approved)
- `POST /api/auth/login` — validates credentials, blocks owner login until their
  shop is `approved`, returns `{ token, user }` in the shape `login.html` expects
- `GET /api/auth/me` — verify a token is still valid
- `GET /api/shops/pending`, `GET /api/shops`, `PATCH /api/shops/:id/approve`,
  `PATCH /api/shops/:id/reject` — admin-only, so you have a real way to approve
  the owners who register (currently your admin approval queue is `localStorage`
  too — wire its Approve/Reject buttons to these two PATCH endpoints next)

Bookings, reviews, notifications, walk-in queue, offers, etc. are **not** built yet —
happy to do those next, one module at a time, once this is working end to end.

## Setup

1. **Create a Supabase project** at supabase.com (free tier is fine).
2. In the Supabase dashboard: **SQL Editor → New query** → paste the contents of
   `config/schema.sql` → Run. This creates `users` and `shops` tables.
3. In **Project Settings → API**, copy the **Project URL** and the
   **`service_role` secret key** (not the `anon` key — the service role key is
   required server-side and must never be shipped to the browser).
4. Copy `.env.example` to `.env` and fill in:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET` (any long random string, e.g. generate one with
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
5. Install the two extra packages this code needs (your `package.json` already has
   express/cors/dotenv/supabase-js/nodemon, just add these two):
   ```
   npm install bcryptjs jsonwebtoken
   ```
6. Seed the demo admin account (matches the hint shown on the admin login tab):
   ```
   node seed/seedAdmin.js
   ```
   Creates `you@gmail.com` / `123@34567` with role `admin`.
7. Run the server:
   ```
   npm run dev    # if you add "dev": "nodemon server.js" to package.json scripts
   # or
   node server.js
   ```
   You should see `Fadeo Finder API running on http://localhost:5000`.

## Trying it

- Open `index.html`/`login.html` as you normally do (e.g. via a static server or
  VS Code Live Server) with the backend running in another terminal.
- Sign up as a **customer** → should log straight in.
- Sign up as an **owner** → shop is created as `pending`. Login is blocked until
  approved.
- Log in as **admin** (`you@gmail.com` / `123@34567`), call
  `GET http://localhost:5000/api/shops/pending` with
  `Authorization: Bearer <admin token>` to see it, then
  `PATCH /api/shops/:id/approve` to unlock that owner's login.

## Folder structure

```
config/
  supabaseClient.js   Supabase client using the service role key
  schema.sql          Run this in Supabase's SQL editor
controllers/
  authController.js   register / login / me
  shopController.js   admin shop approval queue
routes/
  authRoutes.js
  shopRoutes.js
middleware/
  authMiddleware.js   JWT verification + role guard
  errorHandler.js
utils/
  jwt.js
seed/
  seedAdmin.js
server.js
.env.example
```

## Notes / decisions worth knowing about

- Passwords are hashed with `bcryptjs` (pure JS, no native build step — easier on
  student laptops than `bcrypt`).
- Owners don't get a token at registration time — matches `login.html`'s
  `handleRegister()`, which shows "awaiting admin approval" and sends owners to
  the sign-in view instead of logging them in.
- `shop_username` is unique across all shops — it's what an owner types into the
  "Shop ID" field at login, and the login response includes it as `user.shop`,
  which `login.html` already checks against that field.
- Admins are seeded directly in the database, not self-registered (the frontend
  already hides the register link for the admin tab).
