import express from "express";
import cors from "cors";
import "dotenv/config";
import { clerkMiddleware } from '@clerk/express'
import { connectDB } from "./config/db.js";
import path from "path";
import invoiceRouter from "./routes/invoiceRouter.js";

const app = express();
const port = 4000;

// MIDDLEWARES
app.use(cors());
app.use(clerkMiddleware());
app.use(express.json({limit: "20mb"}));
app.use(express.urlencoded({limit: "20mb", extended: true}));

// DATABASE CONNECTION
connectDB();

// ROUTES
app.use("/uplaods", express.static(path.join(process.cwd(), "uploads")));

app.use("/api/invoice", invoiceRouter);

app.get("/", (req, res) => {
    res.send("API WORKING")
});

app.listen(port, () => {
    console.log(`Server Started on http://localhost:${port}`); 
});