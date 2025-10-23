require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const MONGO_URI = process.env.MONGO_URI; 
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('✅ MongoDB connected to Atlas'))
  .catch(err=> console.error('❌ MongoDB connection error:', err));

const TestFileSchema = new mongoose.Schema({
  filename: String,
  originalname: String,
  mimetype: String,
  size: Number,
  uploadedAt: { type: Date, default: Date.now },
});

const CaseSchema = new mongoose.Schema({
  patientName: { type: String, required: true },
  age: Number,
  gender: String,
  entryDate: String,
  history: String,
  investigation: [TestFileSchema],
  progressionNotes: String,
  createdBy: String,
  createdAt: { type: Date, default: Date.now },
});

const Case = mongoose.model('Case', CaseSchema);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random()*1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

const JWT_SECRET = process.env.JWT_SECRET || "secret123";
const FIXED_EMAIL = process.env.FIXED_EMAIL || "doctor@example.com";
const FIXED_PASSWORD = process.env.FIXED_PASSWORD || "MyStrongPass123";

app.post('/auth/logout', (req, res) => {
  res.clearCookie("token", { httpOnly: true, sameSite: "lax" });
  res.json({ ok: true });
});

const createToken = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: "2h" });

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (email === FIXED_EMAIL && password === FIXED_PASSWORD) {
    const token = createToken({ email });
    res.cookie("token", token, { httpOnly: true, sameSite: "lax", maxAge: 2*60*60*1000 });
    return res.json({ ok: true, message: "Logged in" });
  }
  return res.status(401).json({ ok: false, message: "Invalid credentials" });
});

app.get('/auth/me', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({ authenticated: false });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return res.json({ authenticated: true, user: { email: payload.email } });
  } catch(err) {
    return res.json({ authenticated: false });
  }
});

function authMiddleware(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch(err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.get('/api/cases', authMiddleware, async (req, res) => {
  const cases = await Case.find().sort({ createdAt: -1 });
  res.json(cases);
});

app.post('/api/cases', authMiddleware, upload.array('investigation', 10), async (req, res) => {
  try {
    const { patientName, age, gender, entryDate, history, progressionNotes } = req.body;
    const files = (req.files || []).map(f => ({
      filename: f.filename,
      originalname: f.originalname,
      mimetype: f.mimetype,
      size: f.size
    }));
    const newCase = new Case({
      patientName, age, gender, entryDate, history, progressionNotes,
      investigation: files,
      createdBy: req.user.email
    });
    await newCase.save();
    res.status(201).json(newCase);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/cases/:id', authMiddleware, upload.array('investigation', 10), async (req, res) => {
  try {
    const { history, progressionNotes, deletedFiles } = req.body;
    const caseObj = await Case.findById(req.params.id);
    if (!caseObj) return res.status(404).json({ error: 'Case not found' });

    if (history !== undefined) caseObj.history = history;
    if (progressionNotes !== undefined) caseObj.progressionNotes = progressionNotes;

    if (deletedFiles) {
      const filesToDelete = Array.isArray(deletedFiles) ? deletedFiles : [deletedFiles];
      filesToDelete.forEach(filename => {
        const fileIndex = caseObj.investigation.findIndex(f => f.filename === filename);
        if (fileIndex > -1) {
          const filePath = path.join(__dirname, 'uploads', caseObj.investigation[fileIndex].filename);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          caseObj.investigation.splice(fileIndex, 1);
        }
      });
    }

    if (req.files) {
      const newFiles = req.files.map(f => ({
        filename: f.filename,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size
      }));
      caseObj.investigation.push(...newFiles);
    }

    await caseObj.save();
    res.json(caseObj);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/cases/:id', authMiddleware, async (req, res) => {
  try {
    const caseObj = await Case.findById(req.params.id);
    if (!caseObj) return res.status(404).json({ error: 'Case not found' });

    caseObj.investigation.forEach(file => {
      const filePath = path.join(__dirname, 'uploads', file.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    await Case.findByIdAndDelete(req.params.id);
    res.json({ ok: true, message: 'Case deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=> console.log('Server running on port', PORT));
