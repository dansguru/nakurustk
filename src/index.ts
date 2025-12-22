import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import MpesaRoute from "./routes/mpesa";

// Load environment variables
dotenv.config();

const app = express();

const port = process.env.PORT || 3030;

app.use(express.json());
app.use(cors());

// Health check endpoint
app.get("/", (req, res) => {
  res.json({ 
    status: "ok",
    message: "M-Pesa Payment Gateway API is running",
    timestamp: new Date().toISOString()
  });
});

// M-Pesa API routes
app.use("/api/mpesa", MpesaRoute);

// Debug: Log all incoming requests in Vercel
if (process.env.VERCEL || process.env.VERCEL_ENV) {
  app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.path}`);
    next();
  });
}

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({ 
    error: "Internal server error",
    message: err.message 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: "Endpoint not found",
    path: req.path 
  });
});

// Export for Vercel serverless functions
// Vercel expects a handler function that can handle async operations
export default async (req: express.Request, res: express.Response) => {
  return app(req, res);
};

// Only start server if not in Vercel environment
if (process.env.VERCEL !== '1' && !process.env.VERCEL_ENV) {
  app.listen(port, () => {
    console.log("🚀 M-Pesa Payment Gateway Server started");
    console.log(`📌 Port: ${port}`);
    console.log(`🌐 Base URL: http://localhost:${port}`);
    console.log(`📡 Ready to receive M-Pesa transactions`);
    console.log(`✅ Using Supabase for database`);
  });
}
