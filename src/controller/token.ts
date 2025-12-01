import { Request, Response, NextFunction } from "express";
import axios from "axios";
import * as dotenv from "dotenv";
import { saveTransaction, getTransaction, updateBookingPayment } from "../services/firebaseService";
dotenv.config();

let token: string;

const createToken = async (req: Request, res: Response, next: NextFunction) => {
  const secret = process.env.SECRET_KEY;
  const consumer = process.env.CONSUMER_KEY;
  
  if (!consumer || !secret) {
    console.error("❌ M-Pesa credentials not configured");
    return res.status(500).json({ error: "M-Pesa credentials not configured" });
  }

  console.log("🔑 Generating M-Pesa OAuth token...");

  const auth = Buffer.from(`${consumer}:${secret}`).toString("base64");

  try {
    const response = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );

    token = response.data.access_token;
    console.log("✅ M-Pesa token generated successfully");
    next();
  } catch (err) {
    console.error("❌ Failed to generate M-Pesa token:", err);
    res.status(400).json({ 
      error: "Failed to generate M-Pesa token",
      details: err instanceof Error ? err.message : "Unknown error"
    });
  }
};

const stkPush = async (req: Request, res: Response) => {
  try {
    const { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ error: "Phone and amount are required" });
    }

    const shortCode = process.env.SHORT_CODE;
    const passkey = process.env.PASS_KEY;
    const callbackUrl = process.env.CALLBACK_URL;

    if (!shortCode || !passkey || !callbackUrl) {
      console.error("❌ M-Pesa configuration incomplete");
      return res.status(500).json({ error: "M-Pesa configuration incomplete" });
    }

    // Remove leading 0 if present
    const phoneNumber = phone.startsWith("0") ? phone.substring(1) : phone;
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

    const stkPushData = {
      BusinessShortCode: shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: `254${phoneNumber}`,
      PartyB: shortCode,
      PhoneNumber: `254${phoneNumber}`,
      CallBackURL: callbackUrl,
      AccountReference: `BOOKING${Date.now()}`,
      TransactionDesc: "Vehicle Booking Payment",
    };

    console.log("📱 Sending STK Push request...", {
      phone: `254${phoneNumber}`,
      amount,
    });

    const response = await axios.post(url, stkPushData, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const stkResponse = response.data;

    console.log("✅ STK Push initiated successfully:", {
      CheckoutRequestID: stkResponse.CheckoutRequestID,
      ResponseCode: stkResponse.ResponseCode,
    });

    // Create initial transaction record
    if (stkResponse.CheckoutRequestID) {
      await saveTransaction(stkResponse.CheckoutRequestID, {
        checkoutRequestID: stkResponse.CheckoutRequestID,
        phone: `254${phoneNumber}`,
        amount,
        status: "pending",
        initiatedAt: new Date().toISOString(),
        mpesaResponseCode: stkResponse.ResponseCode,
      });
    }

    res.status(200).json(stkResponse);
  } catch (err) {
    console.error("❌ STK Push failed:", err);
    res.status(400).json({ 
      error: "Failed to initiate STK Push",
      details: err instanceof Error ? err.message : "Unknown error"
    });
  }
};

// Handle M-Pesa callback from Safaricom
const handleCallback = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    
    if (!body.Body || !body.Body.stkCallback) {
      console.error("❌ Invalid callback structure received");
      return res.status(400).json({ error: "Invalid callback structure" });
    }

    const callbackData = body.Body.stkCallback;
    
    console.log("📞 M-Pesa Callback received:", {
      CheckoutRequestID: callbackData.CheckoutRequestID,
      ResultCode: callbackData.ResultCode,
      ResultDesc: callbackData.ResultDesc,
    });

    // Immediately acknowledge receipt to Safaricom
    res.status(200).json({ status: "received" });

    const resultCode = callbackData.ResultCode;
    const resultDesc = callbackData.ResultDesc;
    const checkoutRequestID = callbackData.CheckoutRequestID;
    
    // Determine transaction status
    let transactionStatus = "pending";
    if (resultCode === 0) {
      transactionStatus = "completed";
    } else if (resultCode === 1032) {
      transactionStatus = "cancelled";
    } else {
      transactionStatus = "failed";
    }

    // Parse callback metadata for successful transactions
    let transactionData: any = {
      checkoutRequestID,
      resultCode,
      resultDesc,
      status: transactionStatus,
      callbackReceivedAt: new Date().toISOString(),
    };

    if (resultCode === 0 && callbackData.CallbackMetadata && callbackData.CallbackMetadata.Item) {
      // Payment successful - extract details
      const metadata = callbackData.CallbackMetadata.Item;
      
      metadata.forEach((item: any) => {
        if (item.Name === "Amount") transactionData.amount = item.Value;
        if (item.Name === "MpesaReceiptNumber") transactionData.mpesaReceiptNumber = item.Value;
        if (item.Name === "PhoneNumber") transactionData.phoneNumber = item.Value;
        if (item.Name === "TransactionDate") transactionData.transactionDate = item.Value;
      });

      console.log("✅ Payment completed:", {
        receipt: transactionData.mpesaReceiptNumber,
        amount: transactionData.amount,
      });
    }

    // Save transaction to Firebase
    const saveResult = await saveTransaction(checkoutRequestID, transactionData);
    
    if (saveResult.success) {
      console.log("✅ Transaction saved to Firebase");
    } else {
      console.error("⚠️ Failed to save transaction to Firebase:", saveResult.error);
    }

  } catch (error) {
    console.error("❌ Error handling M-Pesa callback:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Query transaction status - used by frontend polling
const getTransactionStatus = async (req: Request, res: Response) => {
  try {
    const { checkoutRequestID } = req.params;

    if (!checkoutRequestID) {
      return res.status(400).json({ error: "checkoutRequestID is required" });
    }

    console.log("🔍 Querying transaction status:", checkoutRequestID);

    // Query Firebase for the transaction
    const result = await getTransaction(checkoutRequestID);
    
    let transaction = result.transaction || { status: "pending" };
    
    // If transaction is still pending after some time, try querying M-Pesa directly
    // This is a fallback for cases where callback is delayed
    if (transaction.status === "pending" && db) {
      const initiatedTime = new Date(transaction.initiatedAt || Date.now()).getTime();
      const currentTime = Date.now();
      const secondsElapsed = (currentTime - initiatedTime) / 1000;
      
      // After 30 seconds, the user has likely confirmed or rejected the prompt
      if (secondsElapsed > 30) {
        console.log("⏳ Transaction pending for >30s, checking if callback was received...");
        
        // Check if transaction has been updated by callback (has resultCode)
        if (!transaction.resultCode) {
          // Still no callback - this might indicate the user rejected or didn't respond
          // We'll let it continue polling but log this state
          console.log("⚠️ No callback received yet for:", checkoutRequestID);
        }
      }
    }
    
    const responseData = {
      checkoutRequestID,
      status: transaction.status,
      resultCode: transaction.resultCode,
      resultDesc: transaction.resultDesc,
      mpesaReceiptNumber: transaction.mpesaReceiptNumber,
      amount: transaction.amount,
      timestamp: transaction.callbackReceivedAt || transaction.initiatedAt,
    };

    console.log("📊 Transaction status response:", {
      checkoutRequestID,
      status: transaction.status,
      hasResultCode: !!transaction.resultCode,
    });

    res.status(200).json(responseData);
  } catch (error) {
    console.error("❌ Error getting transaction status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export { createToken, stkPush, handleCallback, getTransactionStatus };
