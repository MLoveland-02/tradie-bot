const supabase = require("./supabase");

// Get business by Twilio number
async function getBusinessByTwilioNumber(twilioNumber) {
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("twilio_number", twilioNumber)
    .single();

  if (error) throw error;
  return data;
}

// Find or create customer
async function findOrCreateCustomer(businessId, phone) {
  const { data: existing, error: fetchError } = await supabase
    .from("customers")
    .select("*")
    .eq("business_id", businessId)
    .eq("phone", phone)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (existing) return existing;

  const { data: created, error: createError } = await supabase
    .from("customers")
    .insert({
      business_id: businessId,
      phone: phone,
    })
    .select()
    .single();

  if (createError) throw createError;
  return created;
}

// Find or create conversation — returns the most recent conversation for this
// customer regardless of status so returning customers aren't treated as new
async function findOrCreateConversation(businessId, customerId) {
  const { data: existing, error: fetchError } = await supabase
    .from("conversations")
    .select("*")
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (existing) return existing;

  const { data: created, error: createError } = await supabase
    .from("conversations")
    .insert({
      business_id: businessId,
      customer_id: customerId,
      status: "open",
      ai_enabled: true,
      priority: "normal",
    })
    .select()
    .single();

  if (createError) throw createError;
  return created;
}

// Save message
async function saveMessage(conversationId, direction, role, content) {
  const { error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      direction: direction,
      role: role,
      content: content,
    });

  if (error) throw error;
}

// Get message history
async function getConversationMessages(conversationId) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

// Update conversation timestamps / nudge state
async function updateConversation(conversationId, updates) {
  const { error } = await supabase
    .from("conversations")
    .update(updates)
    .eq("id", conversationId);

  if (error) throw error;
}

async function updateConversationPriority(conversationId, priority) {
  const { error } = await supabase
    .from("conversations")
    .update({ priority })
    .eq("id", conversationId);

  if (error) throw error;
}

module.exports = {
  getBusinessByTwilioNumber,
  findOrCreateCustomer,
  findOrCreateConversation,
  saveMessage,
  getConversationMessages,
  updateConversation,
  updateConversationPriority,
};