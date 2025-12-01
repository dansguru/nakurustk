import express from "express";
const router = express.Router();

import { createToken, stkPush, handleCallback, getTransactionStatus } from "../controller/token";

// POST /token - Initiate STK push
router.post("/", createToken, stkPush);

// POST /token/callback - M-Pesa callback endpoint
router.post("/callback", handleCallback);

// GET /token/status/:checkoutRequestID - Query transaction status
router.get("/status/:checkoutRequestID", getTransactionStatus);

export default router;
