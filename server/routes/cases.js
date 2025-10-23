import express from "express";
import Case from "../models/Case.js"; // موديل الحالات
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// =====================
// جلب كل الحالات
// =====================
router.get("/api/cases", authMiddleware, async (req, res) => {
  try {
    const cases = await Case.find().sort({ createdAt: -1 });
    res.json(cases);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// =====================
// حذف حالة معينة
// =====================
router.delete("/api/cases/:id", authMiddleware, async (req, res) => {
  try {
    await Case.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
