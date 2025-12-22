// @ts-ignore - Vercel types
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

// Force Node.js runtime (required for Supabase JS to work correctly)
export const config = {
  runtime: 'nodejs',
};

// Hardcoded Supabase credentials (TEMPORARY - replace with env vars later)
const SUPABASE_URL = 'https://nzlluafskmrhbryimftu.supabase.co';
const SUPABASE_SERVICE_KEY = 'sb_secret_g2yRYthqbpz9Zs41nAWuHw_wJe3l2TR';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// M-Pesa config (from env or hardcoded)
const MPESA_CONFIG = {
  consumerKey: process.env.CONSUMER_KEY || 'AuuordWQP43r19TuMwOlnmuDkFAYjTGT32BReggnDMUa3EII',
  consumerSecret: process.env.SECRET_KEY || 'QkRDUnSSke3HBaWSyllPCAfGAI4vDGApiPxKBOfvhyd1Ln3zPQxyCCLPhds03z3R',
  shortcode: process.env.SHORT_CODE || '174379',
  passkey: process.env.PASS_KEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
  callbackUrl: process.env.CALLBACK_URL || 'https://nakurustk.vercel.app/api/mpesa/callback',
  baseUrl: process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke',
};

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken as string;
  }

  const auth = Buffer.from(`${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`).toString('base64');
  const response = await axios.get(`${MPESA_CONFIG.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });

  const token = response.data.access_token;
  if (!token) {
    throw new Error('Failed to get access token');
  }
  
  cachedToken = token;
  tokenExpiry = Date.now() + 50 * 60 * 1000;
  return token;
}

async function initiateSTKPush(data: {
  phone_number: string;
  amount: number;
  account_reference: string;
  transaction_desc: string;
}): Promise<any> {
  const token = await getAccessToken();
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const password = Buffer.from(`${MPESA_CONFIG.shortcode}${MPESA_CONFIG.passkey}${timestamp}`).toString('base64');

  const payload = {
    BusinessShortCode: MPESA_CONFIG.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.ceil(data.amount),
    PartyA: data.phone_number,
    PartyB: MPESA_CONFIG.shortcode,
    PhoneNumber: data.phone_number,
    CallBackURL: MPESA_CONFIG.callbackUrl,
    AccountReference: data.account_reference,
    TransactionDesc: data.transaction_desc,
  };

  const response = await axios.post(
    `${MPESA_CONFIG.baseUrl}/mpesa/stkpush/v1/processrequest`,
    payload,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );

  return response.data;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers FIRST - before any other logic
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const {
      event_id, user_id, user_name, user_email, user_phone,
      ticket_type, ticket_price, quantity, total_amount,
      phone_number, amount, account_reference, transaction_desc
    } = req.body;

    // Validate
    if (!event_id || !user_id || !phone_number || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: event_id, user_id, phone_number, amount',
      });
    }

    // Check existing bookings
    const { data: existingBookings } = await supabase
      .from('event_bookings')
      .select('id, payment_status')
      .eq('event_id', event_id)
      .eq('user_id', user_id)
      .eq('booking_status', 'confirmed');

    if (existingBookings && existingBookings.length > 0) {
      const paidBooking = existingBookings.find(b => b.payment_status === 'paid');
      if (paidBooking) {
        return res.status(400).json({
          success: false,
          message: 'You have already booked and paid for this event',
          booking_id: paidBooking.id,
        });
      }
    }

    // Initiate STK Push
    const mpesaResponse = await initiateSTKPush({
      phone_number,
      amount,
      account_reference: account_reference || `EVENT-${event_id.substring(0, 8)}`,
      transaction_desc: transaction_desc || 'Event booking payment',
    });

    if (mpesaResponse.ResponseCode === '0') {
      // Store pending payment
      const pendingPaymentData = {
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
        payment_status: 'pending',
      };

      const { error: storeError } = await supabase
        .from('pending_payments')
        .insert(pendingPaymentData);

      if (storeError) {
        console.error('❌ Error storing pending payment:', storeError);
      } else {
        console.log('✅ Pending payment stored:', mpesaResponse.CheckoutRequestID);
      }

      return res.json({
        success: true,
        message: 'STK Push sent successfully',
        CheckoutRequestID: mpesaResponse.CheckoutRequestID,
        MerchantRequestID: mpesaResponse.MerchantRequestID,
        ResponseCode: mpesaResponse.ResponseCode,
        ResponseDescription: mpesaResponse.ResponseDescription,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: mpesaResponse.ResponseDescription || 'Failed to initiate STK Push',
        data: mpesaResponse,
      });
    }
  } catch (error: any) {
    console.error('❌ STK Push error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
}

