import { Request, Response } from 'express';
import { initiateSTKPush, stkQuery } from '../services/mpesa';
import { supabase } from '../config/supabase';

export const stkPushController = async (req: Request, res: Response) => {
  try {
    const { booking_id, phone_number, amount, account_reference, transaction_desc } = req.body;

    // Validate request
    if (!booking_id || !phone_number || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: booking_id, phone_number, amount',
      });
    }

    // Verify booking exists
    const { data: booking, error: bookingError } = await supabase
      .from('event_bookings')
      .select('*')
      .eq('id', booking_id)
      .single();

    if (bookingError || !booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    // Initiate STK Push
    const mpesaResponse = await initiateSTKPush({
      phone_number,
      amount,
      account_reference: account_reference || `EVENT-${booking_id.substring(0, 8)}`,
      transaction_desc: transaction_desc || 'Event booking payment',
    });

    if (mpesaResponse.ResponseCode === '0') {
      // STK Push successful
      res.json({
        success: true,
        message: 'STK Push sent successfully',
        CheckoutRequestID: mpesaResponse.CheckoutRequestID,
        MerchantRequestID: mpesaResponse.MerchantRequestID,
        ResponseCode: mpesaResponse.ResponseCode,
        ResponseDescription: mpesaResponse.ResponseDescription,
      });
    } else {
      res.status(400).json({
        success: false,
        message: mpesaResponse.ResponseDescription || 'Failed to initiate STK Push',
        data: mpesaResponse,
      });
    }
  } catch (error: any) {
    console.error('❌ STK Push controller error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

export const mpesaCallbackController = async (req: Request, res: Response) => {
  try {
    console.log('📥 M-Pesa callback received:', JSON.stringify(req.body, null, 2));

    const { Body } = req.body;
    const stkCallback = Body?.stkCallback;

    if (!stkCallback) {
      return res.status(400).json({
        success: false,
        message: 'Invalid callback format',
      });
    }

    const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc } = stkCallback;

    // Find booking by CheckoutRequestID
    const { data: booking, error: bookingError } = await supabase
      .from('event_bookings')
      .select('*')
      .eq('mpesa_checkout_request_id', CheckoutRequestID)
      .single();

    if (bookingError || !booking) {
      console.error('❌ Booking not found for CheckoutRequestID:', CheckoutRequestID);
      return res.json({ success: true, message: 'Callback received' });
    }

    if (ResultCode === 0) {
      // Payment successful
      const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];
      const mpesaReceiptNumber = callbackMetadata.find(
        (item: any) => item.Name === 'MpesaReceiptNumber'
      )?.Value;
      const transactionDate = callbackMetadata.find(
        (item: any) => item.Name === 'TransactionDate'
      )?.Value;

      // Update booking
      const { error: updateError } = await supabase
        .from('event_bookings')
        .update({
          payment_status: 'paid',
          mpesa_receipt_number: mpesaReceiptNumber,
          mpesa_transaction_date: transactionDate
            ? new Date(
                String(transactionDate).replace(
                  /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/,
                  '$1-$2-$3T$4:$5:$6'
                )
              ).toISOString()
            : new Date().toISOString(),
          paid_at: new Date().toISOString(),
        })
        .eq('id', booking.id);

      if (updateError) {
        console.error('❌ Error updating booking:', updateError);
      } else {
        console.log('✅ Booking payment confirmed:', booking.id);
      }
    } else {
      // Payment failed
      const { error: updateError } = await supabase
        .from('event_bookings')
        .update({
          payment_status: 'failed',
        })
        .eq('id', booking.id);

      if (updateError) {
        console.error('❌ Error updating booking:', updateError);
      } else {
        console.log('❌ Payment failed for booking:', booking.id, ResultDesc);
      }
    }

    // Always return success to M-Pesa
    res.json({
      ResultCode: 0,
      ResultDesc: 'Success',
    });
  } catch (error: any) {
    console.error('❌ Callback controller error:', error);
    // Still return success to M-Pesa to avoid retries
    res.json({
      ResultCode: 0,
      ResultDesc: 'Success',
    });
  }
};

export const querySTKController = async (req: Request, res: Response) => {
  try {
    const { checkout_request_id } = req.body;

    if (!checkout_request_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing checkout_request_id',
      });
    }

    const queryResponse = await stkQuery(checkout_request_id);

    res.json({
      success: true,
      data: queryResponse,
    });
  } catch (error: any) {
    console.error('❌ STK Query controller error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

