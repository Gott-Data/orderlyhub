# OrderlyHub — Setup Guide

**Zero-cost order management with WhatsApp for Sierra Leone**

Monthly cost: **$0** (within free tiers)

| Service | Free Tier | What It Does |
|---------|-----------|-------------|
| Supabase | 500MB DB, 50K rows, 2GB bandwidth | Database + realtime |
| Vercel | 100GB bandwidth, serverless functions | Hosting + API |
| WhatsApp Cloud API | 1,000 conversations/month | Customer messaging |

---

## Step 1: Set Up Supabase (Database) — 10 minutes

1. Go to [supabase.com](https://supabase.com) and sign up (free)
2. Click **New Project** → name it `orderlyhub`
3. Pick any region (closest to Sierra Leone would be EU West)
4. Set a database password — save it somewhere safe
5. Wait for the project to initialize (~2 minutes)

### Create the tables

6. Go to **SQL Editor** (left sidebar)
7. Paste the entire contents of `supabase-schema.sql` into the editor
8. Click **Run** — you should see "Success" messages

### Get your credentials

9. Go to **Settings** → **API**
10. Copy these two values:
    - **Project URL** → this is your `SUPABASE_URL`
    - **service_role key** (under "Project API keys") → this is your `SUPABASE_SERVICE_KEY`

> ⚠️ The service_role key has full database access. Never expose it in client-side code.

---

## Step 2: Deploy to Vercel — 5 minutes

### Option A: Deploy from GitHub (recommended)

1. Push the `orderlyhub` folder to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → sign up with GitHub (free)
3. Click **Import Project** → select your repo
4. In the **Environment Variables** section, add all variables from `.env.example`:
   - `SUPABASE_URL` — from step 1
   - `SUPABASE_SERVICE_KEY` — from step 1
   - `ADMIN_KEY` — make up a secret (e.g. `sl-orderly-admin-2024`)
   - Leave WhatsApp variables empty for now (add in step 3)
5. Click **Deploy**

Your site will be live at `https://your-project.vercel.app`

### Option B: Deploy from CLI

```bash
npm install -g vercel
cd orderlyhub
vercel
# Follow the prompts, then add env vars:
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_KEY
vercel env add ADMIN_KEY
vercel --prod
```

### Test it

- Visit `https://your-project.vercel.app` — you should see the order form
- Try placing a test order — it should work (WhatsApp messages won't send yet, but the order saves to Supabase)

---

## Step 3: Set Up WhatsApp Business API — 30 minutes

This uses Meta's official Cloud API (free for 1,000 conversations/month).

### A. Create a Meta Business Account

1. Go to [business.facebook.com](https://business.facebook.com)
2. Create an account or log in with an existing Facebook account
3. Complete the business verification (name, address) — if registering for the startup:
   - Business name: the startup's name
   - Country: Sierra Leone
   - This can take 1-5 days for verification, but you can test immediately

### B. Create a Meta Developer App

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Click **My Apps** → **Create App**
3. Choose **Other** → **Business** type
4. Name it (e.g. "OrderlyHub") and connect it to your Business Account
5. On the app dashboard, find **WhatsApp** and click **Set Up**

### C. Get API Credentials

1. In the WhatsApp product page, go to **API Setup**
2. You'll see:
   - A **test phone number** (Meta provides one for free)
   - **Phone Number ID** — copy this → `WA_PHONE_NUMBER_ID`
   - **Temporary Access Token** — copy this → `WA_ACCESS_TOKEN`

> The temporary token expires in 24 hours. For production, create a permanent token:
> Go to **Business Settings** → **System Users** → create one → generate a permanent token with `whatsapp_business_messaging` permission.

3. **Add test recipients**: Under API Setup, add the WhatsApp numbers you want to test with (your number and team numbers)

### D. Configure Webhook (receive incoming messages)

1. In the WhatsApp product page → **Configuration**
2. Under **Webhook**:
   - **Callback URL**: `https://your-project.vercel.app/api/webhook`
   - **Verify Token**: `orderlyhub_verify_2024` (must match your `.env`)
3. Click **Verify and Save**
4. Under **Webhook fields**, subscribe to: `messages`

### E. Add Credentials to Vercel

Go to your Vercel project → **Settings** → **Environment Variables** and add:

```
WA_PHONE_NUMBER_ID=<your phone number ID>
WA_ACCESS_TOKEN=<your access token>
WA_VERIFY_TOKEN=orderlyhub_verify_2024
TEAM_PHONE=<team WhatsApp number, e.g. 23276123456>
```

Redeploy: `vercel --prod` or push to GitHub (auto-deploys).

### F. Test the full flow

1. Place an order on your website
2. Check your WhatsApp — you should get a confirmation message
3. Reply on WhatsApp — the message should appear in the admin dashboard
4. In the admin dashboard, update the order status — customer gets a WhatsApp notification

---

## Step 4: Set Up the Admin Dashboard

The admin dashboard (`admin-dashboard.jsx`) is a React component. You have a few options:

### Option A: Use in Claude (quickest for now)

Upload `admin-dashboard.jsx` to Claude and ask it to render as an artifact. Update the `CONFIG` at the top of the file with your API URL and admin key.

### Option B: Deploy as a separate page

Create a simple React app with Vite:

```bash
npm create vite@latest admin -- --template react
cd admin
# Copy admin-dashboard.jsx into src/
# Update App.jsx to import and render AdminDashboard
npm run build
# Deploy the dist/ folder to Vercel
```

### Option C: Add to the same Vercel project

Add React and a build step to the project. This is more involved but keeps everything in one place.

> **Important**: Set the `ADMIN_KEY` in the dashboard component to match your environment variable. This key protects admin endpoints from public access.

---

## Using a Real Phone Number

The Meta test number works for development. For production with customers:

1. Go to Meta Business Suite → **Phone Numbers**
2. Click **Add Phone Number**
3. Enter the business phone number (must be able to receive SMS or calls for verification)
4. Complete the verification
5. The new phone number's ID replaces `WA_PHONE_NUMBER_ID`

> **Sierra Leone numbers**: The country code is +232. WhatsApp Cloud API supports Sierra Leone numbers. Make sure the number isn't already registered as a personal WhatsApp account, or you'll need to delete it first.

---

## Architecture Overview

```
Customer (mobile browser, 3G)
    │
    ├── Places order ──→ Vercel serverless function
    │                         │
    │                         ├── Saves to Supabase (Postgres)
    │                         ├── Sends WhatsApp to customer
    │                         └── Notifies team on WhatsApp
    │
    ├── Tracks order ──→ Polls API every 10 seconds
    │
    └── Chats ──→ Messages saved to Supabase
                       └── Forwarded via WhatsApp

WhatsApp (incoming) ──→ Meta Webhook ──→ Vercel function
                                             │
                                             ├── Matches to order by phone
                                             ├── Saves message to Supabase
                                             └── Notifies team

Admin Dashboard (React) ──→ Polls API every 5 seconds
    │
    ├── Views all orders
    ├── Updates status ──→ Customer gets WhatsApp notification
    └── Replies to chat ──→ Customer gets WhatsApp message
```

---

## Performance Notes

The customer page (`index.html`) is designed for low-bandwidth connections:
- **~10KB total** (HTML + CSS + JS, all inline, no external requests)
- **No external fonts** — uses system fonts that are already on the device
- **No framework** — pure HTML/CSS/JS, zero dependencies
- **Dark theme** — saves battery on OLED screens (common on budget Android)
- **Polls every 10s** — conserves mobile data vs WebSockets
- **Works offline for form filling** — only needs connection to submit

---

## Costs as You Grow

If the startup grows beyond free tiers:

| Scale | Supabase | Vercel | WhatsApp | Total |
|-------|----------|--------|----------|-------|
| < 1,000 orders/mo | Free | Free | Free | **$0** |
| 1,000-5,000 orders/mo | Free | Free | ~$20-80 | **~$50** |
| 5,000-10,000 orders/mo | $25/mo (Pro) | Free | ~$100-200 | **~$150** |

WhatsApp pricing for Africa is among the lowest globally (~$0.02-0.04 per conversation).

---

## Troubleshooting

**Orders aren't saving**: Check Supabase URL and service key in Vercel env vars. Check Vercel function logs.

**WhatsApp messages aren't sending**: Check that the access token hasn't expired (temporary tokens last 24h). Generate a permanent token via System Users.

**Webhook verification fails**: Make sure the verify token in your .env matches exactly what you entered in Meta's dashboard. The callback URL must be HTTPS.

**Customer page loads slowly**: The page is ~10KB. If it's still slow, check if the Vercel region is far from Sierra Leone. You can set `"regions": ["cdg1"]` in vercel.json for Europe (closest to West Africa).

**Admin dashboard shows no orders**: Check that the `ADMIN_KEY` in the React component matches the `ADMIN_KEY` in your Vercel environment variables.
