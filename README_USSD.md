# USSD Integration with Africa's Talking

This document describes the USSD ticket purchasing system integrated with Africa's Talking and M-Pesa payments.

## Architecture Decision

**We're using PayHero callback URL (https://payhero.vercel.app/)** for M-Pesa payments:
- ✅ USSD transactions use PayHero's existing M-Pesa integration
- ✅ Doesn't affect existing Nakuru website payment flow
- ✅ PayHero callback automatically handles USSD transactions
- ✅ Shares the same database (Supabase) and events
- ✅ Separate `ussd_transactions` table for USSD tracking

## Setup Instructions

### 1. Africa's Talking Account Setup

1. Create an account at https://account.africastalking.com/
2. Get your API credentials:
   - Username
   - API Key
3. Create a USSD service:
   - Go to USSD services
   - Create a new service
   - **Set callback URL: `https://payhero.vercel.app/api/ussd/webhook`**
   - Get your USSD code (e.g., `*384*12345#`)

### 2. Environment Variables

Add these to your Vercel environment variables or `.env` file:

```env
# Existing M-Pesa variables
SUPABASE_URL=https://nzlluafskmrhbryimftu.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
CONSUMER_KEY=your_mpesa_consumer_key
SECRET_KEY=your_mpesa_secret_key
SHORT_CODE=your_shortcode
PASS_KEY=your_passkey
CALLBACK_URL=https://your-domain.vercel.app/api/mpesa/callback
MPESA_BASE_URL=https://sandbox.safaricom.co.ke

# New Africa's Talking variables
AT_USERNAME=your_africas_talking_username
AT_API_KEY=your_africas_talking_api_key

# PayHero URL (for USSD payments)
PAYHERO_URL=https://payhero.vercel.app
```

### 3. Database Setup

Run the SQL script to create the `ussd_transactions` table:

```bash
# Execute the SQL file in your Supabase SQL editor
scripts/create_ussd_transactions_table.sql
```

### 4. Deploy

```bash
vercel deploy
```

## USSD Flow

### User Journey

1. **User dials USSD code** (e.g., `*384*12345#`)
2. **Welcome Menu**: User sees options
   - 1. Buy Tickets
   - 2. Help
   - 0. Exit
3. **Event Selection**: User selects from active events
4. **Ticket Type Selection**: User selects ticket type (if multiple available)
5. **Quantity Entry**: User enters quantity (1-10)
6. **Order Summary**: Shows total with service fee
7. **Confirmation**: User confirms and payment is initiated
8. **M-Pesa Prompt**: User receives M-Pesa STK push
9. **Payment Confirmation**: After payment, user receives SMS with ticket details

### Backend Flow

1. **USSD Webhook** (`/api/ussd/webhook`)
   - Receives user input from Africa's Talking (form-encoded POST)
   - Parses text field (concatenated with * separator)
   - Manages session state (in-memory)
   - Handles menu navigation (CON/END responses)
   - Initiates M-Pesa STK push via PayHero when user confirms

2. **PayHero M-Pesa Callback** (`https://payhero.vercel.app/api/mpesa/callback`)
   - Receives payment confirmation from M-Pesa
   - Checks if transaction is USSD-initiated (via `ussd_transactions` table)
   - Creates booking in `event_bookings` table
   - Updates `ussd_transactions` table
   - Sends SMS confirmation via Africa's Talking API

3. **SMS Confirmation**
   - Sent via Africa's Talking API
   - Includes event details, ticket info, and receipt number

## API Endpoints

### POST `/api/ussd/webhook`

Africa's Talking USSD webhook endpoint.

**Request Body:**
```json
{
  "sessionId": "ATUid_xxx",
  "phoneNumber": "254712345678",
  "text": "1" // User input
}
```

**Response:**
```
CON Welcome to Nakuru Social Club...
```
or
```
END Thank you for using Nakuru Social Club!
```

### POST `/api/ussd/payment-callback`

Handles payment callbacks for USSD transactions (called by M-Pesa callback handler).

## Database Schema

### `ussd_transactions` Table

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| session_id | VARCHAR | Africa's Talking session ID |
| phone_number | VARCHAR | User's phone number |
| event_id | UUID | Reference to events table |
| ticket_type | VARCHAR | Selected ticket type |
| quantity | INTEGER | Number of tickets |
| total_amount | DECIMAL | Total amount including service fee |
| payment_status | VARCHAR | pending/paid/failed/cancelled |
| checkout_request_id | VARCHAR | M-Pesa checkout request ID |
| booking_id | UUID | Reference to event_bookings table |
| mpesa_receipt_number | VARCHAR | M-Pesa receipt number |
| error_code | VARCHAR | Error code if payment failed |
| error_message | TEXT | Error message if payment failed |
| created_at | TIMESTAMP | Transaction creation time |
| updated_at | TIMESTAMP | Last update time |

## Service Fee Calculation

Default service fee: **2.5%**

Formula:
```
Subtotal = Ticket Price × Quantity
Service Fee = Subtotal × 2.5%
Total = Subtotal + Service Fee (rounded up)
```

## Session Management

- Sessions are stored in-memory (Map)
- Sessions expire after 5 minutes of inactivity
- For production, consider using Redis for session storage

## SMS Format

```
Nakuru Social Club

Ticket Confirmed!

Event: [Event Title]
Date: [Event Date]
Time: [Event Time]
Venue: [Event Venue]
Tickets: [Quantity]x [Ticket Type]
Total: KSH [Total Amount]
Receipt: [M-Pesa Receipt Number]

Thank you!
```

## Testing

### Test USSD Flow

1. Dial your USSD code: `*384*12345#`
2. Follow the menu prompts
3. Complete payment on M-Pesa
4. Check SMS confirmation

### Test Endpoints

```bash
# Test USSD webhook
curl -X POST https://payhero.vercel.app/api/ussd/webhook \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'sessionId=test_session_123&phoneNumber=254712345678&text='
```

## Security Considerations

1. **Session Validation**: Validate session IDs and phone numbers
2. **Rate Limiting**: Implement rate limiting to prevent abuse
3. **Input Validation**: Validate all user inputs
4. **Payment Verification**: Always verify payment before creating bookings
5. **Double Transaction Prevention**: Check for existing bookings

## Troubleshooting

### USSD not responding
- Check Africa's Talking callback URL configuration
- Verify environment variables are set
- Check Vercel function logs

### Payment not processing
- Verify M-Pesa credentials
- Check M-Pesa callback URL
- Review `ussd_transactions` table for errors

### SMS not sending
- Verify Africa's Talking API credentials
- Check account balance
- Review API logs

## Future Enhancements

- [ ] Redis session storage for production
- [ ] Support for Africa's Talking Payments (alternative to M-Pesa)
- [ ] Multi-language support
- [ ] Ticket cancellation via USSD
- [ ] Check booking status via USSD
- [ ] Admin dashboard for USSD transactions

