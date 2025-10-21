import express from "express";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "HYROX scraper is running" });
});

// Sample endpoint
app.get("/api/sample", (req, res) => {
  const data = {
    eventName: "2025 HYROX Sample Event",
    categories: [
      {
        category: "Men 45-49",
        athletes: [
          { rank: 1, name: "John Doe", time: "1:05:23" },
          { rank: 2, name: "Mark Smith", time: "1:06:45" },
          { rank: 3, name: "David Wilson", time: "1:08:12" },
        ],
      },
      {
        category: "Women 50-54",
        athletes: [
          { rank: 1, name: "Jane Miller", time: "1:12:33" },
          { rank: 2, name: "Amy Taylor", time: "1:14:21" },
          { rank: 3, name: "Kate Brown", time: "1:15:05" },
        ],
      },
    ],
  };
  res.json(data);
});

// Default route
app.get("/", (req, res) => {
  res.send("HYROX Scraper API is active 🚀");
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
