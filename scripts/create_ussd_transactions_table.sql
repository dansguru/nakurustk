-- Create USSD transactions table for Africa's Talking USSD payments
-- This table is separate from event_bookings to track USSD-specific transactions
CREATE TABLE IF NOT EXISTS public.ussd_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  phone_number VARCHAR(20) NOT NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  ticket_type VARCHAR(100),
  quantity INTEGER DEFAULT 1,
  total_amount DECIMAL(10, 2) NOT NULL,
  payment_status VARCHAR(50) DEFAULT 'pending', -- pending, paid, failed, cancelled
  checkout_request_id VARCHAR(255),
  booking_id UUID REFERENCES public.event_bookings(id) ON DELETE SET NULL,
  mpesa_receipt_number VARCHAR(255),
  error_code VARCHAR(50),
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_ussd_transactions_session_id ON public.ussd_transactions(session_id);
CREATE INDEX IF NOT EXISTS idx_ussd_transactions_phone_number ON public.ussd_transactions(phone_number);
CREATE INDEX IF NOT EXISTS idx_ussd_transactions_checkout_request_id ON public.ussd_transactions(checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_ussd_transactions_payment_status ON public.ussd_transactions(payment_status);
CREATE INDEX IF NOT EXISTS idx_ussd_transactions_event_id ON public.ussd_transactions(event_id);
CREATE INDEX IF NOT EXISTS idx_ussd_transactions_created_at ON public.ussd_transactions(created_at DESC);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_ussd_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_ussd_transactions_updated_at
  BEFORE UPDATE ON public.ussd_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_ussd_transactions_updated_at();

-- Add RLS policies (if using Row Level Security)
-- ALTER TABLE public.ussd_transactions ENABLE ROW LEVEL SECURITY;

-- Policy for admins to view all transactions
-- CREATE POLICY "Admins can view all USSD transactions"
--   ON public.ussd_transactions
--   FOR SELECT
--   USING (
--     EXISTS (
--       SELECT 1 FROM admin_users 
--       WHERE admin_users.id = auth.uid() 
--       AND admin_users.is_active = true
--     )
--   );

