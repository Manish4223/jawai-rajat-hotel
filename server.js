require("dotenv").config();
// Fix Node.js DNS resolver for MongoDB Atlas SRV records
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
dns.setServers(["8.8.8.8", "8.8.4.4"]); // Google DNS for reliable SRV resolution

const express    = require("express");
const path       = require("path");
const fs         = require("fs");
const mongoose   = require("mongoose");
const rateLimit  = require("express-rate-limit");
const nodemailer = require("nodemailer");
const jwt        = require("jsonwebtoken");
const multer     = require("multer");
const crypto     = require("crypto");
const Datastore  = require("nedb-promises");

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const JWT_SECRET     = process.env.JWT_SECRET     || "secret_change_me";

// ─── Directories ──────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, "uploads");
const DATA_DIR    = path.join(__dirname, "data");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR,    { recursive: true });

// ─── NeDB local databases (fallback when MongoDB is unavailable) ──────────────
const localDb = {
  bookings:    Datastore.create({ filename: path.join(DATA_DIR, "bookings.db"),    autoload: true }),
  contacts:    Datastore.create({ filename: path.join(DATA_DIR, "contacts.db"),    autoload: true }),
  enquiries:   Datastore.create({ filename: path.join(DATA_DIR, "enquiries.db"),   autoload: true }),
  quickchecks: Datastore.create({ filename: path.join(DATA_DIR, "quickchecks.db"), autoload: true }),
  payments:    Datastore.create({ filename: path.join(DATA_DIR, "payments.db"),    autoload: true }),
  gallery:     Datastore.create({ filename: path.join(DATA_DIR, "gallery.db"),     autoload: true }),
};

// ─── MongoDB Connection ───────────────────────────────────────────────────────
let mongoConnected = false;
const MONGODB_URI  = process.env.MONGODB_URI;

if (MONGODB_URI && !MONGODB_URI.includes("username:password")) {
  mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
  })
    .then(() => { mongoConnected = true; console.log("  ✅  MongoDB Atlas connected"); })
    .catch(err => {
      console.error("  ❌  MongoDB connection failed:", err.message);
      console.warn("  ⚠️   Using local NeDB databases (data/ folder)\n");
    });
} else {
  console.warn("  ⚠️   MONGODB_URI not set — using local NeDB databases (data/ folder)\n");
}

// ─── DB helpers: use Mongo if connected, else NeDB ───────────────────────────
function ts() { return { createdAt: new Date(), updatedAt: new Date() }; }

const db = {
  bookings: {
    create: (d) => mongoConnected ? Booking.create(d) : localDb.bookings.insert({ ...d, ...ts() }),
    find:   (q) => mongoConnected ? Booking.find(q||{}).sort({ createdAt: -1 }) : localDb.bookings.find(q||{}).sort({ createdAt: -1 }),
    findById:        (id) => mongoConnected ? Booking.findById(id) : localDb.bookings.findOne({ _id: id }),
    findByIdAndUpdate: (id, u) => mongoConnected ? Booking.findByIdAndUpdate(id, u) : localDb.bookings.update({ _id: id }, { $set: { ...u, updatedAt: new Date() } }),
    findByIdAndDelete: (id)    => mongoConnected ? Booking.findByIdAndDelete(id) : localDb.bookings.remove({ _id: id }),
  },
  contacts: {
    create: (d) => mongoConnected ? Contact.create(d) : localDb.contacts.insert({ ...d, read: false, ...ts() }),
    find:   (q) => mongoConnected ? Contact.find(q||{}).sort({ createdAt: -1 }) : localDb.contacts.find(q||{}).sort({ createdAt: -1 }),
    findByIdAndUpdate: (id, u) => mongoConnected ? Contact.findByIdAndUpdate(id, u) : localDb.contacts.update({ _id: id }, { $set: u }),
    findByIdAndDelete: (id)    => mongoConnected ? Contact.findByIdAndDelete(id) : localDb.contacts.remove({ _id: id }),
  },
  enquiries: {
    create: (d) => mongoConnected ? Enquiry.create(d) : localDb.enquiries.insert({ ...d, status: d.status||"new", ...ts() }),
    find:   (q) => mongoConnected ? Enquiry.find(q||{}).sort({ createdAt: -1 }) : localDb.enquiries.find(q||{}).sort({ createdAt: -1 }),
    findByIdAndUpdate: (id, u) => mongoConnected ? Enquiry.findByIdAndUpdate(id, u) : localDb.enquiries.update({ _id: id }, { $set: u }),
    findByIdAndDelete: (id)    => mongoConnected ? Enquiry.findByIdAndDelete(id) : localDb.enquiries.remove({ _id: id }),
  },
  quickchecks: {
    create: (d) => mongoConnected ? QuickCheck.create(d) : localDb.quickchecks.insert({ ...d, ...ts() }),
    find:   (q) => mongoConnected ? QuickCheck.find(q||{}).sort({ createdAt: -1 }) : localDb.quickchecks.find(q||{}).sort({ createdAt: -1 }),
  },
  payments: {
    create: (d) => mongoConnected ? Payment.create(d) : localDb.payments.insert({ ...d, ...ts() }),
    find:   (q) => mongoConnected ? Payment.find(q||{}) : localDb.payments.find(q||{}),
    findOneAndUpdate: (q, u) => mongoConnected ? Payment.findOneAndUpdate(q, u) : localDb.payments.update(q, { $set: u }),
  },
  gallery: {
    create: (d) => mongoConnected ? Gallery.create(d) : localDb.gallery.insert({ ...d, ...ts() }),
    find:   (q) => mongoConnected ? Gallery.find(q||{}).sort({ order: 1, createdAt: -1 }) : localDb.gallery.find(q||{}).sort({ order: 1, createdAt: -1 }),
    findById:        (id) => mongoConnected ? Gallery.findById(id) : localDb.gallery.findOne({ _id: id }),
    findByIdAndDelete: (id) => mongoConnected ? Gallery.findByIdAndDelete(id) : localDb.gallery.remove({ _id: id }),
  },
};

// ─── Schemas & Models ─────────────────────────────────────────────────────────
const bookingSchema = new mongoose.Schema({
  fullName:      { type: String, required: true },
  phone:         { type: String, required: true },
  email:         { type: String, required: true },
  city:          String,
  arrival:       { type: String, required: true },
  departure:     { type: String, required: true },
  adults:        { type: String, required: true },
  children:      { type: String, default: "0" },
  stayType:      String,
  message:       String,
  status:        { type: String, enum: ["pending","confirmed","cancelled"], default: "pending" },
  notes:         { type: String, default: "" },
  paymentStatus: { type: String, default: "unpaid" },
}, { timestamps: true });

const contactSchema = new mongoose.Schema({
  name:    { type: String, required: true },
  phone:   { type: String, required: true },
  email:   String,
  subject: String,
  message: { type: String, required: true },
  read:    { type: Boolean, default: false },
}, { timestamps: true });

const enquirySchema = new mongoose.Schema({
  name:      { type: String, required: true },
  phone:     { type: String, required: true },
  eventType: String,
  eventDate: String,
  guests:    String,
  message:   String,
  status:    { type: String, default: "new" },
  notes:     String,
}, { timestamps: true });

const quickCheckSchema = new mongoose.Schema({
  checkin:  String,
  checkout: String,
  guests:   String,
  roomType: String,
}, { timestamps: true });

const paymentSchema = new mongoose.Schema({
  orderId:   String,
  bookingId: String,
  amount:    Number,
  currency:  { type: String, default: "INR" },
  status:    { type: String, default: "created" },
  paymentId: String,
  paidAt:    Date,
}, { timestamps: true });

const gallerySchema = new mongoose.Schema({
  filename: String,
  url:      String,
  alt:      String,
  order:    { type: Number, default: 99 },
}, { timestamps: true });

const Booking    = mongoose.model("Booking",    bookingSchema);
const Contact    = mongoose.model("Contact",    contactSchema);
const Enquiry    = mongoose.model("Enquiry",    enquirySchema);
const QuickCheck = mongoose.model("QuickCheck", quickCheckSchema);
const Payment    = mongoose.model("Payment",    paymentSchema);
const Gallery    = mongoose.model("Gallery",    gallerySchema);

// ─── Email ────────────────────────────────────────────────────────────────────
let mailer = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS && !process.env.SMTP_USER.includes("your@")) {
  mailer = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendEmail(to, subject, html) {
  if (!mailer || !to) return;
  try {
    await mailer.sendMail({
      from: `"Jawai Rajat Hotel" <${process.env.SMTP_USER}>`,
      to, subject, html,
    });
  } catch (e) { console.error("Email error:", e.message); }
}

function bookingEmailHtml(b, forCustomer = false) {
  return `
  <div style="font-family:sans-serif;max-width:560px;margin:auto;background:#0f0f11;color:#f5f5f5;border-radius:12px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#f2c14f,#f08e4a);padding:24px 28px">
      <h2 style="margin:0;color:#151515">${forCustomer ? "Booking Request Received" : "New Booking – " + b.fullName}</h2>
    </div>
    <div style="padding:24px 28px;line-height:1.7">
      ${forCustomer ? `<p>Dear <b>${b.fullName}</b>, thank you for your booking request at <b>Jawai Rajat Hotel</b>. We will confirm within 24 hours.</p>` : ""}
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:5px 0;color:#aaa;width:130px">Name</td><td><b>${b.fullName}</b></td></tr>
        <tr><td style="padding:5px 0;color:#aaa">Phone</td><td>${b.phone}</td></tr>
        <tr><td style="padding:5px 0;color:#aaa">Email</td><td>${b.email}</td></tr>
        <tr><td style="padding:5px 0;color:#aaa">Arrival</td><td>${b.arrival}</td></tr>
        <tr><td style="padding:5px 0;color:#aaa">Departure</td><td>${b.departure}</td></tr>
        <tr><td style="padding:5px 0;color:#aaa">Guests</td><td>${b.adults} Adults, ${b.children||0} Children</td></tr>
        <tr><td style="padding:5px 0;color:#aaa">Type</td><td>${b.stayType || "—"}</td></tr>
        ${b.message ? `<tr><td style="padding:5px 0;color:#aaa">Message</td><td>${b.message}</td></tr>` : ""}
      </table>
      ${forCustomer ? `<p style="margin-top:20px">📞 +91-9256208646 &nbsp;|&nbsp; ✉️ stay@jawai-rajat.com</p>` : ""}
    </div>
  </div>`;
}

// ─── Razorpay ─────────────────────────────────────────────────────────────────
let razorpay = null;
try {
  const Razorpay = require("razorpay");
  if (process.env.RAZORPAY_KEY_ID && !process.env.RAZORPAY_KEY_ID.includes("xxxxxxxxxx")) {
    razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
  }
} catch (_) {}

// ─── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename:    (_, file, cb) => cb(null, Date.now() + "-" + Math.round(Math.random()*1e6) + path.extname(file.originalname).toLowerCase()),
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_, file, cb) => /image\/(jpeg|jpg|png|webp)/.test(file.mimetype) ? cb(null, true) : cb(new Error("Only JPG/PNG/WEBP allowed.")),
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use("/uploads", express.static(UPLOADS_DIR));

const apiLimiter = rateLimit({ windowMs: 15*60*1000, max: 20,
  message: { success: false, message: "Too many requests. Try again after 15 minutes." } });

// ─── Validation ───────────────────────────────────────────────────────────────
function validateBooking(b) {
  const e = [];
  if (!b.fullName || b.fullName.trim().length < 2)               e.push("Full name required.");
  if (!b.phone   || !/^[\d\s\+\-]{7,15}$/.test(b.phone.trim())) e.push("Valid phone required.");
  if (!b.email   || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim())) e.push("Valid email required.");
  if (!b.arrival)                                                 e.push("Arrival date required.");
  if (!b.departure)                                               e.push("Departure date required.");
  if (b.arrival && b.departure && b.arrival > b.departure)       e.push("Departure must be same as or after arrival.");
  if (!b.adults)                                                  e.push("Adults count required.");
  return e;
}

// ─── Admin Auth ───────────────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const legacy = req.headers["x-admin-password"];
  if (legacy === ADMIN_PASSWORD) return next();
  const auth = req.headers["authorization"];
  if (auth && auth.startsWith("Bearer ")) {
    try { jwt.verify(auth.slice(7), JWT_SECRET); return next(); } catch (_) {}
  }
  res.status(401).json({ success: false, message: "Unauthorized" });
}

// ═════════════════════════════════════════════════════════════════════════════
//  AUTH
// ═════════════════════════════════════════════════════════════════════════════
app.post("/api/admin/login", (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD)
    return res.status(401).json({ success: false, message: "Wrong password." });
  const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ success: true, token });
});

app.post("/api/admin/change-password", adminAuth, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ success: false, message: "Min 6 characters required." });
  try {
    let env = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    env = env.replace(/^ADMIN_PASSWORD=.*/m, `ADMIN_PASSWORD=${newPassword}`);
    fs.writeFileSync(path.join(__dirname, ".env"), env);
    res.json({ success: true, message: "Password updated. Restart server to apply." });
  } catch (_) { res.status(500).json({ success: false, message: "Could not update password." }); }
});

// ═════════════════════════════════════════════════════════════════════════════
//  PUBLIC APIs
// ═════════════════════════════════════════════════════════════════════════════
app.post("/api/booking", apiLimiter, async (req, res) => {
  const errors = validateBooking(req.body);
  if (errors.length) return res.status(400).json({ success: false, message: errors.join(" ") });
  try {
    const b = req.body;
    const doc = await db.bookings.create({
      fullName: b.fullName.trim(), phone: b.phone.trim(), email: b.email.trim(),
      city: (b.city||"").trim(), arrival: b.arrival, departure: b.departure,
      adults: b.adults, children: b.children||"0", stayType: b.stayType||"",
      message: (b.message||"").trim(), status: "pending", notes: "", paymentStatus: "unpaid",
    });
    sendEmail(process.env.NOTIFY_EMAIL, `New Booking – ${b.fullName}`, bookingEmailHtml(b, false));
    if (b.email) sendEmail(b.email, "Booking Request Received – Jawai Rajat", bookingEmailHtml(b, true));
    res.status(201).json({ success: true, message: "Booking request received! Confirmation sent to your email. We will contact you within 24 hours.", id: doc._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to save booking. Please try again." });
  }
});

app.post("/api/quick-check", apiLimiter, async (req, res) => {
  try {
    const { checkin, checkout, guests, roomType } = req.body;
    await db.quickchecks.create({ checkin, checkout, guests, roomType });
    res.json({ success: true, message: "Dates saved! Please fill the booking form below." });
  } catch (err) { res.status(500).json({ success: false, message: "Something went wrong." }); }
});

app.post("/api/contact", apiLimiter, async (req, res) => {
  const { name, phone, email, subject, message } = req.body;
  if (!name || !phone || !message)
    return res.status(400).json({ success: false, message: "Name, phone and message are required." });
  try {
    await db.contacts.create({ name: name.trim(), phone: phone.trim(), email: (email||"").trim(), subject: (subject||"").trim(), message: message.trim() });
    sendEmail(process.env.NOTIFY_EMAIL, `Contact: ${name}`, `<p><b>${name}</b> (${phone}): ${message}</p>`);
    res.json({ success: true, message: "Message sent! We will get back to you soon." });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: "Failed to send message." }); }
});

app.post("/api/enquiry", apiLimiter, async (req, res) => {
  const { name, phone, eventType, eventDate, guests, message } = req.body;
  if (!name || !phone) return res.status(400).json({ success: false, message: "Name and phone are required." });
  try {
    await db.enquiries.create({ name: name.trim(), phone: phone.trim(), eventType: eventType||"", eventDate: eventDate||"", guests: guests||"", message: (message||"").trim() });
    sendEmail(process.env.NOTIFY_EMAIL, `Enquiry – ${name}`, `<p><b>${name}</b> (${phone}) enquired about <b>${eventType||"event"}</b></p><p>${message||""}</p>`);
    res.json({ success: true, message: "Enquiry received! We will call you shortly." });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: "Failed to submit enquiry." }); }
});

app.get("/api/gallery", async (req, res) => {
  try { res.json(await db.gallery.find({})); }
  catch (err) { res.status(500).json({ success: false }); }
});

// ═════════════════════════════════════════════════════════════════════════════
//  PAYMENT
// ═════════════════════════════════════════════════════════════════════════════
app.post("/api/payment/create-order", apiLimiter, async (req, res) => {
  if (!razorpay) return res.status(503).json({ success: false, message: "Payment gateway not configured." });
  try {
    const { amount, bookingId, currency = "INR" } = req.body;
    if (!amount || amount < 1) return res.status(400).json({ success: false, message: "Invalid amount." });
    const order = await razorpay.orders.create({ amount: Math.round(amount * 100), currency, receipt: `rcpt_${bookingId||Date.now()}` });
    await db.payments.create({ orderId: order.id, bookingId: bookingId||null, amount, currency, status: "created" });
    res.json({ success: true, orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: "Failed to create payment order." }); }
});

app.post("/api/payment/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, bookingId } = req.body;
    const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET||"")
      .update(razorpay_order_id + "|" + razorpay_payment_id).digest("hex");
    if (expected !== razorpay_signature) return res.status(400).json({ success: false, message: "Payment verification failed." });
    await db.payments.findOneAndUpdate({ orderId: razorpay_order_id }, { status: "paid", paymentId: razorpay_payment_id, paidAt: new Date() });
    if (bookingId) await db.bookings.findByIdAndUpdate(bookingId, { paymentStatus: "paid", status: "confirmed" });
    res.json({ success: true, message: "Payment verified successfully." });
  } catch (err) { res.status(500).json({ success: false, message: "Verification error." }); }
});

// ═════════════════════════════════════════════════════════════════════════════
//  ADMIN APIs
// ═════════════════════════════════════════════════════════════════════════════
app.get("/api/admin/stats", adminAuth, async (req, res) => {
  try {
    const [bookings, contacts, enquiries, checks, payments] = await Promise.all([
      db.bookings.find({}), db.contacts.find({}), db.enquiries.find({}), db.quickchecks.find({}), db.payments.find({})
    ]);
    res.json({
      totalBookings:     bookings.length,
      pendingBookings:   bookings.filter(b => b.status === "pending").length,
      confirmedBookings: bookings.filter(b => b.status === "confirmed").length,
      cancelledBookings: bookings.filter(b => b.status === "cancelled").length,
      totalContacts:     contacts.length,
      unreadContacts:    contacts.filter(c => !c.read).length,
      totalEnquiries:    enquiries.length,
      newEnquiries:      enquiries.filter(e => e.status === "new").length,
      totalQuickChecks:  checks.length,
      totalPayments:     payments.filter(p => p.status === "paid").length,
      totalRevenue:      payments.filter(p => p.status === "paid").reduce((s, p) => s + (p.amount||0), 0),
    });
  } catch (err) { res.status(500).json({ success: false }); }
});

app.get("/api/bookings", adminAuth, async (req, res) => {
  try {
    const { status, search } = req.query;
    let query = {};
    if (status && status !== "all") query.status = status;
    let rows = await db.bookings.find(query);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(b => b.fullName.toLowerCase().includes(s) || b.phone.includes(s) || (b.email||"").toLowerCase().includes(s));
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ success: false }); }
});

app.patch("/api/bookings/:id", adminAuth, async (req, res) => {
  try {
    const update = {};
    if (req.body.status) {
      if (!["pending","confirmed","cancelled"].includes(req.body.status))
        return res.status(400).json({ success: false, message: "Invalid status." });
      update.status = req.body.status;
    }
    if (req.body.notes !== undefined) update.notes = req.body.notes;
    await db.bookings.findByIdAndUpdate(req.params.id, update);
    if (req.body.status === "confirmed") {
      const booking = await db.bookings.findById(req.params.id);
      if (booking?.email) {
        sendEmail(booking.email, "Booking Confirmed – Jawai Rajat",
          `<div style="font-family:sans-serif;background:#0f0f11;color:#f5f5f5;padding:24px;border-radius:12px">
           <h2 style="color:#f2c14f">Booking Confirmed! 🎉</h2>
           <p>Dear <b>${booking.fullName}</b>, your booking is confirmed.</p>
           <p>Arrival: <b>${booking.arrival}</b> | Departure: <b>${booking.departure}</b></p>
           <p>📞 +91-9256208646 | ✉️ stay@jawai-rajat.com</p></div>`);
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

app.delete("/api/bookings/:id", adminAuth, async (req, res) => {
  try { await db.bookings.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false }); }
});

app.get("/api/contacts", adminAuth, async (req, res) => {
  try { res.json(await db.contacts.find({})); }
  catch (err) { res.status(500).json({ success: false }); }
});

app.patch("/api/contacts/:id", adminAuth, async (req, res) => {
  try { await db.contacts.findByIdAndUpdate(req.params.id, { read: true }); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false }); }
});

app.delete("/api/contacts/:id", adminAuth, async (req, res) => {
  try { await db.contacts.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false }); }
});

app.get("/api/enquiries", adminAuth, async (req, res) => {
  try { res.json(await db.enquiries.find({})); }
  catch (err) { res.status(500).json({ success: false }); }
});

app.patch("/api/enquiries/:id", adminAuth, async (req, res) => {
  try {
    const update = {};
    if (req.body.status) update.status = req.body.status;
    if (req.body.notes !== undefined) update.notes = req.body.notes;
    await db.enquiries.findByIdAndUpdate(req.params.id, update);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

app.delete("/api/enquiries/:id", adminAuth, async (req, res) => {
  try { await db.enquiries.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false }); }
});

app.get("/api/quick-checks", adminAuth, async (req, res) => {
  try { res.json(await db.quickchecks.find({})); }
  catch (err) { res.status(500).json({ success: false }); }
});

app.get("/api/payments", adminAuth, async (req, res) => {
  try { res.json(await db.payments.find({})); }
  catch (err) { res.status(500).json({ success: false }); }
});

// ── Gallery Admin ─────────────────────────────────────────────────────────────
app.post("/api/admin/gallery", adminAuth, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No image uploaded." });
    const doc = await db.gallery.create({
      filename: req.file.filename,
      url:      "/uploads/" + req.file.filename,
      alt:      (req.body.alt || "Jawai Rajat Hotel").trim(),
      order:    parseInt(req.body.order) || 99,
    });
    res.json({ success: true, image: doc });
  } catch (err) { res.status(500).json({ success: false, message: "Upload failed." }); }
});

app.delete("/api/admin/gallery/:id", adminAuth, async (req, res) => {
  try {
    const item = await db.gallery.findById(req.params.id);
    if (item) {
      const fp = path.join(UPLOADS_DIR, item.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      await db.gallery.findByIdAndDelete(req.params.id);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

// ─── Fallback ─────────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, () => {
  console.log(`\n  🏨  Jawai Rajat  →  http://localhost:${PORT}`);
  console.log(`  🔧  Admin Panel  →  http://localhost:${PORT}/admin.html\n`);
});
