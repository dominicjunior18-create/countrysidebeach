const express = require("express");
const fs = require("fs");
const path = require("path");
const { Resend } = require("resend");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

const DATA_FILE = path.resolve(__dirname, "bookings.json");
const resend = new Resend(process.env.RESEND_API_KEY);

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "your-email@example.com";
const FROM_EMAIL = process.env.FROM_EMAIL || "bookings@countrysidebeach.vm";

app.use(express.json());
app.use(express.static("."));

function loadBookings() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) { console.error("Load error:", e); }
  return [];
}

function saveBookings(bookings) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(bookings, null, 2));
  } catch (e) { console.error("Save error:", e); }
}

function isDateBooked(bookings, date) {
  return bookings.some(b => b.date === date && b.status !== "cancelled");
}

async function sendEmails(booking) {
  const spaceNames = {
    meeting: "Meeting Room (10–15 people)",
    conference: "Conference Hall (15–60 people)",
    outdoor: "Outdoor Event Grounds (up to 150)"
  };
  const space = spaceNames[booking.space] || booking.space;

  const html = `
    <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #0018a8; color: #fff; padding: 24px; text-align: center;">
        <h1 style="margin: 0; font-family: Playfair Display, serif;">Booking Confirmed</h1>
      </div>
      <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none;">
        <p>Hi ${booking.name},</p>
        <p>Your booking request has been received:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px; font-weight: 600;">Space</td><td style="padding: 8px;">${space}</td></tr>
          <tr><td style="padding: 8px; font-weight: 600;">Date</td><td style="padding: 8px;">${booking.date_display}</td></tr>
          <tr><td style="padding: 8px; font-weight: 600;">Phone</td><td style="padding: 8px;">${booking.phone}</td></tr>
          <tr><td style="padding: 8px; font-weight: 600;">Details</td><td style="padding: 8px;">${booking.notes}</td></tr>
        </table>
        <p style="color: #6b7280; font-size: 0.9rem;">We'll contact you within 24 hours.</p>
      </div>
    </div>`;

  await resend.emails.send({
    from: FROM_EMAIL,
    to: booking.email,
    subject: `Booking Confirmed – ${space} on ${booking.date_display}`,
    html
  });

  await resend.emails.send({
    from: FROM_EMAIL,
    to: ADMIN_EMAIL,
    subject: `New Booking: ${space} – ${booking.date_display}`,
    html: `<h2>New Booking</h2><p><strong>Space:</strong> ${space}</p><p><strong>Date:</strong> ${booking.date_display}</p><p><strong>Name:</strong> ${booking.name}</p><p><strong>Email:</strong> ${booking.email}</p><p><strong>Phone:</strong> ${booking.phone}</p><p><strong>Details:</strong> ${booking.notes}</p>`
  });
}

app.post("/api/booking", async (req, res) => {
  try {
    const booking = req.body;
    const required = ["space", "date", "date_display", "name", "email", "phone", "notes"];
    for (const field of required) {
      if (!booking[field]) return res.status(400).json({ error: `Missing: ${field}` });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email)) {
      return res.status(400).json({ error: "Invalid email" });
    }
    const today = new Date().toISOString().split("T")[0];
    if (booking.date < today) return res.status(400).json({ error: "Past date not allowed" });

    const bookings = loadBookings();
    if (isDateBooked(bookings, booking.date)) {
      return res.status(409).json({ error: "Date already booked" });
    }

    const newBooking = {
      id: `bk-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      ...booking,
      status: "pending",
      created_at: new Date().toISOString()
    };
    bookings.push(newBooking);
    saveBookings(bookings);

    if (process.env.RESEND_API_KEY) {
      sendEmails(newBooking).catch(console.error);
    }

    res.json({ success: true, booking: newBooking });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET availability for calendar
app.get("/api/availability", (req, res) => {
  const bookings = loadBookings();
  const booked = bookings.filter(b => b.status !== "cancelled").map(b => b.date);
  res.json({ booked });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/booking`);
});