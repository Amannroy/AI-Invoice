import mongoose from "mongoose";
import Invoice from "../models/invoiceModel.js";
import { getAuth } from "@clerk/express";
import path from "path";

/**
 * Base URL used to generate public URLs for uploaded files
 * (logo, stamp, signature)
 */
const API_BASE = "http://localhost:4000";

/* =====================================================
   HELPER FUNCTIONS
   ===================================================== */

/**
 * Calculates subtotal, tax and total amount for invoice items
 */
function computeTotals(items = [], taxPercent = 0) {
  // Ensure items is a valid array and remove invalid values
  const safe = Array.isArray(items) ? items.filter(Boolean) : [];

  const subTotal = safe.reduce(
    (sum, item) =>
      sum + Number(item.qty || 0) * Number(item.unitPrice || 0),
    0
  );

  const tax = (subTotal * Number(taxPercent || 0)) / 100;
  const total = subTotal + tax;

  return { subTotal, tax, total };
}

/**
 * Safely parses items field coming from FormData or JSON
 */
function parseItemsField(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;

  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return [];
    }
  }

  return val;
}

/**
 * Checks whether a string is a valid MongoDB ObjectId
 */
function isObjectIdString(val) {
  return typeof val === "string" && /^[0-9a-fA-F]{24}$/.test(val);
}

/**
 * Converts uploaded files into public URLs
 */
function uploadedFilesToUrls(req) {
  const urls = {};
  if (!req.files) return urls;

  // Map file field names to DB fields
  const mapping = {
    logoName: "logoDataUrl",
    stampName: "stampDataUrl",
    signatureNameMeta: "signatureDataUrl",
    logo: "logoDataUrl",
    stamp: "stampDataUrl",
    signature: "signatureDataUrl",
  };

  Object.keys(mapping).forEach((field) => {
    const arr = req.files[field];
    if (Array.isArray(arr) && arr[0]) {
      const filename =
        arr[0].filename || (arr[0].path && path.basename(arr[0].path));

      if (filename) {
        urls[mapping[field]] = `${API_BASE}/uploads/${filename}`;
      }
    }
  });

  return urls;
}

/**
 * Generates a unique invoice number
 * Handles race conditions by retrying
 */
async function generateUniqueInvoiceNumber(attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    const ts = Date.now().toString();
    const suffix = Math.floor(Math.random() * 900000)
      .toString()
      .padStart(6, "0");

    const candidate = `INV-${ts.slice(-6)}-${suffix}`;

    const exists = await Invoice.exists({ invoiceNumber: candidate });
    if (!exists) return candidate;

    // Small delay before retry
    await new Promise((r) => setTimeout(r, 2));
  }

  // Fallback (extremely rare)
  return new mongoose.Types.ObjectId().toString();
}

/* =====================================================
   CREATE INVOICE
   ===================================================== */
export async function createInvoice(req, res) {
  try {
    // Authenticate user
    const { userId } = getAuth(req) || {};
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const body = req.body || {};

    // Parse items safely
    const items = Array.isArray(body.items)
      ? body.items
      : parseItemsField(body.items);

    // Resolve tax percent from possible fields
    const taxPercent = Number(
      body.taxPercent ?? body.tax ?? body.defaultTaxPercent ?? 0
    );

    // Calculate totals
    const totals = computeTotals(items, taxPercent);

    // Handle uploaded files
    const fileUrls = uploadedFilesToUrls(req);

    /**
     * Validate or generate invoice number
     */
    const invoiceNumberProvided =
      typeof body.invoiceNumber === "string" && body.invoiceNumber.trim()
        ? body.invoiceNumber.trim()
        : null;

    if (invoiceNumberProvided) {
      const duplicate = await Invoice.exists({
        invoiceNumber: invoiceNumberProvided,
      });

      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: "Invoice number already exists",
        });
      }
    }

    const invoiceNumber =
      invoiceNumberProvided || (await generateUniqueInvoiceNumber());

    // Build invoice document
    const doc = new Invoice({
      _id: new mongoose.Types.ObjectId(),
      owner: userId,
      invoiceNumber,
      issueDate: body.issueDate || new Date().toISOString().slice(0, 10),
      dueDate: body.dueDate || "",
      fromBusinessName: body.fromBusinessName || "",
      fromEmail: body.fromEmail || "",
      fromAddress: body.fromAddress || "",
      fromPhone: body.fromPhone || "",
      fromGst: body.fromGst || "",
      client:
        typeof body.client === "string" && body.client.trim()
          ? { name: body.client }
          : body.client || {},
      items,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      currency: body.currency || "INR",
      status: body.status ? body.status.toLowerCase() : "draft",
      taxPercent,
      logoDataUrl: fileUrls.logoDataUrl || body.logoDataUrl || body.logo || null,
      stampDataUrl:
        fileUrls.stampDataUrl || body.stampDataUrl || body.stamp || null,
      signatureDataUrl:
        fileUrls.signatureDataUrl ||
        body.signatureDataUrl ||
        body.signature ||
        null,
      signatureName: body.signatureName || "",
      signatureTitle: body.signatureTitle || "",
      notes: body.notes || body.aiSource || "",
    });

    /**
     * Save with retry (handles race conditions)
     */
    let saved = null;
    let attempts = 0;
    const maxSaveAttempts = 6;

    while (attempts < maxSaveAttempts) {
      try {
        saved = await doc.save();
        break;
      } catch (err) {
        if (err?.code === 11000 && err?.keyPattern?.invoiceNumber) {
          attempts++;
          doc.invoiceNumber = await generateUniqueInvoiceNumber();
          continue;
        }
        throw err;
      }
    }

    if (!saved) {
      return res.status(500).json({
        success: false,
        message: "Failed to create invoice after multiple attempts",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Invoice created",
      data: saved,
    });
  } catch (err) {
    console.error("createInvoice error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
}

/* =====================================================
   GET ALL INVOICES
   ===================================================== */
export async function getInvoices(req, res) {
  try {
    const { userId } = getAuth(req) || {};
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // Base query: only user's invoices
    const q = { owner: userId };

    if (req.query.status) q.status = req.query.status;
    if (req.query.invoiceNumber) q.invoiceNumber = req.query.invoiceNumber;

    // Search across multiple fields
    if (req.query.search) {
      const search = req.query.search.trim();
      q.$or = [
        { fromEmail: { $regex: search, $options: "i" } },
        { "client.email": { $regex: search, $options: "i" } },
        { "client.name": { $regex: search, $options: "i" } },
        { invoiceNumber: { $regex: search, $options: "i" } },
      ];
    }

    const invoices = await Invoice.find(q)
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: invoices,
    });
  } catch (err) {
    console.error("GET INVOICES ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
}

/* =====================================================
   GET INVOICE BY ID
   ===================================================== */
export async function getInvoiceById(req, res) {
  try {
    const { userId } = getAuth(req) || {};
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const { id } = req.params;
    let inv;

    // Decide lookup method
    if (isObjectIdString(id)) {
      inv = await Invoice.findById(id);
    } else {
      inv = await Invoice.findOne({ invoiceNumber: id });
    }

    if (!inv) {
      return res.status(400).json({
        success: false,
        message: "Invoice not found",
      });
    }

    // Ownership check
    if (String(inv.owner) !== String(userId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Not your invoice",
      });
    }

    return res.status(200).json({
      success: true,
      data: inv,
    });
  } catch (err) {
    console.error("GET INVOICE BY ID ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
}

/* =====================================================
   UPDATE INVOICE
   ===================================================== */
export async function updateInvoice(req, res) {
  try {
    const { userId } = getAuth(req) || {};
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const { id } = req.params;
    const body = req.body || {};

    const query = isObjectIdString(id)
      ? { _id: id, owner: userId }
      : { invoiceNumber: id, owner: userId };

    const existing = await Invoice.findOne(query);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    // Prevent duplicate invoice numbers
    if (
      body.invoiceNumber &&
      body.invoiceNumber.trim() !== existing.invoiceNumber
    ) {
      const conflict = await Invoice.findOne({
        invoiceNumber: body.invoiceNumber.trim(),
      });

      if (conflict && String(conflict._id) !== String(existing._id)) {
        return res.status(409).json({
          success: false,
          message: "Invoice number already exists",
        });
      }
    }

    // Parse items
    let items = [];
    if (Array.isArray(body.items)) items = body.items;
    else if (typeof body.items === "string") {
      try {
        items = JSON.parse(body.items);
      } catch {
        items = [];
      }
    }

    const taxPercent = Number(
      body.taxPercent ??
        body.tax ??
        body.defaultTaxPercent ??
        existing.taxPercent ??
        0
    );

    const totals = computeTotals(items, taxPercent);
    const fileUrls = uploadedFilesToUrls(req);

    const update = {
      invoiceNumber: body.invoiceNumber,
      issueDate: body.issueDate,
      dueDate: body.dueDate,
      fromBusinessName: body.fromBusinessName,
      fromEmail: body.fromEmail,
      fromAddress: body.fromAddress,
      fromPhone: body.fromPhone,
      fromGst: body.fromGst,
      client:
        typeof body.client === "string" && body.client.trim()
          ? { name: body.client }
          : body.client || existing.client,
      items,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      currency: body.currency,
      status: body.status?.toLowerCase(),
      taxPercent,
      logoDataUrl: fileUrls.logoDataUrl || body.logoDataUrl,
      stampDataUrl: fileUrls.stampDataUrl || body.stampDataUrl,
      signatureDataUrl: fileUrls.signatureDataUrl || body.signatureDataUrl,
      signatureName: body.signatureName,
      signatureTitle: body.signatureTitle,
      notes: body.notes,
    };

    // Remove undefined values
    Object.keys(update).forEach(
      (k) => update[k] === undefined && delete update[k]
    );

    const updated = await Invoice.findByIdAndUpdate(
      existing._id,
      { $set: update },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: "Invoice Updated Successfully",
      data: updated,
    });
  } catch (err) {
    console.error("updateInvoice error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
}

/* =====================================================
   DELETE INVOICE
   ===================================================== */
export async function deleteInvoice(req, res) {
  try {
    const { userId } = getAuth(req) || {};
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const { id } = req.params;

    const query = isObjectIdString(id)
      ? { _id: id, owner: userId }
      : { invoiceNumber: id, owner: userId };

    const found = await Invoice.findOne(query);
    if (!found) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    await Invoice.deleteOne({ _id: found._id });

    return res.status(200).json({
      success: true,
      message: "Invoice Deleted successfully",
    });
  } catch (err) {
    console.error("DELETE INVOICE ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
}
