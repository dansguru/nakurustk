import axios from 'axios';
import { mpesaConfig } from '../config/mpesa';

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

export async function getAccessToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  try {
    const auth = Buffer.from(
      `${mpesaConfig.consumerKey}:${mpesaConfig.consumerSecret}`
    ).toString('base64');

    const response = await axios.get(
      `${mpesaConfig.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );

    cachedToken = response.data.access_token;
    // M-Pesa tokens expire in 1 hour, we cache for 50 minutes
    tokenExpiry = Date.now() + 50 * 60 * 1000;

    console.log('✅ M-Pesa access token generated');
    return cachedToken;
  } catch (error: any) {
    console.error('❌ Error getting M-Pesa access token:', error.response?.data || error.message);
    throw new Error('Failed to get M-Pesa access token');
  }
}

export async function initiateSTKPush(data: {
  phone_number: string;
  amount: number;
  account_reference: string;
  transaction_desc: string;
}): Promise<any> {
  try {
    const token = await getAccessToken();
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14);

    const password = Buffer.from(
      `${mpesaConfig.shortcode}${mpesaConfig.passkey}${timestamp}`
    ).toString('base64');

    const payload = {
      BusinessShortCode: mpesaConfig.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.ceil(data.amount), // M-Pesa requires integer
      PartyA: data.phone_number,
      PartyB: mpesaConfig.shortcode,
      PhoneNumber: data.phone_number,
      CallBackURL: mpesaConfig.callbackUrl,
      AccountReference: data.account_reference,
      TransactionDesc: data.transaction_desc,
    };

    console.log('📤 Initiating STK Push:', {
      phone: data.phone_number,
      amount: data.amount,
      reference: data.account_reference,
    });

    const response = await axios.post(
      `${mpesaConfig.baseUrl}/mpesa/stkpush/v1/processrequest`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ STK Push response:', response.data);
    return response.data;
  } catch (error: any) {
    console.error('❌ STK Push error:', error.response?.data || error.message);
    throw error;
  }
}

export async function stkQuery(checkoutRequestId: string): Promise<any> {
  try {
    const token = await getAccessToken();
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14);

    const password = Buffer.from(
      `${mpesaConfig.shortcode}${mpesaConfig.passkey}${timestamp}`
    ).toString('base64');

    const payload = {
      BusinessShortCode: mpesaConfig.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    };

    const response = await axios.post(
      `${mpesaConfig.baseUrl}/mpesa/stkpushquery/v1/query`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  } catch (error: any) {
    console.error('❌ STK Query error:', error.response?.data || error.message);
    throw error;
  }
}

