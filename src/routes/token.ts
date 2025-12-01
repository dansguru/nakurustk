import express from "express";
const router = express.Router();

import { createToken, stkPush, handleCallback, getTransactionStatus, queryMpesaTransactionStatus } from "../controller/token";

// POST /token - Initiate STK push
router.post("/", createToken, stkPush);

// POST /token/callback - M-Pesa callback endpoint
router.post("/callback", handleCallback);

// GET /token/status/:checkoutRequestID - Query transaction status from Firebase
router.get("/status/:checkoutRequestID", getTransactionStatus);

// GET /token/query/:checkoutRequestID - Query M-Pesa directly for transaction status
router.get("/query/:checkoutRequestID", queryMpesaTransactionStatus);

export default router;
