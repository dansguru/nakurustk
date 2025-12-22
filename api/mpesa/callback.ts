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
  if (req.method !== 'POST') {
    return res.status(405).json({ ResultCode: 1, ResultDesc: 'Method not allowed' });
  }

  try {
    console.log('📥 M-Pesa callback received:', JSON.stringify(req.body, null, 2));

    const { Body } = req.body;
    const stkCallback = Body?.stkCallback;

    if (!stkCallback) {
      console.error('❌ Invalid callback format');
      return res.json({ ResultCode: 0, ResultDesc: 'Success' });
    }

    const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc } = stkCallback;

    // Get pending payment
    const { data: pendingPayment } = await supabase
      .from('pending_payments')
      .select('*')
      .eq('checkout_request_id', CheckoutRequestID)
      .single();

    if (ResultCode === 0) {
      // Payment successful
      const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];
      const mpesaReceiptNumber = callbackMetadata.find((item: any) => item.Name === 'MpesaReceiptNumber')?.Value;
      const transactionDate = callbackMetadata.find((item: any) => item.Name === 'TransactionDate')?.Value;

      if (pendingPayment) {
        // Create booking
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
            mpesa_checkout_request_id: CheckoutRequestID,
            mpesa_receipt_number: mpesaReceiptNumber,
            mpesa_transaction_date: transactionDate
              ? new Date(String(transactionDate).replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6')).toISOString()
              : new Date().toISOString(),
            mpesa_phone_number: pendingPayment.user_phone,
            booking_status: 'confirmed',
            paid_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (!bookingError && booking) {
          console.log('✅ Booking created:', booking.id);
          await supabase
            .from('pending_payments')
            .update({ payment_status: 'paid', booking_id: booking.id })
            .eq('checkout_request_id', CheckoutRequestID);
        }
      }
    } else {
      // Payment failed
      let errorType = 'failed';
      let errorMessage = ResultDesc || 'Payment failed';

      switch (ResultCode) {
        case 1: errorType = 'insufficient_funds'; errorMessage = 'Insufficient funds'; break;
        case 1032: errorType = 'cancelled'; errorMessage = 'Payment cancelled'; break;
        case 1037: errorType = 'timeout'; errorMessage = 'Payment timeout'; break;
        case 2001: errorType = 'wrong_pin'; errorMessage = 'Wrong PIN'; break;
        case 26: errorType = 'system_busy'; errorMessage = 'System busy'; break;
        case 1019: errorType = 'expired'; errorMessage = 'Transaction expired'; break;
        case 17: errorType = 'cancelled'; errorMessage = 'Transaction cancelled'; break;
      }

      if (pendingPayment) {
        await supabase
          .from('pending_payments')
          .update({
            payment_status: errorType,
            error_code: String(ResultCode),
            error_message: errorMessage,
          })
          .eq('checkout_request_id', CheckoutRequestID);

        console.log(`❌ Payment ${errorType}:`, errorMessage);
      }
    }

    return res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (error: any) {
    console.error('❌ Callback error:', error);
    return res.json({ ResultCode: 0, ResultDesc: 'Success' });
  }
}

