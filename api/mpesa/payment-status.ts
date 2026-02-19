// @ts-ignore - Vercel types
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ALLOWED_ORIGIN, isAllowedRequestOrigin } from '../lib/config';
import { supabase } from '../lib/supabase';

export const config = {
  runtime: 'nodejs',
};

function dlog(message: string, data?: Record<string, unknown>) {
  void message;
  void data;
}

function isDbNetworkError(error: any): boolean {
  return (
    error?.message?.includes('fetch failed')
    || error?.message?.includes('ENOTFOUND')
    || error?.message?.includes('ECONNREFUSED')
    || error?.details?.includes('fetch failed')
  );
}

function extractCheckoutRequestId(url?: string): string | undefined {
  if (!url) return undefined;
  const urlPath = url.split('?')[0];
  const urlParts = urlPath.split('/').filter((part: string) => part && part.length > 0);
  const statusIndex = urlParts.indexOf('payment-status');
  if (statusIndex !== -1 && urlParts[statusIndex + 1]) return urlParts[statusIndex + 1];
  if (urlParts.length > 0) return urlParts[urlParts.length - 1];
  return undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  dlog('Incoming request', { method: req.method, url: req.url, origin: req.headers.origin || null });
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  if (ALLOWED_ORIGIN !== '*') {
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    dlog('Preflight accepted');
    return res.status(200).end();
  }

  const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  if (!isAllowedRequestOrigin(requestOrigin)) {
    dlog('Forbidden origin', { requestOrigin: requestOrigin || null, allowedOrigin: ALLOWED_ORIGIN });
    return res.status(403).json({ success: false, message: 'Forbidden origin' });
  }
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });

  try {
    const checkoutRequestId = extractCheckoutRequestId(req.url);
    dlog('Extracted checkoutRequestId', { checkoutRequestId: checkoutRequestId || null });
    if (!checkoutRequestId || checkoutRequestId === 'payment-status') {
      return res.status(400).json({
        success: false,
        message: 'Missing checkout_request_id in URL path. Expected: /api/mpesa/payment-status/{checkoutRequestId}',
      });
    }

    // Check T-shirt pending payments first.
    const { data: pendingTShirtPayment, error: pendingTShirtError } = await supabase
      .from('pending_tshirt_payments')
      .select('*')
      .eq('checkout_request_id', checkoutRequestId)
      .single();

    // Only check event pending payments if no T-shirt payment found.
    let pendingPayment: any = null;
    let pendingError: any = null;
    if (!pendingTShirtPayment) {
      const eventPendingResult = await supabase
        .from('pending_payments')
        .select('*')
        .eq('checkout_request_id', checkoutRequestId)
        .single();
      pendingPayment = eventPendingResult.data;
      pendingError = eventPendingResult.error;
    }
    dlog('Pending lookup result', {
      checkoutRequestId,
      foundTshirtPending: Boolean(pendingTShirtPayment),
      foundEventPending: Boolean(pendingPayment),
      tshirtErrorCode: pendingTShirtError?.code || null,
      eventErrorCode: pendingError?.code || null,
    });

    let foundPayment: any = null;
    let foundError: any = null;
    let isTShirtPayment = false;

    if (pendingTShirtPayment) {
      foundPayment = pendingTShirtPayment;
      foundError = pendingTShirtError;
      isTShirtPayment = true;
    } else if (pendingPayment) {
      foundPayment = pendingPayment;
      foundError = pendingError;
      isTShirtPayment = false;
    } else {
      foundError = pendingTShirtError || pendingError;
    }

    if (foundError && !foundPayment) {
      dlog('No pending record found', { checkoutRequestId, code: foundError?.code || null, message: foundError?.message || null });
      if (isDbNetworkError(foundError)) {
        return res.status(503).json({
          success: false,
          message: 'Database service temporarily unavailable. Please try again in a moment.',
          checkout_request_id: checkoutRequestId,
          error: 'Database connection failed',
        });
      }

      if (foundError.code === 'PGRST116') {
        const { data: tshirtBooking, error: tshirtBookingError } = await supabase
          .from('tshirt_bookings')
          .select('payment_status, mpesa_checkout_request_id')
          .eq('mpesa_checkout_request_id', checkoutRequestId)
          .single();

        if (tshirtBooking) {
          dlog('Found tshirt booking fallback', { checkoutRequestId, status: tshirtBooking.payment_status || null });
          return res.json({
            success: true,
            status: tshirtBooking.payment_status,
            checkout_request_id: checkoutRequestId,
            payment_type: 'tshirt',
          });
        }

        const { data: eventBooking, error: eventBookingError } = await supabase
          .from('event_bookings')
          .select('payment_status, mpesa_checkout_request_id')
          .eq('mpesa_checkout_request_id', checkoutRequestId)
          .single();

        if (eventBooking) {
          dlog('Found event booking fallback', { checkoutRequestId, status: eventBooking.payment_status || null });
          return res.json({
            success: true,
            status: eventBooking.payment_status,
            checkout_request_id: checkoutRequestId,
            payment_type: 'event',
          });
        }

        if (isDbNetworkError(tshirtBookingError) || isDbNetworkError(eventBookingError)) {
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
        message: 'Payment not found. The payment may not have been initiated or the checkout request ID is invalid.',
        checkout_request_id: checkoutRequestId,
        error: foundError.message,
        code: foundError.code,
      });
    }

    if (!foundPayment) {
      const { data: tshirtBooking, error: tshirtBookingError } = await supabase
        .from('tshirt_bookings')
        .select('payment_status, mpesa_checkout_request_id, id')
        .eq('mpesa_checkout_request_id', checkoutRequestId)
        .single();

      if (tshirtBooking) {
        dlog('Found tshirt booking in secondary fallback', { checkoutRequestId, status: tshirtBooking.payment_status || null, bookingId: tshirtBooking.id || null });
        return res.json({
          success: true,
          status: tshirtBooking.payment_status,
          checkout_request_id: checkoutRequestId,
          booking_id: tshirtBooking.id,
          payment_type: 'tshirt',
        });
      }

      const { data: eventBooking, error: eventBookingError } = await supabase
        .from('event_bookings')
        .select('payment_status, mpesa_checkout_request_id, id')
        .eq('mpesa_checkout_request_id', checkoutRequestId)
        .single();

      if (eventBooking) {
        dlog('Found event booking in secondary fallback', { checkoutRequestId, status: eventBooking.payment_status || null, bookingId: eventBooking.id || null });
        return res.json({
          success: true,
          status: eventBooking.payment_status,
          checkout_request_id: checkoutRequestId,
          booking_id: eventBooking.id,
          payment_type: 'event',
        });
      }

      if (isDbNetworkError(tshirtBookingError) || isDbNetworkError(eventBookingError)) {
        return res.status(503).json({
          success: false,
          message: 'Database service temporarily unavailable. Please try again in a moment.',
          checkout_request_id: checkoutRequestId,
          error: 'Database connection failed',
        });
      }

      return res.status(404).json({
        success: false,
        message: 'Payment not found in pending payments or bookings',
        checkout_request_id: checkoutRequestId,
      });
    }

    let bookingId: string | null = null;
    let finalStatus = foundPayment.payment_status || 'pending';

    if (foundPayment.payment_status === 'paid' && foundPayment.booking_id) {
      bookingId = foundPayment.booking_id;
    } else if (foundPayment.payment_status === 'paid') {
      if (isTShirtPayment) {
        const { data: tshirtBooking } = await supabase
          .from('tshirt_bookings')
          .select('id, payment_status')
          .eq('mpesa_checkout_request_id', checkoutRequestId)
          .eq('payment_status', 'paid')
          .maybeSingle();

        if (tshirtBooking) {
          bookingId = tshirtBooking.id;
          finalStatus = 'paid';
        }
      } else {
        const { data: eventBooking } = await supabase
          .from('event_bookings')
          .select('id, payment_status')
          .eq('mpesa_checkout_request_id', checkoutRequestId)
          .eq('payment_status', 'paid')
          .maybeSingle();

        if (eventBooking) {
          bookingId = eventBooking.id;
          finalStatus = 'paid';
        }
      }
    }

    return res.json({
      success: true,
      status: finalStatus,
      error_code: foundPayment.error_code || null,
      error_message: foundPayment.error_message || null,
      checkout_request_id: checkoutRequestId,
      booking_id: bookingId,
      payment_type: isTShirtPayment ? 'tshirt' : 'event',
    });
  } catch (error: any) {
    dlog('Unhandled failure', { message: error?.message || null });
    console.error('Get payment status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
}
