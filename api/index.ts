// @ts-ignore - Vercel types
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.json({
    status: 'ok',
    message: 'M-Pesa Payment Gateway API is running',
    timestamp: new Date().toISOString(),
  });
}

