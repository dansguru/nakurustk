import { Request, Response, NextFunction } from "express";
import axios from "axios";
import * as dotenv from "dotenv";
import { saveTransaction, getTransaction } from "../services/firebaseService";
dotenv.config();

let token: string;

const createToken = async (req: Request, res: Response, next: NextFunction) => {
  const secret = process.env.SECRET_KEY;
  const consumer = process.env.CONSUMER_KEY;
  console.log("Consumer:", consumer);
  console.log("Secret:", secret);

  const auth = Buffer.from(`${consumer}:${secret}`).toString("base64");

  await axios
    .get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    )
    .then((data) => {
      token = data.data.access_token;
      console.log(data.data);
      next();
    })
    .catch((err) => {
      console.log(err);
      res.status(400).json(err);
    });
};

const stkPush = async (req: Request, res: Response) => {
  const shortCode = process.env.SHORT_CODE;
  const phone = req.body.phone.substring(1);
  const amount = req.body.amount;
  const passkey = process.env.PASS_KEY;
  const url = "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

  const date = new Date();
  const timestamp =
    date.getFullYear() +
    ("0" + (date.getMonth() + 1)).slice(-2) +
    ("0" + date.getDate()).slice(-2) +
    ("0" + date.getHours()).slice(-2) +
    ("0" + date.getMinutes()).slice(-2) +
    ("0" + date.getSeconds()).slice(-2);

  const password = Buffer.from(shortCode + passkey + timestamp).toString(
    "base64"
  );

  // Use your actual callback URL - this should be publicly accessible
  const callbackUrl = process.env.CALLBACK_URL || "https://mpesaserver-iota.vercel.app/token/callback";

  const data = {
    BusinessShortCode: shortCode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: amount,
    PartyA: `254${phone}`,
    PartyB: shortCode,
    PhoneNumber: `254${phone}`,
    CallBackURL: callbackUrl,
    AccountReference: `BOOKING${Date.now()}`,
    TransactionDesc: "Vehicle Booking Payment",
  };

  await axios
    .post(url, data, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    })
    .then((data) => {
      console.log("STK Push response:", data.data);
      res.status(200).json(data.data);
    })
    .catch((err) => {
      console.log(err);
      res.status(400).json(err.message);
    });
};

// Handle M-Pesa callback
const handleCallback = async (req: Request, res: Response) => {
  try {
    const callbackData = req.body.Body.stkCallback;
    
    console.log("M-Pesa Callback received:", JSON.stringify(callbackData, null, 2));

    // Immediately acknowledge receipt
    res.status(200).json({ status: "received" });

    const resultCode = callbackData.ResultCode;
    const resultDesc = callbackData.ResultDesc;
    const checkoutRequestID = callbackData.CheckoutRequestID;
    
    // Parse callback metadata
    let transactionData: any = {
      checkoutRequestID,
      resultCode,
      resultDesc,
      timestamp: new Date().toISOString(),
      status: resultCode === 0 ? "completed" : resultCode === 1032 ? "cancelled" : "failed",
    };

    if (resultCode === 0 && callbackData.CallbackMetadata) {
      // Payment successful - extract details
      const metadata = callbackData.CallbackMetadata.Item;
      metadata.forEach((item: any) => {
        if (item.Name === "Amount") transactionData.amount = item.Value;
        if (item.Name === "MpesaReceiptNumber") transactionData.mpesaReceiptNumber = item.Value;
        if (item.Name === "PhoneNumber") transactionData.phoneNumber = item.Value;
        if (item.Name === "TransactionDate") transactionData.transactionDate = item.Value;
      });
    }

    // Save transaction to Firebase
    const saveResult = await saveTransaction(checkoutRequestID, transactionData);
    
    if (saveResult.success) {
      console.log("Transaction successfully saved to Firebase:", checkoutRequestID);
    } else {
      console.error("Failed to save transaction to Firebase:", saveResult.error);
    }

  } catch (error) {
    console.error("Error handling M-Pesa callback:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Query transaction status (for polling)
const getTransactionStatus = async (req: Request, res: Response) => {
  try {
    const { checkoutRequestID } = req.params;

    if (!checkoutRequestID) {
      return res.status(400).json({ error: "checkoutRequestID is required" });
    }

    // Query Firebase for the transaction
    const result = await getTransaction(checkoutRequestID);
    
    const transaction = result.transaction || { status: "pending" };
    
    res.status(200).json({
      checkoutRequestID,
      status: transaction.status,
      resultCode: transaction.resultCode,
      resultDesc: transaction.resultDesc,
      mpesaReceiptNumber: transaction.mpesaReceiptNumber,
      amount: transaction.amount,
      timestamp: transaction.timestamp,
    });
  } catch (error) {
    console.error("Error getting transaction status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export { createToken, stkPush, handleCallback, getTransactionStatus };
