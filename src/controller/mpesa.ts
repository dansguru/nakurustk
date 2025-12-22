import { Request, Response } from 'express';
import { initiateSTKPush, stkQuery } from '../services/mpesa';
import { supabase } from '../config/supabase';

export const stkPushController = async (req: Request, res: Response) => {
  try {
    const { 
      event_id, 
      user_id, 
      user_name, 
      user_email, 
      user_phone, 
      ticket_type, 
      ticket_price, 
      quantity, 
      total_amount,
      phone_number, 
      amount, 
      account_reference, 
      transaction_desc 
    } = req.body;

    // Validate required fields
    const missingFields = [];
    if (!event_id) missingFields.push('event_id');
    if (!user_id) missingFields.push('user_id');
    if (!phone_number) missingFields.push('phone_number');
    if (!amount || amount <= 0) missingFields.push('amount');

    if (missingFields.length > 0) {
      console.error('❌ Missing required fields:', missingFields);
      console.error('❌ Received data:', {
        event_id: !!event_id,
        user_id: !!user_id,
        phone_number: !!phone_number,
        amount: amount,
        total_amount: total_amount,
      });
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`,
        missing_fields: missingFields,
      });
    }

    // Check if user already has a paid booking for this event (prevent duplicates)
    const { data: existingBookings } = await supabase
      .from('event_bookings')
      .select('id, payment_status')
      .eq('event_id', event_id)
      .eq('user_id', user_id)
      .eq('booking_status', 'confirmed');

    if (existingBookings && existingBookings.length > 0) {
      const paidBooking = existingBookings.find(b => b.payment_status === 'paid');
      const pendingBooking = existingBookings.find(b => b.payment_status === 'pending');
      
      if (paidBooking) {
        return res.status(400).json({
          success: false,
          message: 'You have already booked and paid for this event',
          booking_id: paidBooking.id,
        });
      }
      
      if (pendingBooking) {
        return res.status(400).json({
          success: false,
          message: 'You have a pending booking for this event. Please complete that payment first.',
          booking_id: pendingBooking.id,
        });
      }
    }

    // Store payment data temporarily (we'll create booking after payment succeeds)
    // For now, just initiate STK Push
    const mpesaResponse = await initiateSTKPush({
      phone_number,
      amount,
      account_reference: account_reference || `EVENT-${event_id.substring(0, 8)}`,
      transaction_desc: transaction_desc || 'Event booking payment',
    });

    if (mpesaResponse.ResponseCode === '0') {
      // STK Push successful - store payment data temporarily
      const { error: storeError } = await supabase
        .from('pending_payments')
        .insert({
          checkout_request_id: mpesaResponse.CheckoutRequestID,
          event_id,
          user_id,
          user_name: user_name || 'Unknown',
          user_email: user_email || '',
          user_phone: user_phone || phone_number,
          ticket_type: ticket_type || 'Regular',
          ticket_price: ticket_price || amount,
          quantity: quantity || 1,
          total_amount: total_amount || amount,
          payment_method: 'M-Pesa',
        });

      if (storeError) {
        console.error('❌ Error storing pending payment:', storeError);
        // Still return success to user, but log the error
      }

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
      console.error('❌ Invalid callback format - no stkCallback found');
      return res.status(400).json({
        success: false,
        message: 'Invalid callback format',
      });
    }

    const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc } = stkCallback;
    
    console.log('📋 Callback details:', {
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
    });

    // Get pending payment data first
    const { data: pendingPayment } = await supabase
      .from('pending_payments')
      .select('*')
      .eq('checkout_request_id', CheckoutRequestID)
      .single();

    if (ResultCode === 0) {
      // Payment successful - retrieve payment data and CREATE booking
      const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];
      const mpesaReceiptNumber = callbackMetadata.find(
        (item: any) => item.Name === 'MpesaReceiptNumber'
      )?.Value;
      const transactionDate = callbackMetadata.find(
        (item: any) => item.Name === 'TransactionDate'
      )?.Value;

      if (!pendingPayment) {
        console.error('❌ Pending payment not found for CheckoutRequestID:', CheckoutRequestID);
        return res.json({ ResultCode: 0, ResultDesc: 'Success' });
      }

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
            ? new Date(
                String(transactionDate).replace(
                  /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/,
                  '$1-$2-$3T$4:$5:$6'
                )
              ).toISOString()
            : new Date().toISOString(),
          mpesa_phone_number: pendingPayment.user_phone,
          booking_status: 'confirmed',
          paid_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (bookingError) {
        console.error('❌ Error creating booking:', bookingError);
      } else {
        console.log('✅ Booking created successfully:', booking.id);
        
        // Update pending payment with status
        await supabase
          .from('pending_payments')
          .update({ 
            payment_status: 'paid',
            booking_id: booking.id 
          })
          .eq('checkout_request_id', CheckoutRequestID);
      }
      
    } else {
      // Payment failed - update pending payment with error details
      let errorType = 'failed';
      let errorMessage = ResultDesc || 'Payment failed';

      // Map M-Pesa error codes to user-friendly messages
      switch (ResultCode) {
        case 1:
          errorType = 'insufficient_funds';
          errorMessage = 'Insufficient funds in your M-Pesa account. Please top up and try again.';
          break;
        case 1032:
          errorType = 'cancelled';
          errorMessage = 'Payment was cancelled. Please try again.';
          break;
        case 1037:
          errorType = 'timeout';
          errorMessage = 'Payment timeout - you did not enter your PIN in time. Please try again.';
          break;
        case 2001:
          errorType = 'wrong_pin';
          errorMessage = 'Wrong PIN entered. Please try again.';
          break;
        case 26:
          errorType = 'system_busy';
          errorMessage = 'M-Pesa system is busy. Please try again in a moment.';
          break;
        case 1019:
          errorType = 'expired';
          errorMessage = 'Transaction expired. Please try again.';
          break;
        case 17:
          errorType = 'cancelled';
          errorMessage = 'Transaction cancelled. Please try again.';
          break;
        default:
          errorType = 'failed';
          errorMessage = ResultDesc || 'Payment failed. Please try again.';
      }

      if (pendingPayment) {
        const { error: updateError } = await supabase
          .from('pending_payments')
          .update({ 
            payment_status: errorType,
            error_code: String(ResultCode),
            error_message: errorMessage
          })
          .eq('checkout_request_id', CheckoutRequestID);

        if (updateError) {
          console.error('❌ Error updating pending payment:', updateError);
        } else {
          console.log(`✅ Updated pending payment with error:`);
          console.log(`   - Status: ${errorType}`);
          console.log(`   - Message: ${errorMessage}`);
          console.log(`   - Code: ${ResultCode}`);
          console.log(`   - CheckoutRequestID: ${CheckoutRequestID}`);
        }
      } else {
        console.log(`⚠️ No pending payment found for CheckoutRequestID: ${CheckoutRequestID}`);
      }
      
      console.log(`❌ Payment ${errorType}:`, errorMessage, 'Code:', ResultCode);
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

