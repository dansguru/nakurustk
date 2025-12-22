// @ts-ignore - Vercel types
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Hardcoded Supabase credentials (TEMPORARY)
const SUPABASE_URL = 'https://nzlluafskrrhbryimftu.supabase.co';
const SUPABASE_SERVICE_KEY = 'sb_secret_g2yRYthqbpz9Zs41nAWuHw_wJe3l2TR';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    // For Vercel dynamic routes, the path param comes from the URL
    const urlParts = req.url?.split('/') || [];
    const checkoutRequestId = urlParts[urlParts.length - 1]; // Last part of URL

    if (!checkoutRequestId) {
      return res.status(400).json({
        success: false,
        message: 'Missing checkout_request_id',
      });
    }

    console.log('🔍 Checking payment status for:', checkoutRequestId);

    // Check pending payments table
    const { data: pendingPayment, error: pendingError } = await supabase
      .from('pending_payments')
      .select('*')
      .eq('checkout_request_id', checkoutRequestId)
      .single();

    if (pendingError) {
      // If not found, check bookings
      if (pendingError.code === 'PGRST116') {
        const { data: booking } = await supabase
          .from('event_bookings')
          .select('payment_status, mpesa_checkout_request_id')
          .eq('mpesa_checkout_request_id', checkoutRequestId)
          .single();

        if (booking) {
          return res.json({
            success: true,
            status: booking.payment_status,
            checkout_request_id: checkoutRequestId,
          });
        }
      }

      return res.status(404).json({
        success: false,
        message: 'Payment not found',
        error: pendingError.message,
        code: pendingError.code,
      });
    }

    if (!pendingPayment) {
      // Check bookings
      const { data: booking } = await supabase
        .from('event_bookings')
        .select('payment_status, mpesa_checkout_request_id')
        .eq('mpesa_checkout_request_id', checkoutRequestId)
        .single();

      if (booking) {
        return res.json({
          success: true,
          status: booking.payment_status,
          checkout_request_id: checkoutRequestId,
        });
      }

      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    // Return payment status
    return res.json({
      success: true,
      status: pendingPayment.payment_status || 'pending',
      error_code: pendingPayment.error_code || null,
      error_message: pendingPayment.error_message || null,
      checkout_request_id: checkoutRequestId,
    });
  } catch (error: any) {
    console.error('❌ Get payment status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
}

