"use strict";

const twilio = require("twilio");

/* ─────────────────────────────────────────────────────────────────────────────
 * helpers.js
 *
 * Shared utility functions used by both server.js (SMS / admin routes) and
 * voice.js (inbound call handling).  Keeping them here avoids duplication
 * and makes both files easier to read.
 * ───────────────────────────────────────────────────────────────────────── */

/* ── String normalisation ─────────────────────────────────────────────────── */

function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── Emergency detection ──────────────────────────────────────────────────── */

function isEmergency(text) {
  const msg = normalize(text);
  return [
    "gas leak",
    "smell gas",
    "carbon monoxide",
    "fire",
    "explosion",
    "emergency",
  ].some((w) => msg.includes(w));
}

/* ── Priority detection ───────────────────────────────────────────────────── */

function detectPriority(text, business) {
  const msg = normalize(text);

  const urgentKeywords = (business.urgent_keywords || "")
    .toLowerCase()
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const highValueKeywords = (business.high_value_keywords || "")
    .toLowerCase()
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const angryKeywords = [
    "why didn't you answer",
    "why didnt you answer",
    "ridiculous",
    "useless",
    "terrible",
    "angry",
    "complaint",
    "fuming",
  ];

  if (angryKeywords.some((word) => msg.includes(word))) return "angry";
  if (urgentKeywords.some((word) => msg.includes(word))) return "urgent";
  if (highValueKeywords.some((word) => msg.includes(word))) return "high_value";

  return "normal";
}

/* ── Booking intent / response detection ─────────────────────────────────── */

function isTimeSelection(text) {
  const msg = normalize(text);
  return (
    /\b(mon|tue|wed|thu|fri|sat|sun)\b.*\d{1,2}:\d{2}/i.test(text) ||
    /\b\d{1,2}:\d{2}\b/.test(msg) ||
    /\b\d{1,2}\s?(am|pm)\b/.test(msg)
  );
}

function detectBookingIntent(text) {
  const msg = normalize(text);

  const bookingKeywords = [
    "book",
    "appointment",
    "availability",
    "are you free",
    "tomorrow",
    "schedule",
    "can you come",
    "when can you",
    "morning",
    "afternoon",
  ];

  return bookingKeywords.some((w) => msg.includes(w)) || isTimeSelection(text);
}

function isConfirmation(text) {
  return [
    "yes", "y", "confirm", "confirmed",
    "yeah", "yep", "yup", "sure", "correct", "that's right", "thats right",
  ].includes(normalize(text));
}

function isRejection(text) {
  return [
    "no", "n", "different time", "another time", "nope", "nah",
  ].includes(normalize(text));
}

/* ── Slot formatting ─────────────────────────────────────────────────────── */

function formatSlot(slot) {
  return new Date(slot).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ── Business config ─────────────────────────────────────────────────────── */

function buildBusinessConfig(business) {
  return {
    bookingEnabled: business.booking_enabled !== false,
    ownerAlertsEnabled: business.owner_alerts_enabled !== false,
    timezone: business.timezone || "Europe/London",
    bookingBufferMinutes: Number(business.booking_buffer_minutes || 0),
    bookingStartHour: Number(business.booking_start_hour || 9),
    bookingEndHour: Number(business.booking_end_hour || 17),
  };
}

/* ── Conversation history helpers ────────────────────────────────────────── */

function getLatestPendingBooking(history) {
  const pending = [...history]
    .reverse()
    .find(
      (msg) =>
        msg.role === "system" &&
        typeof msg.content === "string" &&
        msg.content.startsWith("PENDING_BOOKING|")
    );

  if (!pending) return null;

  const parts = pending.content.split("|");
  if (parts.length < 3) return null;

  return { iso: parts[1], summary: parts[2] };
}

function getLatestOfferedSlots(history) {
  const offered = [...history]
    .reverse()
    .find(
      (msg) =>
        msg.role === "system" &&
        typeof msg.content === "string" &&
        msg.content.startsWith("OFFERED_SLOTS|")
    );

  if (!offered) return [];

  const parts = offered.content.split("|");
  if (parts.length < 2) return [];
  return parts.slice(1).filter(Boolean);
}

function extractPreferredTime(text) {
  const msg = normalize(text);

  let match = msg.match(/\b(\d{1,2}):(\d{2})\b/);
  if (match) {
    return { hour: Number(match[1]), minute: Number(match[2]) };
  }

  match = msg.match(/\b(\d{1,2})\s?(am|pm)\b/);
  if (match) {
    let hour = Number(match[1]);
    const period = match[2];
    if (period === "pm" && hour < 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;
    return { hour, minute: 0 };
  }

  return null;
}

function resolveSlotFromReply(incoming, offeredSlots) {
  const incomingNormalized = normalize(incoming);

  for (const iso of offeredSlots) {
    const full = normalize(formatSlot(iso));
    const short = normalize(
      new Date(iso).toLocaleString("en-GB", {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    );
    if (incomingNormalized === full || incomingNormalized === short) {
      return iso;
    }
  }

  const preferredTime = extractPreferredTime(incoming);
  if (!preferredTime) return null;

  return (
    offeredSlots.find((iso) => {
      const d = new Date(iso);
      return (
        d.getHours() === preferredTime.hour &&
        d.getMinutes() === preferredTime.minute
      );
    }) || null
  );
}

/* ── Dashboard message humaniser ─────────────────────────────────────────── */

function humanizeSystemMessage(content) {
  if (!content) return "";
  if (content === "MISSED_CALL")  return "Missed call captured";
  if (content === "INBOUND_CALL") return "Inbound call answered";
  if (content.startsWith("BOOKING_CONFIRMED|")) return "Booking confirmed";
  if (content.startsWith("PENDING_BOOKING|"))   return "Booking awaiting confirmation";
  if (content.startsWith("OFFERED_SLOTS|"))     return "Suggested appointment times sent";
  return content;
}

/* ── Twilio request validation middleware ────────────────────────────────── */

function validateTwilioRequest(req, res, next) {
  const signature = req.headers["x-twilio-signature"];
  // req.originalUrl preserves the full path even when this middleware is used
  // inside a mounted Express Router (e.g. /voice/inbound, not just /inbound)
  const url = process.env.APP_BASE_URL + req.originalUrl;
  const params = req.body;

  const valid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    params
  );

  if (!valid) {
    console.warn("Twilio signature validation failed:", url);
    return res.status(403).send("Forbidden");
  }

  next();
}

/* ─────────────────────────────────────────────────────────────────────────── */

module.exports = {
  normalize,
  isEmergency,
  detectPriority,
  isTimeSelection,
  detectBookingIntent,
  isConfirmation,
  isRejection,
  formatSlot,
  buildBusinessConfig,
  getLatestPendingBooking,
  getLatestOfferedSlots,
  extractPreferredTime,
  resolveSlotFromReply,
  humanizeSystemMessage,
  validateTwilioRequest,
};
