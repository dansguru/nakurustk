// @ts-ignore - Vercel types
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Force Node.js runtime (required for Supabase JS to work correctly)
export const config = {
  runtime: 'nodejs',
};

// Hardcoded Supabase credentials (TEMPORARY)
const SUPABASE_URL = 'https://nzlluafskmrhbryimftu.supabase.co';
const SUPABASE_SERVICE_KEY = 'sb_secret_g2yRYthqbpz9Zs41nAWuHw_wJe3l2TR';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    // Extract checkout_request_id from URL path
    // Vercel passes the full path in req.url (e.g., "/api/mpesa/payment-status/ws_CO_...")
    let checkoutRequestId: string | undefined;
    
    if (req.url) {
      // Remove query string if present
      const urlPath = req.url.split('?')[0];
      // Split by '/' and filter out empty parts
      const urlParts = urlPath.split('/').filter((part: string) => part && part.length > 0);
      
      // Find 'payment-status' in the path and get the next segment
      const statusIndex = urlParts.indexOf('payment-status');
      if (statusIndex !== -1 && urlParts[statusIndex + 1]) {
        checkoutRequestId = urlParts[statusIndex + 1];
      } else if (urlParts.length > 0) {
        // Fallback: get the last non-empty segment
        checkoutRequestId = urlParts[urlParts.length - 1];
      }
    }

    if (!checkoutRequestId || checkoutRequestId === 'payment-status' || checkoutRequestId.length === 0) {
      console.error('❌ Missing checkout_request_id. URL:', req.url, 'Query:', req.query);
      return res.status(400).json({
        success: false,
        message: 'Missing checkout_request_id in URL path. Expected: /api/mpesa/payment-status/{checkoutRequestId}',
        url: req.url,
        query: req.query,
      });
    }

    console.log('🔍 Checking payment status for:', checkoutRequestId, '| URL:', req.url);

    // Check pending payments table
    const { data: pendingPayment, error: pendingError } = await supabase
      .from('pending_payments')
      .select('*')
      .eq('checkout_request_id', checkoutRequestId)
      .single();

    if (pendingError) {
      console.log('⚠️ Pending payment query error:', pendingError.code, pendingError.message);
      
      // Check if it's a network/connection error
      const isNetworkError = pendingError.message?.includes('fetch failed') || 
                            pendingError.message?.includes('ENOTFOUND') ||
                            pendingError.message?.includes('ECONNREFUSED') ||
                            pendingError.details?.includes('fetch failed');
      
      if (isNetworkError) {
        console.error('❌ Database connection error:', pendingError);
        return res.status(503).json({
          success: false,
          message: 'Database service temporarily unavailable. Please try again in a moment.',
          checkout_request_id: checkoutRequestId,
          error: 'Database connection failed',
        });
      }
      
      // If not found in pending_payments, check bookings table
      if (pendingError.code === 'PGRST116') {
        console.log('🔍 Checking bookings table for:', checkoutRequestId);
        const { data: booking, error: bookingError } = await supabase
          .from('event_bookings')
          .select('payment_status, mpesa_checkout_request_id')
          .eq('mpesa_checkout_request_id', checkoutRequestId)
          .single();

        if (booking) {
          console.log('✅ Found booking with status:', booking.payment_status);
          return res.json({
            success: true,
            status: booking.payment_status,
            checkout_request_id: checkoutRequestId,
          });
        }
        
        // Check if booking query also has network error
        if (bookingError) {
          const isBookingNetworkError = bookingError.message?.includes('fetch failed') || 
                                      bookingError.message?.includes('ENOTFOUND') ||
                                      bookingError.message?.includes('ECONNREFUSED') ||
                                      bookingError.details?.includes('fetch failed');
          
          if (isBookingNetworkError) {
            console.error('❌ Database connection error on bookings query:', bookingError);
            return res.status(503).json({
              success: false,
              message: 'Database service temporarily unavailable. Please try again in a moment.',
              checkout_request_id: checkoutRequestId,
              error: 'Database connection failed',
            });
          }
        }
      } else {
        console.error('❌ Pending payment query error (non-404):', pendingError);
      }

      // Return 404 only if not found in both tables (not a network error)
      return res.status(404).json({
        success: false,
        message: 'Payment not found. The payment may not have been initiated or the checkout request ID is invalid.',
        checkout_request_id: checkoutRequestId,
        error: pendingError.message,
        code: pendingError.code,
      });
    }

    if (!pendingPayment) {
      console.log('⚠️ Pending payment is null, checking bookings table');
      // Check bookings table as fallback
      const { data: booking, error: bookingError } = await supabase
        .from('event_bookings')
        .select('payment_status, mpesa_checkout_request_id')
        .eq('mpesa_checkout_request_id', checkoutRequestId)
        .single();

      if (booking) {
        console.log('✅ Found booking with status:', booking.payment_status);
        return res.json({
          success: true,
          status: booking.payment_status,
          checkout_request_id: checkoutRequestId,
        });
      }

      // Check if booking query has network error
      if (bookingError) {
        const isBookingNetworkError = bookingError.message?.includes('fetch failed') || 
                                      bookingError.message?.includes('ENOTFOUND') ||
                                      bookingError.message?.includes('ECONNREFUSED') ||
                                      bookingError.details?.includes('fetch failed');
        
        if (isBookingNetworkError) {
          console.error('❌ Database connection error on bookings query:', bookingError);
          return res.status(503).json({
            success: false,
            message: 'Database service temporarily unavailable. Please try again in a moment.',
            checkout_request_id: checkoutRequestId,
            error: 'Database connection failed',
          });
        }
      }

      return res.status(404).json({
        success: false,
        message: 'Payment not found in pending payments or bookings',
        checkout_request_id: checkoutRequestId,
      });
    }
    
    console.log('✅ Found pending payment with status:', pendingPayment.payment_status);
    console.log('📤 Returning payment status response:', {
      success: true,
      status: pendingPayment.payment_status || 'pending',
      error_code: pendingPayment.error_code || null,
      error_message: pendingPayment.error_message || null,
      checkout_request_id: checkoutRequestId,
    });

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

