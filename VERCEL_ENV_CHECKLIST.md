# 🚨 CRITICAL: Vercel Environment Variables Setup

## Current Issues:
1. ❌ **404 errors** on `/api/mpesa/payment-status/:checkoutRequestId` - Route not found
2. ❌ **DNS error**: `getaddrinfo ENOTFOUND nzlluafskrrhbryimftu.supabase.co` - Supabase URL not accessible
3. ❌ **Database writes failing** - Server cannot write to Supabase without proper credentials

## Required Environment Variables in Vercel:

Go to: **https://vercel.com/dashboard → nakurustk → Settings → Environment Variables**

### ✅ MUST ADD (Currently Missing):

**1. SUPABASE_URL**
- Name: `SUPABASE_URL`
- Value: `https://nzlluafskrrhbryimftu.supabase.co`
- ⚠️ **IMPORTANT**: Must include `https://` protocol
- Select: **All Environments** (Production, Preview, Development)

**2. SUPABASE_SERVICE_ROLE_KEY**
- Name: `SUPABASE_SERVICE_ROLE_KEY`
- Value: `sb_secret_g2yRYthqbpz9Zs41nAWuHw_wJe3l2TR`
- ⚠️ **This is DIFFERENT from VITE_SUPABASE_ANON_KEY**
- ⚠️ **This is the SECRET key** (starts with `sb_secret_`)
- Select: **All Environments**

### ✅ Already Added (Keep These):

- `CONSUMER_KEY` ✅
- `SECRET_KEY` ✅
- `PASS_KEY` ✅
- `SHORT_CODE` ✅
- `VITE_SUPABASE_ANON_KEY` ✅ (This is for frontend only, NOT for server)

### ⚠️ Important Notes:

1. **VITE_SUPABASE_ANON_KEY** is NOT the same as **SUPABASE_SERVICE_ROLE_KEY**
   - `VITE_SUPABASE_ANON_KEY` = Frontend key (publishable, safe for browser)
   - `SUPABASE_SERVICE_ROLE_KEY` = Backend key (secret, bypasses RLS, can write to database)

2. **SUPABASE_URL** must include `https://` protocol
   - ✅ Correct: `https://nzlluafskrrhbryimftu.supabase.co`
   - ❌ Wrong: `nzlluafskrrhbryimftu.supabase.co`

## Steps to Fix:

1. **Add SUPABASE_URL**:
   - Click "Add New"
   - Name: `SUPABASE_URL`
   - Value: `https://nzlluafskrrhbryimftu.supabase.co`
   - Select "All Environments"
   - Click "Save"

2. **Add SUPABASE_SERVICE_ROLE_KEY**:
   - Click "Add New"
   - Name: `SUPABASE_SERVICE_ROLE_KEY`
   - Value: `sb_secret_g2yRYthqbpz9Zs41nAWuHw_wJe3l2TR`
   - Select "All Environments"
   - Click "Save"

3. **Redeploy**:
   - Go to "Deployments" tab
   - Click ⋯ on latest deployment
   - Click "Redeploy"
   - Wait for deployment to complete

4. **Test**:
   - Visit: https://nakurustk.vercel.app/
   - Should return: `{"status":"ok","message":"M-Pesa Payment Gateway API is running"}`
   - Try payment flow - should now write to database

## Verification:

After redeploying, check the logs. You should see:
```
✅ Supabase client initialized with service role
   URL: https://nzlluafskrrhbryimftu.supabase...
   Service key: sb_secret_g2yRYthqbp...
```

If you see errors about missing environment variables, the setup is incomplete.

