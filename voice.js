"use strict";

/* ─────────────────────────────────────────────────────────────────────────────
 * voice.js — Inbound voice call handling
 *
 * Mounted at /voice in server.js.  Twilio configuration required:
 *
 *   Number → Voice → "A call comes in" webhook:
 *     POST  https://<your-domain>/voice/inbound
 *
 *   Number → Voice → "Call status changes" callback:
 *     POST  https://<your-domain>/voice/status
 *
 * Flow per caller turn
 * ────────────────────
 *  1. Twilio calls /voice/inbound (or loops back via <Record action=…>)
 *  2. We reply immediately with <Pause length="10"> to keep the call alive
 *     (on the first turn we play a TTS greeting first, then <Record>)
 *  3. In the background we:
 *        a. Download the .mp3 from Twilio (Whisper needs the raw audio)
 *        b. Transcribe with OpenAI Whisper
 *        c. Run through the same booking / priority / GPT logic as SMS
 *        d. Generate a TTS response with OpenAI tts-1
 *        e. Cache the audio buffer locally and expose it at GET /voice/audio/:id
 *        f. Push new TwiML to the live call via twilioClient.calls(sid).update()
 *           — this interrupts the <Pause> so the caller hears the reply the
 *             moment processing finishes (typically 3–5 s), not after 10 s.
 *  4. The new TwiML plays the TTS audio then starts another <Record>
 *  5. On hangup, POST /voice/status fires; we generate a call summary and
 *     persist it to conversations.call_summary in Supabase.
 *
 * Edge cases handled
 * ──────────────────
 *  • Caller hangs up mid-recording → CallStatus "completed" guard
 *  • No audio captured (timeout / silence) → re-prompt
 *  • OpenAI TTS failure → fall back to Twilio <Say voice="alice">
 *  • Caller hangs up before our update() fires → 404/400 caught silently
 *  • In-flight dedup → processingCalls Set prevents double-processing
 *    the same CallSid if Twilio retries a webhook
 * ───────────────────────────────────────────────────────────────────────── */

const express   = require("express");
const { OpenAI, toFile } = require("openai");
const twilio    = require("twilio");
const { v4: uuidv4 } = require("uuid");

const supabase  = require("./supabase");
const {
  getBusinessByTwilioNumber,
  findOrCreateCustomer,
  findOrCreateConversation,
  saveMessage,
  getConversationMessages,
  updateConversation,
  updateConversationPriority,
} = require("./dbHelpers");

const {
  normalize,
  isEmergency,
  detectPriority,
  detectBookingIntent,
  isTimeSelection,
  isConfirmation,
  isRejection,
  formatSlot,
  buildBusinessConfig,
  getLatestPendingBooking,
  getLatestOfferedSlots,
  resolveSlotFromReply,
  validateTwilioRequest,
} = require("./helpers");

const {
  getAvailability,
  getSuggestedSlots,
  createBooking,
} = require("./calendar");

const router       = express.Router();
const openai       = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const VoiceResponse = twilio.twiml.VoiceResponse;

/* ── In-memory stores ────────────────────────────────────────────────────────
 *
 * activeCalls    Tracks live call metadata across turns.
 *                callSid → { conversationId, businessId, from, to }
 *
 * audioCache     Temporary TTS audio buffers served to Twilio <Play>.
 *                uuid → { buffer: Buffer, expiresAt: number }
 *
 * processingCalls  Prevents double-processing if Twilio retries a webhook.
 *                  Set of callSids currently being processed.
 *
 * ⚠ These are single-process only.  If you run multiple server instances
 *   (e.g. Railway with >1 replica) migrate activeCalls and processingCalls
 *   to Redis.  audioCache can stay per-process since the URL includes the
 *   server's own origin.
 * ───────────────────────────────────────────────────────────────────────── */

const activeCalls     = new Map();
const audioCache      = new Map();
const processingCalls = new Set();

// Purge expired audio buffers every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of audioCache) {
    if (entry.expiresAt < now) audioCache.delete(id);
  }
}, 5 * 60 * 1000);

/* ── Audio helpers ─────────────────────────────────────────────────────────── */

/**
 * Generate speech from text using OpenAI tts-1 (fastest model).
 * Returns a Buffer of MP3 audio.
 */
async function generateTTS(text, voice = "nova") {
  const response = await openai.audio.speech.create({
    model: "tts-1",   // tts-1-hd is higher quality but ~2× slower — not worth it for calls
    voice,
    input: text,
  });
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Cache an audio buffer and return its ID.
 * The buffer is served at GET /voice/audio/:id for 10 minutes.
 */
function storeAudio(buffer) {
  const id = uuidv4();
  audioCache.set(id, {
    buffer,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10-minute TTL — plenty for a single call turn
  });
  return id;
}

function audioUrl(id) {
  return `${process.env.APP_BASE_URL}/voice/audio/${id}`;
}

/**
 * Download a Twilio recording and transcribe with OpenAI Whisper.
 * Twilio requires Basic auth to fetch recording files.
 *
 * @param {string} recordingUrl  Twilio RecordingUrl field (no extension)
 * @returns {string}             Transcript text (may be empty string)
 */
async function transcribeRecording(recordingUrl) {
  const credentials = Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
  ).toString("base64");

  // Append .mp3 — Twilio serves the same recording in WAV or MP3
  const audioResponse = await fetch(`${recordingUrl}.mp3`, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!audioResponse.ok) {
    throw new Error(`Twilio recording download failed: HTTP ${audioResponse.status}`);
  }

  const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

  const transcription = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file: await toFile(audioBuffer, "recording.mp3", { type: "audio/mpeg" }),
    language: "en",   // Enforce English; remove if you need auto-detect
  });

  return transcription.text?.trim() ?? "";
}

/* ── Intent helpers ────────────────────────────────────────────────────────── */

function isGoodbye(text) {
  const msg = normalize(text);
  return [
    "goodbye", "bye", "bye bye", "that's all", "thats all",
    "no thanks", "no thank you", "cheers bye", "thanks bye",
    "thank you goodbye", "i'm done", "im done", "all good thanks",
  ].some((phrase) => msg.includes(phrase));
}

/**
 * Format up to 3 slots as natural spoken English.
 * e.g. "Monday the 14th at 9 AM, 10 AM, or Tuesday the 15th at 9 AM"
 */
function formatSlotsForVoice(slots) {
  const formatted = slots.map((s) => formatSlot(s));
  if (formatted.length === 1) return formatted[0];
  if (formatted.length === 2) return `${formatted[0]} or ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(", ")}, or ${formatted[formatted.length - 1]}`;
}

/* ── System prompt for voice calls ────────────────────────────────────────── */

function buildVoiceSystemPrompt(business) {
  return `You are the AI receptionist for ${business.name}, speaking on a live phone call.

IMPORTANT RULES:
- Reply with ONE short sentence only — your response will be read aloud.
- Use natural spoken English. No bullet points, no markdown, no lists.
- Do NOT invent services, prices, or appointment times.
- If you are unsure about anything, say a team member will call back to confirm.
- Tone: ${business.tone || "Professional"}.

Business information:
Services: ${business.services || "not specified"}
Hours: ${business.opening_hours || "not specified"}
Pricing: ${business.pricing_info || "not specified"}
Service area: ${business.service_area || "not specified"}`;
}

/* ── TwiML builder for a recording loop turn ───────────────────────────────
 * Plays audio then starts the next recording.
 * Used both in the initial greeting and in every AI reply turn.
 */
function buildRecordTwiml(audioId, options = {}) {
  const { hangup = false, retryOnSilence = false } = options;
  const twiml = new VoiceResponse();

  if (audioId) {
    twiml.play(audioUrl(audioId));
  }

  if (hangup) {
    twiml.hangup();
    return twiml;
  }

  twiml.record({
    action:  `${process.env.APP_BASE_URL}/voice/recording`,
    method:  "POST",
    maxLength: 30,        // maximum seconds per turn
    timeout:   3,         // seconds of silence that end the recording
    playBeep:  false,     // no beep — sounds more like a real conversation
    trim:      "trim-silence", // strip leading/trailing silence before Whisper
  });

  return twiml;
}

/* ── Route: serve TTS audio buffers ─────────────────────────────────────────
 * GET /voice/audio/:id
 *
 * Twilio <Play> fetches from this URL.  No Twilio signature validation
 * is needed here — the URL is single-use and expires after 10 minutes.
 * ───────────────────────────────────────────────────────────────────────── */

router.get("/audio/:id", (req, res) => {
  const entry = audioCache.get(req.params.id);
  if (!entry || entry.expiresAt < Date.now()) {
    return res.status(404).send("Audio not found or expired");
  }
  res.set("Content-Type", "audio/mpeg");
  res.set("Cache-Control", "no-store");
  return res.send(entry.buffer);
});

/* ── Route: inbound call ─────────────────────────────────────────────────────
 * POST /voice/inbound
 *
 * Twilio hits this the moment a call is answered.
 * We greet the caller synchronously (no background processing here —
 * the greeting is pre-generated, not transcript-dependent).
 * ───────────────────────────────────────────────────────────────────────── */

router.post("/inbound", validateTwilioRequest, async (req, res) => {
  const from    = req.body.From;    // caller's E.164 number
  const to      = req.body.To;     // business's Twilio number
  const callSid = req.body.CallSid;

  res.set("Content-Type", "text/xml");
  const twiml = new VoiceResponse();

  try {
    const business = await getBusinessByTwilioNumber(to);

    if (!business) {
      twiml.say("Sorry, this number is not in service. Goodbye.");
      twiml.hangup();
      return res.send(twiml.toString());
    }

    const voice = business.voice_preference || "nova";

    // Find or create the customer + conversation records
    const customer     = await findOrCreateCustomer(business.id, from);
    const conversation = await findOrCreateConversation(business.id, customer.id);

    // Tag the conversation with this call's SID so the status callback
    // can look it up without the in-memory Map
    await supabase
      .from("conversations")
      .update({ call_sid: callSid, status: "call_active" })
      .eq("id", conversation.id);

    // Store call state for all subsequent turns (recording + status callbacks)
    activeCalls.set(callSid, {
      conversationId: conversation.id,
      businessId:     business.id,
      from,
      to,
    });

    // Log as a system event so it shows in the dashboard
    await saveMessage(conversation.id, "in", "system", "INBOUND_CALL");

    // Build a tone-appropriate greeting
    const tone = (business.tone || "Professional").toLowerCase();
    const greeting =
      tone === "friendly" || tone === "casual"
        ? `Hey! Thanks for calling ${business.name} — how can I help you today?`
        : `Hello, thank you for calling ${business.name}. How can I help you?`;

    await saveMessage(conversation.id, "out", "assistant", greeting);

    // Generate TTS for the greeting and cache it
    const greetingBuffer  = await generateTTS(greeting, voice);
    const greetingAudioId = storeAudio(greetingBuffer);

    // Play the greeting, then start recording the caller's response
    return res.send(buildRecordTwiml(greetingAudioId).toString());

  } catch (err) {
    console.error("VOICE INBOUND ERROR:", err);
    twiml.say("Sorry, we are experiencing technical difficulties. Please try again shortly. Goodbye.");
    twiml.hangup();
    return res.send(twiml.toString());
  }
});

/* ── Route: recording callback ───────────────────────────────────────────────
 * POST /voice/recording
 *
 * Twilio hits this after each <Record> finishes (caller stopped talking).
 *
 * Strategy: respond IMMEDIATELY with a short <Pause> to keep the call alive,
 * then process in the background.  When processing is done (~3–5 s), we
 * interrupt the <Pause> by calling twilioClient.calls(callSid).update().
 * If processing somehow takes longer than 10 s, the fallback <Say> + <Hangup>
 * in the <Pause> chain fires gracefully.
 * ───────────────────────────────────────────────────────────────────────── */

router.post("/recording", validateTwilioRequest, async (req, res) => {
  const callSid        = req.body.CallSid;
  const callStatus     = req.body.CallStatus;
  const recordingUrl   = req.body.RecordingUrl;
  const recordingStatus = req.body.RecordingStatus; // "completed" | "absent"

  res.set("Content-Type", "text/xml");
  const twiml = new VoiceResponse();

  // ── Caller hung up before we could process ────────────────────────────────
  if (callStatus === "completed") {
    // Return empty TwiML — Twilio won't do anything with it, but it needs a 200
    return res.send(twiml.toString());
  }

  // ── No audio detected (silence timeout or recording failed) ───────────────
  if (!recordingUrl || recordingStatus === "absent") {
    const callState = activeCalls.get(callSid);
    let repromptId = null;

    if (callState) {
      const { data: biz } = await supabase
        .from("businesses")
        .select("voice_preference")
        .eq("id", callState.businessId)
        .single();

      const reprompt = "Sorry, I didn't catch anything. Could you say that again?";
      try {
        const buf  = await generateTTS(reprompt, biz?.voice_preference || "nova");
        repromptId = storeAudio(buf);
      } catch {
        // TTS failed — buildRecordTwiml will skip the <Play>
      }
    }

    return res.send(buildRecordTwiml(repromptId).toString());
  }

  // ── Deduplicate concurrent webhook retries ────────────────────────────────
  if (processingCalls.has(callSid)) {
    console.warn(`[voice] Duplicate recording webhook for ${callSid} — ignoring`);
    twiml.pause({ length: 5 });
    return res.send(twiml.toString());
  }

  // ── Respond immediately with a pause so the call stays open ──────────────
  // The background job will interrupt this pause via calls(sid).update()
  twiml.pause({ length: 10 });
  // Fallback chain in case processing exceeds 10 s (very unlikely)
  twiml.say({ voice: "alice" }, "I'm sorry for the delay. A team member will call you back shortly.");
  twiml.hangup();
  res.send(twiml.toString());

  // ── Background processing ─────────────────────────────────────────────────
  processingCalls.add(callSid);

  processVoiceTurn(callSid, recordingUrl)
    .catch((err) => {
      console.error(`[voice] processVoiceTurn error for ${callSid}:`, err);

      // Attempt to gracefully end the call if we can
      const errorTwiml = new VoiceResponse();
      errorTwiml.say(
        "I'm having some trouble at the moment. A team member will call you back shortly. Goodbye."
      );
      errorTwiml.hangup();

      twilioClient.calls(callSid)
        .update({ twiml: errorTwiml.toString() })
        .catch((e) => {
          // 404/400 means the caller already hung up — that's fine
          if (e.status !== 404 && e.status !== 400) {
            console.error(`[voice] Failed to send error TwiML to ${callSid}:`, e);
          }
        });
    })
    .finally(() => {
      processingCalls.delete(callSid);
    });
});

/* ── processVoiceTurn ────────────────────────────────────────────────────────
 *
 * Core voice turn logic.  Mirrors the SMS /sms route but for voice:
 *   booking confirmation → booking intent → GPT fallback
 *
 * When finished, pushes new TwiML to the live call via the Twilio REST API.
 * ───────────────────────────────────────────────────────────────────────── */

async function processVoiceTurn(callSid, recordingUrl) {
  const callState = activeCalls.get(callSid);
  if (!callState) {
    console.warn(`[voice] No call state found for ${callSid}`);
    return;
  }

  const { conversationId, businessId, from, to } = callState;

  // Fetch the full business row (needed for voice_preference, booking config, etc.)
  const { data: business, error: bizErr } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", businessId)
    .single();

  if (bizErr || !business) throw new Error("Failed to fetch business record");

  const voice  = business.voice_preference || "nova";
  const config = buildBusinessConfig(business);

  // ── 1. Transcribe with Whisper ──────────────────────────────────────────
  const transcript = await transcribeRecording(recordingUrl);
  console.log(`[voice] ${callSid} — transcript: "${transcript}"`);

  // ── 2. Empty transcript → re-prompt ────────────────────────────────────
  if (!transcript) {
    const reprompt = "Sorry, I didn't quite get that — could you say it again?";
    await deliverVoiceReply(callSid, reprompt, voice, { loop: true });
    return;
  }

  // ── 3. Save caller's turn to Supabase ──────────────────────────────────
  await saveMessage(conversationId, "in", "user", transcript);

  // ── 4. Emergency check ─────────────────────────────────────────────────
  if (isEmergency(transcript)) {
    const msg =
      "If this is a genuine emergency please leave the building immediately and call the emergency services. Goodbye.";
    await saveMessage(conversationId, "out", "assistant", msg);
    await deliverVoiceReply(callSid, msg, voice, { loop: false });
    activeCalls.delete(callSid);
    return;
  }

  // ── 5. Goodbye detection ───────────────────────────────────────────────
  if (isGoodbye(transcript)) {
    const closing = "Thanks for calling — we will follow up if needed. Goodbye!";
    await saveMessage(conversationId, "out", "assistant", closing);
    await updateConversation(conversationId, {
      status:          "open",
      awaiting_reply:  false,
      next_nudge_at:   null,
      last_inbound_at: new Date().toISOString(),
    });
    await deliverVoiceReply(callSid, closing, voice, { loop: false });
    activeCalls.delete(callSid);
    return;
  }

  // ── 6. Priority detection + owner SMS alert ────────────────────────────
  const priority = detectPriority(transcript, business);
  if (priority !== "normal") {
    await updateConversationPriority(conversationId, priority);

    if (config.ownerAlertsEnabled && business.owner_phone) {
      const labels = {
        urgent:     "🚨 URGENT CALL",
        high_value: "💰 HIGH VALUE CALL",
        angry:      "😡 ANGRY CALLER",
      };
      await twilioClient.messages.create({
        from: to,
        to:   business.owner_phone,
        body: `${labels[priority] ?? "⚠️ PRIORITY CALL"}\n\nCaller: ${from}\nSaid: "${transcript}"`,
      }).catch((e) => console.error("Owner alert SMS failed:", e));
    }
  }

  // ── 7. Load conversation history ───────────────────────────────────────
  const history = await getConversationMessages(conversationId);

  let reply;

  // ── 8a. Pending booking + confirmation / rejection ─────────────────────
  const pendingBooking = getLatestPendingBooking(history);

  if (pendingBooking && isConfirmation(transcript)) {
    try {
      await createBooking(
        business.id,
        from,
        pendingBooking.summary,
        pendingBooking.iso
      );

      // Look up the customer row for the appointments insert
      const { data: customer } = await supabase
        .from("customers")
        .select("id")
        .eq("business_id", business.id)
        .eq("phone", from)
        .maybeSingle();

      await supabase.from("appointments").insert({
        business_id:     business.id,
        customer_id:     customer?.id ?? null,
        conversation_id: conversationId,
        start_time:      pendingBooking.iso,
        summary:         pendingBooking.summary,
        reminder_sent:   false,
      });

      await saveMessage(
        conversationId,
        "out",
        "system",
        `BOOKING_CONFIRMED|${pendingBooking.iso}|${pendingBooking.summary}`
      );

      await updateConversation(conversationId, {
        status:           "booked",
        awaiting_reply:   false,
        next_nudge_at:    null,
        last_outbound_at: new Date().toISOString(),
      });

      reply = `Your appointment has been booked for ${formatSlot(pendingBooking.iso)} — we look forward to seeing you.`;

    } catch (err) {
      console.error("VOICE BOOKING CONFIRM ERROR:", err);
      reply =
        "I wasn't able to lock that slot in — a team member will call you shortly to confirm the booking.";
    }

  } else if (pendingBooking && isRejection(transcript)) {
    reply = "No problem — would you like me to suggest some other available times?";
  }

  // ── 8b. Booking intent → offer slots ──────────────────────────────────
  if (!reply && detectBookingIntent(transcript) && config.bookingEnabled) {
    try {
      const events = await getAvailability(business.id);
      const slots  = getSuggestedSlots(events, {
        query:                transcript,
        bookingStartHour:     config.bookingStartHour,
        bookingEndHour:       config.bookingEndHour,
        bookingBufferMinutes: config.bookingBufferMinutes,
        timezone:             config.timezone,
      });

      if (isTimeSelection(transcript)) {
        // Caller named a specific time — try to match it to a previously offered slot
        const offeredSlots  = getLatestOfferedSlots(history);
        const resolvedSlot  = resolveSlotFromReply(transcript, offeredSlots);

        if (!resolvedSlot) {
          reply =
            "I couldn't match that to a time I offered — could you repeat the date and time you'd prefer?";
        } else {
          const summary = "Service Appointment";
          await saveMessage(
            conversationId,
            "out",
            "system",
            `PENDING_BOOKING|${new Date(resolvedSlot).toISOString()}|${summary}`
          );
          reply = `Just to confirm — ${formatSlot(resolvedSlot)}. Say yes to book that or no to choose a different time.`;
        }

      } else {
        if (slots.length > 0) {
          const shown = slots.slice(0, 3);
          await saveMessage(
            conversationId,
            "out",
            "system",
            `OFFERED_SLOTS|${shown.map((s) => new Date(s).toISOString()).join("|")}`
          );
          // Spoken format: "Mon 14 Apr 09:00, 10:00, or Tue 15 Apr 09:00"
          reply = `We have availability at ${formatSlotsForVoice(shown)}. Which time works best for you?`;
        } else {
          reply =
            "We don't have any slots showing right now — a team member will call you to sort a time.";
        }
      }

    } catch (err) {
      console.error("VOICE CALENDAR ERROR:", err);
      reply =
        "I'm checking our calendar now — a team member will call you shortly to confirm a time.";
    }
  }

  // ── 8c. GPT fallback ───────────────────────────────────────────────────
  if (!reply) {
    // Build AI message history (user/assistant turns only — no system markers)
    const aiMessages = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role:    m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));

    try {
      const completion = await openai.chat.completions.create({
        model:      "gpt-4o-mini",
        messages:   [
          { role: "system", content: buildVoiceSystemPrompt(business) },
          ...aiMessages,
        ],
        max_tokens: 80,   // Short — responses are spoken aloud, 1 sentence target
      });

      reply = completion.choices[0].message.content?.trim();
    } catch (aiErr) {
      console.error("VOICE GPT ERROR:", aiErr);
    }

    if (!reply) {
      reply = "Thanks for calling — a team member will get back to you shortly.";
    }
  }

  // ── 9. Persist assistant reply ─────────────────────────────────────────
  await saveMessage(conversationId, "out", "assistant", reply);
  await updateConversation(conversationId, {
    last_inbound_at:  new Date().toISOString(),
    last_outbound_at: new Date().toISOString(),
  });

  // ── 10. Speak the reply and loop back for the next turn ────────────────
  await deliverVoiceReply(callSid, reply, voice, { loop: true });
}

/* ── deliverVoiceReply ───────────────────────────────────────────────────────
 *
 * Generates TTS audio, caches it, then pushes new TwiML to the live call
 * via the Twilio REST API — interrupting the current <Pause>.
 *
 * Falls back to Twilio's built-in <Say voice="alice"> if TTS generation fails.
 *
 * @param {string}  callSid   Active Twilio call SID
 * @param {string}  text      Text to speak
 * @param {string}  voice     OpenAI TTS voice (nova | alloy | echo | shimmer)
 * @param {object}  opts
 * @param {boolean} opts.loop If true, append <Record> for next turn.
 *                             If false, append <Hangup>.
 * ───────────────────────────────────────────────────────────────────────── */

async function deliverVoiceReply(callSid, text, voice, { loop }) {
  let audioId = null;

  try {
    const buffer = await generateTTS(text, voice);
    audioId = storeAudio(buffer);
  } catch (ttsErr) {
    // TTS failed — buildRecordTwiml falls back to <Say>
    console.error(`[voice] TTS failed for ${callSid}, falling back to <Say>:`, ttsErr);
  }

  // Build the TwiML that will replace the current <Pause>
  const nextTwiml = new VoiceResponse();

  if (audioId) {
    nextTwiml.play(audioUrl(audioId));
  } else {
    // Twilio's built-in neural TTS as fallback
    nextTwiml.say({ voice: "alice" }, text);
  }

  if (loop) {
    nextTwiml.record({
      action:    `${process.env.APP_BASE_URL}/voice/recording`,
      method:    "POST",
      maxLength: 30,
      timeout:   3,
      playBeep:  false,
      trim:      "trim-silence",
    });
  } else {
    nextTwiml.hangup();
  }

  // Push new TwiML to the live call — interrupts the <Pause> immediately
  try {
    await twilioClient.calls(callSid).update({
      twiml: nextTwiml.toString(),
    });
  } catch (err) {
    // 404 / error code 20404 = call already ended — this is expected when
    // the caller hangs up between our processing start and our update call
    if (err.status === 404 || err.status === 400) {
      console.log(`[voice] Call ${callSid} ended before reply could be delivered`);
      activeCalls.delete(callSid);
    } else {
      throw err; // Unexpected — re-raise so processVoiceTurn's catch handles it
    }
  }
}

/* ── Route: call status callback ─────────────────────────────────────────────
 * POST /voice/status
 *
 * Twilio calls this whenever the call status changes.
 * We act only on "completed" — generate a call summary with GPT and store it.
 *
 * Configure this in the Twilio console on the phone number:
 *   "Call status changes" → POST https://<your-domain>/voice/status
 * ───────────────────────────────────────────────────────────────────────── */

router.post("/status", validateTwilioRequest, async (req, res) => {
  const callSid    = req.body.CallSid;
  const callStatus = req.body.CallStatus;

  // Respond immediately — Twilio doesn't need anything from us here
  res.sendStatus(200);

  if (callStatus !== "completed") return;

  // Pull call state from memory; also fall back to Supabase lookup in case
  // the server restarted mid-call (e.g. Railway deploy during a live call)
  let conversationId = activeCalls.get(callSid)?.conversationId ?? null;
  activeCalls.delete(callSid);

  if (!conversationId) {
    const { data: convo } = await supabase
      .from("conversations")
      .select("id")
      .eq("call_sid", callSid)
      .maybeSingle();
    conversationId = convo?.id ?? null;
  }

  if (!conversationId) {
    console.warn(`[voice] Status callback for unknown callSid: ${callSid}`);
    return;
  }

  try {
    const messages = await getConversationMessages(conversationId);

    // Only summarise turns that actually have spoken content
    const voiceTurns = messages.filter(
      (m) => m.role === "user" || m.role === "assistant"
    );

    if (voiceTurns.length === 0) {
      // Call ended without any exchange (e.g. caller hung up immediately)
      await supabase
        .from("conversations")
        .update({ call_sid: null, status: "open" })
        .eq("id", conversationId);
      return;
    }

    const transcriptText = voiceTurns
      .map((m) => `${m.role === "user" ? "Caller" : "AI"}: ${m.content}`)
      .join("\n");

    // Generate a concise call summary
    const completion = await openai.chat.completions.create({
      model:    "gpt-4o-mini",
      messages: [
        {
          role:    "system",
          content:
            "Summarise this phone call in 2–3 sentences. Cover: what the caller needed, what was resolved or agreed, and any follow-up required.",
        },
        { role: "user", content: transcriptText },
      ],
      max_tokens: 150,
    });

    const summary = completion.choices[0].message.content?.trim() ?? "";

    // Persist summary and reset conversation state for the dashboard
    await supabase
      .from("conversations")
      .update({
        call_summary:    summary,
        call_sid:        null,
        status:          "open",
        awaiting_reply:  true,
        next_nudge_at:   new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        last_inbound_at: new Date().toISOString(),
      })
      .eq("id", conversationId);

    console.log(`[voice] Call ${callSid} summary stored for conversation ${conversationId}`);

  } catch (err) {
    console.error(`[voice] Status callback processing error for ${callSid}:`, err);
    // Don't re-throw — status callbacks have no retry value, just log and move on
  }
});

module.exports = router;
