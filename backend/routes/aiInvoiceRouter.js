import express from "express";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Create Express router
const aiInvoiceRouter = express.Router();

// Get Gemini API key from .env
const API_KEY = process.env.GEMINI_API_KEY;

// Warn if API key is missing
if (!API_KEY) {
  console.warn("No Gemini API key found in .env file");
}

// Create Gemini AI instance
const ai = new GoogleGenAI({ apiKey: API_KEY });

// Models we will try one by one if one fails
const MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0"
];

/*
  This function builds a strong instruction
  so AI returns structured invoice JSON only
*/
function buildInvoicePrompt(userText) {
  const invoiceTemplate = {
    invoiceNumber: `INV-${Math.floor(Math.random() * 9000) + 1000}`,
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    fromBusinessName: "",
    fromEmail: "",
    fromAddress: "",
    fromPhone: "",
    client: { name: "", email: "", address: "", phone: "" },
    items: [{ id: "1", description: "", qty: 1, unitPrice: 0 }],
    taxPercent: 18,
    notes: "",
  };

  return `
You are an invoice generation assistant.

Return ONLY valid JSON.
Do not add explanation text.

Follow this schema exactly:
${JSON.stringify(invoiceTemplate, null, 2)}

User Input:
${userText}
`;
}

/*
  This function:
  - Calls Gemini model
  - Extracts text safely
*/
async function tryGenerateWithModel(modelName, prompt) {
  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
  });

  let text = response?.text || null;

  // If no direct text found, try alternate formats
  if (!text && response?.outputs?.length) {
    text = response.outputs
      .map(o => o?.text || "")
      .join("\n");
  }

  if (!text) {
    throw new Error("No text returned from model");
  }

  return { text: text.trim(), modelName };
}

/*
  POST /generate
  This is the main API route
*/
aiInvoiceRouter.post("/generate", async (req, res) => {
  try {

    // If no API key
    if (!API_KEY) {
      return res.status(500).json({
        success: false,
        message: "Server configuration failed: No API key found"
      });
    }

    const { prompt } = req.body;

    // If user did not send prompt
    if (!prompt) {
      return res.status(400).json({
        success: false,
        message: "Prompt text is required"
      });
    }

    // Build strong AI instruction
    const fullPrompt = buildInvoicePrompt(prompt);

    let finalText = null;
    let usedModel = null;

    // Try each model until one works
    for (const model of MODEL_CANDIDATES) {
      try {
        const result = await tryGenerateWithModel(model, fullPrompt);
        finalText = result.text;
        usedModel = result.modelName;
        break;
      } catch (err) {
        console.warn(`Model ${model} failed`, err.message);
      }
    }

    if (!finalText) {
      return res.status(502).json({
        success: false,
        message: "All AI models failed"
      });
    }

    // Extract JSON part from AI response
    const firstBrace = finalText.indexOf("{");
    const lastBrace = finalText.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1) {
      return res.status(502).json({
        success: false,
        message: "AI returned invalid JSON",
        raw: finalText
      });
    }

    const jsonText = finalText.slice(firstBrace, lastBrace + 1);

    let invoiceData;
    try {
      invoiceData = JSON.parse(jsonText);
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: "Failed to parse AI JSON",
        raw: finalText
      });
    }

    // Send final success response
    return res.status(200).json({
      success: true,
      model: usedModel,
      data: invoiceData
    });

  } catch (error) {
    console.error("Unexpected error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      details: error.message
    });
  }
});

export default aiInvoiceRouter;
