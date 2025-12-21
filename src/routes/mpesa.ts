import express from 'express';
import { stkPushController, mpesaCallbackController, querySTKController } from '../controller/mpesa';

const router = express.Router();

// Initiate STK Push
router.post('/stk-push', stkPushController);

// M-Pesa callback endpoint
router.post('/callback', mpesaCallbackController);

// Query STK Push status
router.post('/stk-query', querySTKController);

export default router;

