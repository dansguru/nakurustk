export const mpesaConfig = {
  consumerKey: process.env.CONSUMER_KEY || process.env.MPESA_CONSUMER_KEY!,
  consumerSecret: process.env.SECRET_KEY || process.env.MPESA_CONSUMER_SECRET!,
  shortcode: process.env.SHORT_CODE || process.env.MPESA_SHORTCODE!,
  passkey: process.env.PASS_KEY || process.env.MPESA_PASSKEY!,
  callbackUrl: process.env.CALLBACK_URL || process.env.MPESA_CALLBACK_URL || 'https://nakurustk.vercel.app/api/mpesa/callback',
  baseUrl: process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke',
};

// Validate required environment variables
const requiredVars = [
  { key: 'CONSUMER_KEY', alt: 'MPESA_CONSUMER_KEY' },
  { key: 'SECRET_KEY', alt: 'MPESA_CONSUMER_SECRET' },
  { key: 'SHORT_CODE', alt: 'MPESA_SHORTCODE' },
  { key: 'PASS_KEY', alt: 'MPESA_PASSKEY' }
];

for (const varConfig of requiredVars) {
  if (!process.env[varConfig.key] && !process.env[varConfig.alt]) {
    console.error(`❌ Missing required environment variable: ${varConfig.key} or ${varConfig.alt}`);
  }
}

console.log('✅ M-Pesa configuration loaded', {
  shortcode: mpesaConfig.shortcode,
  callbackUrl: mpesaConfig.callbackUrl,
  baseUrl: mpesaConfig.baseUrl,
});

