import express from "express";
import cors from "cors";
import TokenRoute from "./routes/token";

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

// Payment routes
app.use("/token", TokenRoute);

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

app.listen(port, () => {
  console.log("🚀 M-Pesa Payment Gateway Server started");
  console.log(`📌 Port: ${port}`);
  console.log(`🌐 Base URL: http://localhost:${port}`);
  console.log(`📡 Ready to receive M-Pesa transactions`);
});
