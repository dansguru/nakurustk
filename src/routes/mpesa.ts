import express from 'express';
import { stkPushController, mpesaCallbackController, querySTKController } from '../controller/mpesa';
import { getPaymentStatusController } from '../controller/paymentStatus';

const router = express.Router();

// Initiate STK Push
router.post('/stk-push', stkPushController);

// M-Pesa callback endpoint
router.post('/callback', mpesaCallbackController);

// Query STK Push status
router.post('/stk-query', querySTKController);

// Get payment status (for frontend polling)
router.get('/payment-status/:checkoutRequestId', getPaymentStatusController);

export default router;

