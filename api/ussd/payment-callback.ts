// @ts-ignore - Vercel types
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

// Force Node.js runtime
export const config = {
  runtime: 'nodejs',
};

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nzlluafskmrhbryimftu.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_g2yRYthqbpz9Zs41nAWuHw_wJe3l2TR';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Africa's Talking configuration
const AT_USERNAME = process.env.AT_USERNAME || '';
const AT_API_KEY = process.env.AT_API_KEY || '';

// Helper function to send SMS via Africa's Talking
async function sendSMS(phoneNumber: string, message: string): Promise<boolean> {
  try {
    const auth = Buffer.from(`${AT_USERNAME}:${AT_API_KEY}`).toString('base64');

    const response = await axios.post(
      'https://api.africastalking.com/version1/messaging',
      new URLSearchParams({
        username: AT_USERNAME,
        to: phoneNumber,
        message: message,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'apiKey': AT_API_KEY,
        },
      }
    );

    return response.status === 201;
  } catch (error) {
    console.error('Error sending SMS:', error);
    return false;
  }
}

// Helper function to get event details
async function getEventDetails(eventId: string) {
  try {
    const { data, error } = await supabase
      .from('events')
      .select('title, event_date, event_time, place')
      .eq('id', eventId)
      .single();

    if (error) {
      console.error('Error fetching event:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error fetching event:', error);
    return null;
  }
}

// This endpoint is called by PayHero callback when USSD payment is confirmed
// PayHero callback URL should be: https://payhero.vercel.app/api/mpesa/callback
// PayHero will then call this endpoint for USSD transactions
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ResultCode: 1, ResultDesc: 'Method not allowed' });
  }

  try {
    console.log('📥 USSD Payment callback received:', JSON.stringify(req.body, null, 2));

    // PayHero callback format
    const { Body } = req.body;
    const stkCallback = Body?.stkCallback;

    if (!stkCallback) {
      console.error('❌ Invalid callback format');
      return res.json({ ResultCode: 0, ResultDesc: 'Success' });
    }

    const { CheckoutRequestID, ResultCode, ResultDesc } = stkCallback;

    // Find USSD transaction by checkout_request_id
    const { data: ussdTransaction, error: ussdError } = await supabase
      .from('ussd_transactions')
      .select('*')
      .eq('checkout_request_id', CheckoutRequestID)
      .single();

    if (ussdError || !ussdTransaction) {
      console.error('❌ USSD transaction not found:', ussdError);
      return res.json({ ResultCode: 0, ResultDesc: 'Success' });
    }

    if (ResultCode === 0) {
      // Payment successful
      const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];
      const mpesaReceiptNumber = callbackMetadata.find((item: any) => item.Name === 'MpesaReceiptNumber')?.Value;
      const transactionDate = callbackMetadata.find((item: any) => item.Name === 'TransactionDate')?.Value;

      // Get event details for SMS
      const eventDetails = await getEventDetails(ussdTransaction.event_id);

      // Create booking
      const { data: booking, error: bookingError } = await supabase
        .from('event_bookings')
        .insert({
          event_id: ussdTransaction.event_id,
          user_id: null, // USSD users don't have user_id
          user_name: `USSD User ${ussdTransaction.phone_number}`,
          user_email: '',
          user_phone: ussdTransaction.phone_number,
          ticket_type: ussdTransaction.ticket_type,
          ticket_price: ussdTransaction.total_amount / ussdTransaction.quantity,
          quantity: ussdTransaction.quantity,
          total_amount: ussdTransaction.total_amount,
          payment_method: 'M-Pesa (USSD)',
          payment_status: 'paid',
          mpesa_checkout_request_id: CheckoutRequestID,
          mpesa_receipt_number: mpesaReceiptNumber,
          mpesa_transaction_date: transactionDate
            ? new Date(String(transactionDate).replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6')).toISOString()
            : new Date().toISOString(),
          mpesa_phone_number: ussdTransaction.phone_number,
          booking_status: 'confirmed',
          paid_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (!bookingError && booking) {
        console.log('✅ USSD Booking created:', booking.id);

        // Update USSD transaction
        await supabase
          .from('ussd_transactions')
          .update({
            payment_status: 'paid',
            booking_id: booking.id,
            mpesa_receipt_number: mpesaReceiptNumber,
            updated_at: new Date().toISOString(),
          })
          .eq('checkout_request_id', CheckoutRequestID);

        // Send SMS confirmation
        const eventTitle = eventDetails?.title || 'Event';
        const eventDate = eventDetails?.event_date 
          ? new Date(eventDetails.event_date).toLocaleDateString('en-KE', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })
          : 'TBA';
        const eventTime = eventDetails?.event_time || 'TBA';
        const eventPlace = eventDetails?.place || 'TBA';

        const smsMessage = `Nakuru Social Club\n\nTicket Confirmed!\n\nEvent: ${eventTitle}\nDate: ${eventDate}\nTime: ${eventTime}\nVenue: ${eventPlace}\nTickets: ${ussdTransaction.quantity}x ${ussdTransaction.ticket_type}\nTotal: KSH ${ussdTransaction.total_amount}\nReceipt: ${mpesaReceiptNumber}\n\nThank you!`;

        await sendSMS(ussdTransaction.phone_number, smsMessage);
        console.log('✅ SMS sent to:', ussdTransaction.phone_number);
      }
    } else {
      // Payment failed
      await supabase
        .from('ussd_transactions')
        .update({
          payment_status: 'failed',
          error_code: String(ResultCode),
          error_message: ResultDesc || 'Payment failed',
          updated_at: new Date().toISOString(),
        })
        .eq('checkout_request_id', CheckoutRequestID);

      // Send failure SMS
      const smsMessage = `Nakuru Social Club\n\nPayment failed: ${ResultDesc || 'Unknown error'}\n\nPlease try again or contact support.\nPhone: 0727xxxxx`;
      await sendSMS(ussdTransaction.phone_number, smsMessage);
    }

    return res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (error: any) {
    console.error('❌ USSD Payment callback error:', error);
    return res.json({ ResultCode: 0, ResultDesc: 'Success' });
  }
}

