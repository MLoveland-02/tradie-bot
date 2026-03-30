require("dotenv").config();

const supabase = require("./supabase");
const twilio = require("twilio");

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function runNudgeCheck() {
  const now = new Date().toISOString();

  const { data: conversations, error } = await supabase
    .from("conversations")
    .select(`
      id,
      awaiting_reply,
      next_nudge_at,
      customers(phone),
      businesses(twilio_number)
    `)
    .eq("awaiting_reply", true)
    .lte("next_nudge_at", now);

  if (error) {
    console.error("Nudge query error:", error);
    return;
  }

  for (const convo of conversations) {
    try {
      const customerPhone = convo.customers.phone;
      const twilioNumber = convo.businesses.twilio_number;

      const message =
        "Just checking in — did you still need help with this?";

      await twilioClient.messages.create({
        from: twilioNumber,
        to: customerPhone,
        body: message,
      });

      await supabase
        .from("conversations")
        .update({
          awaiting_reply: false,
          next_nudge_at: null,
        })
        .eq("id", convo.id);

      console.log("Nudge sent to", customerPhone);

    } catch (err) {
      console.error("Nudge error:", err);
    }
  }
}

async function runReminderCheck() {
  const now = new Date();
  const reminderWindow = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

  const { data: appointments, error } = await supabase
    .from("appointments")
    .select(`
      id,
      start_time,
      reminder_sent,
      customers(phone),
      businesses(twilio_number)
    `)
    .eq("reminder_sent", false)
    .lte("start_time", reminderWindow);

  if (error) {
    console.error("Reminder query error:", error);
    return;
  }

  for (const appt of appointments) {
    try {
      const customerPhone = appt.customers.phone;
      const twilioNumber = appt.businesses.twilio_number;

      const message =
        "Reminder: you have an appointment scheduled today. Reply if you need to reschedule.";

      await twilioClient.messages.create({
        from: twilioNumber,
        to: customerPhone,
        body: message,
      });

      await supabase
        .from("appointments")
        .update({ reminder_sent: true })
        .eq("id", appt.id);

      console.log("Reminder sent to", customerPhone);

    } catch (err) {
      console.error("Reminder error:", err);
    }
  }
}

async function workerLoop() {
  console.log("Worker running...");

  await runNudgeCheck();
  await runReminderCheck();
}

setInterval(workerLoop, 60000);