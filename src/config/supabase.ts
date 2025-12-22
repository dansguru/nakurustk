import { createClient } from '@supabase/supabase-js';

let supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Ensure URL has protocol
if (supabaseUrl && !supabaseUrl.startsWith('http://') && !supabaseUrl.startsWith('https://')) {
  supabaseUrl = `https://${supabaseUrl}`;
}

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables:');
  console.error('   SUPABASE_URL:', !!supabaseUrl, supabaseUrl ? `(found: ${supabaseUrl.substring(0, 30)}...)` : '(NOT SET)');
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey, supabaseServiceKey ? '(found)' : '(NOT SET)');
  console.error('');
  console.error('⚠️  IMPORTANT: You need to add these to Vercel:');
  console.error('   1. Go to: https://vercel.com/dashboard → Your Project → Settings → Environment Variables');
  console.error('   2. Add SUPABASE_URL: https://nzlluafskrrhbryimftu.supabase.co');
  console.error('   3. Add SUPABASE_SERVICE_ROLE_KEY: (your secret service role key)');
  console.error('   4. Select "All Environments" and redeploy');
  console.error('');
  throw new Error('Missing Supabase environment variables. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel');
}

// Create Supabase client with service role key (bypasses RLS)
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

console.log('✅ Supabase client initialized with service role');
console.log('   URL:', supabaseUrl.substring(0, 30) + '...');
console.log('   Service key:', supabaseServiceKey.substring(0, 20) + '...');

