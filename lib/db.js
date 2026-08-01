/* =============================================================================
 * lib/db.js — SQLite data layer for the CRM.
 *
 * Replaces the flat JSON-file persistence with a transactional SQLite store.
 * The two audit-critical tables — shipment_events and audit_log — are
 * APPEND-ONLY by design: no UPDATE/DELETE statements exist for them anywhere
 * in the codebase, which guarantees shipment history can never be overwritten.
 *
 * Backward compatibility: on first boot, if the legacy JSON files (orders.json,
 * settings.json, products.json) exist, their contents are imported once and the
 * files renamed to *.legacy. SQLite then becomes the sole source of truth.
 * ========================================================================== */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

/* The database location is configurable so it can live OUTSIDE the application
 * directory. This matters in two places:
 *   - Production: a container's app directory is usually ephemeral, so the
 *     default path loses every order on redeploy. Point CRM_DB_PATH at a
 *     mounted persistent disk (e.g. /var/data/crm.db on Render).
 *   - Tests: each run gets its own throwaway file, so tests can never touch
 *     real data.
 * Defaults to the original in-repo path, so existing deployments are
 * completely unaffected until the variable is set. */
const DATA_DIR = process.env.CRM_DATA_DIR || path.join(__dirname, '..');
const DB_PATH = process.env.CRM_DB_PATH || path.join(DATA_DIR, 'crm.db');
const LEGACY = {
  orders:   path.join(DATA_DIR, 'orders.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  products: path.join(DATA_DIR, 'products.json'),
};

// Create the directory when CRM_DB_PATH points somewhere that doesn't exist
// yet (first boot against a freshly mounted disk).
try {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
} catch (e) {
  console.error('[db] could not create data directory for ' + DB_PATH + ': ' + e.message);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');       // concurrent readers + single writer, no corruption
db.pragma('foreign_keys = ON');

/* ---------------------------------------------------------------------------
 * Schema. Idempotent — uses CREATE TABLE IF NOT EXISTS.
 * JSON columns store structured/nested objects (line_items, variants, raw
 * webhook payloads). Dates are epoch-ms (matches the existing createdAt style).
 * ------------------------------------------------------------------------- */
db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,
  shopifyId       TEXT,
  shopifyName     TEXT,
  client          TEXT,
  phone           TEXT,
  city            TEXT,
  wilaya          TEXT,
  commune         TEXT,
  lineItems       TEXT,            -- JSON
  product         TEXT,
  productVariant  TEXT,
  quantity        INTEGER,
  unitPrice       REAL,
  price           REAL,
  subtotal        REAL,
  discount        REAL,
  shippingCost    REAL,
  agent           TEXT,
  delivery        TEXT,            -- provider CODE (legacy field name kept)
  deliveryMethod  TEXT,
  expressDelivery INTEGER,
  status          TEXT,
  deliveryStatus  TEXT,
  trackingNumber  TEXT,
  managerNote     TEXT,
  shippingNote    TEXT,
  note            TEXT,
  source          TEXT,
  marketer        TEXT,
  storeId         TEXT,
  providerId      TEXT,
  shipmentId      TEXT,
  pendingCallStart INTEGER,
  createdAt       INTEGER,
  shopifyCreatedAt TEXT,
  updatedAt       INTEGER
);

CREATE TABLE IF NOT EXISTS order_calls (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId        TEXT NOT NULL,
  time           INTEGER,
  callStartTime  INTEGER,
  duration       INTEGER,
  threshold      INTEGER,
  suspicious     INTEGER,           -- 0/1/null
  result         TEXT,
  note           TEXT,
  agent          TEXT,
  FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agents (
  name TEXT PRIMARY KEY,
  pass TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  sku         TEXT,
  description TEXT,
  price       REAL,
  variants    TEXT,                 -- JSON [{name,image}]
  image       TEXT,                 -- product-level image, used when there are
                                     -- no variants (or a variant has no image
                                     -- of its own) — previously images only
                                     -- existed per-variant, so a product with
                                     -- zero variants had no way to have an image.
  stock       INTEGER,
  createdAt   INTEGER
);

CREATE TABLE IF NOT EXISTS stores (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  platform       TEXT,              -- shopify | lightfunnels | justsell | ayor | woocommerce | ecwid | magento | bigcommerce | custom
  brand          TEXT,
  credentials    TEXT,              -- JSON (legacy, kept for back-compat)
  webhookConfig  TEXT,              -- JSON (legacy, kept for back-compat)
  apiUrl         TEXT,
  apiKey         TEXT,
  apiSecret      TEXT,
  webhookSecret  TEXT,
  webhookEndpoint TEXT,             -- generated inbound endpoint, e.g. /webhook/store/<id>
  apiEnabled     INTEGER DEFAULT 1,
  webhookEnabled INTEGER DEFAULT 1,
  lastTestAt     INTEGER,
  active         INTEGER DEFAULT 1,
  createdAt      INTEGER
);

/* =============================================================================
 * product_links — one CRM product can be sold on SEVERAL external store
 * listings at once (two different Shopify stores, Shopify + LightFunnels,
 * etc.). Each row is ONE (store, external product) pairing pointing back at
 * ONE crm product — a many-links-to-one-product relationship, never the
 * other way around. This is purely ADDITIVE: manually-created products keep
 * working exactly as before via name matching; a link is just an extra,
 * more precise way to find the SAME product when one exists.
 * storeId is nullable — null means "the single/primary Shopify integration"
 * (the existing /webhook/shopify endpoint has no per-store identity yet;
 * proper multi-Shopify-store routing would need shop-domain identification,
 * which is a separate, not-yet-built piece). storeId is populated when a
 * link comes through the generic multi-store /webhook/store/:id path.
 * ========================================================================== */
CREATE TABLE IF NOT EXISTS product_links (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  productId         TEXT NOT NULL,
  storeId           TEXT,
  platform          TEXT NOT NULL,     -- shopify | lightfunnels | ... — always set, even when storeId is null
  externalProductId TEXT NOT NULL,
  externalVariantId TEXT,
  createdAt         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_product_links_lookup
  ON product_links(platform, storeId, externalProductId);
CREATE INDEX IF NOT EXISTS idx_product_links_product
  ON product_links(productId);

/* =============================================================================
 * unexpected_charges — one-off, dated expenses for the profit calculator.
 * Deliberately separate from the recurring monthly fixedCosts setting: a
 * fixed cost (rent, salaries) applies to every period and gets prorated by
 * day-count; an unexpected charge (e.g. a one-time van repair) happened on
 * ONE specific date and only counts toward a profit calculation whose date
 * range includes that date.
 * ========================================================================== */
CREATE TABLE IF NOT EXISTS unexpected_charges (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  label     TEXT NOT NULL,
  amount    REAL NOT NULL,
  date      INTEGER NOT NULL,   -- the day the expense actually happened (ms epoch)
  createdAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_unexpected_charges_date ON unexpected_charges(date);

/* =============================================================================
 * push_subscriptions — one row per (agent, device) Web Push subscription.
 * An agent can have more than one (phone + laptop, or reinstalled the PWA),
 * so this is NOT unique per agent — all matching rows get a push on each
 * event. endpoint is unique per browser/device subscription.
 * ========================================================================== */
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  agent     TEXT NOT NULL,
  endpoint  TEXT NOT NULL UNIQUE,
  p256dh    TEXT NOT NULL,
  auth      TEXT NOT NULL,
  createdAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_agent ON push_subscriptions(agent);

CREATE TABLE IF NOT EXISTS providers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  code         TEXT UNIQUE,         -- short stable token, e.g. "zr", "ecom", "yalidine"
  adapter      TEXT,                -- adapter key: mock | zr-webhook | generic | future carrier keys
  apiUrl       TEXT,                -- API Base URL
  apiKey       TEXT,
  secretKey    TEXT,
  webhookUrl   TEXT,                -- where the carrier pushes updates TO us (inbound)
  webhookSecret TEXT,               -- shared secret to verify inbound webhooks
  trackingEndpoint   TEXT,          -- sub-path for GET tracking
  shipmentEndpoint   TEXT,          -- sub-path for POST create shipment
  statusEndpoint     TEXT,          -- sub-path for GET status list / map
  customFields TEXT,                -- JSON
  apiEnabled     INTEGER DEFAULT 1,
  webhookEnabled INTEGER DEFAULT 1,
  lastSyncAt     INTEGER,
  lastTestAt     INTEGER,
  lastTestOk     INTEGER,
  isDefault    INTEGER DEFAULT 0,
  active       INTEGER DEFAULT 1,
  createdAt    INTEGER
);

-- Status mapping: provider-native status string <-> CRM status. The ORIGINAL
-- provider status is always preserved (on shipment_events too), so it is never
-- lost. One row per (provider, originalStatus).
CREATE TABLE IF NOT EXISTS status_mappings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  providerId     TEXT,
  originalStatus TEXT,
  crmStatus      TEXT,
  UNIQUE (providerId, originalStatus)
);
CREATE INDEX IF NOT EXISTS idx_status_mappings_provider ON status_mappings(providerId);

-- Provider/store integration log (append-only). Records every API call,
-- webhook, sync, and auth/sync error with request/response context.
CREATE TABLE IF NOT EXISTS integration_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity      TEXT,                -- provider | store
  entityId    TEXT,
  event       TEXT,                -- shipment_created | shipment_updated | webhook_received | api_request | api_response | auth_error | sync_error | test_connection | manual_sync
  result      TEXT,                -- success | failure
  message     TEXT,
  request     TEXT,                -- JSON (method, url, body summary)
  response    TEXT,                -- JSON (status, body summary)
  ts          INTEGER DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_integration_logs_entity ON integration_logs(entity, entityId, ts);

CREATE TABLE IF NOT EXISTS shipments (
  id                  TEXT PRIMARY KEY,
  orderId             TEXT NOT NULL,
  providerId          TEXT,
  trackingNumber      TEXT,
  providerShipmentId  TEXT,
  providerReference   TEXT,
  crmStatus           TEXT,
  originalStatus      TEXT,
  labelUrl            TEXT,
  raw                 TEXT,         -- JSON of the provider's createShipment response
  createdAt           INTEGER,
  updatedAt           INTEGER,
  FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE
);

-- APPEND-ONLY shipment event log. No UPDATE/DELETE path exists for this table.
CREATE TABLE IF NOT EXISTS shipment_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  shipmentId     TEXT NOT NULL,
  eventTime      INTEGER,           -- when the event happened at the provider
  originalStatus TEXT,              -- exactly what the provider reported
  crmStatus      TEXT,              -- normalized CRM status
  description    TEXT,
  raw            TEXT,              -- JSON
  insertedAt     INTEGER DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  FOREIGN KEY (shipmentId) REFERENCES shipments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_shipment_events_shipment ON shipment_events(shipmentId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_events_dedupe
  ON shipment_events(shipmentId, eventTime, originalStatus);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT,
  title       TEXT,
  body        TEXT,
  orderId     TEXT,
  shipmentId  TEXT,
  read        INTEGER DEFAULT 0,
  createdAt   INTEGER DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read, createdAt);

-- APPEND-ONLY audit log. No UPDATE/DELETE path exists.
CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  entity    TEXT,          -- order | shipment | provider | store | ai_provider | ai_agent
  entityId  TEXT,
  action    TEXT,
  actor     TEXT,
  payload   TEXT,          -- JSON
  ts        INTEGER DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);

-- ============================================================================
-- AI PLATFORM — provider registry, agent configs, conversation history.
-- Mirrors the providers/stores shape so the AI layer reads exactly like the
-- delivery/store integrations do. No model is hardcoded anywhere: each row in
-- ai_providers points at a generic adapter (openai-compat | gemini | anthropic)
-- plus connection details. Adding a new model = adding a provider row, never
-- touching the CRM core.
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_providers (
  id            TEXT PRIMARY KEY,
  name          TEXT,
  type          TEXT,          -- openai-compat | gemini | anthropic
  baseUrl       TEXT,
  apiKey        TEXT,          -- masked on read (rowToAiProvider), never returned to the client
  defaultModel  TEXT,
  temperature   REAL DEFAULT 0.7,
  maxTokens     INTEGER DEFAULT 2048,
  timeoutMs     INTEGER DEFAULT 30000,
  active        INTEGER DEFAULT 1,
  isDefault     INTEGER DEFAULT 0,
  lastTestAt    INTEGER,
  lastTestOk    INTEGER,
  createdAt     INTEGER DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_ai_providers_default ON ai_providers(isDefault, active);

-- An AI Agent is a role-configured assistant (Sales, Confirmation, Delivery,
-- Manager, Analytics, Support…). It binds to an ai_provider + model and carries
-- its own system prompt + permission set. The CRM core is agnostic to roles —
-- roles live here as data.
CREATE TABLE IF NOT EXISTS ai_agents (
  id            TEXT PRIMARY KEY,
  name          TEXT,
  description   TEXT,
  providerId    TEXT,          -- FK -> ai_providers.id (nullable: falls back to default)
  model         TEXT,          -- overrides provider.defaultModel when set
  systemPrompt  TEXT,
  permissions   TEXT,          -- JSON array of permission keys (read_orders, …)
  enabled       INTEGER DEFAULT 1,
  role          TEXT,          -- optional tag: sales | confirmation | delivery | manager | analytics | support
  createdAt     INTEGER DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_ai_agents_enabled ON ai_agents(enabled);

-- Conversation history. A conversation belongs to a CRM user (actorName) using
-- a given ai_agent. APPEND-ONLY — the AI never edits history; it appends to it.
CREATE TABLE IF NOT EXISTS ai_conversations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actorName     TEXT,          -- manager | agent:<name> | anonymous
  agentId       TEXT,          -- FK -> ai_agents.id
  role          TEXT,          -- user | assistant | system
  content       TEXT,
  tokenCount    INTEGER,
  ts            INTEGER DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_actor ON ai_conversations(actorName, agentId, ts);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT                -- JSON-encoded value
);

-- ============================================================================
-- INVENTORY — append-only stock movement ledger (req §10).
-- Like shipment_events & audit_log, this table has NO UPDATE/DELETE path
-- anywhere in the codebase: every stock change is recorded as a new row with
-- prev/new quantities, so the full history can never be overwritten or lost.
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory_movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  productId   TEXT NOT NULL,
  variantName TEXT,                 -- '' = product-level (no variant)
  orderId     TEXT,
  delta       INTEGER,              -- negative for decrement, positive for increment
  prevQty     INTEGER,
  newQty      INTEGER,
  reason      TEXT,                 -- confirm | cancel | reserve | release | adjustment | import | initial
  actor       TEXT,
  ts          INTEGER DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory_movements(productId, variantName, ts);
CREATE INDEX IF NOT EXISTS idx_inventory_order ON inventory_movements(orderId);

-- Cost-lot tracking (FIFO): each row is ONE purchase batch (or a return
-- rejoining an earlier batch). Kept fully separate from inventory_movements
-- (which stays the immutable append-only quantity ledger it always was) —
-- this table is mutable (qtyRemaining decreases as FIFO consumes it) because
-- it represents CURRENT remaining quantity per batch, not history; the
-- historical record of what happened lives in inventory_movements +
-- movement_lot_consumption below.
CREATE TABLE IF NOT EXISTS stock_lots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  productId     TEXT NOT NULL,
  variantName   TEXT,                 -- '' = product-level (no variant)
  unitCost      REAL DEFAULT 0,       -- buy price per unit for THIS batch
  packagingCost REAL DEFAULT 0,       -- packaging cost per unit for THIS batch
  qtyOriginal   INTEGER,
  qtyRemaining  INTEGER,
  source        TEXT,                 -- 'purchase' | 'return'
  actor         TEXT,
  createdAt     INTEGER DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_stock_lots_product ON stock_lots(productId, variantName, createdAt);

-- Which lot(s) a given inventory_movements row actually touched, and by how
-- much. INSERT-ONLY like inventory_movements itself: a 'confirm' movement
-- records what it consumed; the matching 'cancel' movement (if any) records
-- what it restored, as its OWN new rows — nothing here is ever edited or
-- deleted, so — same guarantee as inventory_movements — the trail can never
-- diverge from what actually happened. This is what lets a cancellation put
-- stock back into the EXACT lots it came from instead of guessing.
CREATE TABLE IF NOT EXISTS movement_lot_consumption (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  movementId  INTEGER NOT NULL,
  lotId       INTEGER NOT NULL,
  qty         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlc_movement ON movement_lot_consumption(movementId);
CREATE INDEX IF NOT EXISTS idx_mlc_lot ON movement_lot_consumption(lotId);

-- Product historical timeline (architecture upgrade, phase C). Append-only,
-- exactly like inventory_movements: nothing here is ever updated or
-- deleted. Stock changes already have their own permanent record in
-- inventory_movements/stock_lots, so they are NOT duplicated here — this
-- table is for everything ELSE the spec calls out: price changes, cost
-- changes, variants added/removed, supplier changes, and the
-- archived/unarchived/created lifecycle events.
CREATE TABLE IF NOT EXISTS product_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  productId  TEXT NOT NULL,
  eventType  TEXT NOT NULL,   -- created | price_change | cost_change | packaging_cost_change | variant_added | variant_removed | supplier_changed | brand_changed | archived | unarchived
  field      TEXT,            -- the exact field name that changed, when applicable
  oldValue   TEXT,
  newValue   TEXT,
  actor      TEXT,
  createdAt  INTEGER DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_product_events_product ON product_events(productId, createdAt);

-- Permanent financial (profit & loss) records — architecture upgrade phase D.
-- INSERT-ONLY, like every other historical table in this file: saving the
-- SAME period twice (e.g. re-saving "Week of Jan 5" after ad-spend numbers
-- came in later) never updates the old row — it inserts a NEW one with a
-- later createdAt. "The current record for a period" is simply whichever
-- row for that exact (periodType,startDate,endDate) has the newest
-- createdAt; older ones stay forever as an audit trail of what the
-- business looked like AT THE TIME each calculation was made. This is
-- exactly the "never overwrite, always append" + "nothing financial
-- should disappear" requirement.
CREATE TABLE IF NOT EXISTS financial_records (
  id                 TEXT PRIMARY KEY,
  periodType         TEXT NOT NULL,   -- day | week | month | quarter | year | custom
  startDate          INTEGER NOT NULL,
  endDate            INTEGER NOT NULL,
  revenue            REAL DEFAULT 0,
  productCosts       REAL DEFAULT 0,
  shippingCosts      REAL DEFAULT 0,
  advertisingCosts   REAL DEFAULT 0,
  fixedExpenses      REAL DEFAULT 0,  -- already prorated for this exact period — see prorateFixedExpenses()
  unexpectedExpenses REAL DEFAULT 0,
  netProfit          REAL DEFAULT 0,
  margin             REAL DEFAULT 0,  -- netProfit / revenue * 100
  notes              TEXT,
  source             TEXT,            -- 'manual' (typed into the calculator) | 'aggregated' (rolled up from saved sub-period records)
  productBreakdown   TEXT,            -- JSON snapshot of the per-product figures behind this total, for drill-down
  actor              TEXT,
  createdAt          INTEGER DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_financial_records_period ON financial_records(periodType, startDate, createdAt);

-- ============================================================================
-- FOLLOW-UP (SUIVI) — call-reminder tasks + escalations (req §1).
-- Auto-created when a delivery status requires contacting the customer; carries
-- a due time so the jobs loop can escalate overdue reminders to the manager.
-- ============================================================================
CREATE TABLE IF NOT EXISTS followup_tasks (
  id         TEXT PRIMARY KEY,
  orderId    TEXT NOT NULL,
  type       TEXT,                  -- call_customer | escalation | contact
  status     TEXT DEFAULT 'open',   -- open | done | overdue
  dueAt      INTEGER,               -- epoch-ms when the reminder expires
  agent      TEXT,                  -- assigned follow-up agent
  reason     TEXT,                  -- triggering delivery status / description
  createdAt  INTEGER DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  resolvedAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_followup_status ON followup_tasks(status, dueAt);
CREATE INDEX IF NOT EXISTS idx_followup_agent ON followup_tasks(agent, status);
CREATE INDEX IF NOT EXISTS idx_followup_order ON followup_tasks(orderId);

-- =============================================================================
-- CLIENTS — permanent customer registry (architecture upgrade, phase A).
-- One row per unique phone number, across every connected store. NEVER
-- deleted automatically — deleteOrder() never touches this table, on
-- purpose, so a client's identity and lifetime history survive an order
-- being removed. The count columns (confirmedOrders, cancelledOrders,
-- deliveredOrders, totalSpent) are LIFETIME EVENT counts, not live
-- snapshots — see upsertClientFromOrder()'s comment for exactly what that
-- means and why.
-- =============================================================================
CREATE TABLE IF NOT EXISTS clients (
  id              TEXT PRIMARY KEY,
  phone           TEXT NOT NULL,        -- normalized (0xxxxxxxxx form) — the dedup/merge key
  phoneDisplay    TEXT,                 -- last-seen raw form, for showing on screen
  name            TEXT,                 -- most recent known name
  wilaya          TEXT,
  commune         TEXT,
  address         TEXT,                 -- free text; manually entered (no reliable source field exists yet)
  firstOrderAt    INTEGER,
  lastOrderAt     INTEGER,
  totalOrders     INTEGER DEFAULT 0,
  confirmedOrders INTEGER DEFAULT 0,
  cancelledOrders INTEGER DEFAULT 0,
  deliveredOrders INTEGER DEFAULT 0,
  totalSpent      REAL DEFAULT 0,       -- sum of price for orders that reached deliveryOutcome='delivered'
  createdAt       INTEGER,
  updatedAt       INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_last_order ON clients(lastOrderAt);

-- =============================================================================
-- SESSIONS — server-side login sessions (audit SEC-01/SEC-02).
-- The id column holds the SHA-256 of the token that was handed to the client,
-- never the token itself, so a database leak cannot be replayed as a live login.
-- Rows are disposable: deleting one revokes that login immediately, which is
-- what makes suspending an account take effect at once.
-- =============================================================================
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  agentName  TEXT NOT NULL,
  createdAt  INTEGER,
  expiresAt  INTEGER,
  lastSeenAt INTEGER,
  userAgent  TEXT,
  ip         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agentName);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expiresAt);
`);

/* ---------------------------------------------------------------------------
 * Idempotent column migrations for databases created before these fields
 * existed. SQLite has no ADD COLUMN IF NOT EXISTS, so we introspect the schema
 * and ALTER only what's missing. Safe to run on every boot.
 * ------------------------------------------------------------------------- */
function addMissingColumns(table, columns) {
  const existing = new Set(
    db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
  );
  for (const [col, def] of Object.entries(columns)) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  }
}
addMissingColumns('providers', {
  webhookSecret: 'TEXT',
  trackingEndpoint: 'TEXT',
  shipmentEndpoint: 'TEXT',
  statusEndpoint: 'TEXT',
  apiEnabled: 'INTEGER DEFAULT 1',
  webhookEnabled: 'INTEGER DEFAULT 1',
  lastSyncAt: 'INTEGER',
  lastTestAt: 'INTEGER',
  lastTestOk: 'INTEGER',
});
addMissingColumns('stores', {
  apiUrl: 'TEXT',
  apiKey: 'TEXT',
  apiSecret: 'TEXT',
  webhookSecret: 'TEXT',
  webhookEndpoint: 'TEXT',
  apiEnabled: 'INTEGER DEFAULT 1',
  webhookEnabled: 'INTEGER DEFAULT 1',
  lastTestAt: 'INTEGER',
});

// --- Orders: new columns for order-type metadata, fake classification,
//     store/brand identification, and follow-up / call-reminder tracking.
//     All additive via the idempotent migration; existing rows default safely.
addMissingColumns('orders', {
  // Real-world delivery outcome — set ONCE when a shipment reaches an actual
  // final state ('delivered' or 'returned'), from the carrier webhook, NOT
  // from the confirmation-call status. 'cancelled'/'refused' deliberately do
  // NOT set this — per the manager, those are provisional; the parcel is
  // only counted once it settles into 'returned' (or 'delivered'). This is
  // what the profit calculator counts as an actual sale, since a phone
  // confirmation is not a guaranteed sale under cash-on-delivery.
  deliveryOutcome:   "TEXT DEFAULT ''",   // '' | 'delivered' | 'returned'
  deliveryOutcomeAt: 'INTEGER',            // when it was set — for date-range profit queries
});
addMissingColumns('orders', {
  orderType:          "TEXT DEFAULT 'normal'",   // normal | abandoned (req §4 — metadata, not status)
  classification:     "TEXT DEFAULT ''",          // '' | 'fake' (req §3 — orthogonal to status)
  fakeReason:         'TEXT',
  fakeResponsible:    'TEXT',
  fakeAt:             'INTEGER',
  storeName:          'TEXT',                      // denormalized store display name (req §5/§11)
  brand:              'TEXT',                      // denormalized brand (req §5/§11)
  platform:           'TEXT',                      // source platform: shopify | lightfunnels | ... (req §5/§11)
  shopifyProductId:   'TEXT',                       // first line item's product id — precise product matching (multi-store linking)
  shopifyVariantId:   'TEXT',                       // first line item's variant id
  followupAgent:      'TEXT',                      // assigned Suivi agent (req §1)
  followupAssignedAt: 'INTEGER',
  callReminderDue:    'INTEGER',                   // epoch-ms when the reminder expires (req §1)
  callReminderStatus: "TEXT DEFAULT ''",          // '' | pending | done | overdue
  overdueFlaggedAt:   'INTEGER',                   // set once the reassignment sweep has counted/alerted
                                                     // this order, so an unresolved order isn't re-counted
                                                     // every sweep tick (spec §4/§6). Cleared on reassignment.
});

// --- Clients (architecture upgrade phase A): an indexed, normalized phone
// on the order itself makes "every order for this client" a fast indexed
// lookup instead of a full-table scan with JS-side normalization.
addMissingColumns('orders', {
  phoneNormalized: 'TEXT',
});
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_phone_normalized ON orders(phoneNormalized)');

// --- order_calls: note type, for standalone notes (client called back,
//     complaint, address change, instructions, other) that an agent can log
//     WITHOUT having made a call — result/callStartTime/duration/suspicious
//     all stay null for these, since they are not a confirmation-call
//     attempt and must never feed the manipulation-detection system.
addMissingColumns('order_calls', {
  noteType: 'TEXT',
});

// --- Agents: role column (confirmation | followup | both) (req §1).
addMissingColumns('agents', {
  role: "TEXT DEFAULT 'confirmation'",
});

// --- Agents: accountability fields for the reassignment/suspension system
//     (Confirmation Agent Dashboard spec §6-§7). missedOrders is a permanent
//     counter — only ever reset explicitly by a manager action, never
//     auto-decremented. suspended blocks login until a manager reactivates.
addMissingColumns('agents', {
  missedOrders: 'INTEGER DEFAULT 0',
  suspended:    'INTEGER DEFAULT 0',
});

// --- Agents: payment configuration (payroll feature). Deliberately 3
//     independent numeric rate fields instead of a fixed "mode" enum — any
//     can be 0, any combination is valid (monthly-only, per-order-only,
//     salary+per-order, etc.), matching the project's "no hardcoding" rule.
addMissingColumns('agents', {
  baseSalaryMonthly:    'REAL DEFAULT 0',
  payPerConfirmedOrder: 'REAL DEFAULT 0',
  payPerDeliveredOrder: 'REAL DEFAULT 0',
});

// --- Agents: recurring weekly day(s) off. JSON array of day-of-week
//     numbers (0=Sunday..6=Saturday, matching JS Date#getDay()). An agent
//     with e.g. '[5]' (Friday) must be automatically skipped by auto-assign
//     AND by the overdue-reassignment candidate pool on every Friday, every
//     week, with no manager action needed — this is the whole point (as
//     opposed to a manual suspend, which stays off until someone flips it
//     back). Stored as JSON text rather than one column per day so any
//     number of days off is possible without a schema change.
addMissingColumns('agents', {
  weeklyDaysOff: "TEXT DEFAULT '[]'",
});

// --- Agents: ACCOUNT role, i.e. privilege level, kept deliberately separate
//     from the existing `role` column, which describes the JOB (confirmation |
//     followup | both). Conflating them would mean a follow-up agent could
//     never be a manager. Everyone defaults to 'agent'; the bootstrap in
//     lib/auth.js promotes exactly one account to 'manager' on first boot.
// --- Notifications: recipient targeting + a per-account read watermark.
//     `target` was accepted by notifications.push() from the very beginning but
//     had no column to land in, so every stored notification was effectively a
//     broadcast — including the manager-only ones about an agent's own misses.
addMissingColumns('notifications', {
  target: 'TEXT',                        // NULL/'' = everyone | 'manager' | agent name
});
db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target, id)');

addMissingColumns('agents', {
  // High-water mark for "notifications I have seen". Replaces the global
  // notifications.read flag, which marked a notification read for EVERYONE the
  // moment any one person opened their panel.
  lastReadNotificationId: 'INTEGER DEFAULT 0',
  accountRole: "TEXT DEFAULT 'agent'",   // agent | manager
  // Whether a real password has been set. Kept as its own column because a
  // salted hash cannot reveal that the input was empty, and an account that
  // still opens with a blank field is something a manager must be able to see.
  // Backfilled from the plaintext value by the boot migration in lib/auth.js.
  hasPassword: 'INTEGER',
});

// --- Products: product-level image (Products & Stock — a product with zero
//     variants previously had no way to have any image at all, since images
//     only existed inside the per-variant JSON blob).
addMissingColumns('products', {
  image: 'TEXT',
});

// --- Products: product-level low-stock threshold, for products with no
//     variants. Previously these ALWAYS used the hardcoded global default
//     (5) with no way to override per product — now configurable, defaults
//     to 24 per manager's request.
addMissingColumns('products', {
  threshold: 'INTEGER DEFAULT 24',
});

// --- Products: cost basis for the profit calculator (spec: per-product
// profit from real delivered orders). Previously only the SELLING price
// (`price`) existed anywhere in the schema — there was no way to know what
// the manager actually paid, so no real profit could ever be computed.
// packagingCost is separate from buy cost since it varies by product size,
// same reasoning already applied to per-order shipping cost elsewhere.
addMissingColumns('products', {
  costPrice:      'REAL DEFAULT 0',   // what the manager pays to acquire/produce one unit
  packagingCost:  'REAL DEFAULT 0',   // packaging cost per unit for THIS product specifically
});

// --- Products: multi-dimensional variant option definitions (e.g. Color x
// Size). Previously a product only had a flat `variants` list with no notion
// of which "axes" made up each variant, so the manager had to type every
// combination by hand. optionDefs stores the axes themselves
// ([{name,values:[]}]); the actual per-combination rows still live in the
// existing `variants` column (now each can carry its own sku + an `options`
// map back to these axes) — this is purely ADDITIVE, no existing single-
// dimension product needs optionDefs to keep working exactly as before.
addMissingColumns('products', {
  optionDefs: 'TEXT',                 // JSON [{name, values:[]}], defaults to [] in JS layer
});

// --- Product permanence (architecture upgrade, phase C): classification
// fields the original spec asks for, plus archived (soft-delete — a
// product is NEVER hard-deleted through the normal app flow anymore, see
// archiveProduct() below) and lifetime stats maintained the SAME way
// clients' lifetime stats are (event-transition counters via
// upsertProductStatsFromOrder(), hooked into insertOrder/saveOrder
// alongside the existing client + inventory hooks — one order write now
// keeps THREE permanent records in sync: the client, the product, and the
// stock/cost ledger).
addMissingColumns('products', {
  brand: 'TEXT', niche: 'TEXT', category: 'TEXT', supplier: 'TEXT',
  archived: 'INTEGER DEFAULT 0', archivedAt: 'INTEGER',
  totalOrders: 'INTEGER DEFAULT 0', confirmedOrders: 'INTEGER DEFAULT 0',
  cancelledOrders: 'INTEGER DEFAULT 0', deliveredOrders: 'INTEGER DEFAULT 0',
  totalRevenue: 'REAL DEFAULT 0', totalProfit: 'REAL DEFAULT 0',
  firstOrderAt: 'INTEGER', lastOrderAt: 'INTEGER',
});

// --- Cost-lot tracking: the per-unit cost basis a movement actually
// consumed/restored, when known (see stock_lots above). Nullable — older
// movements (or products that never used "Add Stock → New purchase") simply
// have no cost recorded here, and the profit calculator falls back to the
// product's flat costPrice/packagingCost for those, exactly as it always
// has, so nothing that worked before this feature stops working.
addMissingColumns('inventory_movements', {
  unitCost: 'REAL',
  packagingCost: 'REAL',
});

// --- Client import (architecture upgrade phase B): kept in DEDICATED
// columns, completely separate from the live totalOrders/confirmedOrders/…
// that upsertClientFromOrder() maintains from real orders in THIS system.
// This is deliberate: blending an external CRM's historical numbers into
// the same counters that are carefully event-tracked from real order
// transitions would risk silently corrupting them (double-counting, or
// mixing two different systems' definitions of "confirmed"). Keeping them
// separate means neither can ever overwrite the other — exactly the "never
// overwrite, append instead" rule — and the client profile can show both
// side by side: what happened here, and what came from before.
addMissingColumns('clients', {
  importedTotalOrders: 'INTEGER DEFAULT 0',
  importedConfirmedOrders: 'INTEGER DEFAULT 0',
  importedCancelledOrders: 'INTEGER DEFAULT 0',
  importedDeliveredOrders: 'INTEGER DEFAULT 0',
  importedTotalSpent: 'REAL DEFAULT 0',
  importedSource: 'TEXT',
  importedAt: 'INTEGER',
});

/* ---------------------------------------------------------------------------
 * Settings — stored as key/value with JSON-encoded values.
 * Defaults preserve the original settings.json shape plus the new ones.
 * ------------------------------------------------------------------------- */
const DEFAULT_SETTINGS = {
  autoAssign: false,
  minCallSeconds: 40,
  alertMinutes: 60,
  autoCreateShipment: true,   // create a shipment automatically when an order is confirmed
  trackingPollMinutes: 15,    // server-side polling fallback interval
  // --- Follow-up (Suivi) department (req §1) ---
  followupAutoAssign: false,        // auto-assign confirmed orders to a follow-up agent
  followupReminderMinutes: 120,     // configurable call-reminder delay (minutes)
  // --- Inventory reservation policy (req §9) ---
  reservationMode: 'on_confirm',    // immediate | on_confirm | none
  // --- Default carrier per store (req §7): { storeId: providerCode }
  defaultCarrierByStore: {},
  // --- Confirmation Agent Dashboard: overdue reassignment + suspension (spec §5, §8) ---
  autoReassign: false,        // manager toggle — off by default until reviewed
  reassignMinutes: 5,         // minutes with zero calls logged before an order is pulled
  autoSuspend: false,         // manager toggle — off by default until reviewed
  suspendThreshold: 5,        // missed orders before an agent is auto-locked out
  workHoursStart: 10,         // sweep only acts between these hours (Algeria local time) —
  workHoursEnd: 20,           // outside them nobody is expected to be working, per manager
  // Orders created OUTSIDE working hours get extra time once the day starts:
  // instead of the normal reassignMinutes rule counting from creation time
  // (which would catch them almost instantly at workHoursStart, since they
  // already sat all night), they become eligible at
  // (next workHoursStart + nightGraceMinutes) instead.
  nightGraceMinutes: 120,      // default 2 hours, per manager's request
  // --- Profit calculator: recurring MONTHLY fixed costs (salaries, rent,
  // any other standing expense) — entered once, prorated by day-count for
  // whatever date range the manager picks (spec: "enter once monthly,
  // applies automatically to any period"). [{id, label, amount}]
  fixedCosts: [],
};

const getSettingsStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingsStmt = db.prepare(
  'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
);

function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key,value FROM settings').all()) {
    try { out[row.key] = JSON.parse(row.value); } catch { out[row.key] = row.value; }
  }
  // Safety: autoCreateShipment defaults to true unless explicitly set to false.
  if (out.autoCreateShipment === undefined || out.autoCreateShipment === null) {
    out.autoCreateShipment = true;
  }
  return out;
}
function setSettings(partial) {
  const cur = getSettings();
  const next = { ...cur, ...partial };
  const tx = db.transaction((obj) => {
    for (const [k, v] of Object.entries(obj)) setSettingsStmt.run(k, JSON.stringify(v));
  });
  tx(next);
  return next;
}

/* ---------------------------------------------------------------------------
 * Row <-> object mappers. The DB stores JSON for nested fields; these restore
 * the exact object shapes the rest of the app already expects (so callers in
 * index.js keep working with order.calls[], product.variants[], etc.).
 * ------------------------------------------------------------------------- */
function rowToOrder(r) {
  if (!r) return null;
  return {
    id: r.id,
    shopifyId: r.shopifyId || '',
    shopifyName: r.shopifyName || '',
    client: r.client || '',
    phone: r.phone || '',
    city: r.city || '',
    wilaya: r.wilaya || '',
    commune: r.commune || '',
    lineItems: safeJson(r.lineItems, []),
    product: r.product || '',
    productVariant: r.productVariant || '',
    quantity: r.quantity ?? 1,
    unitPrice: r.unitPrice ?? 0,
    price: r.price ?? 0,
    subtotal: r.subtotal ?? 0,
    discount: r.discount ?? 0,
    shippingCost: r.shippingCost ?? 0,
    agent: r.agent || '',
    delivery: r.delivery || '',
    deliveryMethod: r.deliveryMethod || '',
    expressDelivery: !!r.expressDelivery,
    status: r.status || '',
    deliveryStatus: r.deliveryStatus || '',
    trackingNumber: r.trackingNumber || '',
    managerNote: r.managerNote || '',
    shippingNote: r.shippingNote || '',
    note: r.note || '',
    source: r.source || '',
    marketer: r.marketer || '',
    storeId: r.storeId || '',
    providerId: r.providerId || '',
    shipmentId: r.shipmentId || '',
    pendingCallStart: r.pendingCallStart || null,
    // --- order-type metadata (abandoned is metadata, not a status — req §4) ---
    orderType: r.orderType || (r.status === 'abandoned' || r.source === 'shopify_abandoned' ? 'abandoned' : 'normal'),
    // --- fake-order classification (orthogonal to status — req §3) ---
    classification: r.classification || '',
    fakeReason: r.fakeReason || '',
    fakeResponsible: r.fakeResponsible || '',
    fakeAt: r.fakeAt || null,
    // --- store / brand identification (req §5 / §11) ---
    storeName: r.storeName || '',
    brand: r.brand || '',
    platform: r.platform || (r.source && r.source !== 'manual' && r.source !== 'shopify' ? r.source : (r.source === 'shopify' ? 'shopify' : '')),
    // --- follow-up (Suivi) department (req §1) ---
    followupAgent: r.followupAgent || '',
    followupAssignedAt: r.followupAssignedAt || null,
    callReminderDue: r.callReminderDue || null,
    callReminderStatus: r.callReminderStatus || '',
    overdueFlaggedAt: r.overdueFlaggedAt || null,
    // --- real delivery outcome from the carrier webhook (req §9 / profit
    // calculator's actual-sale source of truth) — BUGFIX: these two columns
    // have existed since early in the project (see addMissingColumns above)
    // and were always written correctly, but rowToOrder() never read them
    // back out, so any caller going through getOrder()/patchOrder()'s
    // internal before/after reads (as opposed to the direct SQL in
    // getOrdersByDeliveryOutcome) saw deliveryOutcome as permanently
    // undefined. Harmless everywhere that already bypassed getOrder() for
    // this field, but it silently broke the new clients feature's ability
    // to detect "this order just became delivered".
    deliveryOutcome: r.deliveryOutcome || '',
    deliveryOutcomeAt: r.deliveryOutcomeAt || null,
    phoneNormalized: r.phoneNormalized || '',
    createdAt: r.createdAt || null,
    shopifyCreatedAt: r.shopifyCreatedAt || null,
    calls: [],                       // populated by attachCalls
  };
}

function attachCalls(order) {
  if (!order) return order;
  order.calls = db.prepare(
    'SELECT * FROM order_calls WHERE orderId = ? ORDER BY id ASC'
  ).all(order.id).map(c => ({
    time: c.time,
    callStartTime: c.callStartTime,
    duration: c.duration,
    threshold: c.threshold,
    suspicious: c.suspicious === null ? null : !!c.suspicious,
    result: c.result,
    note: c.note || '',
    noteType: c.noteType || '',
    agent: c.agent || '',
  }));
  return order;
}

function orderToRow(o) {
  return {
    id: o.id,
    shopifyId: o.shopifyId ?? null,
    shopifyName: o.shopifyName ?? null,
    client: o.client ?? null,
    phone: o.phone ?? null,
    city: o.city ?? null,
    wilaya: o.wilaya ?? null,
    commune: o.commune ?? null,
    lineItems: JSON.stringify(o.lineItems || []),
    product: o.product ?? null,
    productVariant: o.productVariant ?? null,
    quantity: o.quantity ?? 1,
    unitPrice: num(o.unitPrice),
    price: num(o.price),
    subtotal: num(o.subtotal),
    discount: num(o.discount),
    shippingCost: num(o.shippingCost),
    agent: o.agent ?? null,
    delivery: o.delivery ?? null,
    deliveryMethod: o.deliveryMethod ?? null,
    expressDelivery: o.expressDelivery ? 1 : 0,
    status: o.status ?? null,
    deliveryStatus: o.deliveryStatus ?? null,
    trackingNumber: o.trackingNumber ?? null,
    managerNote: o.managerNote ?? null,
    shippingNote: o.shippingNote ?? null,
    note: o.note ?? null,
    source: o.source ?? null,
    marketer: o.marketer ?? null,
    storeId: o.storeId ?? null,
    providerId: o.providerId ?? null,
    shipmentId: o.shipmentId ?? null,
    pendingCallStart: o.pendingCallStart ?? null,
    orderType: o.orderType ?? 'normal',
    classification: o.classification ?? '',
    fakeReason: o.fakeReason ?? null,
    fakeResponsible: o.fakeResponsible ?? null,
    fakeAt: o.fakeAt ?? null,
    storeName: o.storeName ?? null,
    brand: o.brand ?? null,
    platform: o.platform ?? null,
    shopifyProductId: o.shopifyProductId ?? null,
    shopifyVariantId: o.shopifyVariantId ?? null,
    followupAgent: o.followupAgent ?? null,
    followupAssignedAt: o.followupAssignedAt ?? null,
    callReminderDue: o.callReminderDue ?? null,
    callReminderStatus: o.callReminderStatus ?? '',
    overdueFlaggedAt: o.overdueFlaggedAt ?? null,
    deliveryOutcome: o.deliveryOutcome ?? '',
    deliveryOutcomeAt: o.deliveryOutcomeAt ?? null,
    createdAt: o.createdAt ?? Date.now(),
    shopifyCreatedAt: o.shopifyCreatedAt ?? null,
    phoneNormalized: normalizePhoneForClient(o.phone),
    updatedAt: Date.now(),
  };
}

function rowToProduct(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    sku: r.sku || '',
    description: r.description || '',
    price: r.price ?? 0,
    variants: normalizeVariantStock(safeJson(r.variants, [])),
    optionDefs: safeJson(r.optionDefs, []),
    image: r.image || '',
    threshold: (r.threshold === null || r.threshold === undefined) ? 24 : Number(r.threshold),
    costPrice: r.costPrice ?? 0,
    packagingCost: r.packagingCost ?? 0,
    stock: r.stock ?? 0,
    // --- Product permanence / classification (phase C) ---
    brand: r.brand || '', niche: r.niche || '', category: r.category || '', supplier: r.supplier || '',
    archived: !!r.archived, archivedAt: r.archivedAt || null,
    totalOrders: r.totalOrders || 0, confirmedOrders: r.confirmedOrders || 0,
    cancelledOrders: r.cancelledOrders || 0, deliveredOrders: r.deliveredOrders || 0,
    totalRevenue: r.totalRevenue || 0, totalProfit: r.totalProfit || 0,
    avgSellingPrice: r.deliveredOrders ? (r.totalRevenue / r.deliveredOrders) : 0,
    firstOrderAt: r.firstOrderAt || null, lastOrderAt: r.lastOrderAt || null,
    createdAt: r.createdAt,
  };
}

/**
 * Normalize the variant JSON into the extended shape
 * {name,image,stock,threshold,sku,options}. Accepts legacy forms: string[],
 * {name,image}[], {name,...} partials. Missing stock/threshold default to
 * null (treated as "use product-level stock" by the inventory layer).
 * sku defaults to '' and options defaults to {} (empty map = a plain,
 * single-dimension variant with no option axes attached).
 * BUGFIX: this used to only carry {name,image,stock,threshold} through,
 * so sku and options were silently dropped on every read from the DB even
 * when they had been saved correctly — the multi-dimensional variant
 * feature would have looked broken on reload without this fix.
 */
function normalizeVariantStock(variants) {
  if (!Array.isArray(variants)) return [];
  return variants.map(v => {
    if (typeof v === 'string') return { name: v, image: '', stock: null, threshold: null, sku: '', options: {} };
    return {
      name: v.name || v.label || '',
      image: v.image || v.img || '',
      stock: v.stock === undefined ? null : Number(v.stock),
      threshold: v.threshold === undefined ? null : Number(v.threshold),
      sku: v.sku || '',
      options: (v.options && typeof v.options === 'object' && !Array.isArray(v.options)) ? v.options : {},
    };
  });
}

/** Total stock across variants when any variant defines a concrete level. */
function productStockTotal(p) {
  if (!p || !Array.isArray(p.variants)) return p ? (p.stock ?? 0) : 0;
  const defined = p.variants.filter(v => v.stock !== null && v.stock !== undefined);
  if (defined.length === 0) return p.stock ?? 0;     // no per-variant data → use flat
  return defined.reduce((s, v) => s + (Number(v.stock) || 0), 0);
}

function rowToStore(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    platform: r.platform || '',
    brand: r.brand || '',
    // New explicit credential fields…
    apiUrl: r.apiUrl || '',
    apiKey: r.apiKey ? maskKey(r.apiKey) : '',
    apiSecret: r.apiSecret ? '••••' : '',
    webhookSecret: r.webhookSecret ? '••••' : '',
    webhookEndpoint: r.webhookEndpoint || '',
    apiEnabled: r.apiEnabled === null ? true : !!r.apiEnabled,
    webhookEnabled: r.webhookEnabled === null ? true : !!r.webhookEnabled,
    lastTestAt: r.lastTestAt || null,
    // …and legacy JSON blobs (kept for back-compat / migration).
    credentials: safeJson(r.credentials, {}),
    webhookConfig: safeJson(r.webhookConfig, {}),
    active: !!r.active,
    createdAt: r.createdAt,
    _hasCredentials: !!(r.apiKey || r.apiSecret),
  };
}

function rowToProvider(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    adapter: r.adapter || 'generic',
    apiUrl: r.apiUrl || '',
    apiKey: r.apiKey ? maskKey(r.apiKey) : '',   // never expose full keys in listings
    secretKey: r.secretKey ? '••••' : '',
    webhookUrl: r.webhookUrl || '',
    webhookSecret: r.webhookSecret ? '••••' : '',
    trackingEndpoint: r.trackingEndpoint || '',
    shipmentEndpoint: r.shipmentEndpoint || '',
    statusEndpoint: r.statusEndpoint || '',
    customFields: safeJson(r.customFields, {}),
    apiEnabled: r.apiEnabled === null ? true : !!r.apiEnabled,
    webhookEnabled: r.webhookEnabled === null ? true : !!r.webhookEnabled,
    lastSyncAt: r.lastSyncAt || null,
    lastTestAt: r.lastTestAt || null,
    lastTestOk: r.lastTestOk === null ? null : !!r.lastTestOk,
    isDefault: !!r.isDefault,
    active: !!r.active,
    createdAt: r.createdAt,
    _hasCredentials: !!(r.apiKey || r.secretKey),  // UI hint, not the key itself
  };
}
function maskKey(k) { return k.length > 8 ? k.slice(0, 4) + '••••' + k.slice(-4) : '••••'; }

function rowToShipment(r) {
  if (!r) return null;
  return {
    id: r.id,
    orderId: r.orderId,
    providerId: r.providerId || '',
    trackingNumber: r.trackingNumber || '',
    providerShipmentId: r.providerShipmentId || '',
    providerReference: r.providerReference || '',
    crmStatus: r.crmStatus || '',
    originalStatus: r.originalStatus || '',
    labelUrl: r.labelUrl || '',
    raw: safeJson(r.raw, {}),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function rowToEvent(e) {
  return {
    id: e.id,
    shipmentId: e.shipmentId,
    eventTime: e.eventTime,
    originalStatus: e.originalStatus || '',
    crmStatus: e.crmStatus || '',
    description: e.description || '',
    raw: safeJson(e.raw, {}),
    insertedAt: e.insertedAt,
  };
}

function safeJson(s, fallback) {
  if (s === null || s === undefined) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}
function num(v) { return v === undefined || v === null ? null : Number(v) || 0; }

/* ---------------------------------------------------------------------------
 * Prepared statements for the hot paths.
 * ------------------------------------------------------------------------- */
const stmts = {
  getOrder:   db.prepare('SELECT * FROM orders WHERE id = ?'),
  allOrders:  db.prepare('SELECT * FROM orders ORDER BY createdAt DESC'),
  allAgents:  db.prepare('SELECT * FROM agents'),
  allProducts:db.prepare('SELECT * FROM products ORDER BY createdAt DESC'),
  allStores:  db.prepare('SELECT * FROM stores ORDER BY createdAt DESC'),
  allProviders: db.prepare('SELECT * FROM providers ORDER BY isDefault DESC, name ASC'),
  defaultProvider: db.prepare('SELECT * FROM providers WHERE isDefault = 1 LIMIT 1'),
  insertOrder: db.prepare(`
    INSERT INTO orders (
      id, shopifyId, shopifyName, client, phone, city, wilaya, commune, lineItems,
      product, productVariant, quantity, unitPrice, price, subtotal, discount, shippingCost,
      agent, delivery, deliveryMethod, expressDelivery, status, deliveryStatus, trackingNumber,
      managerNote, shippingNote, note, source, marketer, storeId, providerId, shipmentId,
      pendingCallStart, orderType, classification, fakeReason, fakeResponsible, fakeAt,
      storeName, brand, platform, shopifyProductId, shopifyVariantId, followupAgent, followupAssignedAt,
      callReminderDue, callReminderStatus, overdueFlaggedAt, phoneNormalized,
      deliveryOutcome, deliveryOutcomeAt,
      createdAt, shopifyCreatedAt, updatedAt
    ) VALUES (
      @id, @shopifyId, @shopifyName, @client, @phone, @city, @wilaya, @commune, @lineItems,
      @product, @productVariant, @quantity, @unitPrice, @price, @subtotal, @discount, @shippingCost,
      @agent, @delivery, @deliveryMethod, @expressDelivery, @status, @deliveryStatus, @trackingNumber,
      @managerNote, @shippingNote, @note, @source, @marketer, @storeId, @providerId, @shipmentId,
      @pendingCallStart, @orderType, @classification, @fakeReason, @fakeResponsible, @fakeAt,
      @storeName, @brand, @platform, @shopifyProductId, @shopifyVariantId, @followupAgent, @followupAssignedAt,
      @callReminderDue, @callReminderStatus, @overdueFlaggedAt, @phoneNormalized,
      @deliveryOutcome, @deliveryOutcomeAt,
      @createdAt, @shopifyCreatedAt, @updatedAt
    )`),
  updateOrderFields: db.prepare(`
    UPDATE orders SET
      shopifyId=@shopifyId, shopifyName=@shopifyName, client=@client, phone=@phone,
      city=@city, wilaya=@wilaya, commune=@commune, lineItems=@lineItems,
      product=@product, productVariant=@productVariant, quantity=@quantity,
      unitPrice=@unitPrice, price=@price, subtotal=@subtotal, discount=@discount,
      shippingCost=@shippingCost, agent=@agent, delivery=@delivery, deliveryMethod=@deliveryMethod,
      expressDelivery=@expressDelivery, status=@status, deliveryStatus=@deliveryStatus,
      trackingNumber=@trackingNumber, managerNote=@managerNote, shippingNote=@shippingNote,
      note=@note, source=@source, marketer=@marketer, storeId=@storeId, providerId=@providerId,
      shipmentId=@shipmentId, pendingCallStart=@pendingCallStart,
      orderType=@orderType, classification=@classification, fakeReason=@fakeReason,
      fakeResponsible=@fakeResponsible, fakeAt=@fakeAt,
      storeName=@storeName, brand=@brand, platform=@platform,
      shopifyProductId=@shopifyProductId, shopifyVariantId=@shopifyVariantId,
      followupAgent=@followupAgent, followupAssignedAt=@followupAssignedAt,
      callReminderDue=@callReminderDue, callReminderStatus=@callReminderStatus,
      overdueFlaggedAt=@overdueFlaggedAt, phoneNormalized=@phoneNormalized,
      deliveryOutcome=@deliveryOutcome, deliveryOutcomeAt=@deliveryOutcomeAt,
      shopifyCreatedAt=@shopifyCreatedAt,
      updatedAt=@updatedAt
    WHERE id=@id`),
  deleteOrder: db.prepare('DELETE FROM orders WHERE id = ?'),
  insertCall: db.prepare(`INSERT INTO order_calls
    (orderId, time, callStartTime, duration, threshold, suspicious, result, note, noteType, agent)
    VALUES (@orderId, @time, @callStartTime, @duration, @threshold, @suspicious, @result, @note, @noteType, @agent)`),
  insertProduct: db.prepare(`INSERT INTO products
    (id, name, sku, description, price, variants, optionDefs, image, threshold, costPrice, packagingCost, stock, brand, niche, category, supplier, createdAt)
    VALUES (@id, @name, @sku, @description, @price, @variants, @optionDefs, @image, @threshold, @costPrice, @packagingCost, @stock, @brand, @niche, @category, @supplier, @createdAt)`),
  updateProduct: db.prepare(`UPDATE products SET
    name=@name, sku=@sku, description=@description, price=@price, variants=@variants, optionDefs=@optionDefs, image=@image, threshold=@threshold, costPrice=@costPrice, packagingCost=@packagingCost, stock=@stock, brand=@brand, niche=@niche, category=@category, supplier=@supplier
    WHERE id=@id`),
  deleteProduct: db.prepare('DELETE FROM products WHERE id = ?'),
  insertShipment: db.prepare(`INSERT INTO shipments
    (id, orderId, providerId, trackingNumber, providerShipmentId, providerReference,
     crmStatus, originalStatus, labelUrl, raw, createdAt, updatedAt)
    VALUES (@id, @orderId, @providerId, @trackingNumber, @providerShipmentId, @providerReference,
     @crmStatus, @originalStatus, @labelUrl, @raw, @createdAt, @updatedAt)`),
  updateShipment: db.prepare(`UPDATE shipments SET
    trackingNumber=@trackingNumber, providerShipmentId=@providerShipmentId,
    providerReference=@providerReference, crmStatus=@crmStatus, originalStatus=@originalStatus,
    labelUrl=@labelUrl, raw=@raw, updatedAt=@updatedAt WHERE id=@id`),
  getShipment: db.prepare('SELECT * FROM shipments WHERE id = ?'),
  getShipmentByOrder: db.prepare('SELECT * FROM shipments WHERE orderId = ?'),
  getShipmentByTracking: db.prepare('SELECT * FROM shipments WHERE trackingNumber = ?'),
  insertEvent: db.prepare(`INSERT INTO shipment_events
    (shipmentId, eventTime, originalStatus, crmStatus, description, raw)
    VALUES (@shipmentId, @eventTime, @originalStatus, @crmStatus, @description, @raw)`),
  eventsForShipment: db.prepare('SELECT * FROM shipment_events WHERE shipmentId = ? ORDER BY eventTime ASC, id ASC'),
  insertNotification: db.prepare(`INSERT INTO notifications
    (type, title, body, orderId, shipmentId, target)
    VALUES (@type, @title, @body, @orderId, @shipmentId, @target)`),
  insertAudit: db.prepare(`INSERT INTO audit_log (entity, entityId, action, actor, payload)
    VALUES (@entity, @entityId, @action, @actor, @payload)`),
};

/* ---------------------------------------------------------------------------
 * High-level data API used by index.js. Mirrors the old loadData()/saveData()
 * helpers so the route handlers change minimally.
 * ------------------------------------------------------------------------- */

/** Returns { orders:[], agents:[] } — same shape as the old loadData(). */
function loadOrdersData() {
  return {
    orders: stmts.allOrders.all().map(r => attachCalls(rowToOrder(r))),
    // rowToAgent, not an inline shape: this used to carry `pass` in cleartext
    // too, and loadOrdersData() feeds the AI context builder among other
    // things, so the credential travelled further than GET /api/agents alone.
    agents: stmts.allAgents.all().map(rowToAgent),
  };
}

function getOrder(id) {
  return attachCalls(rowToOrder(stmts.getOrder.get(id)));
}

function findOrder(predicate) {
  for (const r of stmts.allOrders.all()) {
    if (predicate(r)) return attachCalls(rowToOrder(r));
  }
  return null;
}

function insertOrder(o) {
  const row = orderToRow(o);
  const tx = db.transaction(() => {
    stmts.insertOrder.run(row);
    stmts.insertAudit.run({ entity: 'order', entityId: o.id, action: 'create', actor: 'system', payload: JSON.stringify({ status: o.status }) });
    upsertClientFromOrder(null, getOrder(o.id)); // before=null: this order is definitely brand new
    upsertProductStatsFromOrder(null, getOrder(o.id));
  });
  tx();
  return getOrder(o.id);
}

function saveOrder(o) {
  // Whole-order upsert used by the manual edit + PUT path.
  const before = getOrder(o.id); // capture prior state BEFORE mutating, for the client stat transition check
  const row = orderToRow(o);
  const tx = db.transaction(() => {
    const existing = stmts.getOrder.get(o.id);
    if (existing) stmts.updateOrderFields.run(row);
    else stmts.insertOrder.run(row);
    upsertClientFromOrder(before, getOrder(o.id));
    upsertProductStatsFromOrder(before, getOrder(o.id));
  });
  tx();
  return getOrder(o.id);
}

function patchOrder(id, patch) {
  const cur = getOrder(id);
  if (!cur) return null;
  return saveOrder({ ...cur, ...patch, id });
}

function deleteOrder(id) {
  const tx = db.transaction(() => { stmts.deleteOrder.run(id); });
  tx();
}

/* ===========================================================================
 * CLIENTS — permanent customer registry (architecture upgrade, phase A).
 * See the `clients` table comment above for the storage contract. Nothing
 * in this section ever deletes a client row; deleteOrder() above never
 * touches this table at all, by design.
 * ======================================================================== */

/** Same normalization index.js's normalizePhone() uses for delivery/webhook
 *  matching — duplicated deliberately (matches this codebase's existing
 *  convention, e.g. inventory.js's own normalizeProductName) rather than
 *  cross-importing, so this module has no dependency on index.js. Using the
 *  IDENTICAL rule here means a client found by phone always agrees with
 *  every other part of the system that already compares phone numbers. */
function normalizePhoneForClient(p) {
  if (!p) return '';
  p = String(p).replace(/\s/g, '');
  if (p.startsWith('+213')) return '0' + p.slice(4);
  if (p.startsWith('213')) return '0' + p.slice(3);
  return p;
}

const insertClientStmt = db.prepare(`INSERT INTO clients
  (id, phone, phoneDisplay, name, wilaya, commune, address,
   firstOrderAt, lastOrderAt, totalOrders, confirmedOrders, cancelledOrders, deliveredOrders, totalSpent,
   createdAt, updatedAt)
  VALUES (@id, @phone, @phoneDisplay, @name, @wilaya, @commune, @address,
   @firstOrderAt, @lastOrderAt, @totalOrders, @confirmedOrders, @cancelledOrders, @deliveredOrders, @totalSpent,
   @createdAt, @updatedAt)`);
const updateClientStmt = db.prepare(`UPDATE clients SET
  phoneDisplay=@phoneDisplay, name=@name, wilaya=@wilaya, commune=@commune,
  firstOrderAt=@firstOrderAt, lastOrderAt=@lastOrderAt,
  totalOrders=@totalOrders, confirmedOrders=@confirmedOrders, cancelledOrders=@cancelledOrders,
  deliveredOrders=@deliveredOrders, totalSpent=@totalSpent, updatedAt=@updatedAt
  WHERE id=@id`);
const getClientByPhoneStmt = db.prepare('SELECT * FROM clients WHERE phone=?');
const getClientByIdStmt = db.prepare('SELECT * FROM clients WHERE id=?');

function rowToClient(r) {
  if (!r) return null;
  return {
    id: r.id, phone: r.phone, phoneDisplay: r.phoneDisplay || r.phone,
    name: r.name || '', wilaya: r.wilaya || '', commune: r.commune || '', address: r.address || '',
    firstOrderAt: r.firstOrderAt, lastOrderAt: r.lastOrderAt,
    totalOrders: r.totalOrders || 0, confirmedOrders: r.confirmedOrders || 0,
    cancelledOrders: r.cancelledOrders || 0, deliveredOrders: r.deliveredOrders || 0,
    totalSpent: r.totalSpent || 0,
    avgOrderValue: r.deliveredOrders ? (r.totalSpent / r.deliveredOrders) : 0,
    // Imported baseline from an external CRM (phase B) — always separate
    // from the live counters above; see the addMissingColumns('clients', …)
    // comment for why. importedSource is '' / null for a client that has
    // never been touched by an import.
    importedTotalOrders: r.importedTotalOrders || 0, importedConfirmedOrders: r.importedConfirmedOrders || 0,
    importedCancelledOrders: r.importedCancelledOrders || 0, importedDeliveredOrders: r.importedDeliveredOrders || 0,
    importedTotalSpent: r.importedTotalSpent || 0, importedSource: r.importedSource || '', importedAt: r.importedAt || null,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

/**
 * Keeps the permanent `clients` record for an order's phone number in sync.
 * Called from INSIDE the same transaction as every order create/update
 * (see insertOrder/saveOrder above), so a client's lifetime stats can never
 * drift from what actually happened to their orders.
 *
 * `before` is the order's state prior to this write (null for a brand new
 * order); `after` is its state now. The counters below are LIFETIME EVENT
 * counts, not live snapshots: confirmedOrders means "how many times has one
 * of this client's orders reached Confirmed, ever" — it does NOT go back
 * down if that same order is later cancelled (that cancellation is instead
 * its own new event: cancelledOrders +1). This matches the "never rewrite,
 * only append" rule for everything else in this architecture. Crucially,
 * deleteOrder() never calls this at all — a client's history is not
 * reversible by deleting the order that created it.
 */
function upsertClientFromOrder(before, after) {
  if (!after || !after.phone) return;
  const phone = normalizePhoneForClient(after.phone);
  if (!phone) return;
  const now = Date.now();
  let client = getClientByPhoneStmt.get(phone);
  const isNewOrder = !before;

  if (!client) {
    insertClientStmt.run({
      id: 'CLI-' + now.toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase(),
      phone, phoneDisplay: after.phone || phone,
      name: after.client || '', wilaya: after.wilaya || '', commune: after.commune || '', address: '',
      firstOrderAt: after.createdAt || now, lastOrderAt: after.createdAt || now,
      totalOrders: 0, confirmedOrders: 0, cancelledOrders: 0, deliveredOrders: 0, totalSpent: 0,
      createdAt: now, updatedAt: now,
    });
    client = getClientByPhoneStmt.get(phone);
  }

  const wasConfirmed = !!before && before.status === 'confirmed';
  const isConfirmed = after.status === 'confirmed';
  const wasCancelled = !!before && before.status === 'cancelled';
  const isCancelled = after.status === 'cancelled';
  const wasDelivered = !!before && before.deliveryOutcome === 'delivered';
  const isDelivered = after.deliveryOutcome === 'delivered';

  updateClientStmt.run({
    id: client.id,
    phoneDisplay: after.phone || client.phoneDisplay,
    name: after.client || client.name,
    wilaya: after.wilaya || client.wilaya,
    commune: after.commune || client.commune,
    firstOrderAt: client.firstOrderAt || (after.createdAt || now),
    lastOrderAt: Math.max(client.lastOrderAt || 0, after.createdAt || now),
    totalOrders: client.totalOrders + (isNewOrder ? 1 : 0),
    confirmedOrders: client.confirmedOrders + ((isConfirmed && !wasConfirmed) ? 1 : 0),
    cancelledOrders: client.cancelledOrders + ((isCancelled && !wasCancelled) ? 1 : 0),
    deliveredOrders: client.deliveredOrders + ((isDelivered && !wasDelivered) ? 1 : 0),
    totalSpent: client.totalSpent + ((isDelivered && !wasDelivered) ? (Number(after.price) || 0) : 0),
    updatedAt: now,
  });
}

/** Same normalization inventory.js's resolveLines() already uses to match
 *  an order's product name against the CRM catalog — duplicated here
 *  deliberately (this module cannot require inventory.js; that would be
 *  the dependency running backwards) rather than cross-imported, matching
 *  this codebase's established convention for this exact situation. */
function normalizeProductNameForStats(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ');
}
function resolveOrderToProductId(order) {
  if (!order) return null;
  if (order.shopifyProductId) {
    const p = findProductByExternalId({ storeId: order.storeId || null, platform: order.platform || 'shopify', externalProductId: order.shopifyProductId });
    if (p) return p.id;
  }
  const norm = normalizeProductNameForStats(order.product || '');
  if (!norm) return null;
  const match = stmts.allProducts.all().find(r => normalizeProductNameForStats(r.name) === norm);
  return match ? match.id : null;
}
/**
 * Keeps a product's permanent lifetime stats (totalOrders, confirmedOrders,
 * cancelledOrders, deliveredOrders, totalRevenue, totalProfit,
 * first/lastOrderAt) in sync — the exact same "lifetime event count,
 * archiving/deleting the order never reverses it" design as
 * upsertClientFromOrder() above, for the exact same reason (req: "I want
 * lifetime statistics... nothing should disappear").
 *
 * Profit is computed from the REAL cost the order's stock movement(s)
 * actually recorded (see lib/inventory.js's FIFO lot consumption) — the
 * same source of truth /api/products/:id/sales-summary already uses for
 * period-accurate COGS — falling back to the product's flat
 * costPrice/packagingCost when no movement has cost info (predates the
 * lot feature, or reservationMode was 'none').
 */
function upsertProductStatsFromOrder(before, after) {
  if (!after) return;
  const productId = resolveOrderToProductId(after);
  if (!productId) return;
  const productRow = db.prepare('SELECT costPrice, packagingCost, firstOrderAt, lastOrderAt FROM products WHERE id=?').get(productId);
  if (!productRow) return;

  const isNewOrder = !before;
  const wasConfirmed = !!before && before.status === 'confirmed';
  const isConfirmed = after.status === 'confirmed';
  const wasCancelled = !!before && before.status === 'cancelled';
  const isCancelled = after.status === 'cancelled';
  const wasDelivered = !!before && before.deliveryOutcome === 'delivered';
  const isDelivered = after.deliveryOutcome === 'delivered';

  let revenueDelta = 0, profitDelta = 0;
  if (isDelivered && !wasDelivered) {
    revenueDelta = Number(after.price) || 0;
    const qty = Math.max(1, Number(after.quantity) || 1);
    const movements = db.prepare(`SELECT delta, unitCost, packagingCost FROM inventory_movements WHERE orderId=? AND reason IN ('reserve','confirm')`).all(after.id || '');
    let cost = 0;
    if (movements.length) {
      movements.forEach(m => {
        const mQty = Math.abs(Number(m.delta) || 0);
        if (m.unitCost !== null && m.unitCost !== undefined) cost += mQty * (Number(m.unitCost) + Number(m.packagingCost || 0));
        else cost += mQty * ((Number(productRow.costPrice) || 0) + (Number(productRow.packagingCost) || 0));
      });
    } else {
      cost = qty * ((Number(productRow.costPrice) || 0) + (Number(productRow.packagingCost) || 0));
    }
    profitDelta = revenueDelta - cost;
  }

  const now = after.createdAt || Date.now();
  db.prepare(`UPDATE products SET
      totalOrders = totalOrders + ?,
      confirmedOrders = confirmedOrders + ?,
      cancelledOrders = cancelledOrders + ?,
      deliveredOrders = deliveredOrders + ?,
      totalRevenue = totalRevenue + ?,
      totalProfit = totalProfit + ?,
      firstOrderAt = COALESCE(firstOrderAt, ?),
      lastOrderAt = MAX(COALESCE(lastOrderAt, 0), ?)
    WHERE id = ?`).run(
    isNewOrder ? 1 : 0,
    (isConfirmed && !wasConfirmed) ? 1 : 0,
    (isCancelled && !wasCancelled) ? 1 : 0,
    (isDelivered && !wasDelivered) ? 1 : 0,
    revenueDelta, profitDelta,
    now, now,
    productId
  );
}

function getClient(id) { return rowToClient(getClientByIdStmt.get(id)); }
function getClientByPhone(phone) { return rowToClient(getClientByPhoneStmt.get(normalizePhoneForClient(phone))); }

/** List/search clients. `search` matches name, phone (raw or normalized),
 *  or wilaya (simple LIKE — fine at COD-business scale; swap for FTS5 if
 *  this ever needs to scale past tens of thousands of clients). */
/** Shared WHERE-clause builder for the client list/count endpoints. All
 *  filters are optional and AND together. product/niche/store are never
 *  denormalized fields on the client itself — a client can order many
 *  different products/niches/stores over their lifetime — so those three
 *  correlate against the client's ENTIRE order history via
 *  orders.phoneNormalized = clients.phone, the same join key
 *  upsertClientFromOrder() already uses to keep client stats in sync.
 *  niche additionally joins orders -> products by product NAME (orders has
 *  no normalized product id for manually-created orders, only Shopify ones
 *  do) — this is a best-effort match, documented here rather than silently
 *  assumed: if a product was renamed after orders were placed, older
 *  orders under the old name won't match the niche filter. */
function buildClientFilterClause({ search, wilaya, product, niche, store, minOrders, minDelivered, since, until } = {}) {
  const clauses = [];
  const params = [];
  if (search && search.trim()) {
    const like = '%' + search.trim() + '%';
    const likePhone = '%' + normalizePhoneForClient(search.trim()) + '%';
    clauses.push('(name LIKE ? OR phone LIKE ? OR phoneDisplay LIKE ? OR wilaya LIKE ?)');
    params.push(like, likePhone, like, like);
  }
  if (wilaya && String(wilaya).trim()) {
    clauses.push('wilaya = ?');
    params.push(String(wilaya).trim());
  }
  if (product && String(product).trim()) {
    clauses.push('EXISTS (SELECT 1 FROM orders o WHERE o.phoneNormalized = clients.phone AND o.product LIKE ?)');
    params.push('%' + String(product).trim() + '%');
  }
  if (niche && String(niche).trim()) {
    clauses.push('EXISTS (SELECT 1 FROM orders o JOIN products p ON p.name = o.product WHERE o.phoneNormalized = clients.phone AND p.niche = ?)');
    params.push(String(niche).trim());
  }
  if (store && String(store).trim()) {
    clauses.push('EXISTS (SELECT 1 FROM orders o WHERE o.phoneNormalized = clients.phone AND o.storeName = ?)');
    params.push(String(store).trim());
  }
  if (minOrders !== undefined && minOrders !== null && minOrders !== '') {
    clauses.push('totalOrders >= ?');
    params.push(Number(minOrders) || 0);
  }
  if (minDelivered !== undefined && minDelivered !== null && minDelivered !== '') {
    clauses.push('deliveredOrders >= ?');
    params.push(Number(minDelivered) || 0);
  }
  if (since !== undefined && since !== null && since !== '') {
    clauses.push('lastOrderAt >= ?');
    params.push(Number(since));
  }
  if (until !== undefined && until !== null && until !== '') {
    clauses.push('lastOrderAt <= ?');
    params.push(Number(until));
  }
  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params };
}

/** Real, currently-in-use values for the client filter dropdowns — never a
 *  hardcoded list, since wilaya spellings/niches/stores are whatever this
 *  particular store actually has. Empty/blank values excluded. */
function getClientFilterOptions() {
  const wilayas = db.prepare("SELECT DISTINCT wilaya FROM clients WHERE wilaya IS NOT NULL AND wilaya != '' ORDER BY wilaya ASC").all().map(r => r.wilaya);
  const niches = db.prepare("SELECT DISTINCT niche FROM products WHERE niche IS NOT NULL AND niche != '' ORDER BY niche ASC").all().map(r => r.niche);
  const stores = db.prepare("SELECT DISTINCT storeName FROM orders WHERE storeName IS NOT NULL AND storeName != '' ORDER BY storeName ASC").all().map(r => r.storeName);
  return { wilayas, niches, stores };
}

function getClients({ search = '', sort = 'lastOrderAt', limit = 50, offset = 0, wilaya, product, niche, store, minOrders, minDelivered, since, until } = {}) {
  const sortCol = ['lastOrderAt', 'firstOrderAt', 'totalOrders', 'totalSpent', 'name'].includes(sort) ? sort : 'lastOrderAt';
  const { where, params } = buildClientFilterClause({ search, wilaya, product, niche, store, minOrders, minDelivered, since, until });
  const rows = db.prepare(`SELECT * FROM clients ${where} ORDER BY ${sortCol} DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return rows.map(rowToClient);
}

/** Backward compatible: countClients('some text') still works exactly like
 *  before (treated as {search: 'some text'}); countClients({...}) accepts
 *  the same filter object as getClients(). */
function countClients(filters = '') {
  const f = typeof filters === 'string' ? { search: filters } : (filters || {});
  const { where, params } = buildClientFilterClause(f);
  return db.prepare(`SELECT COUNT(*) AS n FROM clients ${where}`).get(...params).n;
}


/** Manual edit of the fields the manager is actually allowed to correct by
 *  hand (address has no reliable auto-source; name/wilaya/commune can be
 *  manually fixed for a typo without waiting for the next order). Never
 *  touches the lifetime counters — those only ever move via
 *  upsertClientFromOrder(). */
function updateClientDetails(id, patch) {
  const client = getClientByIdStmt.get(id);
  if (!client) return null;
  db.prepare(`UPDATE clients SET name=@name, wilaya=@wilaya, commune=@commune, address=@address, updatedAt=@updatedAt WHERE id=@id`).run({
    id,
    name: patch.name !== undefined ? patch.name : client.name,
    wilaya: patch.wilaya !== undefined ? patch.wilaya : client.wilaya,
    commune: patch.commune !== undefined ? patch.commune : client.commune,
    address: patch.address !== undefined ? patch.address : client.address,
    updatedAt: Date.now(),
  });
  return getClient(id);
}

/* ---------------------------------------------------------------------------
 * Client import (architecture upgrade, phase B) — CSV/Excel column mapping
 * happens in the browser (see index.html); this layer only ever sees clean
 * {name, phone, wilaya, commune, address, totalOrders, confirmedOrders,
 * cancelledOrders, deliveredOrders, totalSpent, source} records, one per
 * imported row.
 * ------------------------------------------------------------------------- */

/** Merges ONE imported record into the clients table.
 *  - No phone at all -> rejected outright (phone is the only identity key
 *    this system has; a client import cannot invent one).
 *  - Brand new phone -> a new client row, seeded directly from the import
 *    (nothing pre-existing to conflict with).
 *  - Existing phone -> identity fields (name/wilaya/commune/address) are
 *    filled ONLY where the CURRENT value is blank — a real existing value
 *    is never replaced by an imported one. The imported* stat columns are
 *    set once, on the FIRST import that ever touches this client (checked
 *    via importedSource being empty), and never touched again by a later
 *    import — "never overwrite" applies to imported data just as much as
 *    to live data. The LIVE totalOrders/confirmedOrders/… counters from
 *    upsertClientFromOrder() are never touched here at all. */
function importClientRecord(rec) {
  const phone = normalizePhoneForClient(rec.phone);
  if (!phone) return { ok: false, reason: 'no_phone' };
  const now = Date.now();
  let client = getClientByPhoneStmt.get(phone);
  const wasNew = !client;
  const alreadyImportedBefore = !!(client && client.importedSource);

  if (wasNew) {
    insertClientStmt.run({
      id: 'CLI-' + now.toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase(),
      phone, phoneDisplay: rec.phone || phone,
      name: '', wilaya: '', commune: '', address: '',
      firstOrderAt: null, lastOrderAt: null,
      totalOrders: 0, confirmedOrders: 0, cancelledOrders: 0, deliveredOrders: 0, totalSpent: 0,
      createdAt: now, updatedAt: now,
    });
    client = getClientByPhoneStmt.get(phone);
  }

  const identity = {
    name: (client.name && client.name.trim()) ? client.name : (rec.name || ''),
    wilaya: (client.wilaya && client.wilaya.trim()) ? client.wilaya : (rec.wilaya || ''),
    commune: (client.commune && client.commune.trim()) ? client.commune : (rec.commune || ''),
    address: (client.address && client.address.trim()) ? client.address : (rec.address || ''),
  };
  const importedStats = alreadyImportedBefore ? {
    importedTotalOrders: client.importedTotalOrders, importedConfirmedOrders: client.importedConfirmedOrders,
    importedCancelledOrders: client.importedCancelledOrders, importedDeliveredOrders: client.importedDeliveredOrders,
    importedTotalSpent: client.importedTotalSpent, importedSource: client.importedSource, importedAt: client.importedAt,
  } : {
    importedTotalOrders: Number(rec.totalOrders) || 0, importedConfirmedOrders: Number(rec.confirmedOrders) || 0,
    importedCancelledOrders: Number(rec.cancelledOrders) || 0, importedDeliveredOrders: Number(rec.deliveredOrders) || 0,
    importedTotalSpent: Number(rec.totalSpent) || 0, importedSource: rec.source || 'import', importedAt: now,
  };

  db.prepare(`UPDATE clients SET
      name=@name, wilaya=@wilaya, commune=@commune, address=@address,
      importedTotalOrders=@importedTotalOrders, importedConfirmedOrders=@importedConfirmedOrders,
      importedCancelledOrders=@importedCancelledOrders, importedDeliveredOrders=@importedDeliveredOrders,
      importedTotalSpent=@importedTotalSpent, importedSource=@importedSource, importedAt=@importedAt,
      updatedAt=@updatedAt
    WHERE id=@id`).run({ id: client.id, ...identity, ...importedStats, updatedAt: now });

  return { ok: true, client: getClient(client.id), wasNew, merged: !wasNew };
}

/** Read-only dry run over a batch of parsed rows — no writes at all. Lets
 *  the manager see "N new, M merged, K skipped" before committing to
 *  anything, per the "map columns before importing" requirement. Rows
 *  sharing a phone WITHIN the same file are conservatively counted as
 *  merges after the first — an estimate, not a guarantee, which is exactly
 *  what a preview should be. */
function previewImportClients(records) {
  const result = { toCreate: 0, toMerge: 0, skipped: 0, skippedRows: [] };
  const seenInFile = new Set();
  records.forEach((rec, i) => {
    const phone = normalizePhoneForClient(rec.phone);
    if (!phone) { result.skipped++; result.skippedRows.push({ row: i + 1, reason: 'no_phone' }); return; }
    const exists = !!getClientByPhoneStmt.get(phone) || seenInFile.has(phone);
    if (exists) result.toMerge++; else result.toCreate++;
    seenInFile.add(phone);
  });
  return result;
}

/** Actually performs the import, all rows in ONE transaction (atomic, and
 *  far faster than one auto-commit per row for a large file). */
function importClients(records, source) {
  const result = { created: 0, merged: 0, skipped: 0, skippedRows: [] };
  const tx = db.transaction(() => {
    records.forEach((rec, i) => {
      const r = importClientRecord({ ...rec, source });
      if (!r.ok) { result.skipped++; result.skippedRows.push({ row: i + 1, reason: r.reason }); }
      else if (r.wasNew) result.created++;
      else result.merged++;
    });
  });
  tx();
  return result;
}

/** Full chronological order history for one client (by phone), enriched
 *  with the delivery company name + timeline for orders that reached
 *  shipping. platform/brand/storeName/followupAgent are already
 *  denormalized directly onto `orders` (see addMissingColumns('orders', …)
 *  above), so this needs a real JOIN only for delivery company + timeline. */
function getClientOrderHistory(phone) {
  const norm = normalizePhoneForClient(phone);
  if (!norm) return [];
  const orders = db.prepare(`SELECT * FROM orders WHERE phoneNormalized=? ORDER BY createdAt DESC`).all(norm);
  return orders.map(o => {
    const provider = o.providerId ? db.prepare('SELECT name FROM providers WHERE id=?').get(o.providerId) : null;
    const shipment = db.prepare('SELECT * FROM shipments WHERE orderId=? ORDER BY createdAt DESC LIMIT 1').get(o.id);
    const timeline = shipment
      ? db.prepare('SELECT eventTime, crmStatus, description FROM shipment_events WHERE shipmentId=? ORDER BY eventTime ASC').all(shipment.id)
      : [];
    return {
      orderId: o.id,
      storeName: o.storeName || '', platform: o.platform || '', brand: o.brand || '',
      product: o.product || '', productVariant: o.productVariant || '', quantity: o.quantity || 1,
      orderValue: Number(o.price) || 0,
      deliveryCompany: provider ? provider.name : '',
      confirmationAgent: o.agent || '',
      followupAgent: o.followupAgent || '',
      status: o.status || '', deliveryOutcome: o.deliveryOutcome || '',
      createdAt: o.createdAt,
      timeline: timeline.map(t => ({ time: t.eventTime, status: t.crmStatus, description: t.description })),
    };
  });
}

function addCall(orderId, call) {
  stmts.insertCall.run({
    orderId,
    time: call.time,
    callStartTime: call.callStartTime,
    duration: call.duration,
    threshold: call.threshold,
    suspicious: call.suspicious === true ? 1 : call.suspicious === false ? 0 : null,
    result: call.result,
    note: call.note || '',
    noteType: call.noteType || null,
    agent: call.agent || '',
  });
}

/* Public agent shape. The password is NEVER included (audit SEC-02): this
 * object is returned straight to the browser by GET /api/agents, and the old
 * version carried `pass` in cleartext — which is what let the agent PWA compare
 * passwords client-side, and let anyone read every credential in the system
 * with one unauthenticated request.
 *
 * `hasPassword` replaces it: enough for the UI to warn a manager that an
 * account can still be entered with a blank password, without disclosing
 * anything. Use listAgentSecrets()/getAgentRaw() for the server-side hash. */
function rowToAgent(a) {
  return {
    name: a.name,
    role: a.role || 'confirmation',
    accountRole: a.accountRole || 'agent',
    hasPassword: a.hasPassword === null || a.hasPassword === undefined ? !!a.pass : !!a.hasPassword,
    missedOrders: a.missedOrders || 0,
    suspended: !!a.suspended,
    baseSalaryMonthly: a.baseSalaryMonthly || 0,
    payPerConfirmedOrder: a.payPerConfirmedOrder || 0,
    payPerDeliveredOrder: a.payPerDeliveredOrder || 0,
    weeklyDaysOff: safeParseDaysOff(a.weeklyDaysOff),
  };
}
function getAgents() { return stmts.allAgents.all().map(rowToAgent); }

/* ---- Server-side only: these DO expose the stored hash. Never route their
 * output to a response. ---- */
function listAgentSecrets() { return stmts.allAgents.all().map(a => ({ name: a.name, pass: a.pass })); }
function getAgentRaw(name) { return db.prepare('SELECT * FROM agents WHERE name = ?').get(name) || null; }
/* `hasPassword` is tracked in its own column because a salted hash cannot tell
 * you whether the input was blank — and "this account can be entered with an
 * empty password field" is exactly what a manager needs to see. */
function setAgentPasswordHash(name, hash, hasPassword = true) {
  db.prepare('UPDATE agents SET pass = ?, hasPassword = ? WHERE name = ?')
    .run(hash, hasPassword ? 1 : 0, name);
}
function setAccountRole(name, accountRole) {
  db.prepare('UPDATE agents SET accountRole = ? WHERE name = ?').run(accountRole, name);
}
function countManagers() {
  return db.prepare("SELECT COUNT(*) AS c FROM agents WHERE accountRole = 'manager'").get().c;
}

/* ---- Sessions ---- */
function createSession(s) {
  db.prepare(`INSERT INTO sessions (id, agentName, createdAt, expiresAt, lastSeenAt, userAgent, ip)
    VALUES (@id, @agentName, @createdAt, @expiresAt, @createdAt, @userAgent, @ip)`).run(s);
  return s;
}
function getSession(id) { return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) || null; }
function touchSession(id) { db.prepare('UPDATE sessions SET lastSeenAt = ? WHERE id = ?').run(Date.now(), id); }
function deleteSession(id) { db.prepare('DELETE FROM sessions WHERE id = ?').run(id); }
function deleteSessionsForAgent(agentName) { db.prepare('DELETE FROM sessions WHERE agentName = ?').run(agentName); }
function deleteExpiredSessions() {
  return db.prepare('DELETE FROM sessions WHERE expiresAt < ?').run(Date.now()).changes;
}
function listSessionsForAgent(agentName) {
  return db.prepare('SELECT id, createdAt, expiresAt, lastSeenAt, userAgent, ip FROM sessions WHERE agentName = ? ORDER BY lastSeenAt DESC').all(agentName);
}
function safeParseDaysOff(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter(n => Number.isInteger(n) && n >= 0 && n <= 6) : [];
  } catch (e) { return []; }
}
function getAgentsByRole(role) {
  // role = 'followup' returns followup + both; 'confirmation' returns confirmation + both; 'both' returns all.
  return getAgents().filter(a => {
    if (role === 'both') return true;
    return a.role === role || a.role === 'both';
  });
}
/* `pass` is stored VERBATIM — callers are responsible for hashing it first
 * (see lib/auth.js hashPassword). Keeping the hashing decision at the caller
 * means this layer never has to know the KDF, and the legacy-import path below
 * can hand over plaintext that the boot migration then rewrites. */
function addAgent(name, pass, role, opts = {}) {
  db.prepare('INSERT INTO agents(name,pass,role,accountRole,hasPassword) VALUES(?,?,?,?,?)')
    .run(name, pass || '', role || 'confirmation', opts.accountRole || 'agent',
         opts.hasPassword === undefined ? (pass ? 1 : 0) : (opts.hasPassword ? 1 : 0));
}
function updateAgentRole(name, role) {
  db.prepare('UPDATE agents SET role = ? WHERE name = ?').run(role || 'confirmation', name);
}
function removeAgent(name) {
  db.prepare('DELETE FROM agents WHERE name = ?').run(name);
}

/* ---------------------------------------------------------------------------
 * Agent accountability (Confirmation Agent Dashboard spec §4-§7).
 * missedOrders is permanent and only ever changed by an explicit manager
 * reset — auto-reassignment increments it, nothing auto-decrements it.
 * suspended blocks agent login (checked wherever login happens) until a
 * manager explicitly reactivates.
 * ------------------------------------------------------------------------- */
function patchAgent(name, patch) {
  const fields = [];
  const params = {};
  if (patch.role !== undefined)         { fields.push('role = @role'); params.role = patch.role; }
  if (patch.missedOrders !== undefined) { fields.push('missedOrders = @missedOrders'); params.missedOrders = patch.missedOrders; }
  if (patch.suspended !== undefined)    { fields.push('suspended = @suspended'); params.suspended = patch.suspended ? 1 : 0; }
  if (patch.baseSalaryMonthly !== undefined)    { fields.push('baseSalaryMonthly = @baseSalaryMonthly'); params.baseSalaryMonthly = Number(patch.baseSalaryMonthly) || 0; }
  if (patch.payPerConfirmedOrder !== undefined) { fields.push('payPerConfirmedOrder = @payPerConfirmedOrder'); params.payPerConfirmedOrder = Number(patch.payPerConfirmedOrder) || 0; }
  if (patch.payPerDeliveredOrder !== undefined) { fields.push('payPerDeliveredOrder = @payPerDeliveredOrder'); params.payPerDeliveredOrder = Number(patch.payPerDeliveredOrder) || 0; }
  if (patch.weeklyDaysOff !== undefined) {
    const days = Array.isArray(patch.weeklyDaysOff) ? patch.weeklyDaysOff.filter(n => Number.isInteger(n) && n >= 0 && n <= 6) : [];
    fields.push('weeklyDaysOff = @weeklyDaysOff'); params.weeklyDaysOff = JSON.stringify(days);
  }
  if (!fields.length) return getAgents().find(a => a.name === name) || null;
  params.name = name;
  db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE name = @name`).run(params);
  return getAgents().find(a => a.name === name) || null;
}

/** Increments the permanent missed-orders counter and returns the NEW total
 *  (callers check this against the suspend threshold right after). */
function incrementMissedOrders(name) {
  db.prepare('UPDATE agents SET missedOrders = COALESCE(missedOrders, 0) + 1 WHERE name = ?').run(name);
  const row = db.prepare('SELECT missedOrders FROM agents WHERE name = ?').get(name);
  return row ? (row.missedOrders || 0) : 0;
}

/** Manager-only: reset an agent's missed-orders counter back to zero. */
function resetMissedOrders(name) {
  db.prepare('UPDATE agents SET missedOrders = 0 WHERE name = ?').run(name);
}

function suspendAgent(name)   { db.prepare('UPDATE agents SET suspended = 1 WHERE name = ?').run(name); }
function reactivateAgent(name) { db.prepare('UPDATE agents SET suspended = 0 WHERE name = ?').run(name); }

/** Payroll for one agent over [since, until]. Three independent components:
 *  - salaryPay: baseSalaryMonthly prorated to periodType via prorateMonthlyAmount.
 *  - confirmedPay: payPerConfirmedOrder × count of orders where this agent is
 *    the confirming agent (orders.agent) AND status='confirmed', attributed
 *    by order createdAt. KNOWN SIMPLIFICATION: there is no separate
 *    confirmedAt timestamp on orders, so an order confirmed near a period
 *    boundary is credited to whichever period it was CREATED in, not
 *    necessarily when the confirming call actually happened.
 *  - deliveredPay: payPerDeliveredOrder × count of orders where this agent is
 *    EITHER the confirming agent (orders.agent) OR the assigned follow-up
 *    agent (orders.followupAgent) AND deliveryOutcome='delivered', attributed
 *    by the real deliveryOutcomeAt (carrier-settled, not the phone status —
 *    same source of truth as getOrdersByDeliveryOutcome above). If two
 *    DIFFERENT agents each touch the same order (one confirms, another
 *    follows up), EACH earns their own full delivered-pay independently —
 *    this is not split/shared between them. */
function computeAgentPayroll(name, since, until, periodType) {
  const agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(name);
  if (!agent) return null;
  const s = Number(since) || 0, u = Number(until) || Date.now();

  const confirmedOrders = db.prepare(`
    SELECT COUNT(*) AS n FROM orders
    WHERE agent = ? AND status = 'confirmed' AND createdAt >= ? AND createdAt <= ?
  `).get(name, s, u).n;

  const deliveredOrders = db.prepare(`
    SELECT COUNT(*) AS n FROM orders
    WHERE (agent = ? OR followupAgent = ?) AND deliveryOutcome = 'delivered'
      AND deliveryOutcomeAt >= ? AND deliveryOutcomeAt <= ?
  `).get(name, name, s, u).n;

  const baseSalaryMonthly = agent.baseSalaryMonthly || 0;
  const payPerConfirmedOrder = agent.payPerConfirmedOrder || 0;
  const payPerDeliveredOrder = agent.payPerDeliveredOrder || 0;

  const salaryPay = prorateMonthlyAmount(baseSalaryMonthly, periodType, s, u);
  const confirmedPay = confirmedOrders * payPerConfirmedOrder;
  const deliveredPay = deliveredOrders * payPerDeliveredOrder;

  return {
    name, role: agent.role || 'confirmation',
    since: s, until: u, periodType: periodType || 'custom',
    confirmedOrders, deliveredOrders,
    baseSalaryMonthly, payPerConfirmedOrder, payPerDeliveredOrder,
    salaryPay, confirmedPay, deliveredPay,
    totalPay: salaryPay + confirmedPay + deliveredPay,
  };
}

/** Payroll for every agent over the same [since, until] window — one row
 *  per agent, same shape as computeAgentPayroll. */
function computeAllAgentsPayroll(since, until, periodType) {
  return getAgents().map(a => computeAgentPayroll(a.name, since, until, periodType)).filter(Boolean);
}

/** Orders assigned to an agent that have sat with ZERO logged calls —
 *  candidates for auto-reassignment (spec §4). Deliberately excludes orders
 *  with an active in-progress call (pendingCallStart set) so an agent
 *  mid-call is never pulled out from under them. Only 'pending'
 *  (never-yet-attempted) orders are considered — a later attempt's own
 *  timeout is a separate, not-yet-requested feature.
 *  NOTE: does NOT filter by exact elapsed time here — the caller (index.js)
 *  computes each order's precise eligibility, since orders created outside
 *  working hours get a different rule (night grace period) than orders
 *  created during working hours. A generous 72h lookback just keeps this
 *  query bounded, not the actual overdue determination. */
function listOverdueUnansweredOrders() {
  const lookback = Date.now() - 72 * 3600000;
  const rows = db.prepare(`
    SELECT * FROM orders
    WHERE agent IS NOT NULL AND agent != ''
      AND status = 'pending'
      AND pendingCallStart IS NULL
      AND overdueFlaggedAt IS NULL
      AND createdAt > ?
      AND id NOT IN (SELECT DISTINCT orderId FROM order_calls)
  `).all(lookback);
  return rows.map(r => attachCalls(rowToOrder(r)));
}

function getProducts() { return stmts.allProducts.all().map(rowToProduct); }
/** Product list views (frontend) use these — archived items are hidden
 *  from the normal working list by default so they don't clutter it, but
 *  getProducts() above stays UNCHANGED and still returns everything
 *  (archived included), because internal order-resolution / stock /
 *  stats code (this file, inventory.js) must keep matching orders against
 *  products that have since been archived — an old order didn't stop
 *  happening just because the product isn't sold anymore. */
function getActiveProducts() { return stmts.allProducts.all().filter(r => !r.archived).map(rowToProduct); }
function getArchivedProducts() { return stmts.allProducts.all().filter(r => r.archived).map(rowToProduct); }
function getProduct(id) { return rowToProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(id)); }
const insertProductEventStmt = db.prepare(`INSERT INTO product_events (productId, eventType, field, oldValue, newValue, actor) VALUES (?, ?, ?, ?, ?, ?)`);
/** Appends ONE row to the permanent product timeline — never updated,
 *  never deleted, matching inventory_movements' own immutability rule. */
function logProductEvent(productId, eventType, field, oldValue, newValue, actor = 'system') {
  insertProductEventStmt.run(
    productId, eventType, field || null,
    (oldValue === null || oldValue === undefined) ? null : String(oldValue),
    (newValue === null || newValue === undefined) ? null : String(newValue),
    actor || 'system'
  );
}
function insertProduct(p) {
  const variants = normalizeVariantStock(p.variants || []);
  stmts.insertProduct.run({
    id: p.id, name: p.name, sku: p.sku || '', description: p.description || '',
    price: p.price || 0, variants: JSON.stringify(variants),
    optionDefs: JSON.stringify(Array.isArray(p.optionDefs) ? p.optionDefs : []),
    image: p.image || '',
    threshold: (p.threshold === undefined || p.threshold === null || p.threshold === '') ? 24 : Number(p.threshold),
    costPrice: Number(p.costPrice) || 0, packagingCost: Number(p.packagingCost) || 0,
    // Auto-sum: when any variant carries a concrete stock number, the
    // product's flat `stock` column always mirrors their sum on save, so
    // every other place that reads product.stock (dashboards, low-stock
    // checks, exports) stays correct without having to know about variants
    // at all. Falls back to whatever flat stock was given when no variant
    // has stock set (a product with no variants, or variants with unknown
    // stock) — see productStockTotal().
    stock: productStockTotal({ variants, stock: p.stock || 0 }),
    brand: p.brand || '', niche: p.niche || '', category: p.category || '', supplier: p.supplier || '',
    createdAt: p.createdAt || Date.now(),
  });
  logProductEvent(p.id, 'created', null, null, p.name, p.actor || 'admin');
  return getProduct(p.id);
}
function saveProduct(p) {
  const existing = getProduct(p.id);
  const tx = db.transaction(() => {
    if (existing) {
      const variants = normalizeVariantStock(p.variants || []);
      const newPrice = p.price || 0;
      const newCostPrice = Number(p.costPrice) || 0;
      const newPackagingCost = Number(p.packagingCost) || 0;
      const newBrand = p.brand || '', newNiche = p.niche || '', newCategory = p.category || '', newSupplier = p.supplier || '';
      stmts.updateProduct.run({
        id: p.id, name: p.name, sku: p.sku || '', description: p.description || '',
        price: newPrice, variants: JSON.stringify(variants),
        optionDefs: JSON.stringify(Array.isArray(p.optionDefs) ? p.optionDefs : []),
        image: p.image || '',
        threshold: (p.threshold === undefined || p.threshold === null || p.threshold === '') ? 24 : Number(p.threshold),
        costPrice: newCostPrice, packagingCost: newPackagingCost,
        stock: productStockTotal({ variants, stock: p.stock || 0 }),
        brand: newBrand, niche: newNiche, category: newCategory, supplier: newSupplier,
      });

      // --- Historical timeline (phase C): log exactly what changed, one
      // event per changed field, so nothing is inferred or guessed later
      // from a diff — the record of "what changed and when" is written
      // at the moment it happens. ---
      const actor = p.actor || 'admin';
      if (newPrice !== existing.price) logProductEvent(p.id, 'price_change', 'price', existing.price, newPrice, actor);
      if (newCostPrice !== existing.costPrice) logProductEvent(p.id, 'cost_change', 'costPrice', existing.costPrice, newCostPrice, actor);
      if (newPackagingCost !== existing.packagingCost) logProductEvent(p.id, 'packaging_cost_change', 'packagingCost', existing.packagingCost, newPackagingCost, actor);
      if (newSupplier !== existing.supplier) logProductEvent(p.id, 'supplier_changed', 'supplier', existing.supplier, newSupplier, actor);
      if (newBrand !== existing.brand) logProductEvent(p.id, 'brand_changed', 'brand', existing.brand, newBrand, actor);
      // Variants added/removed, matched by name (what a manager actually
      // recognizes), not by array position — reordering variants is not
      // an add+remove.
      const oldNames = new Set(existing.variants.map(v => v.name));
      const newNames = new Set(variants.map(v => v.name));
      variants.forEach(v => { if (v.name && !oldNames.has(v.name)) logProductEvent(p.id, 'variant_added', 'variants', null, v.name, actor); });
      existing.variants.forEach(v => { if (v.name && !newNames.has(v.name)) logProductEvent(p.id, 'variant_removed', 'variants', v.name, null, actor); });
    }
    else insertProduct(p);
  });
  tx();
  return getProduct(p.id);
}
/** Soft-delete: the product row is NEVER removed — "even if I stop
 *  selling it, even if I archive it... I want a permanent product
 *  history" is the exact requirement this satisfies. Archived products
 *  drop out of getActiveProducts() (the normal working list) but stay
 *  fully intact for getProduct()/history/reporting, forever. */
function archiveProduct(id, actor = 'admin') {
  const p = getProduct(id);
  if (!p) return null;
  db.prepare('UPDATE products SET archived=1, archivedAt=? WHERE id=?').run(Date.now(), id);
  logProductEvent(id, 'archived', null, null, null, actor);
  return getProduct(id);
}
function unarchiveProduct(id, actor = 'admin') {
  const p = getProduct(id);
  if (!p) return null;
  db.prepare('UPDATE products SET archived=0, archivedAt=NULL WHERE id=?').run(id);
  logProductEvent(id, 'unarchived', null, null, null, actor);
  return getProduct(id);
}
/** The permanent timeline + the store links this product has ever had —
 *  everything a "product profile" view needs beyond the live row itself. */
function getProductHistory(productId) {
  const events = db.prepare('SELECT * FROM product_events WHERE productId=? ORDER BY createdAt DESC').all(productId);
  const links = db.prepare(`SELECT pl.platform, pl.storeId, pl.externalProductId, pl.createdAt, s.name AS storeName
    FROM product_links pl LEFT JOIN stores s ON s.id = pl.storeId WHERE pl.productId=? ORDER BY pl.createdAt ASC`).all(productId);
  return {
    events: events.map(e => ({ id: e.id, eventType: e.eventType, field: e.field, oldValue: e.oldValue, newValue: e.newValue, actor: e.actor, createdAt: e.createdAt })),
    stores: links.map(l => ({ platform: l.platform, storeName: l.storeName || l.storeId || '', externalProductId: l.externalProductId, linkedAt: l.createdAt })),
  };
}
// True hard delete — kept available at the DB layer for genuine cleanup
// (e.g. a duplicate created by mistake seconds ago), but the normal
// app flow (DELETE /api/products/:id) calls archiveProduct() instead, per
// "even if I archive it, I want a permanent product history."
function deleteProduct(id) { stmts.deleteProduct.run(id); }

/* ---------------------------------------------------------------------------
 * Multi-store product links — see the product_links table comment for the
 * full rationale. One CRM product, many external listings.
 * ------------------------------------------------------------------------- */

/** Record that a CRM product is also sold under an external id on some
 *  store/platform. Silently no-ops (does not duplicate) if that exact
 *  (platform, storeId, externalProductId) link already exists. */
function linkProductToExternal({ productId, storeId = null, platform, externalProductId, externalVariantId = null }) {
  const existing = db.prepare(`
    SELECT * FROM product_links
    WHERE platform = ? AND externalProductId = ? AND (storeId IS ? OR storeId = ?)
  `).get(platform, String(externalProductId), storeId, storeId);
  if (existing) return existing;
  db.prepare(`
    INSERT INTO product_links (productId, storeId, platform, externalProductId, externalVariantId, createdAt)
    VALUES (@productId, @storeId, @platform, @externalProductId, @externalVariantId, @createdAt)
  `).run({ productId, storeId, platform, externalProductId: String(externalProductId), externalVariantId: externalVariantId !== null ? String(externalVariantId) : null, createdAt: Date.now() });
  return db.prepare(`SELECT * FROM product_links WHERE platform = ? AND externalProductId = ? AND (storeId IS ? OR storeId = ?)`).get(platform, String(externalProductId), storeId, storeId);
}

/** Find the CRM product for a given external (platform, storeId, id) —
 *  storeId null matches links that also have storeId null (the single
 *  default Shopify integration case). Returns null if no link exists yet,
 *  in which case callers should fall back to name-based matching. */
function findProductByExternalId({ storeId = null, platform, externalProductId }) {
  if (!externalProductId) return null;
  const link = db.prepare(`
    SELECT * FROM product_links
    WHERE platform = ? AND externalProductId = ? AND (storeId IS ? OR storeId = ?)
  `).get(platform, String(externalProductId), storeId, storeId);
  return link ? getProduct(link.productId) : null;
}

/** All external links for one CRM product (for a future "linked stores" UI). */
function getProductLinks(productId) {
  return db.prepare('SELECT * FROM product_links WHERE productId = ? ORDER BY createdAt DESC').all(productId);
}

function unlinkProduct(linkId) {
  db.prepare('DELETE FROM product_links WHERE id = ?').run(linkId);
}

/* ---------------------------------------------------------------------------
 * Unexpected charges — one-off dated expenses (profit calculator).
 * ------------------------------------------------------------------------- */
function addUnexpectedCharge({ label, amount, date }) {
  const info = db.prepare(`
    INSERT INTO unexpected_charges (label, amount, date, createdAt)
    VALUES (@label, @amount, @date, @createdAt)
  `).run({ label, amount: Number(amount) || 0, date: Number(date) || Date.now(), createdAt: Date.now() });
  return db.prepare('SELECT * FROM unexpected_charges WHERE id = ?').get(info.lastInsertRowid);
}
/** All unexpected charges whose date falls within [since, until] (ms epoch, inclusive). */
function listUnexpectedCharges(since, until) {
  if (since === undefined && until === undefined) {
    return db.prepare('SELECT * FROM unexpected_charges ORDER BY date DESC').all();
  }
  return db.prepare('SELECT * FROM unexpected_charges WHERE date >= ? AND date <= ? ORDER BY date DESC').all(since || 0, until || Date.now());
}
function deleteUnexpectedCharge(id) {
  db.prepare('DELETE FROM unexpected_charges WHERE id = ?').run(id);
}

/* ---------------------------------------------------------------------------
 * Financial records — permanent P&L history + aggregation (architecture
 * upgrade, phase D). See the financial_records table comment for the
 * immutability contract.
 * ------------------------------------------------------------------------- */
const insertFinancialRecordStmt = db.prepare(`INSERT INTO financial_records
  (id, periodType, startDate, endDate, revenue, productCosts, shippingCosts, advertisingCosts,
   fixedExpenses, unexpectedExpenses, netProfit, margin, notes, source, productBreakdown, actor, createdAt)
  VALUES (@id, @periodType, @startDate, @endDate, @revenue, @productCosts, @shippingCosts, @advertisingCosts,
   @fixedExpenses, @unexpectedExpenses, @netProfit, @margin, @notes, @source, @productBreakdown, @actor, @createdAt)`);
function rowToFinancialRecord(r) {
  if (!r) return null;
  return {
    id: r.id, periodType: r.periodType, startDate: r.startDate, endDate: r.endDate,
    revenue: r.revenue || 0, productCosts: r.productCosts || 0, shippingCosts: r.shippingCosts || 0,
    advertisingCosts: r.advertisingCosts || 0, fixedExpenses: r.fixedExpenses || 0, unexpectedExpenses: r.unexpectedExpenses || 0,
    netProfit: r.netProfit || 0, margin: r.margin || 0, notes: r.notes || '', source: r.source || 'manual',
    productBreakdown: safeJson(r.productBreakdown, []), actor: r.actor || '', createdAt: r.createdAt,
  };
}
/** Persists ONE immutable snapshot. Net profit + margin are always
 *  recomputed here from the component figures (never trusted from the
 *  caller) so a record can never be internally inconsistent. */
function saveFinancialRecord(r) {
  const revenue = Number(r.revenue) || 0;
  const productCosts = Number(r.productCosts) || 0;
  const shippingCosts = Number(r.shippingCosts) || 0;
  const advertisingCosts = Number(r.advertisingCosts) || 0;
  const fixedExpenses = Number(r.fixedExpenses) || 0;
  const unexpectedExpenses = Number(r.unexpectedExpenses) || 0;
  const netProfit = revenue - productCosts - shippingCosts - advertisingCosts - fixedExpenses - unexpectedExpenses;
  const margin = revenue ? (netProfit / revenue * 100) : 0;
  const now = Date.now();
  const id = 'FIN-' + now.toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  insertFinancialRecordStmt.run({
    id, periodType: r.periodType, startDate: Number(r.startDate), endDate: Number(r.endDate),
    revenue, productCosts, shippingCosts, advertisingCosts, fixedExpenses, unexpectedExpenses,
    netProfit, margin, notes: r.notes || '', source: r.source || 'manual',
    productBreakdown: JSON.stringify(Array.isArray(r.productBreakdown) ? r.productBreakdown : []),
    actor: r.actor || 'admin', createdAt: now,
  });
  return getFinancialRecord(id);
}
function getFinancialRecord(id) {
  return rowToFinancialRecord(db.prepare('SELECT * FROM financial_records WHERE id=?').get(id));
}
/** Every version ever saved for one EXACT period, newest first — the full
 *  audit trail ("what did we think Week of Jan 5 looked like, and when did
 *  our estimate change"). */
function getFinancialRecordVersions(periodType, startDate, endDate) {
  return db.prepare(`SELECT * FROM financial_records WHERE periodType=? AND startDate=? AND endDate=? ORDER BY createdAt DESC`)
    .all(periodType, Number(startDate), Number(endDate)).map(rowToFinancialRecord);
}
/** The list a "Financial History" page shows: ONE row per distinct period —
 *  whichever version of it is newest — never every re-save. */
function getFinancialRecords({ periodType, limit = 100, offset = 0 } = {}) {
  const whereType = periodType ? 'WHERE periodType=?' : '';
  const params = periodType ? [periodType] : [];
  const rows = db.prepare(`
    SELECT fr.* FROM financial_records fr
    INNER JOIN (
      SELECT periodType, startDate, endDate, MAX(createdAt) AS maxCreated
      FROM financial_records ${whereType}
      GROUP BY periodType, startDate, endDate
    ) latest
      ON fr.periodType = latest.periodType AND fr.startDate = latest.startDate
     AND fr.endDate = latest.endDate AND fr.createdAt = latest.maxCreated
    ORDER BY fr.startDate DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  return rows.map(rowToFinancialRecord);
}
function getLatestFinancialRecordForPeriod(periodType, startDate, endDate) {
  const versions = getFinancialRecordVersions(periodType, startDate, endDate);
  return versions[0] || null;
}

/** Total of every recurring MONTHLY fixed cost currently configured
 *  (settings.fixedCosts — salaries, rent, internet, subscriptions, …). */
function getMonthlyFixedCostsTotal() {
  const s = getSettings();
  const list = Array.isArray(s.fixedCosts) ? s.fixedCosts : [];
  return list.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
}
/**
 * Automatic fixed-expense proration (req §7) — the exact rule specified:
 * monthly amount ÷4 for a week, full amount for a month, proportional by
 * day-count for a day. Quarter/year extend the same logic (×3 / ×12); any
 * other/custom range prorates by its exact day count against an average
 * 30.44-day month (365.25/12), which is the standard way to prorate an
 * irregular date range against a monthly figure.
 */
/** Shared proration core: takes a MONTHLY amount and scales it to whatever
 *  periodType is being viewed. Extracted out of prorateFixedExpenses so the
 *  exact same rule (÷4 week, full month, ×3/×12 quarter/year, day-count/day,
 *  ÷30.44×days for anything else) also drives agent salary proration below —
 *  ONE rule, one place, instead of two copies that could drift apart.
 *  periodType==='month' returns the amount UNCHANGED (exact), never the
 *  30.44-day-average approximation — that approximation is only for
 *  non-calendar-aligned custom ranges. */
function prorateMonthlyAmount(amount, periodType, startDate, endDate) {
  const monthly = Number(amount) || 0;
  if (periodType === 'month') return monthly;
  if (periodType === 'week') return monthly / 4;
  if (periodType === 'quarter') return monthly * 3;
  if (periodType === 'year') return monthly * 12;
  if (periodType === 'day') {
    const d = new Date(Number(startDate));
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return monthly / daysInMonth;
  }
  const days = Math.max(1, Math.round((Number(endDate) - Number(startDate)) / 86400000));
  return monthly / 30.44 * days;
}

function prorateFixedExpenses(periodType, startDate, endDate) {
  return prorateMonthlyAmount(getMonthlyFixedCostsTotal(), periodType, startDate, endDate);
}

/**
 * Rolls up the LATEST saved sub-period records that fall inside
 * [startDate,endDate) into one aggregate figure — week→month,
 * month→quarter, month→year, per req §6 exactly ("Monthly reports must
 * automatically use the saved weekly records… Yearly reports must
 * automatically use the saved monthly records"). Reads ONLY what was
 * already saved; never touches orders/inventory — this is the fast path
 * the requirement is explicitly asking for, as an alternative to
 * recomputing a whole quarter from raw data every time.
 *
 * Returns a COMPUTED result (not yet persisted) plus how many sub-records
 * were actually found, so the caller can warn if coverage is incomplete
 * (e.g. only 3 of a month's ~4 weeks were ever saved) before deciding
 * whether to save this aggregate as its own permanent record.
 */
function aggregateFinancialPeriod(periodType, startDate, endDate) {
  const subType = { quarter: 'month', year: 'month', month: 'week' }[periodType];
  if (!subType) return { covered: false, subRecordsUsed: 0, reason: 'no_smaller_unit' };
  const subRecords = getFinancialRecords({ periodType: subType, limit: 2000 })
    .filter(r => r.startDate >= Number(startDate) && r.startDate < Number(endDate));
  if (!subRecords.length) return { covered: false, subRecordsUsed: 0, reason: 'no_saved_sub_records' };
  const sum = (key) => subRecords.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const revenue = sum('revenue'), productCosts = sum('productCosts'), shippingCosts = sum('shippingCosts'),
        advertisingCosts = sum('advertisingCosts'), fixedExpenses = sum('fixedExpenses'), unexpectedExpenses = sum('unexpectedExpenses');
  const netProfit = revenue - productCosts - shippingCosts - advertisingCosts - fixedExpenses - unexpectedExpenses;
  return {
    covered: true, subRecordsUsed: subRecords.length, subPeriodType: subType,
    periodType, startDate: Number(startDate), endDate: Number(endDate),
    revenue, productCosts, shippingCosts, advertisingCosts, fixedExpenses, unexpectedExpenses,
    netProfit, margin: revenue ? (netProfit / revenue * 100) : 0,
  };
}

/* ---------------------------------------------------------------------------
 * Push subscriptions (Web Push — real OS-level notifications, work even when
 * the app is closed/backgrounded, unlike the existing SSE-based in-app ones).
 * ------------------------------------------------------------------------- */
function addPushSubscription({ agent, endpoint, p256dh, auth }) {
  db.prepare(`
    INSERT INTO push_subscriptions (agent, endpoint, p256dh, auth, createdAt)
    VALUES (@agent, @endpoint, @p256dh, @auth, @createdAt)
    ON CONFLICT(endpoint) DO UPDATE SET agent=excluded.agent, p256dh=excluded.p256dh, auth=excluded.auth
  `).run({ agent, endpoint, p256dh, auth, createdAt: Date.now() });
  return db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
}
function getPushSubscriptionsForAgent(agent) {
  return db.prepare('SELECT * FROM push_subscriptions WHERE agent = ?').all(agent);
}
/** Called when a push send fails with 404/410 (push service confirms the
 *  subscription is gone — e.g. the agent uninstalled the app) — cleans up
 *  dead rows so we stop wasting sends on them. */
function deletePushSubscriptionByEndpoint(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

/** Orders whose REAL delivery outcome (from the carrier, not the phone
 *  confirmation) is 'delivered' or 'returned', settled within [since, until]
 *  (by deliveryOutcomeAt). This is the actual-sales source of truth for the
 *  profit calculator — a phone 'confirmed' status is not a guaranteed sale
 *  under cash-on-delivery (per the manager, 30-50% of confirmed orders can
 *  still be refused/returned at the door). */
function getOrdersByDeliveryOutcome({ outcome, since, until }) {
  const rows = db.prepare(`
    SELECT * FROM orders
    WHERE deliveryOutcome = ?
      AND deliveryOutcomeAt >= ? AND deliveryOutcomeAt <= ?
  `).all(outcome, since || 0, until || Date.now());
  return rows.map(r => attachCalls(rowToOrder(r)));
}

function getStores() { return stmts.allStores.all().map(rowToStore); }
function getStore(id) { return rowToStore(db.prepare('SELECT * FROM stores WHERE id = ?').get(id)); }
function saveStore(s) {
  const existing = s.id ? db.prepare('SELECT * FROM stores WHERE id = ?').get(s.id) : null;
  // Preserve secrets when the caller sent the masked form (••••) or omitted them.
  const keep = (incoming, stored) => (incoming && !String(incoming).includes('••••')) ? incoming : (stored || '');
  // UPDATE payload excludes createdAt (better-sqlite3 rejects extra named keys).
  const row = {
    id: s.id, name: s.name, platform: s.platform || '', brand: s.brand || '',
    apiUrl: s.apiUrl ?? (existing?.apiUrl || ''),
    apiKey: keep(s.apiKey, existing?.apiKey),
    apiSecret: keep(s.apiSecret, existing?.apiSecret),
    webhookSecret: keep(s.webhookSecret, existing?.webhookSecret),
    webhookEndpoint: s.webhookEndpoint ?? (existing?.webhookEndpoint || ''),
    apiEnabled: s.apiEnabled === false ? 0 : 1,
    webhookEnabled: s.webhookEnabled === false ? 0 : 1,
    credentials: JSON.stringify(s.credentials || {}),
    webhookConfig: JSON.stringify(s.webhookConfig || {}),
    active: s.active === false ? 0 : 1,
  };
  const tx = db.transaction(() => {
    if (existing) db.prepare(`UPDATE stores SET name=@name, platform=@platform, brand=@brand,
      apiUrl=@apiUrl, apiKey=@apiKey, apiSecret=@apiSecret, webhookSecret=@webhookSecret,
      webhookEndpoint=@webhookEndpoint, apiEnabled=@apiEnabled, webhookEnabled=@webhookEnabled,
      credentials=@credentials, webhookConfig=@webhookConfig, active=@active WHERE id=@id`).run(row);
    else db.prepare(`INSERT INTO stores (id,name,platform,brand,apiUrl,apiKey,apiSecret,webhookSecret,webhookEndpoint,apiEnabled,webhookEnabled,credentials,webhookConfig,active,createdAt)
      VALUES (@id,@name,@platform,@brand,@apiUrl,@apiKey,@apiSecret,@webhookSecret,@webhookEndpoint,@apiEnabled,@webhookEnabled,@credentials,@webhookConfig,@active,@createdAt)`).run(
        { ...row, createdAt: s.createdAt || Date.now() }
      );
  });
  tx();
  return getStore(s.id);
}
function deleteStore(id) { db.prepare('DELETE FROM stores WHERE id = ?').run(id); }

function getProviders() { return stmts.allProviders.all().map(rowToProvider); }
function getProvider(id) {
  const r = db.prepare('SELECT * FROM providers WHERE id = ?').get(id);
  return r ? rowToProvider(r) : null;
}
function getProviderByCode(code) {
  const r = db.prepare('SELECT * FROM providers WHERE code = ?').get(code);
  return r ? rowToProvider(r) : null;
}
/** Full provider config INCLUDING secrets — only used server-side by adapters. */
function getProviderSecrets(idOrCode) {
  const r = db.prepare('SELECT * FROM providers WHERE id = ? OR code = ?').get(idOrCode, idOrCode);
  if (!r) return null;
  return {
    id: r.id, name: r.name, code: r.code, adapter: r.adapter || 'generic',
    apiUrl: r.apiUrl || '', apiKey: r.apiKey || '', secretKey: r.secretKey || '',
    webhookUrl: r.webhookUrl || '', webhookSecret: r.webhookSecret || '',
    trackingEndpoint: r.trackingEndpoint || '', shipmentEndpoint: r.shipmentEndpoint || '',
    statusEndpoint: r.statusEndpoint || '',
    apiEnabled: r.apiEnabled === null ? true : !!r.apiEnabled,
    webhookEnabled: r.webhookEnabled === null ? true : !!r.webhookEnabled,
    customFields: safeJson(r.customFields, {}),
    isDefault: !!r.isDefault, active: !!r.active,
  };
}
function getStoreSecrets(id) {
  const r = db.prepare('SELECT * FROM stores WHERE id = ?').get(id);
  if (!r) return null;
  return {
    id: r.id, name: r.name, platform: r.platform || '', brand: r.brand || '',
    apiUrl: r.apiUrl || '', apiKey: r.apiKey || '', apiSecret: r.apiSecret || '',
    webhookSecret: r.webhookSecret || '', webhookEndpoint: r.webhookEndpoint || '',
    apiEnabled: r.apiEnabled === null ? true : !!r.apiEnabled,
    webhookEnabled: r.webhookEnabled === null ? true : !!r.webhookEnabled,
    active: !!r.active,
  };
}
function getDefaultProvider() {
  const r = stmts.defaultProvider.get();
  return r ? rowToProvider(r) : null;
}
function saveProvider(p) {
  const existing = getProviderByCode(p.code) || (p.id ? getProvider(p.id) : null);
  // Preserve secrets when the caller sent the masked form (••••) or omitted them.
  const keep = (incoming, stored) => (incoming && !String(incoming).includes('••••')) ? incoming : (stored || '');
  const secrets = existing ? getProviderSecrets(existing.code) : {};
  const id = existing?.id || p.id || ('PRV-' + Math.random().toString(36).slice(2, 8).toUpperCase());
  // UPDATE payload excludes createdAt (better-sqlite3 rejects extra named keys).
  const row = {
    id, name: p.name, code: p.code, adapter: p.adapter || 'generic',
    apiUrl: p.apiUrl ?? (existing?.apiUrl || ''),
    apiKey: keep(p.apiKey, secrets.apiKey),
    secretKey: keep(p.secretKey, secrets.secretKey),
    webhookUrl: p.webhookUrl ?? (existing?.webhookUrl || ''),
    webhookSecret: keep(p.webhookSecret, secrets.webhookSecret),
    trackingEndpoint: p.trackingEndpoint ?? (existing?.trackingEndpoint || ''),
    shipmentEndpoint: p.shipmentEndpoint ?? (existing?.shipmentEndpoint || ''),
    statusEndpoint: p.statusEndpoint ?? (existing?.statusEndpoint || ''),
    customFields: JSON.stringify(p.customFields || {}),
    apiEnabled: p.apiEnabled === false ? 0 : 1,
    webhookEnabled: p.webhookEnabled === false ? 0 : 1,
    isDefault: p.isDefault ? 1 : 0,
    active: p.active === false ? 0 : 1,
  };
  const tx = db.transaction(() => {
    if (existing) db.prepare(`UPDATE providers SET name=@name, code=@code, adapter=@adapter,
      apiUrl=@apiUrl, apiKey=@apiKey, secretKey=@secretKey, webhookUrl=@webhookUrl, webhookSecret=@webhookSecret,
      trackingEndpoint=@trackingEndpoint, shipmentEndpoint=@shipmentEndpoint, statusEndpoint=@statusEndpoint,
      customFields=@customFields, apiEnabled=@apiEnabled, webhookEnabled=@webhookEnabled,
      isDefault=@isDefault, active=@active WHERE id=@id`).run(row);
    else db.prepare(`INSERT INTO providers (id,name,code,adapter,apiUrl,apiKey,secretKey,webhookUrl,webhookSecret,trackingEndpoint,shipmentEndpoint,statusEndpoint,customFields,apiEnabled,webhookEnabled,isDefault,active,createdAt)
      VALUES (@id,@name,@code,@adapter,@apiUrl,@apiKey,@secretKey,@webhookUrl,@webhookSecret,@trackingEndpoint,@shipmentEndpoint,@statusEndpoint,@customFields,@apiEnabled,@webhookEnabled,@isDefault,@active,@createdAt)`).run(
        { ...row, createdAt: existing?.createdAt || Date.now() }
      );
  });
  tx();
  return getProvider(id);
}
function deleteProvider(id) { db.prepare('DELETE FROM providers WHERE id = ?').run(id); }
function setDefaultProvider(id) {
  const tx = db.transaction(() => {
    db.prepare('UPDATE providers SET isDefault = 0').run();
    db.prepare('UPDATE providers SET isDefault = 1 WHERE id = ?').run(id);
  });
  tx();
}

function getShipment(id) { return rowToShipment(stmts.getShipment.get(id)); }
function getShipmentByOrder(orderId) { return rowToShipment(stmts.getShipmentByOrder.get(orderId)); }
function getShipmentByTracking(tr) { return rowToShipment(stmts.getShipmentByTracking.get(tr)); }
function saveShipment(s) {
  // updateShipment statement only references these keys; insertShipment adds
  // orderId/providerId/createdAt. better-sqlite3 rejects extra named keys, so
  // we build the insert payload separately.
  const upd = {
    id: s.id,
    trackingNumber: s.trackingNumber || '', providerShipmentId: s.providerShipmentId || '',
    providerReference: s.providerReference || '', crmStatus: s.crmStatus || '',
    originalStatus: s.originalStatus || '', labelUrl: s.labelUrl || '',
    raw: JSON.stringify(s.raw || {}), updatedAt: Date.now(),
  };
  const existing = getShipment(s.id);
  const tx = db.transaction(() => {
    if (existing) stmts.updateShipment.run(upd);
    else stmts.insertShipment.run({
      ...upd,
      orderId: s.orderId, providerId: s.providerId || '',
      createdAt: s.createdAt || Date.now(),
    });
  });
  tx();
  return getShipment(s.id);
}
function getEvents(shipmentId) { return stmts.eventsForShipment.all(shipmentId).map(rowToEvent); }

/** Non-terminal shipments the polling job should refresh. */
function listActiveShipments() {
  const TERMINAL = ['delivered', 'refused', 'returned', 'cancelled'];
  return db.prepare(`
    SELECT s.* FROM shipments s
    WHERE s.crmStatus IS NOT NULL AND s.crmStatus NOT IN ('${TERMINAL.join("','")}')
  `).all().map(rowToShipment);
}

/**
 * Append a tracking event. Dedupes on (shipmentId, eventTime, originalStatus)
 * via the unique index — calling twice with the same provider event is a no-op.
 * Returns true if a new row was actually inserted (drives notification logic).
 */
function appendEvent(ev) {
  try {
    const info = stmts.insertEvent.run({
      shipmentId: ev.shipmentId,
      eventTime: ev.eventTime,
      originalStatus: ev.originalStatus || '',
      crmStatus: ev.crmStatus || '',
      description: ev.description || '',
      raw: JSON.stringify(ev.raw || {}),
    });
    return info.changes > 0;
  } catch (e) {
    // UNIQUE constraint = duplicate event, not an error.
    if (String(e.message).includes('UNIQUE')) return false;
    throw e;
  }
}

/* =============================================================================
 * NOTIFICATIONS
 *
 * Two things were wrong before. Rows were written but never read back by any
 * client, so the whole persisted half was dead and every notification vanished
 * on refresh. And `target` was accepted by notifications.push() but had no
 * column to land in, so it was silently dropped — the live SSE hop was
 * targeted, the stored row was not. A manager-only alert ("agent X missed an
 * order") therefore sat in a table that, once anyone started reading it, would
 * have shown it to that very agent.
 *
 * RECIPIENT MODEL — one nullable `target` column, three meanings:
 *     NULL / ''      everyone
 *     'manager'      managers only
 *     '<agent name>' that agent, plus managers
 * This matches broadcast(payload, target) exactly, so the live and stored paths
 * cannot disagree about who an event was for.
 *
 * READ STATE — a per-account high-water mark (agents.lastReadNotificationId)
 * rather than a global `read` flag or a join table. The flag was wrong because
 * one person opening the panel marked it read for everybody; a join table would
 * grow without bound for a UI whose only gesture is "I have seen these". Ids
 * are monotonic, so "unread" is simply "visible to me AND id > my watermark",
 * which is one indexed comparison and needs no cleanup.
 * ========================================================================== */

/** SQL fragment for "notifications this account may see", with bound params. */
function visibilityClause(user) {
  if (user && user.isManager) {
    // Managers see everything: broadcasts, manager-only, and per-agent alerts.
    return { where: '1=1', params: [] };
  }
  const name = user ? user.name : ' no-such-agent';
  // An agent sees broadcasts and their own; never manager-only, never another
  // agent's.
  return { where: "(target IS NULL OR target = '' OR target = ?)", params: [name] };
}

function addNotification(n) {
  const info = stmts.insertNotification.run({
    type: n.type || '', title: n.title || '', body: n.body || '',
    orderId: n.orderId || '', shipmentId: n.shipmentId || '',
    target: n.target === undefined || n.target === null ? null : String(n.target),
  });
  return Number(info.lastInsertRowid);
}

/** Newest-first page of what this account may see. */
function getNotifications(user, { limit = 50, beforeId = null } = {}) {
  const v = visibilityClause(user);
  const extra = beforeId ? ' AND id < ?' : '';
  const params = [...v.params, ...(beforeId ? [Number(beforeId)] : []), Math.min(Number(limit) || 50, 200)];
  return db.prepare(
    `SELECT * FROM notifications WHERE ${v.where}${extra} ORDER BY id DESC LIMIT ?`
  ).all(...params).map(rowToNotification);
}

/** Everything newer than `afterId` that this account may see, OLDEST first.
 *  Used to replay what a disconnected SSE client missed. */
function getNotificationsSince(user, afterId, limit = 100) {
  const v = visibilityClause(user);
  return db.prepare(
    `SELECT * FROM notifications WHERE ${v.where} AND id > ? ORDER BY id ASC LIMIT ?`
  ).all(...v.params, Number(afterId) || 0, Math.min(Number(limit) || 100, 200)).map(rowToNotification);
}

function rowToNotification(n) {
  return {
    id: n.id, type: n.type || '', title: n.title || '', body: n.body || '',
    orderId: n.orderId || '', shipmentId: n.shipmentId || '',
    target: n.target || null, createdAt: n.createdAt,
  };
}

function getLastReadNotificationId(agentName) {
  const row = db.prepare('SELECT lastReadNotificationId AS v FROM agents WHERE name = ?').get(agentName);
  return row && row.v ? Number(row.v) : 0;
}

/** Advance the watermark. Never moves BACKWARDS — two tabs racing, or an
 *  out-of-order request, must not resurrect notifications already dismissed. */
function markNotificationsRead(agentName, upToId = null) {
  const maxId = db.prepare('SELECT COALESCE(MAX(id), 0) AS v FROM notifications').get().v;
  /* Clamped to the newest id that actually exists. An unclamped value — a
   * client bug, or someone posting {"upToId": 999999} by hand — would park the
   * watermark in the future and silently suppress this account's badge until a
   * million notifications had been raised. Negative and non-numeric values
   * collapse to 0, which is simply "nothing read yet". */
  const requested = upToId === null || upToId === undefined ? maxId : Number(upToId);
  const target = Math.max(0, Math.min(Number.isFinite(requested) ? requested : 0, maxId));
  db.prepare(
    'UPDATE agents SET lastReadNotificationId = ? WHERE name = ? AND COALESCE(lastReadNotificationId, 0) < ?'
  ).run(target, agentName, target);
  return getLastReadNotificationId(agentName);
}

function getUnreadCount(user) {
  if (!user) return 0;
  const v = visibilityClause(user);
  return db.prepare(
    `SELECT COUNT(*) AS c FROM notifications WHERE ${v.where} AND id > ?`
  ).get(...v.params, getLastReadNotificationId(user.name)).c;
}

/** Trim the table to its most recent `keep` rows. Nothing here is an audit
 *  record — audit_log is — so unbounded growth buys nothing. */
function pruneNotifications(keep = 5000) {
  const row = db.prepare('SELECT COALESCE(MAX(id), 0) AS maxId, COUNT(*) AS n FROM notifications').get();
  if (row.n <= keep) return 0;
  return db.prepare('DELETE FROM notifications WHERE id <= ?').run(row.maxId - keep).changes;
}

function audit(entity, entityId, action, actor, payload) {
  stmts.insertAudit.run({
    entity, entityId, action, actor: actor || 'system',
    payload: JSON.stringify(payload || {}),
  });
}

/* ---------------------------------------------------------------------------
 * Integration logs (append-only). Every API call, webhook, sync, and error for
 * providers and stores is recorded here so admins can diagnose connections.
 * ------------------------------------------------------------------------- */
const insertLogStmt = db.prepare(`INSERT INTO integration_logs
  (entity, entityId, event, result, message, request, response) VALUES
  (@entity, @entityId, @event, @result, @message, @request, @response)`);
function logIntegration(entity, entityId, event, result, message, reqObj, resObj) {
  insertLogStmt.run({
    entity, entityId, event, result: result || (message ? 'failure' : 'success'),
    message: message || '',
    request: reqObj ? JSON.stringify(reqObj) : null,
    response: resObj ? JSON.stringify(resObj) : null,
  });
}
function getIntegrationLogs(entity, entityId, limit = 100) {
  let rows;
  if (entity && entityId) {
    rows = db.prepare(`SELECT * FROM integration_logs WHERE entity=? AND entityId=? ORDER BY id DESC LIMIT ?`).all(entity, entityId, limit);
  } else if (entity) {
    rows = db.prepare(`SELECT * FROM integration_logs WHERE entity=? ORDER BY id DESC LIMIT ?`).all(entity, limit);
  } else {
    rows = db.prepare(`SELECT * FROM integration_logs ORDER BY id DESC LIMIT ?`).all(limit);
  }
  return rows.map(r => ({
    id: r.id, entity: r.entity, entityId: r.entityId, event: r.event,
    result: r.result, message: r.message,
    request: safeJson(r.request, null), response: safeJson(r.response, null), ts: r.ts,
  }));
}

/* ---------------------------------------------------------------------------
 * Status mapping (original provider status <-> CRM status). Falls back to the
 * adapter's keyword map, then the shared statusMap when no explicit row exists.
 * The ORIGINAL status is ALWAYS stored on shipment_events too — never lost.
 * ------------------------------------------------------------------------- */
function getStatusMappings(providerId) {
  return db.prepare(`SELECT * FROM status_mappings WHERE providerId=? ORDER BY originalStatus`).all(providerId)
    .map(r => ({ id: r.id, providerId: r.providerId, originalStatus: r.originalStatus, crmStatus: r.crmStatus }));
}
function setStatusMapping(providerId, originalStatus, crmStatus) {
  db.prepare(`INSERT INTO status_mappings (providerId, originalStatus, crmStatus)
    VALUES (?, ?, ?)
    ON CONFLICT(providerId, originalStatus) DO UPDATE SET crmStatus=excluded.crmStatus`)
    .run(providerId, originalStatus, crmStatus);
}
function deleteStatusMapping(id) {
  db.prepare(`DELETE FROM status_mappings WHERE id=?`).run(id);
}
/** Returns {originalStatus: crmStatus} for an adapter's mapStatus. */
function getStatusMapFor(providerId) {
  const out = {};
  for (const r of db.prepare(`SELECT originalStatus, crmStatus FROM status_mappings WHERE providerId=?`).all(providerId)) {
    out[r.originalStatus] = r.crmStatus;
  }
  return out;
}

/* Test/sync timestamp markers used by the Test Connection + Sync Now flows. */
function markProviderTested(id, ok) {
  db.prepare(`UPDATE providers SET lastTestAt=?, lastTestOk=? WHERE id=?`).run(Date.now(), ok ? 1 : 0, id);
}
function markProviderSynced(id) {
  db.prepare(`UPDATE providers SET lastSyncAt=? WHERE id=?`).run(Date.now(), id);
}
function markStoreTested(id) {
  db.prepare(`UPDATE stores SET lastTestAt=? WHERE id=?`).run(Date.now(), id);
}

/* ===========================================================================
 * AI PLATFORM — provider registry, agent configs, conversation history.
 * Same shape & conventions as the delivery/store functions above: secrets are
 * masked on read (rowToAiProvider), the masked placeholder (••••) preserves a
 * stored secret on update, and every API event is logged to integration_logs.
 * ======================================================================== */

/** Public-facing AI provider — secrets masked. Safe to send to the client. */
function rowToAiProvider(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name || '',
    type: r.type || 'openai-compat',
    baseUrl: r.baseUrl || '',
    apiKey: r.apiKey ? '••••' + String(r.apiKey).slice(-4) : '',
    hasApiKey: !!r.apiKey,
    defaultModel: r.defaultModel || '',
    temperature: r.temperature === null ? 0.7 : r.temperature,
    maxTokens: r.maxTokens === null ? 2048 : r.maxTokens,
    timeoutMs: r.timeoutMs === null ? 30000 : r.timeoutMs,
    active: r.active === null ? true : !!r.active,
    isDefault: !!r.isDefault,
    lastTestAt: r.lastTestAt || null,
    lastTestOk: r.lastTestOk === null ? null : !!r.lastTestOk,
    createdAt: r.createdAt || null,
  };
}
/** Full AI provider config INCLUDING the real secret — server-side only. */
function rowToAiProviderSecrets(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.name || '', type: r.type || 'openai-compat',
    baseUrl: r.baseUrl || '', apiKey: r.apiKey || '',
    defaultModel: r.defaultModel || '',
    temperature: r.temperature === null ? 0.7 : r.temperature,
    maxTokens: r.maxTokens === null ? 2048 : r.maxTokens,
    timeoutMs: r.timeoutMs === null ? 30000 : r.timeoutMs,
    active: r.active === null ? true : !!r.active,
    isDefault: !!r.isDefault,
  };
}

const aiProviderAll    = db.prepare('SELECT * FROM ai_providers ORDER BY isDefault DESC, name ASC');
const aiProviderGet    = db.prepare('SELECT * FROM ai_providers WHERE id = ?');
const aiProviderGetRaw = db.prepare('SELECT * FROM ai_providers WHERE id = ?');
const aiProviderDefault= db.prepare('SELECT * FROM ai_providers WHERE isDefault = 1 AND active = 1 LIMIT 1');
const aiProviderActive = db.prepare('SELECT * FROM ai_providers WHERE active = 1 ORDER BY isDefault DESC, name ASC');

function getAiProviders() { return aiProviderAll.all().map(rowToAiProvider); }
function getAiProvider(id) {
  const r = aiProviderGet.get(id); return r ? rowToAiProvider(r) : null;
}
/** Server-side: full config with the real secret. */
function getAiProviderSecrets(id) {
  const r = aiProviderGetRaw.get(id); return r ? rowToAiProviderSecrets(r) : null;
}
function getDefaultAiProvider() {
  const r = aiProviderDefault.get();
  return r ? rowToAiProviderSecrets(r) : null;
}
/** Resolve an id to a usable secrets config, falling back to the default. */
function resolveAiProvider(idOrConfig) {
  let r;
  if (idOrConfig && typeof idOrConfig === 'object') r = idOrConfig;
  else if (idOrConfig) r = aiProviderGetRaw.get(idOrConfig);
  if (!r) r = aiProviderDefault.get();
  if (!r) r = aiProviderActive.get();
  return r ? rowToAiProviderSecrets(r) : null;
}
function saveAiProvider(p) {
  const existing = (p.id && aiProviderGet.get(p.id)) || null;
  const keep = (incoming, stored) => (incoming && !String(incoming).includes('••••'))
    ? incoming : (stored || '');
  const stored = existing ? rowToAiProviderSecrets(existing) : {};
  const id = existing?.id || p.id || ('AIP-' + Math.random().toString(36).slice(2, 8).toUpperCase());
  const row = {
    id,
    name: p.name, type: p.type || 'openai-compat',
    baseUrl: p.baseUrl ?? (stored.baseUrl || ''),
    apiKey: keep(p.apiKey, stored.apiKey),
    defaultModel: p.defaultModel ?? (stored.defaultModel || ''),
    temperature: p.temperature === undefined ? (stored.temperature ?? 0.7) : p.temperature,
    maxTokens: p.maxTokens === undefined ? (stored.maxTokens ?? 2048) : p.maxTokens,
    timeoutMs: p.timeoutMs === undefined ? (stored.timeoutMs ?? 30000) : p.timeoutMs,
    active: p.active === false ? 0 : 1,
    isDefault: p.isDefault ? 1 : 0,
  };
  const tx = db.transaction(() => {
    if (existing) db.prepare(`UPDATE ai_providers SET name=@name, type=@type, baseUrl=@baseUrl,
      apiKey=@apiKey, defaultModel=@defaultModel, temperature=@temperature, maxTokens=@maxTokens,
      timeoutMs=@timeoutMs, active=@active, isDefault=@isDefault WHERE id=@id`).run(row);
    else db.prepare(`INSERT INTO ai_providers (id,name,type,baseUrl,apiKey,defaultModel,temperature,maxTokens,timeoutMs,active,isDefault,createdAt)
      VALUES (@id,@name,@type,@baseUrl,@apiKey,@defaultModel,@temperature,@maxTokens,@timeoutMs,@active,@isDefault,@createdAt)`).run(
        { ...row, createdAt: p.createdAt || Date.now() }
      );
    if (row.isDefault) {
      db.prepare('UPDATE ai_providers SET isDefault = 0 WHERE id != ?').run(id);
    }
  });
  tx();
  return getAiProvider(id);
}
function deleteAiProvider(id) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id);
    // Detach (not delete) agents that pointed at the removed provider.
    db.prepare('UPDATE ai_agents SET providerId = NULL WHERE providerId = ?').run(id);
  });
  tx();
}
function setDefaultAiProvider(id) {
  const tx = db.transaction(() => {
    db.prepare('UPDATE ai_providers SET isDefault = 0').run();
    db.prepare('UPDATE ai_providers SET isDefault = 1 WHERE id = ?').run(id);
  });
  tx();
}
function markAiProviderTested(id, ok) {
  db.prepare(`UPDATE ai_providers SET lastTestAt=?, lastTestOk=? WHERE id=?`).run(Date.now(), ok ? 1 : 0, id);
}

/* ---- AI Agents (role-configured assistants) ---- */
const aiAgentAll = db.prepare('SELECT * FROM ai_agents ORDER BY enabled DESC, name ASC');
const aiAgentGet = db.prepare('SELECT * FROM ai_agents WHERE id = ?');

function rowToAiAgent(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name || '',
    description: r.description || '',
    providerId: r.providerId || '',
    model: r.model || '',
    systemPrompt: r.systemPrompt || '',
    permissions: safeJson(r.permissions, []),
    enabled: r.enabled === null ? true : !!r.enabled,
    role: r.role || '',
    createdAt: r.createdAt || null,
  };
}
function getAiAgents() { return aiAgentAll.all().map(rowToAiAgent); }
function getAiAgent(id) {
  const r = aiAgentGet.get(id); return r ? rowToAiAgent(r) : null;
}
function getEnabledAiAgents() {
  return db.prepare('SELECT * FROM ai_agents WHERE enabled = 1 ORDER BY name ASC').all().map(rowToAiAgent);
}
function saveAiAgent(a) {
  const existing = (a.id && aiAgentGet.get(a.id)) || null;
  const id = existing?.id || a.id || ('AAG-' + Math.random().toString(36).slice(2, 8).toUpperCase());
  const row = {
    id,
    name: a.name, description: a.description || '',
    providerId: a.providerId || null,
    model: a.model || '',
    systemPrompt: a.systemPrompt || '',
    permissions: JSON.stringify(Array.isArray(a.permissions) ? a.permissions : []),
    enabled: a.enabled === false ? 0 : 1,
    role: a.role || '',
  };
  const tx = db.transaction(() => {
    if (existing) db.prepare(`UPDATE ai_agents SET name=@name, description=@description, providerId=@providerId,
      model=@model, systemPrompt=@systemPrompt, permissions=@permissions, enabled=@enabled, role=@role WHERE id=@id`).run(row);
    else db.prepare(`INSERT INTO ai_agents (id,name,description,providerId,model,systemPrompt,permissions,enabled,role,createdAt)
      VALUES (@id,@name,@description,@providerId,@model,@systemPrompt,@permissions,@enabled,@role,@createdAt)`).run(
        { ...row, createdAt: a.createdAt || Date.now() }
      );
  });
  tx();
  return getAiAgent(id);
}
function deleteAiAgent(id) { db.prepare('DELETE FROM ai_agents WHERE id = ?').run(id); }

/* ---- AI conversations (append-only chat history) ---- */
const insertConversationStmt = db.prepare(`INSERT INTO ai_conversations (actorName, agentId, role, content, tokenCount)
  VALUES (@actorName, @agentId, @role, @content, @tokenCount)`);
function addConversationTurn(t) {
  const info = insertConversationStmt.run({
    actorName: t.actorName || 'anonymous',
    agentId: t.agentId || null,
    role: t.role || 'user',
    content: t.content || '',
    tokenCount: t.tokenCount || 0,
  });
  return info.lastInsertRowid;
}
function getConversation(actorName, agentId, limit = 30) {
  return db.prepare(`SELECT id, actorName, agentId, role, content, tokenCount, ts
    FROM ai_conversations WHERE actorName=? AND (agentId=? OR (?='' AND agentId IS NULL))
    ORDER BY ts ASC LIMIT ?`).all(actorName, agentId, agentId, limit)
    .map(r => ({ id: r.id, role: r.role, content: r.content, ts: r.ts }));
}
function clearConversation(actorName, agentId) {
  if (agentId) db.prepare('DELETE FROM ai_conversations WHERE actorName=? AND agentId=?').run(actorName, agentId);
  else db.prepare('DELETE FROM ai_conversations WHERE actorName=?').run(actorName);
}

/* ---------------------------------------------------------------------------
 * One-time legacy JSON import. Runs only if the DB looks empty AND the legacy
 * file still exists. After import the file is renamed *.legacy so this never
 * re-runs (idempotent across restarts / deploys).
 * ------------------------------------------------------------------------- */
/**
 * One-time, non-destructive backfill of orders.deliveryOutcome from the
 * append-only shipment_events history (audit BUG-02).
 *
 * Nothing ever wrote deliveryOutcome, so on an existing installation every
 * parcel the carrier already reported as delivered or returned still reads as
 * unsettled — which is why the profit calculator, delivered-pay payroll and
 * client lifetime spend all show zero even for orders that plainly completed.
 * shipment_events is the permanent record of what the carrier actually said,
 * so the true outcome and the moment it settled can be recovered exactly.
 *
 * Safety properties:
 *   - Only ever fills rows where deliveryOutcome is empty; never overwrites.
 *   - Routed through patchOrder() rather than raw SQL so the client and product
 *     lifetime counters move on the same transition they would have moved on
 *     had the value been written at the time.
 *   - Idempotent: the empty-outcome guard means a second run is a no-op, and a
 *     settings marker skips the scan entirely after the first completed run.
 *
 * @returns {{scanned:number, updated:number, skipped:boolean}}
 */
function backfillDeliveryOutcomes() {
  const marker = 'deliveryOutcomeBackfillAt';
  const settings = getSettings();
  if (settings[marker]) return { scanned: 0, updated: 0, skipped: true };

  const rows = db.prepare(`
    SELECT o.id AS orderId, e.crmStatus AS outcome, MIN(e.eventTime) AS settledAt
    FROM orders o
    JOIN shipments s       ON s.orderId = o.id
    JOIN shipment_events e ON e.shipmentId = s.id
    WHERE (o.deliveryOutcome IS NULL OR o.deliveryOutcome = '')
      AND e.crmStatus IN ('delivered', 'returned')
    GROUP BY o.id
  `).all();

  let updated = 0;
  for (const r of rows) {
    try {
      patchOrder(r.orderId, {
        deliveryOutcome: r.outcome,
        deliveryOutcomeAt: r.settledAt || Date.now(),
      });
      audit('order', r.orderId, 'delivery_outcome_backfilled', 'migration', {
        outcome: r.outcome, settledAt: r.settledAt,
      });
      updated++;
    } catch (e) {
      console.error('[db] deliveryOutcome backfill failed for ' + r.orderId + ': ' + e.message);
    }
  }

  setSettings({ [marker]: Date.now() });
  return { scanned: rows.length, updated, skipped: false };
}

function migrateFromLegacy() {
  const orderCount = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;

  // providers: always seed defaults if none exist
  if (db.prepare('SELECT COUNT(*) AS c FROM providers').get().c === 0) {
    seedDefaultProviders();
  }

  // ai_agents: always seed the ready-made assistant roles if none exist.
  // No ai_provider is seeded (the admin must add their own key) — agents simply
  // remain unusable until one is configured. This keeps no model hardcoded.
  if (db.prepare('SELECT COUNT(*) AS c FROM ai_agents').get().c === 0) {
    seedDefaultAiAgents();
  }

  if (orderCount > 0) return; // already populated

  // --- settings ---
  if (fs.existsSync(LEGACY.settings)) {
    try {
      const s = JSON.parse(fs.readFileSync(LEGACY.settings, 'utf8'));
      setSettings(s);
      renameLegacy(LEGACY.settings);
    } catch (e) { /* keep defaults */ }
  }

  // --- products ---
  if (fs.existsSync(LEGACY.products)) {
    try {
      const prods = JSON.parse(fs.readFileSync(LEGACY.products, 'utf8'));
      const tx = db.transaction((arr) => arr.forEach(p => {
        if (!p || !p.id) return;
        insertProduct({
          id: p.id, name: p.name, sku: p.sku || '', description: p.description || '',
          price: p.price || 0,
          variants: Array.isArray(p.variants) ? p.variants.map(v => typeof v === 'string' ? { name: v, image: '' } : { name: v.name || '', image: v.image || '' }) : [],
          stock: p.stock || 0, createdAt: p.createdAt || Date.now(),
        });
      }));
      tx(prods);
      renameLegacy(LEGACY.products);
    } catch (e) { /* ignore corrupt */ }
  }

  // --- orders + agents ---
  if (fs.existsSync(LEGACY.orders)) {
    try {
      const data = JSON.parse(fs.readFileSync(LEGACY.orders, 'utf8'));
      const tx = db.transaction(() => {
        (data.agents || []).forEach(a => addAgent(a.name, a.pass || '', a.role));
        (data.orders || []).forEach(o => {
          if (!o || !o.id) return;
          const row = orderToRow(o);
          stmts.insertOrder.run(row);
          (o.calls || []).forEach(c => addCall(o.id, c));
          stmts.insertAudit.run({ entity: 'order', entityId: o.id, action: 'migrate', actor: 'migration', payload: '{}' });
        });
      });
      tx();
      renameLegacy(LEGACY.orders);
    } catch (e) { /* ignore corrupt */ }
  }
}

function renameLegacy(file) {
  try { if (fs.existsSync(file)) fs.renameSync(file, file + '.legacy'); } catch { /* best effort */ }
}

/** Seed the four providers that were previously hardcoded in the UI. */
function seedDefaultProviders() {
  const now = Date.now();
  const defaults = [
    { code: 'zr',      name: 'ZR Express',      adapter: 'zr-webhook' },
    { code: 'ecom',    name: 'Ecom Delivery',   adapter: 'generic' },
    { code: 'ecotrac', name: 'Ecotrac',         adapter: 'generic' },
    { code: 'maystro', name: 'Maystro',         adapter: 'generic' },
  ];
  const tx = db.transaction((arr) => arr.forEach((p, i) => {
    db.prepare(`INSERT INTO providers (id,name,code,adapter,isDefault,active,createdAt)
      VALUES (?,?,?,?,?,?,?)`).run(
      'PRV-' + (i + 1), p.name, p.code, p.adapter, i === 0 ? 1 : 0, 1, now
    );
  }));
  tx(defaults);
}

/**
 * Seed the ready-made AI Agent roles. Each ships with a focused system prompt
 * and a MINIMAL, read-only permission set (no destructive capability exists).
 * The admin can edit, extend, or delete any of these. Permissions are keys from
 * lib/ai/context.js — keep them in sync if the catalog grows.
 */
function seedDefaultAiAgents() {
  const now = Date.now();
  const defaults = [
    {
      id: 'AAG-MANAGER', name: 'Manager Assistant', role: 'manager',
      description: 'Strategic overview: performance, anomalies, daily/weekly summaries.',
      systemPrompt: 'You are the Manager Assistant for a COD (cash-on-delivery) e-commerce CRM in Algeria. You help managers understand performance, spot problems (low confirmation rates, delivery delays, fraud signals), and decide next actions. Always cite the real numbers from the provided CRM context. Be concise. Suggest concrete next actions, but never claim to execute them — the user approves every action.',
      permissions: ['read_orders','read_customers','read_products','read_delivery','read_analytics','read_agent_notes','generate_reports','suggest_actions'],
    },
    {
      id: 'AAG-SALES', name: 'Sales Assistant', role: 'sales',
      description: 'Customer & order insights, best products, conversion opportunities.',
      systemPrompt: 'You are the Sales Assistant. You analyze orders, customers, and products to surface opportunities and top performers. Cite real numbers from the CRM context. Suggest, never execute.',
      permissions: ['read_orders','read_customers','read_products','read_analytics','suggest_actions'],
    },
    {
      id: 'AAG-CONFIRM', name: 'Confirmation Assistant', role: 'confirmation',
      description: 'Helps confirmation agents prioritize calls and lift confirmation rate.',
      systemPrompt: 'You are the Confirmation Assistant. You help confirmation agents decide who to call next, interpret call notes, and lift the confirmation rate. Focus on actionable prioritization using real CRM data. Suggest, never execute.',
      permissions: ['read_orders','read_customers','read_agent_notes','suggest_actions'],
    },
    {
      id: 'AAG-DELIVERY', name: 'Delivery Assistant', role: 'delivery',
      description: 'Tracks shipments, flags delays and delivery risks.',
      systemPrompt: 'You are the Delivery Assistant. You monitor shipments, flag delays and stuck parcels, and explain delivery status using the tracking timeline. Cite real tracking data. Suggest, never execute.',
      permissions: ['read_orders','read_delivery','suggest_actions'],
    },
    {
      id: 'AAG-ANALYTICS', name: 'Analytics Assistant', role: 'analytics',
      description: 'Deep dives: rates by wilaya/agent/product, trends over time.',
      systemPrompt: 'You are the Analytics Assistant. You compute and explain rates (confirmation, cancellation, delivery success) grouped by wilaya, agent, and product, and over time. Always show the underlying numbers. Suggest, never execute.',
      permissions: ['read_orders','read_customers','read_products','read_delivery','read_analytics','generate_reports','suggest_actions'],
    },
    {
      id: 'AAG-SUPPORT', name: 'Support Assistant', role: 'support',
      description: 'Answers order-status questions and follow-up needs.',
      systemPrompt: 'You are the Support Assistant. You answer status and follow-up questions about orders and customers using real CRM data. Be clear and helpful. Suggest, never execute.',
      permissions: ['read_orders','read_customers','read_delivery','read_agent_notes'],
    },
  ];
  const tx = db.transaction((arr) => arr.forEach(a => {
    db.prepare(`INSERT INTO ai_agents (id,name,description,providerId,model,systemPrompt,permissions,enabled,role,createdAt)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      a.id, a.name, a.description, null, '', a.systemPrompt,
      JSON.stringify(a.permissions), 1, a.role, now
    );
  }));
  tx(defaults);
}

/* ===========================================================================
 * INVENTORY — append-only stock ledger access (req §10).
 * Like shipment_events/audit_log, inventory_movements is INSERT-ONLY. The
 * functions below never UPDATE or DELETE a row; they read history and append.
 * The actual stock mutation (writing the products.variants JSON) happens in
 * lib/inventory.js, which calls addInventoryMovement inside the same txn.
 * ======================================================================== */
const insertMovementStmt = db.prepare(`INSERT INTO inventory_movements
  (productId, variantName, orderId, delta, prevQty, newQty, reason, actor, unitCost, packagingCost)
  VALUES (@productId, @variantName, @orderId, @delta, @prevQty, @newQty, @reason, @actor, @unitCost, @packagingCost)`);
function addInventoryMovement(m) {
  insertMovementStmt.run({
    productId: m.productId,
    variantName: m.variantName || '',
    orderId: m.orderId || '',
    delta: Number(m.delta) || 0,
    prevQty: m.prevQty === undefined ? null : m.prevQty,
    newQty: m.newQty === undefined ? null : m.newQty,
    reason: m.reason || '',
    actor: m.actor || 'system',
    // Per-unit cost basis this specific movement consumed/restored (see
    // lib/inventory.js's FIFO lot consumption) — null when unknown (manual
    // adjustments, or stock that predates the cost-lot feature).
    unitCost: (m.unitCost === undefined || m.unitCost === null) ? null : Number(m.unitCost),
    packagingCost: (m.packagingCost === undefined || m.packagingCost === null) ? null : Number(m.packagingCost),
  });
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}
function getInventoryMovements(productId, variantName, limit = 200) {
  if (variantName !== undefined && variantName !== null) {
    return db.prepare(`SELECT * FROM inventory_movements
      WHERE productId=? AND variantName=? ORDER BY id DESC LIMIT ?`)
      .all(productId, variantName, limit).map(rowToMovement);
  }
  return db.prepare(`SELECT * FROM inventory_movements
    WHERE productId=? ORDER BY id DESC LIMIT ?`).all(productId, limit).map(rowToMovement);
}
function getMovementsForOrder(orderId) {
  return db.prepare(`SELECT * FROM inventory_movements WHERE orderId=? ORDER BY id ASC`)
    .all(orderId).map(rowToMovement);
}
function rowToMovement(r) {
  return {
    id: r.id, productId: r.productId, variantName: r.variantName || '',
    orderId: r.orderId || '', delta: r.delta,
    prevQty: r.prevQty, newQty: r.newQty,
    reason: r.reason || '', actor: r.actor || '', ts: r.ts,
    unitCost: (r.unitCost === null || r.unitCost === undefined) ? null : Number(r.unitCost),
    packagingCost: (r.packagingCost === null || r.packagingCost === undefined) ? null : Number(r.packagingCost),
  };
}

/* ---------------------------------------------------------------------------
 * Cost lots (FIFO) — see stock_lots / movement_lot_consumption above.
 * ------------------------------------------------------------------------- */
const insertLotStmt = db.prepare(`INSERT INTO stock_lots
  (productId, variantName, unitCost, packagingCost, qtyOriginal, qtyRemaining, source, actor, createdAt)
  VALUES (@productId, @variantName, @unitCost, @packagingCost, @qty, @qty, @source, @actor, @createdAt)`);
function insertStockLot({ productId, variantName = '', unitCost = 0, packagingCost = 0, qty, source = 'purchase', actor = 'admin', createdAt }) {
  insertLotStmt.run({
    productId, variantName: variantName || '',
    unitCost: Number(unitCost) || 0, packagingCost: Number(packagingCost) || 0,
    qty: Math.max(0, Math.round(Number(qty)) || 0),
    source, actor: actor || 'admin',
    createdAt: createdAt || Date.now(),
  });
  const id = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  return getLot(id);
}
function getLot(id) {
  return db.prepare('SELECT * FROM stock_lots WHERE id=?').get(id) || null;
}
/** Active lots (qtyRemaining>0) oldest-first — the exact FIFO consumption order. */
function getActiveLots(productId, variantName = '') {
  return db.prepare(`SELECT * FROM stock_lots
    WHERE productId=? AND variantName=? AND qtyRemaining>0
    ORDER BY createdAt ASC, id ASC`).all(productId, variantName || '');
}
/** Every lot (including exhausted ones), newest first — for the "batches" display. */
function getAllLots(productId, variantName = '') {
  return db.prepare(`SELECT * FROM stock_lots
    WHERE productId=? AND variantName=?
    ORDER BY createdAt DESC, id DESC`).all(productId, variantName || '');
}
/** Adds (positive) or removes (negative) quantity from ONE lot, clamped so
 *  it can never go below 0 or above what the lot originally had. */
function adjustLotQty(lotId, deltaQty) {
  const lot = getLot(lotId);
  if (!lot) return null;
  const next = Math.max(0, Math.min(lot.qtyOriginal, lot.qtyRemaining + Math.round(Number(deltaQty) || 0)));
  db.prepare('UPDATE stock_lots SET qtyRemaining=? WHERE id=?').run(next, lotId);
  return getLot(lotId);
}
const insertConsumptionStmt = db.prepare(`INSERT INTO movement_lot_consumption (movementId, lotId, qty) VALUES (?, ?, ?)`);
/** Records which lot(s) a movement touched — breakdown is [{lotId, qty}]. */
function recordLotConsumption(movementId, breakdown) {
  for (const b of breakdown) {
    if (b.qty > 0) insertConsumptionStmt.run(movementId, b.lotId, Math.round(b.qty));
  }
}
/** Sums, per lot, how much a given order+variant's 'reserve'/'confirm'
 *  movement(s) consumed — this is what a later cancellation reverses. */
function getLotConsumptionForOrder(orderId, variantName = '') {
  return db.prepare(`
    SELECT mlc.lotId AS lotId, SUM(mlc.qty) AS qty
    FROM movement_lot_consumption mlc
    JOIN inventory_movements im ON im.id = mlc.movementId
    WHERE im.orderId = ? AND im.variantName = ? AND im.reason IN ('reserve','confirm')
    GROUP BY mlc.lotId
    HAVING SUM(mlc.qty) > 0
  `).all(orderId, variantName || '');
}

/* ===========================================================================
 * FOLLOW-UP (SUIVI) tasks — call-reminder lifecycle (req §1).
 * followup_tasks supports auto-creation on delivery statuses that need a
 * customer call, a configurable countdown (dueAt), and overdue escalation.
 * ======================================================================== */
function saveFollowupTask(t) {
  const existing = t.id ? db.prepare('SELECT id FROM followup_tasks WHERE id=?').get(t.id) : null;
  const id = existing?.id || t.id || ('FT-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase());
  const row = {
    id,
    orderId: t.orderId,
    type: t.type || 'call_customer',
    status: t.status || 'open',
    dueAt: t.dueAt || null,
    agent: t.agent || '',
    reason: t.reason || '',
    resolvedAt: t.resolvedAt || null,
  };
  const tx = db.transaction(() => {
    if (existing) db.prepare(`UPDATE followup_tasks SET type=@type, status=@status, dueAt=@dueAt,
      agent=@agent, reason=@reason, resolvedAt=@resolvedAt WHERE id=@id`).run(row);
    else db.prepare(`INSERT INTO followup_tasks (id,orderId,type,status,dueAt,agent,reason,resolvedAt,createdAt)
      VALUES (@id,@orderId,@type,@status,@dueAt,@agent,@reason,@resolvedAt,@createdAt)`).run(
        { ...row, createdAt: t.createdAt || Date.now() }
      );
  });
  tx();
  return getFollowupTask(id);
}
const followupTaskGetStmt = db.prepare('SELECT * FROM followup_tasks WHERE id = ?');
function rowToFollowupTask(r) {
  if (!r) return null;
  return {
    id: r.id, orderId: r.orderId, type: r.type || 'call_customer',
    status: r.status || 'open', dueAt: r.dueAt, agent: r.agent || '',
    reason: r.reason || '', createdAt: r.createdAt, resolvedAt: r.resolvedAt,
  };
}
function getFollowupTask(id) { return rowToFollowupTask(followupTaskGetStmt.get(id)); }
function getFollowupTasks(filter = {}) {
  let sql = 'SELECT * FROM followup_tasks';
  const where = [], params = [];
  if (filter.status) { where.push('status=?'); params.push(filter.status); }
  if (filter.agent) { where.push('agent=?'); params.push(filter.agent); }
  if (filter.orderId) { where.push('orderId=?'); params.push(filter.orderId); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY dueAt ASC';
  return db.prepare(sql).all(...params).map(rowToFollowupTask);
}
/** Open follow-up task for an order of a given type (avoids duplicate reminders). */
function getOpenFollowupForOrder(orderId, type) {
  const sql = type
    ? 'SELECT * FROM followup_tasks WHERE orderId=? AND type=? AND status="open" ORDER BY id DESC LIMIT 1'
    : 'SELECT * FROM followup_tasks WHERE orderId=? AND status="open" ORDER BY id DESC LIMIT 1';
  return rowToFollowupTask(type ? db.prepare(sql).get(orderId, type) : db.prepare(sql).get(orderId));
}
function resolveFollowupTask(id) {
  db.prepare('UPDATE followup_tasks SET status="done", resolvedAt=? WHERE id=?').run(Date.now(), id);
  return getFollowupTask(id);
}
function markFollowupOverdue(id) {
  db.prepare('UPDATE followup_tasks SET status="overdue" WHERE id=?').run(id);
  return getFollowupTask(id);
}
/** All open tasks whose dueAt has passed — candidates for escalation. */
function listOverdueFollowupTasks() {
  const now = Date.now();
  return db.prepare("SELECT * FROM followup_tasks WHERE status='open' AND dueAt IS NOT NULL AND dueAt < ?")
    .all(now).map(rowToFollowupTask);
}

/** One-time (but safe to re-run — every step is idempotent) backfill for
 *  databases that had orders BEFORE the clients feature existed:
 *  1) compute phoneNormalized for any order that doesn't have it yet, and
 *  2) walk every order chronologically through upsertClientFromOrder() so
 *     already-placed orders retroactively build correct, real client
 *     history instead of every existing customer showing up as "new" the
 *     next time they order. Runs once at boot; only touches rows that
 *     still need it, so it costs nothing on every subsequent restart.
 *  MUST run down here, after stmts/getOrder/upsertClientFromOrder are all
 *  fully defined above — calling them from any earlier point in this file
 *  would hit "stmts" before its own initialization. */
(function backfillPhoneNormalizedAndClients() {
  const stale = db.prepare(`SELECT id, phone FROM orders WHERE (phoneNormalized IS NULL OR phoneNormalized='') AND phone IS NOT NULL AND phone != ''`).all();
  if (stale.length) {
    const upd = db.prepare('UPDATE orders SET phoneNormalized=? WHERE id=?');
    const tx = db.transaction((rows) => { rows.forEach(r => upd.run(normalizePhoneForClient(r.phone), r.id)); });
    tx(stale);
  }
  // Only walk history into the clients table if it is CURRENTLY EMPTY —
  // once at least one client exists, every order from then on is already
  // kept in sync live by insertOrder/saveOrder, so re-scanning the whole
  // orders table on every single boot would be pure waste at scale.
  const clientCount = db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
  if (clientCount === 0) {
    const existingOrders = db.prepare(`SELECT * FROM orders WHERE phone IS NOT NULL AND phone != '' ORDER BY createdAt ASC`).all();
    if (existingOrders.length) {
      const tx = db.transaction((rows) => {
        // BUGFIX (caught by testing, not shipped): before=null for EVERY
        // row here, not the previous order seen for that phone. Each
        // pre-existing order is being counted by the clients system for
        // the very first time, in isolation — passing the LAST order as
        // "before" made upsertClientFromOrder think every 2nd+ order for
        // the same client was a status update on an already-known order
        // rather than a brand new one, so totalOrders silently stuck at 1
        // per client no matter how many orders they actually had.
        rows.forEach(r => { upsertClientFromOrder(null, getOrder(r.id)); });
      });
      tx(existingOrders);
    }
  }
})();

module.exports = {
  db,
  getSettings, setSettings,
  loadOrdersData, getOrder, findOrder, insertOrder, saveOrder, patchOrder, deleteOrder, addCall,
  getClient, getClientByPhone, getClients, countClients, getClientFilterOptions, updateClientDetails, getClientOrderHistory,
  importClientRecord, previewImportClients, importClients,
  getAgents, getAgentsByRole, addAgent, updateAgentRole, removeAgent,
  // Auth surface (lib/auth.js). listAgentSecrets/getAgentRaw expose the stored
  // password hash and must never be routed to a response.
  listAgentSecrets, getAgentRaw, setAgentPasswordHash, setAccountRole, countManagers,
  createSession, getSession, touchSession, deleteSession, deleteSessionsForAgent,
  deleteExpiredSessions, listSessionsForAgent,
  patchAgent, incrementMissedOrders, resetMissedOrders, suspendAgent, reactivateAgent, listOverdueUnansweredOrders,
  computeAgentPayroll, computeAllAgentsPayroll,
  getProducts, getProduct, insertProduct, saveProduct, deleteProduct, productStockTotal, normalizeVariantStock,
  getActiveProducts, getArchivedProducts, archiveProduct, unarchiveProduct, getProductHistory, logProductEvent,
  linkProductToExternal, findProductByExternalId, getProductLinks, unlinkProduct,
  addUnexpectedCharge, listUnexpectedCharges, deleteUnexpectedCharge, getOrdersByDeliveryOutcome,
  saveFinancialRecord, getFinancialRecord, getFinancialRecords, getFinancialRecordVersions,
  getLatestFinancialRecordForPeriod, getMonthlyFixedCostsTotal, prorateFixedExpenses, prorateMonthlyAmount, aggregateFinancialPeriod,
  addPushSubscription, getPushSubscriptionsForAgent, deletePushSubscriptionByEndpoint,
  getStores, getStore, getStoreSecrets, saveStore, deleteStore, markStoreTested,
  getProviders, getProvider, getProviderByCode, getProviderSecrets, getDefaultProvider,
  saveProvider, deleteProvider, setDefaultProvider, markProviderTested, markProviderSynced,
  getShipment, getShipmentByOrder, getShipmentByTracking, saveShipment,
  getEvents, appendEvent, listActiveShipments,
  addNotification, getNotifications, getNotificationsSince, markNotificationsRead,
  getUnreadCount, getLastReadNotificationId, pruneNotifications,
  logIntegration, getIntegrationLogs,
  getStatusMappings, setStatusMapping, deleteStatusMapping, getStatusMapFor,
  getAiProviders, getAiProvider, getAiProviderSecrets, getDefaultAiProvider, resolveAiProvider,
  saveAiProvider, deleteAiProvider, setDefaultAiProvider, markAiProviderTested,
  getAiAgents, getAiAgent, getEnabledAiAgents, saveAiAgent, deleteAiAgent,
  addConversationTurn, getConversation, clearConversation,
  // Inventory ledger (append-only)
  addInventoryMovement, getInventoryMovements, getMovementsForOrder,
  insertStockLot, getLot, getActiveLots, getAllLots, adjustLotQty,
  recordLotConsumption, getLotConsumptionForOrder,
  // Follow-up (Suivi) tasks
  saveFollowupTask, getFollowupTask, getFollowupTasks, getOpenFollowupForOrder,
  resolveFollowupTask, markFollowupOverdue, listOverdueFollowupTasks,
  audit, migrateFromLegacy, backfillDeliveryOutcomes,
  raw: db,   // exposed for the rare ad-hoc query
};
