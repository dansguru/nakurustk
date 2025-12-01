import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import * as dotenv from "dotenv";

dotenv.config();

let db: any;

try {
  // Parse Firebase credentials from environment variable
  const firebaseCredentials = JSON.parse(
    process.env.FIREBASE_CREDENTIALS || "{}"
  );

  if (Object.keys(firebaseCredentials).length > 0) {
    const app = initializeApp({
      credential: cert(firebaseCredentials),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });

    db = getDatabase(app);
    console.log("Firebase initialized successfully");
  } else {
    console.warn(
      "Firebase credentials not found. Backend Firebase operations will be disabled."
    );
  }
} catch (error) {
  console.error("Failed to initialize Firebase:", error);
}

// Save transaction to Firebase
export const saveTransaction = async (
  checkoutRequestID: string,
  transactionData: any
) => {
  try {
    if (!db) {
      console.warn("Firebase not initialized, skipping transaction save");
      return { success: false, error: "Firebase not initialized" };
    }

    const transactionRef = db.ref(`transactions/${checkoutRequestID}`);
    await transactionRef.set({
      ...transactionData,
      createdAt: new Date().toISOString(),
    });

    console.log("Transaction saved to Firebase:", checkoutRequestID);
    return { success: true };
  } catch (error) {
    console.error("Error saving transaction to Firebase:", error);
    return { success: false, error: error };
  }
};

// Get transaction from Firebase
export const getTransaction = async (checkoutRequestID: string) => {
  try {
    if (!db) {
      console.warn("Firebase not initialized, returning pending status");
      return { success: false, transaction: { status: "pending" } };
    }

    const transactionRef = db.ref(`transactions/${checkoutRequestID}`);
    const snapshot = await transactionRef.get();

    if (snapshot.exists()) {
      return {
        success: true,
        transaction: {
          id: checkoutRequestID,
          ...snapshot.val(),
        },
      };
    }

    return {
      success: false,
      transaction: { status: "pending" }, // If not found yet, still pending
    };
  } catch (error) {
    console.error("Error fetching transaction from Firebase:", error);
    return {
      success: false,
      error: error,
      transaction: { status: "pending" },
    };
  }
};

// Update booking with payment status
export const updateBookingPayment = async (
  bookingId: string,
  paymentStatus: string,
  transactionDetails: any
) => {
  try {
    if (!db) {
      console.warn("Firebase not initialized, skipping booking update");
      return { success: false, error: "Firebase not initialized" };
    }

    const bookingRef = db.ref(`bookings/${bookingId}`);
    await bookingRef.update({
      paid: paymentStatus === "completed",
      paymentStatus: paymentStatus,
      transactionDetails: transactionDetails,
      updatedAt: new Date().toISOString(),
    });

    console.log("Booking updated with payment status:", bookingId);
    return { success: true };
  } catch (error) {
    console.error("Error updating booking:", error);
    return { success: false, error: error };
  }
};

export default db;
