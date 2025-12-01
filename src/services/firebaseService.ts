import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase, Database } from "firebase-admin/database";
import * as dotenv from "dotenv";

dotenv.config();

let db: Database | null = null;

try {
  // Parse Firebase credentials from environment variable
  const firebaseCredentialsStr = process.env.FIREBASE_CREDENTIALS;
  
  if (!firebaseCredentialsStr) {
    throw new Error("FIREBASE_CREDENTIALS environment variable is not set");
  }

  const firebaseCredentials = JSON.parse(firebaseCredentialsStr);
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  if (!databaseURL) {
    throw new Error("FIREBASE_DATABASE_URL environment variable is not set");
  }

  const app = initializeApp({
    credential: cert(firebaseCredentials),
    databaseURL: databaseURL,
  });

  db = getDatabase(app);
  console.log("✅ Firebase Admin SDK initialized successfully");
  console.log(`📊 Database URL: ${databaseURL}`);
} catch (error) {
  console.error("❌ Failed to initialize Firebase Admin SDK:", error);
}

// Save transaction to Firebase Realtime Database
export const saveTransaction = async (
  checkoutRequestID: string,
  transactionData: any
): Promise<{ success: boolean; error?: any }> => {
  try {
    if (!db) {
      console.error("Firebase Database not initialized");
      return { success: false, error: "Firebase Database not initialized" };
    }

    const transactionRef = db.ref(`transactions/${checkoutRequestID}`);
    
    await transactionRef.set({
      ...transactionData,
      savedAt: new Date().toISOString(),
    });

    console.log("✅ Transaction saved to Firebase:", {
      checkoutRequestID,
      status: transactionData.status,
      amount: transactionData.amount,
    });

    return { success: true };
  } catch (error) {
    console.error("❌ Error saving transaction to Firebase:", error);
    return { success: false, error };
  }
};

// Get transaction from Firebase Realtime Database
export const getTransaction = async (
  checkoutRequestID: string
): Promise<{ success: boolean; transaction?: any; error?: any }> => {
  try {
    if (!db) {
      console.error("Firebase Database not initialized");
      return { 
        success: false, 
        transaction: { status: "pending" },
        error: "Firebase Database not initialized"
      };
    }

    const transactionRef = db.ref(`transactions/${checkoutRequestID}`);
    const snapshot = await transactionRef.get();

    if (snapshot.exists()) {
      const transaction = snapshot.val();
      console.log("✅ Transaction retrieved from Firebase:", {
        checkoutRequestID,
        status: transaction.status,
      });

      return {
        success: true,
        transaction: {
          id: checkoutRequestID,
          ...transaction,
        },
      };
    }

    console.log("⏳ Transaction not found in database yet:", checkoutRequestID);
    return {
      success: false,
      transaction: { status: "pending" },
    };
  } catch (error) {
    console.error("❌ Error fetching transaction from Firebase:", error);
    return {
      success: false,
      error,
      transaction: { status: "pending" },
    };
  }
};

// Update booking with payment status
export const updateBookingPayment = async (
  bookingId: string,
  paymentStatus: string,
  transactionDetails: any
): Promise<{ success: boolean; error?: any }> => {
  try {
    if (!db) {
      console.error("Firebase Database not initialized");
      return { success: false, error: "Firebase Database not initialized" };
    }

    const bookingRef = db.ref(`bookings/${bookingId}`);
    
    await bookingRef.update({
      paid: paymentStatus === "completed",
      paymentStatus: paymentStatus,
      transactionDetails: transactionDetails,
      paymentUpdatedAt: new Date().toISOString(),
    });

    console.log("✅ Booking updated with payment status:", {
      bookingId,
      paymentStatus,
    });

    return { success: true };
  } catch (error) {
    console.error("❌ Error updating booking payment status:", error);
    return { success: false, error };
  }
};

// Listen for real-time transaction updates (for potential future use)
export const listenToTransactionUpdates = (
  checkoutRequestID: string,
  onUpdate: (data: any) => void,
  onError?: (error: any) => void
) => {
  try {
    if (!db) {
      if (onError) onError("Firebase Database not initialized");
      return;
    }

    const transactionRef = db.ref(`transactions/${checkoutRequestID}`);
    
    const listener = transactionRef.on(
      "value",
      (snapshot) => {
        if (snapshot.exists()) {
          const transaction = snapshot.val();
          console.log("🔄 Real-time update received:", {
            checkoutRequestID,
            status: transaction.status,
          });
          onUpdate(transaction);
        }
      },
      (error) => {
        console.error("❌ Real-time listener error:", error);
        if (onError) onError(error);
      }
    );

    return listener;
  } catch (error) {
    console.error("❌ Error setting up real-time listener:", error);
    if (onError) onError(error);
  }
};

// Cleanup function
export const disconnectFirebase = () => {
  if (db) {
    try {
      db.goOffline();
      console.log("✅ Firebase connection closed");
    } catch (error) {
      console.error("❌ Error disconnecting Firebase:", error);
    }
  }
};

export default db;
