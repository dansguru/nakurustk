// @ts-ignore - Vercel types
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../lib/supabase';

export const config = {
  runtime: 'nodejs',
};

// TEMP_DEBUG_REMOVE_AFTER_FIX
const MPESA_DEBUG_LOGS = ['1', 'true', 'yes', 'on'].includes(String(process.env.MPESA_DEBUG_LOGS || '').toLowerCase());
function dlog(message: string, data?: Record<string, unknown>) {
  if (!MPESA_DEBUG_LOGS) return;
  console.log(`[MPESA][callback] ${message}`, data || {});
}

function isDbNetworkError(error: any): boolean {
  const message = error?.message || '';
  const details = error?.details || '';
  return (
    message.includes('fetch failed')
    || message.includes('ENOTFOUND')
    || message.includes('ECONNREFUSED')
    || details.includes('fetch failed')
  );
}

function mapFailure(resultCode: number | string | null, resultDesc: string): { errorType: string; errorMessage: string } {
  const code = String(resultCode ?? '');
  switch (code) {
    case '1':
      return { errorType: 'insufficient_funds', errorMessage: 'Insufficient funds' };
    case '1032':
      return { errorType: 'cancelled', errorMessage: 'Payment cancelled' };
    case '1037':
      return { errorType: 'timeout', errorMessage: 'Payment timeout' };
    case '2001':
      return { errorType: 'wrong_pin', errorMessage: 'Wrong PIN' };
    case '26':
      return { errorType: 'system_busy', errorMessage: 'System busy' };
    case '1019':
      return { errorType: 'expired', errorMessage: 'Transaction expired' };
    case '17':
      return { errorType: 'cancelled', errorMessage: 'Transaction cancelled' };
    default:
      return { errorType: 'failed', errorMessage: resultDesc || 'Payment failed' };
  }
}

function parseCallbackMetadata(stkCallback: any): { receiptNumber: string; transactionDateIso: string } {
  const callbackMetadata = stkCallback?.CallbackMetadata?.Item || [];
  const receiptNumber = callbackMetadata.find((item: any) => item.Name === 'MpesaReceiptNumber')?.Value || '';
  const transactionDateRaw = callbackMetadata.find((item: any) => item.Name === 'TransactionDate')?.Value;

  const transactionDateIso = transactionDateRaw
    ? new Date(String(transactionDateRaw).replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6')).toISOString()
    : new Date().toISOString();

  return { receiptNumber, transactionDateIso };
}

async function handleTShirtSuccess(checkoutRequestId: string, pendingTShirtPayment: any, receiptNumber: string, transactionDateIso: string): Promise<void> {
  if (!pendingTShirtPayment.tshirt_id) {
    await supabase
      .from('pending_tshirt_payments')
      .update({
        payment_status: 'failed',
        error_code: 'MISSING_TSHIRT_ID',
        error_message: 'T-shirt information is missing for this payment. Please try again or contact support.',
      })
      .eq('id', pendingTShirtPayment.id);
    return;
  }

  const { data: existingBooking } = await supabase
    .from('tshirt_bookings')
    .select('id, payment_status')
    .eq('mpesa_checkout_request_id', checkoutRequestId)
    .eq('payment_status', 'paid')
    .maybeSingle();

  if (existingBooking) {
    await supabase
      .from('pending_tshirt_payments')
      .update({
        payment_status: 'paid',
        booking_id: existingBooking.id,
        error_code: null,
        error_message: null,
      })
      .eq('checkout_request_id', checkoutRequestId);
    return;
  }

  const phoneNumber = pendingTShirtPayment.user_phone || '';
  const { data: booking, error: bookingError } = await supabase
    .from('tshirt_bookings')
    .insert({
      tshirt_id: pendingTShirtPayment.tshirt_id,
      user_id: pendingTShirtPayment.user_id,
      user_name: pendingTShirtPayment.user_name,
      user_email: pendingTShirtPayment.user_email,
      user_phone: phoneNumber,
      size: pendingTShirtPayment.size,
      color: pendingTShirtPayment.color,
      unit_price: pendingTShirtPayment.unit_price,
      quantity: pendingTShirtPayment.quantity,
      total_amount: pendingTShirtPayment.total_amount,
      payment_method: 'M-Pesa',
      payment_status: 'paid',
      mpesa_checkout_request_id: checkoutRequestId,
      mpesa_receipt_number: receiptNumber || checkoutRequestId,
      mpesa_transaction_date: transactionDateIso,
      mpesa_phone_number: phoneNumber,
      booking_status: 'confirmed',
      paid_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (bookingError || !booking) {
    await supabase
      .from('pending_tshirt_payments')
      .update({
        payment_status: 'pending',
        error_code: 'BOOKING_CREATION_FAILED',
        error_message: `T-shirt booking creation failed: ${bookingError?.message || 'unknown error'}. Payment verified but booking not created.`,
      })
      .eq('checkout_request_id', checkoutRequestId);
    return;
  }

  await supabase
    .from('pending_tshirt_payments')
    .update({
      payment_status: 'paid',
      booking_id: booking.id,
      error_code: null,
      error_message: null,
    })
    .eq('checkout_request_id', checkoutRequestId);
}

async function handleEventSuccess(checkoutRequestId: string, pendingPayment: any, receiptNumber: string, transactionDateIso: string): Promise<void> {
  if (!pendingPayment) return;

  const { data: existingBooking } = await supabase
    .from('event_bookings')
    .select('id, payment_status')
    .eq('mpesa_checkout_request_id', checkoutRequestId)
    .eq('payment_status', 'paid')
    .maybeSingle();

  if (existingBooking) {
    await supabase
      .from('pending_payments')
      .update({
        payment_status: 'paid',
        booking_id: existingBooking.id,
        error_code: null,
        error_message: null,
      })
      .eq('checkout_request_id', checkoutRequestId);
    return;
  }

  const { data: booking, error: bookingError } = await supabase
    .from('event_bookings')
    .insert({
      event_id: pendingPayment.event_id,
      user_id: pendingPayment.user_id,
      user_name: pendingPayment.user_name,
      user_email: pendingPayment.user_email,
      user_phone: pendingPayment.user_phone,
      ticket_type: pendingPayment.ticket_type,
      ticket_price: pendingPayment.ticket_price,
      quantity: pendingPayment.quantity,
      total_amount: pendingPayment.total_amount,
      payment_method: 'M-Pesa',
      payment_status: 'paid',
      mpesa_checkout_request_id: checkoutRequestId,
      mpesa_receipt_number: receiptNumber || checkoutRequestId,
      mpesa_transaction_date: transactionDateIso,
      mpesa_phone_number: pendingPayment.user_phone,
      booking_status: 'confirmed',
      paid_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (bookingError || !booking) {
    await supabase
      .from('pending_payments')
      .update({
        payment_status: 'pending',
        error_code: 'BOOKING_CREATION_FAILED',
        error_message: `Booking creation failed: ${bookingError?.message || 'unknown error'}. Payment verified but booking not created.`,
      })
      .eq('checkout_request_id', checkoutRequestId);
    return;
  }

  await supabase
    .from('pending_payments')
    .update({
      payment_status: 'paid',
      booking_id: booking.id,
      error_code: null,
      error_message: null,
    })
    .eq('checkout_request_id', checkoutRequestId);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  dlog('Incoming callback request', { method: req.method, url: req.url });
  if (req.method !== 'POST') {
    return res.status(405).json({ ResultCode: 1, ResultDesc: 'Method not allowed' });
  }

  try {
    let parsedBody: any = req.body;
    if (typeof parsedBody === 'string') {
      try {
        parsedBody = JSON.parse(parsedBody);
      } catch {
        parsedBody = {};
      }
    }

    const stkCallback =
      parsedBody?.Body?.stkCallback
      || parsedBody?.stkCallback
      || parsedBody?.body?.stkCallback
      || null;

    dlog('Parsed callback envelope', {
      hasBody: Boolean(parsedBody),
      hasStkCallback: Boolean(stkCallback),
      callbackKeys: stkCallback ? Object.keys(stkCallback) : [],
    });
    if (!stkCallback) {
      dlog('Callback payload missing stkCallback', {
        topLevelKeys: parsedBody && typeof parsedBody === 'object' ? Object.keys(parsedBody) : [],
      });
      return res.json({ ResultCode: 0, ResultDesc: 'Success' });
    }

    const { CheckoutRequestID, ResultCode, ResultDesc } = stkCallback;
    dlog('Callback core fields', {
      checkoutRequestId: CheckoutRequestID || null,
      resultCode: ResultCode ?? null,
      resultDesc: ResultDesc || null,
    });
    if (!CheckoutRequestID) {
      return res.json({ ResultCode: 0, ResultDesc: 'Success' });
    }

    const { receiptNumber, transactionDateIso } = parseCallbackMetadata(stkCallback);

    let pendingTShirtPayment: any = null;
    let pendingPayment: any = null;
    let pendingPaymentError: any = null;
    let isNetworkError = false;

    try {
      const tshirtResult = await supabase
        .from('pending_tshirt_payments')
        .select('*')
        .eq('checkout_request_id', CheckoutRequestID)
        .single();
      pendingTShirtPayment = tshirtResult.data;
    } catch {
      pendingTShirtPayment = null;
    }
    dlog('Pending tshirt lookup', {
      checkoutRequestId: CheckoutRequestID,
      found: Boolean(pendingTShirtPayment),
    });

    if (!pendingTShirtPayment) {
      try {
        const result = await supabase
          .from('pending_payments')
          .select('*')
          .eq('checkout_request_id', CheckoutRequestID)
          .single();
        pendingPayment = result.data;
        pendingPaymentError = result.error;
        isNetworkError = isDbNetworkError(pendingPaymentError);
      } catch (error: any) {
        pendingPaymentError = error;
        isNetworkError = isDbNetworkError(error);
      }
    }
    dlog('Pending event lookup', {
      checkoutRequestId: CheckoutRequestID,
      found: Boolean(pendingPayment),
      hasError: Boolean(pendingPaymentError),
      isNetworkError,
    });

    if (ResultCode === 0) {
      dlog('Successful callback result', {
        checkoutRequestId: CheckoutRequestID,
        paymentType: pendingTShirtPayment ? 'tshirt' : 'event',
      });
      if (pendingTShirtPayment) {
        await handleTShirtSuccess(CheckoutRequestID, pendingTShirtPayment, receiptNumber, transactionDateIso);
        return res.json({ ResultCode: 0, ResultDesc: 'Success' });
      }

      await handleEventSuccess(CheckoutRequestID, pendingPayment, receiptNumber, transactionDateIso);
      return res.json({ ResultCode: 0, ResultDesc: 'Success' });
    }

    const { errorType, errorMessage } = mapFailure(ResultCode, ResultDesc || 'Payment failed');
    dlog('Failed callback mapped', {
      checkoutRequestId: CheckoutRequestID,
      resultCode: ResultCode ?? null,
      errorType,
      errorMessage,
      paymentType: pendingTShirtPayment ? 'tshirt' : (pendingPayment ? 'event' : 'unknown'),
    });

    if (pendingTShirtPayment) {
      await supabase
        .from('pending_tshirt_payments')
        .update({
          payment_status: errorType,
          error_code: String(ResultCode ?? ''),
          error_message: errorMessage,
        })
        .eq('checkout_request_id', CheckoutRequestID);
      return res.json({ ResultCode: 0, ResultDesc: 'Success' });
    }

    if (pendingPayment) {
      await supabase
        .from('pending_payments')
        .update({
          payment_status: errorType,
          error_code: String(ResultCode ?? ''),
          error_message: errorMessage,
        })
        .eq('checkout_request_id', CheckoutRequestID);
    } else if (!isNetworkError) {
      const insertResult = await supabase
        .from('pending_payments')
        .insert({
          checkout_request_id: CheckoutRequestID,
          payment_status: errorType,
          error_code: String(ResultCode ?? ''),
          error_message: errorMessage,
          event_id: null,
          user_id: null,
          total_amount: null,
        });

      if (insertResult.error) {
        console.error('Failed to create pending payment record:', insertResult.error.message);
      }
    }

    if (pendingPaymentError && !isNetworkError) {
      console.warn('Pending payment lookup issue:', pendingPaymentError.message);
    }

    dlog('Callback processing complete', { checkoutRequestId: CheckoutRequestID });
    return res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (error: any) {
    dlog('Callback handler exception', { message: error?.message || null });
    console.error('Callback handler error:', error?.message || error);
    return res.json({ ResultCode: 0, ResultDesc: 'Success' });
  }
}
