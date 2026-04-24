import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const WA_PHONE_ID = process.env.WA_PHONE_NUMBER_ID;
const WA_TOKEN = process.env.WA_ACCESS_TOKEN;
const TEAM_PHONE = process.env.TEAM_PHONE;

async function sendWhatsApp(to, body) {
  if (!WA_TOKEN || !WA_PHONE_ID) return;
  try {
    await fetch(
      `https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WA_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: to.replace(/[^0-9]/g, ""),
          type: "text",
          text: { body },
        }),
      }
    );
  } catch (e) {
    console.error("[WA] Send failed:", e.message);
  }
}

export default async function handler(req, res) {
  // ── GET: Meta webhook verification ──
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.WA_VERIFY_TOKEN) {
      console.log("[WA] Webhook verified");
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  // ── POST: Incoming WhatsApp messages ──
  if (req.method === "POST") {
    // Always respond 200 fast (Meta requires this)
    res.status(200).send("OK");

    try {
      const entry = req.body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (!value?.messages) return;

      for (const message of value.messages) {
        const from = message.from; // Customer's phone
        const text = message.text?.body;
        const contactName = value.contacts?.[0]?.profile?.name || "Customer";

        if (!text) continue;

        console.log(`[WA] From ${contactName} (${from}): ${text}`);

        // Try to match by order ID in message
        let order = null;
        const idMatch = text.match(/ORD-\d+/i);
        if (idMatch) {
          const { data } = await supabase
            .from("orders")
            .select("*")
            .eq("id", idMatch[0].toUpperCase())
            .single();
          order = data;
        }

        // Otherwise match by phone (most recent order)
        if (!order) {
          // Normalize phone: strip everything except digits
          const cleanPhone = from.replace(/[^0-9]/g, "");
          const { data } = await supabase
            .from("orders")
            .select("*")
            .or(`phone.like.%${cleanPhone.slice(-9)}%`)
            .order("created_at", { ascending: false })
            .limit(1);

          order = data?.[0];
        }

        if (order) {
          // Save message to DB
          await supabase.from("messages").insert({
            order_id: order.id,
            sender: "customer",
            text,
          });

          // Notify team
          if (TEAM_PHONE) {
            sendWhatsApp(
              TEAM_PHONE,
              `💬 *${order.id}* — ${contactName}:\n"${text}"`
            );
          }
        } else {
          // No matching order — welcome message
          sendWhatsApp(
            from,
            `👋 Hi ${contactName}! Thanks for reaching out.\n\nTo place an order, visit our website. Or send your order details here and we'll get back to you!`
          );

          if (TEAM_PHONE) {
            sendWhatsApp(
              TEAM_PHONE,
              `📩 *New inquiry* from ${contactName} (+${from}):\n"${text}"\n\nNo matching order found.`
            );
          }
        }
      }
    } catch (err) {
      console.error("[WA] Webhook error:", err);
    }
    return;
  }

  return res.status(405).send("Method not allowed");
}
