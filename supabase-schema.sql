-- ═══════════════════════════════════════════════════════
-- OrderlyHub — Supabase Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- ═══════════════════════════════════════════════════════

-- Orders table
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  customer TEXT NOT NULL,
  phone TEXT NOT NULL,
  items TEXT NOT NULL,
  address TEXT NOT NULL,
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'new' CHECK (status IN ('new','confirmed','picked_up','in_transit','delivered')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Messages table (chat between customer and team)
CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('customer','team','system')),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast message lookups
CREATE INDEX idx_messages_order ON messages(order_id, created_at);

-- Index for phone lookups (matching WhatsApp messages to orders)
CREATE INDEX idx_orders_phone ON orders(phone);

-- Auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ═══════════════════════════════════════════════════════
-- Row Level Security
-- The API uses the service_role key, so RLS doesn't
-- block it. But we enable it as a safety net.
-- ═══════════════════════════════════════════════════════

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS. These policies are for
-- the anon key (not used in our setup, but safe default).
CREATE POLICY "Service role full access" ON orders FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON messages FOR ALL
  USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════
-- Enable Realtime (for admin dashboard live updates)
-- ═══════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
