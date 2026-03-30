require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { OpenAI } = require("openai");
const twilio = require("twilio");
const { google } = require("googleapis");

const supabase = require("./supabase");
const {
  getAvailability,
  getSuggestedSlots,
  createBooking,
} = require("./calendar");

const {
  getBusinessByTwilioNumber,
  findOrCreateCustomer,
  findOrCreateConversation,
  saveMessage,
  getConversationMessages,
  updateConversation,
  updateConversationPriority,
} = require("./dbHelpers");

const app = express();

/* ---------------- CORS ---------------- */

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "ngrok-skip-browser-warning",
    ],
  })
);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* ---------------- CLIENTS ---------------- */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* ---------------- TWILIO WEBHOOK VALIDATION ---------------- */

function validateTwilioRequest(req, res, next) {
  const signature = req.headers["x-twilio-signature"];
  const url = process.env.APP_BASE_URL + req.originalUrl;
  const params = req.body;

  const valid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    params
  );

  if (!valid) {
    return res.status(403).send("Forbidden");
  }

  next();
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

/* ---------------- HELPERS ---------------- */

const recentMessages = new Map();

function isRateLimited(phone) {
  const now = Date.now();
  const last = recentMessages.get(phone);
  if (last && now - last < 3000) return true;
  recentMessages.set(phone, now);
  return false;
}

function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

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
  return ["yes", "y", "confirm", "confirmed"].includes(normalize(text));
}

function isRejection(text) {
  return ["no", "n", "different time", "another time"].includes(normalize(text));
}

function formatSlot(slot) {
  return new Date(slot).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

  return {
    iso: parts[1],
    summary: parts[2],
  };
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
    return {
      hour: Number(match[1]),
      minute: Number(match[2]),
    };
  }

  match = msg.match(/\b(\d{1,2})\s?(am|pm)\b/);
  if (match) {
    let hour = Number(match[1]);
    const period = match[2];

    if (period === "pm" && hour < 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;

    return {
      hour,
      minute: 0,
    };
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

async function checkAdmin(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send("Unauthorized");
  }

  const token = authHeader.slice(7);

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return res.status(401).send("Unauthorized");
  }

  // Look up the business owned by this authenticated user
  const { data: business, error: bizError } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (bizError || !business) {
    return res.status(403).send("Forbidden");
  }

  // If the route has a businessId param, verify it matches the user's business
  const { businessId } = req.params;
  if (businessId && businessId !== business.id) {
    return res.status(403).send("Forbidden");
  }

  // If the route has a conversationId param, verify it belongs to the user's business
  const { conversationId } = req.params;
  if (conversationId) {
    const { data: convo } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("business_id", business.id)
      .maybeSingle();

    if (!convo) {
      return res.status(403).send("Forbidden");
    }
  }

  req.user = user;
  req.businessId = business.id;
  next();
}

function humanizeSystemMessage(content) {
  if (!content) return "";
  if (content === "MISSED_CALL") return "Missed call captured";
  if (content.startsWith("BOOKING_CONFIRMED|")) return "Booking confirmed";
  if (content.startsWith("PENDING_BOOKING|")) return "Booking awaiting confirmation";
  if (content.startsWith("OFFERED_SLOTS|")) return "Suggested appointment times sent";
  return content;
}

/* ---------------- ROOT ---------------- */

app.get("/", (req, res) => {
  res.send("AI Receptionist Running");
});

/* ---------------- AUTH ---------------- */

app.post("/auth/signup", async (req, res) => {
  const { email, password, business_name, phone, twilio_number } = req.body;

  if (!email || !password || !business_name || !twilio_number) {
    return res
      .status(400)
      .json({ error: "email, password, business_name, and twilio_number are required" });
  }

  // Create the Supabase Auth user via the admin API so it is auto-confirmed
  // (no email verification loop) and works from a service-role backend
  const { data: adminData, error: signUpError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (signUpError) {
    return res.status(400).json({ error: signUpError.message });
  }

  const userId = adminData.user.id;

  // Create the businesses row linked to this auth user
  const { error: bizError } = await supabase.from("businesses").insert({
    owner_user_id: userId,
    name: business_name,
    phone: phone || null,
    twilio_number,
  });

  if (bizError) {
    // Roll back the auth user so the email address can be retried
    await supabase.auth.admin.deleteUser(userId);
    console.error("Business insert error:", bizError);
    return res.status(500).json({ error: "Failed to create business" });
  }

  // Sign the user in immediately to return a usable session token
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    return res.status(500).json({ error: "Account created but sign-in failed" });
  }

  return res.status(201).json({ session: signInData.session });
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return res.status(401).json({ error: error.message });
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_user_id", data.user.id)
    .maybeSingle();

  return res.json({ session: data.session, business_id: business?.id || null });
});

app.post("/auth/refresh", async (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    return res.status(400).json({ error: "refresh_token is required" });
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token });

  if (error) {
    return res.status(401).json({ error: error.message });
  }

  return res.json({ session: data.session });
});

/* ---------------- GOOGLE CONNECT ---------------- */

app.get("/google/connect", async (req, res) => {
  const businessId = req.query.business_id;

  if (!businessId) {
    return res.status(400).send("Missing business_id");
  }

  const scopes = ["https://www.googleapis.com/auth/calendar"];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    state: businessId,
    prompt: "consent",
  });

  return res.redirect(url);
});

/* ---------------- GOOGLE CALLBACK ---------------- */

app.get("/google/callback", async (req, res) => {
  const code = req.query.code;
  const businessId = req.query.state;

  if (!code || !businessId) {
    return res.status(400).send("Invalid callback");
  }

  try {
    const tokenResponse = await oauth2Client.getToken(code);
    const tokens = tokenResponse.tokens;

    await supabase.from("google_tokens").delete().eq("business_id", businessId);

    const { error } = await supabase.from("google_tokens").insert({
      business_id: businessId,
      access_token: tokens.access_token || null,
      refresh_token: tokens.refresh_token || null,
      expiry_date: tokens.expiry_date || null,
    });

    if (error) {
      console.error("Google token save error:", error);
      return res
        .status(500)
        .send("Calendar connected, but token save failed.");
    }

    return res.send("Google Calendar connected successfully and saved.");
  } catch (err) {
    console.error("Google OAuth error:", err);
    return res.status(500).send("Calendar connection failed.");
  }
});

/* ---------------- MISSED CALL ---------------- */

app.post("/incoming-call", validateTwilioRequest, async (req, res) => {
  const from = req.body.From;
  const to = req.body.To;

  try {
    if (!from || !to) return res.sendStatus(200);

    const business = await getBusinessByTwilioNumber(to);
    if (!business) return res.sendStatus(200);

    const customer = await findOrCreateCustomer(business.id, from);
    const conversation = await findOrCreateConversation(
      business.id,
      customer.id
    );

    await saveMessage(conversation.id, "in", "system", "MISSED_CALL");

    const reply = "Sorry we missed your call. How can we help?";

    await saveMessage(conversation.id, "out", "assistant", reply);

    await twilioClient.messages.create({
      from: to,
      to: from,
      body: reply,
    });

    await updateConversation(conversation.id, {
      awaiting_reply: true,
      next_nudge_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      last_inbound_at: new Date().toISOString(),
      last_outbound_at: new Date().toISOString(),
      status: "missed_call",
    });

    console.log("Missed call handled for:", from);
    return res.sendStatus(200);
  } catch (err) {
    console.error("MISSED CALL ERROR:", err);
    return res.sendStatus(200);
  }
});

/* ---------------- SMS WEBHOOK ---------------- */

app.post("/sms", validateTwilioRequest, async (req, res) => {
  const incoming = req.body.Body?.trim();
  const sender = req.body.From;
  const toNumber = req.body.To;

  if (!incoming || !sender || !toNumber) return res.sendStatus(200);
  if (["STOP", "UNSUBSCRIBE"].includes(incoming.toUpperCase())) {
    return res.sendStatus(200);
  }
  if (isRateLimited(sender)) return res.sendStatus(200);

  try {
    if (isEmergency(incoming)) {
      await twilioClient.messages.create({
        from: toNumber,
        to: sender,
        body:
          "If this is an emergency, leave immediately and contact emergency services.",
      });
      return res.sendStatus(200);
    }

    const business = await getBusinessByTwilioNumber(toNumber);
    if (!business) return res.sendStatus(200);

    const config = buildBusinessConfig(business);
    const customer = await findOrCreateCustomer(business.id, sender);
    const conversation = await findOrCreateConversation(
      business.id,
      customer.id
    );

    const priority = detectPriority(incoming, business);
    if (priority !== "normal") {
      await updateConversationPriority(conversation.id, priority);

      if (config.ownerAlertsEnabled && business.owner_phone) {
        let alertPrefix = "⚠️ PRIORITY LEAD";
        if (priority === "urgent") alertPrefix = "🚨 URGENT LEAD";
        if (priority === "angry") alertPrefix = "😡 ANGRY CUSTOMER";
        if (priority === "high_value") alertPrefix = "💰 HIGH VALUE LEAD";

        await twilioClient.messages.create({
          from: toNumber,
          to: business.owner_phone,
          body: `${alertPrefix}\n\nCustomer: ${sender}\nMessage: ${incoming}`,
        });
      }
    }

    await saveMessage(conversation.id, "in", "user", incoming);

    const history = await getConversationMessages(conversation.id);

    const aiMessages = history
      .filter((msg) => msg.role === "user" || msg.role === "assistant")
      .map((msg) => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content,
      }));

    let reply;
    const pendingBooking = getLatestPendingBooking(history);

    if (pendingBooking && isConfirmation(incoming)) {
      try {
        await createBooking(
          business.id,
          sender,
          pendingBooking.summary,
          pendingBooking.iso
        );

        await supabase.from("appointments").insert({
          business_id: business.id,
          customer_id: customer.id,
          conversation_id: conversation.id,
          start_time: pendingBooking.iso,
          summary: pendingBooking.summary,
          reminder_sent: false,
        });

        await saveMessage(
          conversation.id,
          "out",
          "system",
          `BOOKING_CONFIRMED|${pendingBooking.iso}|${pendingBooking.summary}`
        );

        await updateConversation(conversation.id, {
          awaiting_reply: false,
          next_nudge_at: null,
          status: "booked",
          last_outbound_at: new Date().toISOString(),
        });

        reply = `Your appointment has been booked for ${formatSlot(
          pendingBooking.iso
        )}.`;
      } catch (err) {
        console.error("BOOKING ERROR:", err);
        reply =
          "I couldn’t confirm that slot. A team member will follow up shortly.";
      }
    } else if (pendingBooking && isRejection(incoming)) {
      reply = "No problem. Please choose another suggested time.";
    }

    if (!reply && detectBookingIntent(incoming) && config.bookingEnabled) {
      try {
        const events = await getAvailability(business.id);
        const slots = getSuggestedSlots(events, {
          query: incoming,
          bookingStartHour: config.bookingStartHour,
          bookingEndHour: config.bookingEndHour,
          bookingBufferMinutes: config.bookingBufferMinutes,
          timezone: config.timezone,
        });

        if (isTimeSelection(incoming)) {
          const offeredSlots = getLatestOfferedSlots(history);
          const resolvedSlot = resolveSlotFromReply(incoming, offeredSlots);

          if (!resolvedSlot) {
            reply =
              "I couldn’t match that time. Please choose one of the suggested slots exactly as shown.";
          } else {
            const summary = "Service Appointment";

            await saveMessage(
              conversation.id,
              "out",
              "system",
              `PENDING_BOOKING|${new Date(resolvedSlot).toISOString()}|${summary}`
            );

            reply = `Just to confirm, you'd like ${formatSlot(
              resolvedSlot
            )}. Reply YES to confirm or NO to choose another time.`;
          }
        } else {
          if (slots.length > 0) {
            const shown = slots.slice(0, 3);

            await saveMessage(
              conversation.id,
              "out",
              "system",
              `OFFERED_SLOTS|${shown.map((s) => new Date(s).toISOString()).join("|")}`
            );

            reply =
              `We have availability at:\n` +
              shown.map((s) => formatSlot(s)).join("\n") +
              `\n\nReply with a time to book.`;
          } else {
            reply =
              "We don’t currently have any suitable slots showing. A team member will confirm availability shortly.";
          }
        }
      } catch (err) {
        console.error("CALENDAR ERROR:", err);
        reply =
          "I’m checking availability now. A team member will confirm shortly.";
      }
    }

    if (!reply) {
      const systemPrompt = `
You are the AI receptionist for ${business.name}.

Your job:
- Answer questions about services and opening hours.
- Help with normal customer questions.
- Help collect information for bookings or callbacks.
- Be polite, calm, and professional.

Rules:
- Do NOT invent services or pricing.
- If the business info does not clearly confirm something, say a team member will confirm.
- Do NOT confirm exact appointment times unless the system has explicitly confirmed the booking.
- Keep replies under 2 short sentences.
- Tone: ${business.tone || "Professional and concise"}.

Business info:
Services: ${business.services || ""}
Hours: ${business.opening_hours || ""}
Pricing: ${business.pricing_info || ""}
Service area: ${business.service_area || ""}
`;

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: systemPrompt }, ...aiMessages],
          max_tokens: 120,
        });

        reply = completion.choices[0].message.content?.trim();
      } catch (aiError) {
        console.error("AI ERROR:", aiError);
        reply =
          "Thanks for your message. A team member will get back to you shortly.";
      }

      if (!reply) {
        reply =
          "Thanks for your message. A team member will get back to you shortly.";
      }
    }

    await saveMessage(conversation.id, "out", "assistant", reply);

    if (
      conversation.status !== "booked" &&
      !reply.startsWith("Your appointment has been booked")
    ) {
      await updateConversation(conversation.id, {
        awaiting_reply: true,
        next_nudge_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        last_inbound_at: new Date().toISOString(),
        last_outbound_at: new Date().toISOString(),
      });
    }

    await twilioClient.messages.create({
      from: toNumber,
      to: sender,
      body: reply,
    });

    console.log("Reply sent:", reply);
    return res.sendStatus(200);
  } catch (err) {
    console.error("ERROR:", err);

    try {
      await twilioClient.messages.create({
        from: toNumber,
        to: sender,
        body:
          "Thanks for your message. A team member will get back to you shortly.",
      });
    } catch (fallbackErr) {
      console.error("Fallback SMS error:", fallbackErr);
    }

    return res.sendStatus(200);
  }
});

/* ---------------- PROTECTED ADMIN ROUTES ---------------- */

app.post("/admin/business/setup", checkAdmin, async (req, res) => {
  const ALLOWED_FIELDS = [
    "name",
    "services",
    "opening_hours",
    "tone",
    "owner_phone",
    "pricing_info",
    "service_area",
    "average_job_value",
    "urgent_keywords",
    "high_value_keywords",
    "booking_enabled",
    "booking_start_hour",
    "booking_end_hour",
    "booking_buffer_minutes",
  ];

  const updates = {};
  for (const field of ALLOWED_FIELDS) {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No valid fields provided" });
  }

  const { error } = await supabase
    .from("businesses")
    .update(updates)
    .eq("id", req.businessId);

  if (error) {
    console.error("Business setup error:", error);
    return res.status(500).json({ error: "Failed to update business" });
  }

  return res.json({ success: true });
});

app.get("/admin/business/profile", checkAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", req.businessId)
    .single();

  if (error) {
    console.error("Profile fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch profile" });
  }

  return res.json(data);
});

app.get("/admin/conversations/:businessId", checkAdmin, async (req, res) => {
  const { businessId } = req.params;

  try {
    const { data: conversations, error } = await supabase
      .from("conversations")
      .select(
        `
        *,
        customers (
          id,
          phone
        )
      `
      )
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const conversationIds = (conversations || []).map((c) => c.id);
    let messagesByConversation = {};

    if (conversationIds.length > 0) {
      const { data: messages, error: messagesError } = await supabase
        .from("messages")
        .select("*")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: false });

      if (messagesError) throw messagesError;

      for (const msg of messages || []) {
        if (!messagesByConversation[msg.conversation_id]) {
          messagesByConversation[msg.conversation_id] = msg;
        }
      }
    }

    const enriched = (conversations || []).map((conversation) => {
      const lastMessage = messagesByConversation[conversation.id];

      return {
        id: conversation.id,
        status: conversation.status || "open",
        priority: conversation.priority || "normal",
        customer_phone: conversation.customers?.phone || "Unknown",
        last_message_preview: lastMessage
          ? humanizeSystemMessage(lastMessage.content)
          : "",
        last_message_at:
          lastMessage?.created_at ||
          conversation.last_outbound_at ||
          conversation.last_inbound_at ||
          conversation.created_at,
        created_at: conversation.created_at,
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error("CONVERSATIONS ERROR:", err);
    res.status(500).send("Failed to fetch conversations");
  }
});

app.get("/admin/messages/:conversationId", checkAdmin, async (req, res) => {
  const { conversationId } = req.params;

  try {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const transformed = (data || []).map((msg) => ({
      id: msg.id,
      direction: msg.direction,
      role: msg.role,
      content:
        msg.role === "system" ? humanizeSystemMessage(msg.content) : msg.content,
      created_at: msg.created_at,
    }));

    res.json(transformed);
  } catch (err) {
    console.error("MESSAGES ERROR:", err);
    res.status(500).send("Failed to fetch messages");
  }
});

/* ---------------- BUSINESS STATS ---------------- */

app.get("/admin/stats/:businessId", checkAdmin, async (req, res) => {
  const { businessId } = req.params;

  try {
    const { data: conversations, error: conversationsError } = await supabase
      .from("conversations")
      .select("*")
      .eq("business_id", businessId);

    if (conversationsError) throw conversationsError;

    const { data: bookings, error: bookingsError } = await supabase
      .from("messages")
      .select("*, conversations!inner(business_id)")
      .eq("role", "system")
      .like("content", "BOOKING_CONFIRMED%")
      .eq("conversations.business_id", businessId);

    if (bookingsError) throw bookingsError;

    const { data: missedCalls, error: missedCallsError } = await supabase
      .from("messages")
      .select("*, conversations!inner(business_id)")
      .eq("role", "system")
      .eq("content", "MISSED_CALL")
      .eq("conversations.business_id", businessId);

    if (missedCallsError) throw missedCallsError;

    const { data: urgentLeads, error: urgentError } = await supabase
      .from("conversations")
      .select("*")
      .eq("business_id", businessId)
      .eq("priority", "urgent");

    if (urgentError) throw urgentError;

    const { data: highValueLeads, error: highValueError } = await supabase
      .from("conversations")
      .select("*")
      .eq("business_id", businessId)
      .eq("priority", "high_value");

    if (highValueError) throw highValueError;

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("average_job_value")
      .eq("id", businessId)
      .single();

    if (businessError) throw businessError;

    const totalConversations = conversations?.length || 0;
    const totalBookings = bookings?.length || 0;
    const totalMissedCalls = missedCalls?.length || 0;
    const totalUrgent = urgentLeads?.length || 0;
    const totalHighValue = highValueLeads?.length || 0;
    const estimatedRevenue =
      totalBookings * Number(business?.average_job_value || 0);

    res.json({
      conversations: totalConversations,
      bookings: totalBookings,
      missed_calls: totalMissedCalls,
      urgent_leads: totalUrgent,
      high_value_leads: totalHighValue,
      estimated_revenue: estimatedRevenue,
    });
  } catch (err) {
    console.error("STATS ERROR:", err);
    res.status(500).send("Failed to fetch stats");
  }
});

/* ---------------- SERVER ---------------- */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});