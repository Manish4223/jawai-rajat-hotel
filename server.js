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

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const JWT_SECRET     = process.env.JWT_SECRET     || "secret_change_me";

// ─── Directories ──────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ─── MongoDB Connection ───────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI || MONGODB_URI.includes("username:password")) {
  console.error("\n  ❌  MONGODB_URI not set in .env — please add your Atlas connection string.\n");
  process.exit(1);
}

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 45000,
})
  .then(() => console.log("  ✅  MongoDB Atlas connected"))
  .catch(err => { console.error("  ❌  MongoDB connection failed:", err.message); process.exit(1); });

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
      ${forCustomer ? `<p style="margin-top:20px">📞 +91-XXXXXXXXXX &nbsp;|&nbsp; ✉️ stay@jawai-rajat.com</p>` : ""}
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
  if (b.arrival && b.departure && b.arrival >= b.departure)       e.push("Departure must be after arrival.");
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
    const doc = await Booking.create({
      fullName: b.fullName.trim(), phone: b.phone.trim(), email: b.email.trim(),
      city: (b.city||"").trim(), arrival: b.arrival, departure: b.departure,
      adults: b.adults, children: b.children||"0", stayType: b.stayType||"",
      message: (b.message||"").trim(),
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
    await QuickCheck.create({ checkin, checkout, guests, roomType });
    res.json({ success: true, message: "Dates saved! Please fill the booking form below." });
  } catch (err) { res.status(500).json({ success: false, message: "Something went wrong." }); }
});

app.post("/api/contact", apiLimiter, async (req, res) => {
  const { name, phone, email, subject, message } = req.body;
  if (!name || !phone || !message)
    return res.status(400).json({ success: false, message: "Name, phone and message are required." });
  try {
    await Contact.create({ name: name.trim(), phone: phone.trim(), email: (email||"").trim(), subject: (subject||"").trim(), message: message.trim() });
    sendEmail(process.env.NOTIFY_EMAIL, `Contact: ${name}`, `<p><b>${name}</b> (${phone}): ${message}</p>`);
    res.json({ success: true, message: "Message sent! We will get back to you soon." });
  } catch (err) { res.status(500).json({ success: false, message: "Failed to send message." }); }
});

app.post("/api/enquiry", apiLimiter, async (req, res) => {
  const { name, phone, eventType, eventDate, guests, message } = req.body;
  if (!name || !phone) return res.status(400).json({ success: false, message: "Name and phone are required." });
  try {
    await Enquiry.create({ name: name.trim(), phone: phone.trim(), eventType: eventType||"", eventDate: eventDate||"", guests: guests||"", message: (message||"").trim() });
    sendEmail(process.env.NOTIFY_EMAIL, `Enquiry – ${name}`, `<p><b>${name}</b> (${phone}) enquired about <b>${eventType||"event"}</b></p><p>${message||""}</p>`);
    res.json({ success: true, message: "Enquiry received! We will call you shortly." });
  } catch (err) { res.status(500).json({ success: false, message: "Failed to submit enquiry." }); }
});

app.get("/api/gallery", async (req, res) => {
  try { res.json(await Gallery.find().sort({ order: 1, createdAt: -1 })); }
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
    await Payment.create({ orderId: order.id, bookingId: bookingId||null, amount, currency });
    res.json({ success: true, orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: "Failed to create payment order." }); }
});

app.post("/api/payment/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, bookingId } = req.body;
    const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET||"")
      .update(razorpay_order_id + "|" + razorpay_payment_id).digest("hex");
    if (expected !== razorpay_signature) return res.status(400).json({ success: false, message: "Payment verification failed." });
    await Payment.findOneAndUpdate({ orderId: razorpay_order_id }, { status: "paid", paymentId: razorpay_payment_id, paidAt: new Date() });
    if (bookingId) await Booking.findByIdAndUpdate(bookingId, { paymentStatus: "paid", status: "confirmed" });
    res.json({ success: true, message: "Payment verified successfully." });
  } catch (err) { res.status(500).json({ success: false, message: "Verification error." }); }
});

// ═════════════════════════════════════════════════════════════════════════════
//  ADMIN APIs
// ═════════════════════════════════════════════════════════════════════════════
app.get("/api/admin/stats", adminAuth, async (req, res) => {
  try {
    const [bookings, contacts, enquiries, checks, payments] = await Promise.all([
      Booking.find(), Contact.find(), Enquiry.find(), QuickCheck.find(), Payment.find()
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
    let rows = await Booking.find(query).sort({ createdAt: -1 });
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
    await Booking.findByIdAndUpdate(req.params.id, update);
    if (req.body.status === "confirmed") {
      const booking = await Booking.findById(req.params.id);
      if (booking?.email) {
        sendEmail(booking.email, "Booking Confirmed – Jawai Rajat",
          `<div style="font-family:sans-serif;background:#0f0f11;color:#f5f5f5;padding:24px;border-radius:12px">
           <h2 style="color:#f2c14f">Booking Confirmed! 🎉</h2>
           <p>Dear <b>${booking.fullName}</b>, your booking is confirmed.</p>
           <p>Arrival: <b>${booking.arrival}</b> | Departure: <b>${booking.departure}</b></p>
           <p>📞 +91-XXXXXXXXXX | ✉️ stay@jawai-rajat.com</p></div>`);
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

app.delete("/api/bookings/:id", adminAuth, async (req, res) => {
  try { await Booking.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false }); }
});

app.get("/api/contacts", adminAuth, async (req, res) => {
  try { res.json(await Contact.find().sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ success: false }); }
});

app.patch("/api/contacts/:id", adminAuth, async (req, res) => {
  try { await Contact.findByIdAndUpdate(req.params.id, { read: true }); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false }); }
});

app.delete("/api/contacts/:id", adminAuth, async (req, res) => {
  try { await Contact.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false }); }
});

app.get("/api/enquiries", adminAuth, async (req, res) => {
  try { res.json(await Enquiry.find().sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ success: false }); }
});

app.patch("/api/enquiries/:id", adminAuth, async (req, res) => {
  try {
    const update = {};
    if (req.body.status) update.status = req.body.status;
    if (req.body.notes !== undefined) update.notes = req.body.notes;
    await Enquiry.findByIdAndUpdate(req.params.id, update);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

app.delete("/api/enquiries/:id", adminAuth, async (req, res) => {
  try { await Enquiry.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false }); }
});

app.get("/api/quick-checks", adminAuth, async (req, res) => {
  try { res.json(await QuickCheck.find().sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ success: false }); }
});

app.get("/api/payments", adminAuth, async (req, res) => {
  try { res.json(await Payment.find().sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ success: false }); }
});

// ── Gallery Admin ─────────────────────────────────────────────────────────────
app.post("/api/admin/gallery", adminAuth, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No image uploaded." });
    const doc = await Gallery.create({
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
    const item = await Gallery.findById(req.params.id);
    if (item) {
      const fp = path.join(UPLOADS_DIR, item.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      await Gallery.findByIdAndDelete(req.params.id);
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
