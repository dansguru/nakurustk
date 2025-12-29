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

// USSD Session State Management (in-memory - for production, use Redis)
interface USSDSession {
  phoneNumber: string;
  sessionId: string;
  step: string;
  eventId?: string;
  ticketType?: string;
  quantity?: number;
  totalAmount?: number;
  timestamp: number;
}

const sessions = new Map<string, USSDSession>();

// Clean up old sessions (older than 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.timestamp > 5 * 60 * 1000) {
      sessions.delete(key);
    }
  }
}, 60000); // Run every minute

// Helper function to get active events
async function getActiveEvents(): Promise<Array<{ id: string; title: string; amount: string }>> {
  try {
    const { data, error } = await supabase
      .from('events')
      .select('id, title, amount')
      .eq('status', 'active')
      .order('event_date', { ascending: true })
      .limit(10);

    if (error) {
      console.error('Error fetching events:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching events:', error);
    return [];
  }
}

// Helper function to get ticket types for an event
async function getEventTicketTypes(eventId: string): Promise<Array<{ type: string; price: number }>> {
  try {
    const { data: event, error } = await supabase
      .from('events')
      .select('amount, ticket_price_variability')
      .eq('id', eventId)
      .single();

    if (error || !event) {
      return [{ type: 'Regular', price: parseFloat(event?.amount || '0') }];
    }

    const ticketTypes: Array<{ type: string; price: number }> = [];

    // Parse ticket_price_variability if it exists
    if (event.ticket_price_variability) {
      try {
        const variability = typeof event.ticket_price_variability === 'string'
          ? JSON.parse(event.ticket_price_variability)
          : event.ticket_price_variability;

        Object.entries(variability).forEach(([type, price]) => {
          ticketTypes.push({ type, price: Number(price) });
        });
      } catch (e) {
        console.error('Error parsing ticket_price_variability:', e);
      }
    }

    // If no ticket types found, use default
    if (ticketTypes.length === 0) {
      ticketTypes.push({ type: 'Regular', price: parseFloat(event.amount || '0') });
    }

    return ticketTypes;
  } catch (error) {
    console.error('Error fetching ticket types:', error);
    return [{ type: 'Regular', price: 0 }];
  }
}

// Helper function to calculate total with service fee
function calculateTotal(amount: number, quantity: number, serviceFeePercent: number = 2.5): number {
  const subtotal = amount * quantity;
  const serviceFee = subtotal * (serviceFeePercent / 100);
  return Math.ceil(subtotal + serviceFee);
}

// Helper function to send SMS via Africa's Talking
async function sendSMS(phoneNumber: string, message: string): Promise<boolean> {
  try {
    const axios = require('axios');
    const auth = Buffer.from(`${AT_USERNAME}:${AT_API_KEY}`).toString('base64');

    const response = await axios.post(
      'https://api.africastalking.com/version1/messaging',
      {
        username: AT_USERNAME,
        to: phoneNumber,
        message: message,
      },
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

// Main USSD handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set response type to text/plain as required by Africa's Talking
  res.setHeader('Content-Type', 'text/plain');

  if (req.method === 'OPTIONS') {
    return res.status(200).send('OK');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    // Africa's Talking sends data as application/x-www-form-urlencoded
    // Parse form data from body
    const sessionId = req.body.sessionId || req.body.session_id;
    const phoneNumber = req.body.phoneNumber || req.body.phone_number;
    const text = req.body.text || '';
    const serviceCode = req.body.serviceCode || req.body.service_code;
    const networkCode = req.body.networkCode || req.body.network_code;

    if (!sessionId || !phoneNumber) {
      return res.status(400).send('END Missing required fields');
    }

    const sessionKey = `${phoneNumber}_${sessionId}`;
    let session = sessions.get(sessionKey);
    
    // Parse user input - text field concatenates all inputs with * separator
    // Example: "1" for first selection, "1*2" for selecting 1 then 2
    const userInput = text ? text.trim() : '';
    const inputParts = userInput ? userInput.split('*') : [];

    // Initialize session if new
    if (!session) {
      session = {
        phoneNumber,
        sessionId,
        step: 'welcome',
        timestamp: Date.now(),
      };
      sessions.set(sessionKey, session);
    } else {
      session.timestamp = Date.now(); // Update timestamp
    }

    let responseText = '';
    let shouldEndSession = false;

    // USSD Menu Flow
    // Handle first request (empty text)
    if (!session || userInput === '') {
      responseText = `CON Welcome to Nakuru Social Club\n\nSelect an option:\n1. Buy Tickets\n2. Help\n0. Exit`;
      if (!session) {
        session = {
          phoneNumber,
          sessionId,
          step: 'main_menu',
          timestamp: Date.now(),
        };
        sessions.set(sessionKey, session);
      } else {
        session.step = 'main_menu';
      }
    } else {
      // Handle subsequent menu selections
      switch (session.step) {
        case 'main_menu':
          if (inputParts[0] === '1') {
            // Fetch active events
            const events = await getActiveEvents();
            if (events.length === 0) {
              responseText = 'END No active events available at the moment.';
              shouldEndSession = true;
            } else {
              let menu = 'CON Select an event:\n';
              events.forEach((event, index) => {
                // Remove special characters for USSD compatibility
                const cleanTitle = event.title.replace(/[^\w\s]/g, '').substring(0, 30);
                menu += `${index + 1}. ${cleanTitle}\n`;
              });
              menu += '0. Back';
              responseText = menu;
              session.step = 'select_event';
              // Store events in session for later reference
              (session as any).events = events;
            }
          } else if (inputParts[0] === '2') {
            responseText = `END For assistance, contact:\nPhone: 0727xxxxx\nEmail: info@nakurusocialclub.co.ke\nWebsite: www.nakurusocialclub.co.ke`;
            shouldEndSession = true;
          } else if (inputParts[0] === '0') {
            responseText = 'END Thank you for using Nakuru Social Club!';
            shouldEndSession = true;
          } else {
            responseText = 'CON Invalid option. Please try again:\n1. Buy Tickets\n2. Help\n0. Exit';
          }
          break;

        case 'select_event':
          const events = (session as any).events || [];
          const eventIndex = parseInt(inputParts[inputParts.length - 1]) - 1;

          if (inputParts[inputParts.length - 1] === '0') {
            responseText = `CON Welcome to Nakuru Social Club\n\nSelect an option:\n1. Buy Tickets\n2. Help\n0. Exit`;
            session.step = 'main_menu';
          } else if (eventIndex >= 0 && eventIndex < events.length) {
          const selectedEvent = events[eventIndex];
          session.eventId = selectedEvent.id;
          
            // Get ticket types for this event
            const ticketTypes = await getEventTicketTypes(selectedEvent.id);
            let menu = 'CON Select ticket type:\n';
            ticketTypes.forEach((ticket, index) => {
              menu += `${index + 1}. ${ticket.type} - KSH ${ticket.price}\n`;
            });
            menu += '0. Back';
            responseText = menu;
            session.step = 'select_ticket_type';
            (session as any).ticketTypes = ticketTypes;
          } else {
            responseText = 'CON Invalid selection. Please try again.';
          }
          break;

        case 'select_ticket_type':
          const ticketTypes = (session as any).ticketTypes || [];
          const ticketIndex = parseInt(inputParts[inputParts.length - 1]) - 1;

          if (inputParts[inputParts.length - 1] === '0') {
            // Go back to event selection
            const events = (session as any).events || [];
            let menu = 'CON Select an event:\n';
            events.forEach((event: any, index: number) => {
              const cleanTitle = event.title.replace(/[^\w\s]/g, '').substring(0, 30);
              menu += `${index + 1}. ${cleanTitle}\n`;
            });
            menu += '0. Back';
            responseText = menu;
            session.step = 'select_event';
          } else if (ticketIndex >= 0 && ticketIndex < ticketTypes.length) {
          const selectedTicket = ticketTypes[ticketIndex];
          session.ticketType = selectedTicket.type;
          (session as any).ticketPrice = selectedTicket.price;
          responseText = 'CON Enter quantity (1-10):';
          session.step = 'enter_quantity';
        } else {
          responseText = 'CON Invalid selection. Please try again.';
        }
        break;

        case 'enter_quantity':
          const quantity = parseInt(inputParts[inputParts.length - 1]);
          if (isNaN(quantity) || quantity < 1 || quantity > 10) {
            responseText = 'CON Invalid quantity. Enter a number between 1 and 10:';
          } else {
          session.quantity = quantity;
          const ticketPrice = (session as any).ticketPrice || 0;
          const totalAmount = calculateTotal(ticketPrice, quantity);
          session.totalAmount = totalAmount;
          
          const serviceFee = totalAmount - (ticketPrice * quantity);
          
          responseText = `CON Order Summary:\n\nTicket: ${session.ticketType}\nQuantity: ${quantity}\nPrice per ticket: KSH ${ticketPrice}\nService fee: KSH ${serviceFee}\nTotal: KSH ${totalAmount}\n\n1. Confirm & Pay\n0. Cancel`;
          session.step = 'confirm_order';
        }
        break;

        case 'confirm_order':
          if (inputParts[inputParts.length - 1] === '1') {
          // Initiate payment
          responseText = 'CON Processing payment...\n\nYou will receive an M-Pesa prompt.';
          session.step = 'processing_payment';
          
            // Trigger payment via PayHero (M-Pesa STK Push)
            try {
              const PAYHERO_URL = process.env.PAYHERO_URL || 'https://payhero.vercel.app';
              const paymentResponse = await axios.post(
                `${PAYHERO_URL}/api/mpesa/stk-push`,
                {
                  event_id: session.eventId,
                  user_id: null, // USSD users don't have user_id
                  user_name: `USSD User ${session.phoneNumber}`,
                  user_email: '',
                  user_phone: session.phoneNumber,
                  ticket_type: session.ticketType,
                  ticket_price: (session as any).ticketPrice,
                  quantity: session.quantity,
                  total_amount: session.totalAmount,
                  phone_number: session.phoneNumber,
                  amount: session.totalAmount,
                  account_reference: `USSD-${session.eventId?.substring(0, 8)}`,
                  transaction_desc: `USSD Ticket Purchase`,
                }
              );

            if (paymentResponse.data.success) {
              // Store USSD transaction
              await supabase.from('ussd_transactions').insert({
                session_id: sessionId,
                phone_number: session.phoneNumber,
                event_id: session.eventId,
                ticket_type: session.ticketType,
                quantity: session.quantity,
                total_amount: session.totalAmount,
                payment_status: 'pending',
                checkout_request_id: paymentResponse.data.CheckoutRequestID,
                created_at: new Date().toISOString(),
              });

              responseText = 'END Payment request sent! Complete payment on your phone. You will receive SMS confirmation.';
              shouldEndSession = true;
            } else {
              responseText = `END Payment failed: ${paymentResponse.data.message || 'Unknown error'}`;
              shouldEndSession = true;
            }
          } catch (error: any) {
            console.error('Payment error:', error);
            responseText = 'END Payment processing failed. Please try again later.';
            shouldEndSession = true;
          }
          } else if (inputParts[inputParts.length - 1] === '0') {
            responseText = 'END Transaction cancelled. Thank you!';
            shouldEndSession = true;
          } else {
            responseText = 'CON Invalid option. Please select:\n1. Confirm & Pay\n0. Cancel';
          }
          break;

        default:
          responseText = 'END Session expired. Please start again.';
          shouldEndSession = true;
      }
    }

    // Clean up session if ending
    if (shouldEndSession) {
      sessions.delete(sessionKey);
    } else {
      sessions.set(sessionKey, session);
    }

    // Return text/plain response as required by Africa's Talking
    return res.status(200).send(responseText);
  } catch (error: any) {
    console.error('USSD Webhook error:', error);
    return res.status(200).send('END An error occurred. Please try again later.');
  }
}

