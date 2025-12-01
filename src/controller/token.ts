import { Request, Response, NextFunction } from "express";
import axios from "axios";
import * as dotenv from "dotenv";
import {
    saveTransaction,
    getTransaction,
    updateBookingPayment,
    findBookingByCheckoutRequestID
} from "../services/firebaseService";
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
        const { phone, amount, bookingId } = req.body;

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

        // FIXED: Proper phone formatting
        let formattedPhone = phone;

        // Remove all non-digits first
        formattedPhone = formattedPhone.replace(/\D/g, '');

        // Now format correctly for M-Pesa
        if (formattedPhone.startsWith('0')) {
            // Format: 0745342479 -> 254745342479
            formattedPhone = '254' + formattedPhone.substring(1);
        } else if (formattedPhone.startsWith('254')) {
            // Already in correct format: 254745342479
            // Do nothing, it's already correct
            formattedPhone = formattedPhone;
        } else if (formattedPhone.length === 9) {
            // Format: 745342479 -> 254745342479
            formattedPhone = '254' + formattedPhone;
        } else {
            console.error("❌ Invalid phone number:", phone);
            return res.status(400).json({
                error: "Invalid phone number format. Use: 0745342479 or 745342479 or 254745342479"
            });
        }

        // Final validation
        if (formattedPhone.length !== 12) {
            console.error("❌ Invalid phone length:", formattedPhone);
            return res.status(400).json({
                error: "Invalid phone number. Should be 12 digits (e.g., 254745342479)"
            });
        }

        console.log("📱 Formatted phone for M-Pesa:", formattedPhone);

        const url = "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

        const date = new Date();
        const timestamp =
            date.getFullYear() +
            ("0" + (date.getMonth() + 1)).slice(-2) +
            ("0" + date.getDate()).slice(-2) +
            ("0" + date.getHours()).slice(-2) +
            ("0" + date.getMinutes()).slice(-2) +
            ("0" + date.getSeconds()).slice(-2);

        const password = Buffer.from(shortCode + passkey + timestamp).toString("base64");

        // Create account reference with bookingId if available
        const accountReference = bookingId
            ? `BOOKING-${bookingId}`
            : `BOOKING${Date.now()}`;

        const stkPushData = {
            BusinessShortCode: shortCode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline",
            Amount: amount,
            PartyA: formattedPhone,  // Use the formatted phone
            PartyB: shortCode,
            PhoneNumber: formattedPhone,  // Use the formatted phone
            CallBackURL: callbackUrl,
            AccountReference: accountReference,
            TransactionDesc: "Vehicle Booking Payment",
        };

        console.log("📱 Sending STK Push request...", {
            phone: formattedPhone,
            amount,
            bookingId,
            timestamp
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

        // Create initial transaction record with bookingId if provided
        if (stkResponse.CheckoutRequestID) {
            await saveTransaction(stkResponse.CheckoutRequestID, {
                checkoutRequestID: stkResponse.CheckoutRequestID,
                phone: formattedPhone,
                amount,
                bookingId: bookingId || null,
                status: "pending",
                initiatedAt: new Date().toISOString(),
                mpesaResponseCode: stkResponse.ResponseCode,
                accountReference: accountReference,
            });
        }

        res.status(200).json(stkResponse);
    } catch (err) {
        console.error("❌ STK Push failed:", err);

        // Better error logging
        if (err.response?.data) {
            console.error("❌ M-Pesa API Error:", err.response.data);
            return res.status(400).json({
                error: "Failed to initiate STK Push",
                details: err.response.data.errorMessage || JSON.stringify(err.response.data),
                mpesaErrorCode: err.response.data.errorCode
            });
        }

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
        } else if (resultCode === 1037) {
            transactionStatus = "timeout";
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

            // Try to find and update associated booking
            const bookingResult = await findBookingByCheckoutRequestID(checkoutRequestID);

            if (bookingResult.success && bookingResult.bookingId) {
                await updateBookingPayment(
                    bookingResult.bookingId,
                    transactionStatus,
                    transactionData
                );
            } else {
                // If no booking found by checkoutRequestID, check if bookingId was stored in transaction
                const transactionResult = await getTransaction(checkoutRequestID);
                if (transactionResult.success && transactionResult.transaction?.bookingId) {
                    await updateBookingPayment(
                        transactionResult.transaction.bookingId,
                        transactionStatus,
                        transactionData
                    );
                }
            }
        } else {
            console.error("⚠️ Failed to save transaction to Firebase:", saveResult.error);
        }

    } catch (error) {
        console.error("❌ Error handling M-Pesa callback:", error);
        // Don't send response here since we already sent it
    }
};

// Query M-Pesa directly for transaction status (bypasses callback)
const queryMpesaTransactionStatus = async (req: Request, res: Response) => {
    try {
        const { checkoutRequestID } = req.params;

        if (!checkoutRequestID) {
            return res.status(400).json({ error: "checkoutRequestID is required" });
        }

        const shortCode = process.env.SHORT_CODE;
        const passkey = process.env.PASS_KEY;

        if (!shortCode || !passkey) {
            return res.status(500).json({ error: "M-Pesa configuration incomplete" });
        }

        console.log("🔎 Querying M-Pesa directly for transaction:", checkoutRequestID);

        // Generate OAuth token first
        const secret = process.env.SECRET_KEY;
        const consumer = process.env.CONSUMER_KEY;

        if (!consumer || !secret) {
            return res.status(500).json({ error: "M-Pesa credentials not configured" });
        }

        const auth = Buffer.from(`${consumer}:${secret}`).toString("base64");

        const tokenResponse = await axios.get(
            "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
            {
                headers: {
                    Authorization: `Basic ${auth}`,
                },
            }
        );

        const accessToken = tokenResponse.data.access_token;

        // Generate timestamp and password for STK query
        const date = new Date();
        const timestamp =
            date.getFullYear() +
            ("0" + (date.getMonth() + 1)).slice(-2) +
            ("0" + date.getDate()).slice(-2) +
            ("0" + date.getHours()).slice(-2) +
            ("0" + date.getMinutes()).slice(-2) +
            ("0" + date.getSeconds()).slice(-2);

        const password = Buffer.from(shortCode + passkey + timestamp).toString("base64");

        // Query M-Pesa for transaction status
        const queryUrl = "https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query";

        const queryData = {
            BusinessShortCode: shortCode,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: checkoutRequestID,
        };

        const mpesaResponse = await axios.post(queryUrl, queryData, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        const queryResult = mpesaResponse.data;

        console.log("📡 M-Pesa Query Response:", {
            ResultCode: queryResult.ResultCode,
            ResultDesc: queryResult.ResultDesc,
            CheckoutRequestID: queryResult.CheckoutRequestID,
        });

        // Determine transaction status from result code
        let transactionStatus = "pending";
        if (queryResult.ResultCode === "0") {
            transactionStatus = "completed";
        } else if (queryResult.ResultCode === "1032") {
            transactionStatus = "cancelled";
        } else if (queryResult.ResultCode === "1037") {
            transactionStatus = "timeout";
        } else if (queryResult.ResultCode === "1") {
            transactionStatus = "failed";
        } else if (queryResult.ResultCode === "1001") {
            transactionStatus = "insufficient_funds";
        }

        // Update Firebase with the query result
        const updateData = {
            checkoutRequestID,
            resultCode: queryResult.ResultCode,
            resultDesc: queryResult.ResultDesc,
            status: transactionStatus,
            queriedAt: new Date().toISOString(),
        };

        await saveTransaction(checkoutRequestID, updateData);

        // Try to update associated booking
        const bookingResult = await findBookingByCheckoutRequestID(checkoutRequestID);

        if (bookingResult.success && bookingResult.bookingId) {
            await updateBookingPayment(
                bookingResult.bookingId,
                transactionStatus,
                updateData
            );
        } else {
            // If no booking found by checkoutRequestID, check if bookingId was stored in transaction
            const transactionResult = await getTransaction(checkoutRequestID);
            if (transactionResult.success && transactionResult.transaction?.bookingId) {
                await updateBookingPayment(
                    transactionResult.transaction.bookingId,
                    transactionStatus,
                    updateData
                );
            }
        }

        console.log("✅ Transaction status updated from M-Pesa query:", {
            status: transactionStatus,
            resultCode: queryResult.ResultCode,
        });

        res.status(200).json({
            checkoutRequestID,
            status: transactionStatus,
            resultCode: queryResult.ResultCode,
            resultDesc: queryResult.ResultDesc,
            queriedAt: updateData.queriedAt,
        });

    } catch (error: any) {
        console.error("❌ Error querying M-Pesa transaction:", error);

        // Check if it's an axios error with response
        if (error.response) {
            console.error("M-Pesa API Error:", error.response.data);
            return res.status(error.response.status || 500).json({
                error: "M-Pesa query failed",
                details: error.response.data,
            });
        }

        res.status(500).json({
            error: "Failed to query M-Pesa transaction",
            details: error.message
        });
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

        // If transaction is still pending after some time, provide helpful debugging info
        if (transaction.status === "pending") {
            const initiatedTime = new Date(transaction.initiatedAt || Date.now()).getTime();
            const currentTime = Date.now();
            const secondsElapsed = (currentTime - initiatedTime) / 1000;

            // After 30 seconds, the user has likely confirmed or rejected the prompt
            if (secondsElapsed > 30) {
                console.log("⏳ Transaction pending for >30s, checking if callback was received...");

                // Check if transaction has been updated by callback (has resultCode)
                if (!transaction.resultCode) {
                    // Still no callback - this might indicate the user rejected or didn't respond
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

export { createToken, stkPush, handleCallback, getTransactionStatus, queryMpesaTransactionStatus };