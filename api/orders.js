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

function genId() {
  return "ORD-" + Math.floor(1000 + Math.random() * 9000);
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-admin-key");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // ── GET: Fetch order(s) ──
    if (req.method === "GET") {
      const { id } = req.query;

      // Single order lookup (customer)
      if (id) {
        const { data: order, error } = await supabase
          .from("orders")
          .select("*")
          .eq("id", id.toUpperCase())
          .single();

        if (error || !order) return res.status(404).json({ error: "Order not found" });

        // Attach messages
        const { data: messages } = await supabase
          .from("messages")
          .select("*")
          .eq("order_id", order.id)
          .order("created_at", { ascending: true });

        return res.json({ ...order, messages: messages || [] });
      }

      // List all orders (admin only)
      const adminKey = req.headers["x-admin-key"];
      if (adminKey !== process.env.ADMIN_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { data: orders } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

      // Attach messages to each order
      const ids = (orders || []).map((o) => o.id);
      const { data: allMsgs } = await supabase
        .from("messages")
        .select("*")
        .in("order_id", ids)
        .order("created_at", { ascending: true });

      const msgMap = {};
      (allMsgs || []).forEach((m) => {
        if (!msgMap[m.order_id]) msgMap[m.order_id] = [];
        msgMap[m.order_id].push(m);
      });

      const result = (orders || []).map((o) => ({
        ...o,
        messages: msgMap[o.id] || [],
      }));

      return res.json(result);
    }

    // ── POST: Create order ──
    if (req.method === "POST") {
      const { customer, phone, items, address, notes } = req.body;

      if (!customer || !phone || !items || !address) {
        return res.status(400).json({ error: "Missing required fields: customer, phone, items, address" });
      }

      const id = genId();
      const { data: order, error } = await supabase
        .from("orders")
        .insert({ id, customer, phone, items, address, notes: notes || "" })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });

      // System message
      await supabase.from("messages").insert({
        order_id: id,
        sender: "system",
        text: "Order received! We'll confirm shortly.",
      });

      // WhatsApp confirmation to customer
      sendWhatsApp(
        phone,
        `✅ *Order ${id} Received!*\n\nHi ${customer}, we got your order:\n📦 ${items}\n📍 ${address}\n\nWe'll confirm shortly. Reply here anytime to chat with us!`
      );

      // Notify team
      if (TEAM_PHONE) {
        sendWhatsApp(
          TEAM_PHONE,
          `🆕 *New Order: ${id}*\n👤 ${customer} (${phone})\n📦 ${items}\n📍 ${address}${notes ? "\n📝 " + notes : ""}`
        );
      }

      // Return order with messages
      const { data: messages } = await supabase
        .from("messages")
        .select("*")
        .eq("order_id", id)
        .order("created_at", { ascending: true });

      return res.status(201).json({ ...order, messages: messages || [] });
    }

    // ── PATCH: Update status (admin) ──
    if (req.method === "PATCH") {
      const adminKey = req.headers["x-admin-key"];
      if (adminKey !== process.env.ADMIN_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { id, status } = req.body;
      const validStatuses = ["new", "confirmed", "picked_up", "in_transit", "delivered"];
      const statusLabels = {
        confirmed: "Confirmed",
        picked_up: "Picked Up",
        in_transit: "On the Way",
        delivered: "Delivered",
      };
      const statusEmoji = {
        confirmed: "✅",
        picked_up: "📦",
        in_transit: "🛵",
        delivered: "🎉",
      };

      if (!id || !validStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid id or status" });
      }

      const { data: order, error } = await supabase
        .from("orders")
        .update({ status })
        .eq("id", id)
        .select()
        .single();

      if (error || !order) return res.status(404).json({ error: "Order not found" });

      // System message
      await supabase.from("messages").insert({
        order_id: id,
        sender: "system",
        text: `Status updated → ${statusLabels[status] || status}`,
      });

      // WhatsApp notification to customer
      sendWhatsApp(
        order.phone,
        `${statusEmoji[status] || "📋"} *Order ${id} Update*\n\nStatus: *${statusLabels[status] || status}*${
          status === "delivered"
            ? "\n\nThank you for your order! 💛"
            : "\n\nWe'll keep you posted!"
        }`
      );

      return res.json(order);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
