import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

export const getPaymentStatusController = async (req: Request, res: Response) => {
  try {
    const { checkoutRequestId } = req.params;

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

    if (pendingError || !pendingPayment) {
      // Check if booking exists (payment succeeded)
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

