const { google } = require("googleapis");
const supabase = require("./supabase");

/* ---------------- OAUTH ---------------- */

async function getOAuthClientForBusiness(businessId) {
  const { data, error } = await supabase
    .from("google_tokens")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error("No Google token found for business");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: data.expiry_date,
  });

  // Persist refreshed tokens back to Supabase automatically
  oauth2Client.on("tokens", async (newTokens) => {
    const update = {};
    if (newTokens.access_token) update.access_token = newTokens.access_token;
    if (newTokens.expiry_date) update.expiry_date = newTokens.expiry_date;
    if (newTokens.refresh_token) update.refresh_token = newTokens.refresh_token;

    await supabase
      .from("google_tokens")
      .update(update)
      .eq("business_id", businessId);
  });

  return oauth2Client;
}

/* ---------------- CALENDAR EVENTS ---------------- */

async function getAvailability(businessId) {
  const auth = await getOAuthClientForBusiness(businessId);
  const calendar = google.calendar({ version: "v3", auth });

  const now = new Date();
  const end = new Date();
  end.setDate(now.getDate() + 7);

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });

  return response.data.items || [];
}

/* ---------------- FILTERS ---------------- */

function matchesTimePreference(date, query) {
  const q = String(query || "").toLowerCase();
  const hour = date.getHours();

  if (q.includes("morning")) return hour >= 9 && hour < 12;
  if (q.includes("afternoon")) return hour >= 12 && hour < 17;

  return true;
}

function matchesDayPreference(date, query) {
  const q = String(query || "").toLowerCase();

  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const targetIndex = days.findIndex((d) => q.includes(d));

  if (targetIndex === -1) {
    if (q.includes("tomorrow")) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return (
        date.getDate() === tomorrow.getDate() &&
        date.getMonth() === tomorrow.getMonth() &&
        date.getFullYear() === tomorrow.getFullYear()
      );
    }
    return true;
  }

  return date.getDay() === targetIndex;
}

/* ---------------- SLOT SUGGESTION ---------------- */

function getSuggestedSlots(events, options = {}) {
  const {
    query = "",
    bookingStartHour = 9,
    bookingEndHour = 17,
    bookingBufferMinutes = 0,
  } = options;

  const slots = [];
  const now = new Date();

  const start = new Date(now);
  start.setDate(start.getDate() + 1);
  start.setHours(bookingStartHour, 0, 0, 0);

  for (let day = 0; day < 5; day++) {
    const dayStart = new Date(start);
    dayStart.setDate(start.getDate() + day);

    for (
      let slot = new Date(dayStart);
      slot.getHours() < bookingEndHour;
      slot.setMinutes(slot.getMinutes() + 60)
    ) {
      const slotEnd = new Date(slot);
      slotEnd.setHours(slotEnd.getHours() + 1);

      if (!matchesDayPreference(slot, query)) continue;
      if (!matchesTimePreference(slot, query)) continue;

      const overlaps = events.some((event) => {
        if (!event.start?.dateTime || !event.end?.dateTime) return false;

        const eventStart = new Date(event.start.dateTime);
        const eventEnd = new Date(event.end.dateTime);

        eventStart.setMinutes(eventStart.getMinutes() - bookingBufferMinutes);
        eventEnd.setMinutes(eventEnd.getMinutes() + bookingBufferMinutes);

        return slot < eventEnd && slotEnd > eventStart;
      });

      if (!overlaps) {
        slots.push(new Date(slot));
      }

      if (slots.length >= 6) return slots;
    }
  }

  return slots;
}

/* ---------------- CREATE BOOKING ---------------- */

async function createBooking(businessId, customerPhone, summary, startTime) {
  const auth = await getOAuthClientForBusiness(businessId);
  const calendar = google.calendar({ version: "v3", auth });

  const start = new Date(startTime);
  const end = new Date(startTime);
  end.setHours(end.getHours() + 1);

  const event = {
    summary,
    description: `Booked via AI Receptionist. Customer: ${customerPhone}`,
    start: {
      dateTime: start.toISOString(),
    },
    end: {
      dateTime: end.toISOString(),
    },
  };

  const response = await calendar.events.insert({
    calendarId: "primary",
    resource: event,
  });

  return response.data;
}

module.exports = {
  getAvailability,
  getSuggestedSlots,
  createBooking,
};