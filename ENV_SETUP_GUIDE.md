# 📋 How to Use This File

## For Local Development:

1. Copy this file:
   ```bash
   cp .env.example .env
   ```

2. The `.env` file is already filled with your actual credentials - ready to use!

3. Start the server:
   ```bash
   npm run dev
   ```

---

## For Vercel Deployment:

Copy and paste each variable into Vercel:

**Go to**: https://vercel.com/dashboard → nakurustk → Settings → Environment Variables

### Click "Add New" for each:

**Variable 1:**
- Name: `SUPABASE_URL`
- Value: `https://nzlluafskrrhbryimftu.supabase.co`

**Variable 2:**
- Name: `SUPABASE_SERVICE_ROLE_KEY`
- Value: `erx42BlhV/CE3QSFSBgXs2nJ4bl3bnCr3Ul6VwgchiBVgKJwO5YUZZlrp13Yp92rmNm5vzB9jtOtM84Am0+2TQ==`

**Variable 3:**
- Name: `CONSUMER_KEY`
- Value: `AuuordWQP43r19TuMwOlnmuDkFAYjTGT32BReggnDMUa3EII`

**Variable 4:**
- Name: `SECRET_KEY`
- Value: `QkRDUnSSke3HBaWSyllPCAfGAI4vDGApiPxKBOfvhyd1Ln3zPQxyCCLPhds03z3R`

**Variable 5:**
- Name: `PASS_KEY`
- Value: `bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919`

**Variable 6:**
- Name: `SHORT_CODE`
- Value: `174379`

**Variable 7 (Optional):**
- Name: `CALLBACK_URL`
- Value: `https://nakurustk.vercel.app/api/mpesa/callback`

**Variable 8 (Optional):**
- Name: `MPESA_BASE_URL`
- Value: `https://sandbox.safaricom.co.ke`

### After adding all variables:
1. Select "All Environments" (Production, Preview, Development)
2. Click "Save"
3. Go to "Deployments" tab
4. Click ⋯ on latest deployment → "Redeploy"

---

## ✅ Checklist:

- [ ] SUPABASE_URL
- [ ] SUPABASE_SERVICE_ROLE_KEY
- [ ] CONSUMER_KEY
- [ ] SECRET_KEY (already added ✅)
- [ ] PASS_KEY (already added ✅)
- [ ] SHORT_CODE (already added ✅)
- [ ] CALLBACK_URL (optional)
- [ ] MPESA_BASE_URL (optional)

---

**After redeploying, test:** https://nakurustk.vercel.app/

Should return: `{"status":"ok","message":"M-Pesa Payment Gateway API is running"}`

