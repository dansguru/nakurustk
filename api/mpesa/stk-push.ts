// @ts-ignore - Vercel types
import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { ALLOWED_ORIGIN, isAllowedRequestOrigin, MPESA_CONFIG } from '../lib/config';
import { supabase } from '../lib/supabase';

export const config = {
  runtime: 'nodejs',
};

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const auth = Buffer.from(`${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`).toString('base64');
  const response = await axios.get(`${MPESA_CONFIG.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    timeout: 15000,
  });

  const token = response.data?.access_token;
  if (!token) throw new Error('Failed to get access token');

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
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 20000,
    }
  );

  return response.data;
}

function parseVariant(variant?: string): { color: string; size: string } {
  if (!variant) return { color: '', size: '' };
  const parts = String(variant).trim().split(/\s+/);
  if (parts.length === 0) return { color: '', size: '' };
  return {
    color: parts[0] || '',
    size: parts.length > 1 ? parts.slice(1).join(' ') : '',
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  if (!isAllowedRequestOrigin(requestOrigin)) {
    return res.status(403).json({ success: false, message: 'Forbidden origin' });
  }

  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(200).json({ message: 'OK' });
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  try {
    const {
      payment_type,
      event_id,
      ticket_type,
      ticket_price,
      tshirt_id,
      variant_id,
      variant,
      unit_price,
      user_id,
      user_name,
      user_email,
      user_phone,
      quantity,
      total_amount,
      phone_number,
      amount,
      account_reference,
      transaction_desc,
    } = req.body || {};

    const isTShirtPayment = payment_type === 'tshirt';

    if (isTShirtPayment) {
      const actualTshirtId = (tshirt_id || variant_id || '').toString().trim();
      const invalidTshirtId = !actualTshirtId || actualTshirtId === 'null' || actualTshirtId === 'undefined' || actualTshirtId.length < 10;
      if (invalidTshirtId || !user_id || !phone_number || !amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields for T-shirt payment: tshirt_id (or variant_id), user_id, phone_number, amount',
        });
      }
    } else if (!event_id || !user_id || !phone_number || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields for event payment: event_id, user_id, phone_number, amount',
      });
    }

    const reference = account_reference
      || (isTShirtPayment
        ? `TSHIRT-${String(tshirt_id || variant_id || '').substring(0, 8)}`
        : `EVENT-${String(event_id).substring(0, 8)}`);

    const mpesaResponse = await initiateSTKPush({
      phone_number,
      amount,
      account_reference: reference,
      transaction_desc: transaction_desc || (isTShirtPayment ? 'T-shirt purchase payment' : 'Event booking payment'),
    });

    if (mpesaResponse.ResponseCode !== '0' || !mpesaResponse.CheckoutRequestID) {
      return res.status(400).json({
        success: false,
        message: mpesaResponse.ResponseDescription || 'Failed to initiate STK Push',
        data: mpesaResponse,
      });
    }

    const checkoutRequestId = mpesaResponse.CheckoutRequestID;

    if (isTShirtPayment) {
      const actualTshirtId = (tshirt_id || variant_id || '').toString().trim();
      const invalidTshirtId = !actualTshirtId || actualTshirtId === 'null' || actualTshirtId === 'undefined' || actualTshirtId.length < 10;
      if (invalidTshirtId) {
        return res.status(400).json({
          success: false,
          message: 'Invalid T-shirt variant. Please re-select the T-shirt and try again.',
          code: 'TSHIRT_ID_INVALID',
        });
      }

      const { color, size } = parseVariant(variant);
      const insertResult = await supabase
        .from('pending_tshirt_payments')
        .insert({
          checkout_request_id: checkoutRequestId,
          tshirt_id: actualTshirtId,
          user_id,
          user_name: user_name || 'Unknown',
          user_email: user_email || '',
          user_phone: user_phone || phone_number,
          size,
          color,
          unit_price: unit_price || amount,
          quantity: quantity || 1,
          total_amount: total_amount || amount,
          payment_method: 'M-Pesa',
          payment_status: 'pending',
        });

      if (insertResult.error) {
        if (insertResult.error.code === '23503') {
          return res.status(400).json({
            success: false,
            message: 'Invalid T-shirt variant. The selected T-shirt variant does not exist.',
            code: 'TSHIRT_NOT_FOUND',
          });
        }
        return res.status(500).json({
          success: false,
          message: 'Failed to create T-shirt payment record',
        });
      }
    } else {
      const insertResult = await supabase
        .from('pending_payments')
        .insert({
          checkout_request_id: checkoutRequestId,
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
        });

      if (insertResult.error) {
        return res.status(500).json({
          success: false,
          message: 'Failed to create event payment record',
        });
      }
    }

    return res.json({
      success: true,
      message: 'STK Push sent successfully',
      CheckoutRequestID: checkoutRequestId,
      MerchantRequestID: mpesaResponse.MerchantRequestID,
      ResponseCode: mpesaResponse.ResponseCode,
      ResponseDescription: mpesaResponse.ResponseDescription,
    });
  } catch (error: any) {
    const errorMessage = axios.isAxiosError(error)
      ? error.response?.data?.errorMessage || error.response?.data?.ResponseDescription || error.message
      : error?.message || 'Unknown error';
    console.error('STK push failed:', errorMessage);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: errorMessage,
    });
  }
}
