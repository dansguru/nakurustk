import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

export const getPaymentStatusController = async (req: Request, res: Response) => {
  try {
    const { checkoutRequestId } = req.params;

    console.log('🔍 Checking payment status for:', checkoutRequestId);

    if (!checkoutRequestId) {
      return res.status(400).json({
        success: false,
        message: 'Missing checkout_request_id',
      });
    }

    // Check pending payments table
    const { data: pendingPayment, error: pendingError } = await supabase
      .from('pending_payments')
      .select('*')
      .eq('checkout_request_id', checkoutRequestId)
      .single();

    if (pendingError) {
      console.log('⚠️ Error querying pending_payments:', pendingError);
      console.log('   Code:', pendingError.code);
      console.log('   Message:', pendingError.message);
      
      // If it's a "not found" error (PGRST116), check bookings
      if (pendingError.code === 'PGRST116') {
        // Check if booking exists (payment succeeded)
        const { data: booking, error: bookingError } = await supabase
          .from('event_bookings')
          .select('payment_status, mpesa_checkout_request_id')
          .eq('mpesa_checkout_request_id', checkoutRequestId)
          .single();

        if (booking) {
          console.log('✅ Found booking for checkout:', checkoutRequestId);
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
      console.log('⚠️ No pending payment found, checking bookings...');
      // Check if booking exists (payment succeeded)
      const { data: booking } = await supabase
        .from('event_bookings')
        .select('payment_status, mpesa_checkout_request_id')
        .eq('mpesa_checkout_request_id', checkoutRequestId)
        .single();

      if (booking) {
        console.log('✅ Found booking for checkout:', checkoutRequestId);
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

    console.log('✅ Found pending payment:', {
      id: pendingPayment.id,
      status: pendingPayment.payment_status,
      error_message: pendingPayment.error_message,
    });

    // Return payment status (including errors from callback)
    res.json({
      success: true,
      status: pendingPayment.payment_status || 'pending',
      error_code: pendingPayment.error_code || null,
      error_message: pendingPayment.error_message || null,
      checkout_request_id: checkoutRequestId,
    });
  } catch (error: any) {
    console.error('❌ Get payment status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

