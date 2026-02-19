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

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function getAllowedOrigins(): string[] {
  const primaryRaw = process.env.ALLOWED_ORIGIN || '*';
  const primary = primaryRaw === '*' ? '*' : normalizeOrigin(primaryRaw);
  const extras = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => (value.trim() === '*' ? '*' : normalizeOrigin(value)))
    .filter((value) => value.length > 0);

  const allowed = new Set<string>([primary, ...extras]);

  if (allowed.has('*')) {
    return ['*'];
  }

  // Accept apex/www variants of the same configured domain.
  try {
    const url = new URL(primary);
    const host = url.hostname;
    const aliasHost = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
    const alias = `${url.protocol}//${aliasHost}${url.port ? `:${url.port}` : ''}`;
    allowed.add(normalizeOrigin(alias));
  } catch {
    // Ignore invalid ALLOWED_ORIGIN format; requireEnv guarantees presence.
  }

  return Array.from(allowed);
}

export const ALLOWED_ORIGINS = getAllowedOrigins();
export const ALLOWED_ORIGIN = ALLOWED_ORIGINS[0];

export function isAllowedRequestOrigin(origin?: string): boolean {
  if (ALLOWED_ORIGIN === '*') return true;
  if (typeof origin !== 'string' || origin.trim() === '') return false;
  return ALLOWED_ORIGINS.includes(normalizeOrigin(origin));
}
