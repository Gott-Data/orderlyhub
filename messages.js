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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-admin-key");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // ── GET: Fetch messages for an order ──
    if (req.method === "GET") {
      const { order_id } = req.query;
      if (!order_id) return res.status(400).json({ error: "order_id required" });

      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("order_id", order_id.toUpperCase())
        .order("created_at", { ascending: true });

      return res.json(data || []);
    }

    // ── POST: Send a message ──
    if (req.method === "POST") {
      const { order_id, text, sender } = req.body;

      if (!order_id || !text) {
        return res.status(400).json({ error: "order_id and text required" });
      }

      // If sender is "team", require admin key
      const isAdmin = req.headers["x-admin-key"] === process.env.ADMIN_KEY;
      const actualSender = isAdmin && sender === "team" ? "team" : "customer";

      // Verify order exists
      const { data: order } = await supabase
        .from("orders")
        .select("*")
        .eq("id", order_id.toUpperCase())
        .single();

      if (!order) return res.status(404).json({ error: "Order not found" });

      // Insert message
      const { data: msg, error } = await supabase
        .from("messages")
        .insert({ order_id: order.id, sender: actualSender, text })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });

      // Route message via WhatsApp
      if (actualSender === "customer") {
        // Notify team that customer sent a message
        if (TEAM_PHONE) {
          sendWhatsApp(TEAM_PHONE, `💬 *${order.id}* — ${order.customer}:\n"${text}"`);
        }
      } else if (actualSender === "team") {
        // Send team's reply to customer via WhatsApp
        sendWhatsApp(order.phone, text);
      }

      return res.status(201).json(msg);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Messages API error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
