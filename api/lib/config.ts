export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getSupabaseServiceKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!key || key.trim() === '') {
    throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)');
  }
  const lower = key.toLowerCase();
  if (lower.includes('publishable') || lower.includes('anon')) {
    throw new Error('SUPABASE service key is publishable/anon. Use a secret service key.');
  }
  return key;
}

export const SUPABASE_URL = requireEnv('SUPABASE_URL');
export const SUPABASE_SERVICE_ROLE_KEY = getSupabaseServiceKey();

export const MPESA_CONFIG = {
  consumerKey: requireEnv('CONSUMER_KEY'),
  consumerSecret: requireEnv('SECRET_KEY'),
  shortcode: requireEnv('SHORT_CODE'),
  passkey: requireEnv('PASS_KEY'),
  callbackUrl: requireEnv('CALLBACK_URL'),
  baseUrl: process.env.MPESA_BASE_URL || 'https://api.safaricom.co.ke',
};

export const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
