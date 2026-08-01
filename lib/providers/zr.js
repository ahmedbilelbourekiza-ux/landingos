/* =============================================================================
 * lib/providers/zr.js — ZR Express Algeria adapter.
 *
 * ZR Express uses Svix for webhook delivery.
 * Auth:   X-Tenant (cfg.secretKey = tenant UUID) + X-Api-Key (cfg.apiKey = secret key)
 * Base:   https://api.zrexpress.app/api/v1   (cfg.apiUrl)
 *
 * Webhook payload (Svix envelope):
 *   { eventType, occurredAt, data: ParcelWebhookDto }
 * Svix headers: svix-id, svix-timestamp, svix-signature
 *
 * canCreateOutbound: true — outbound parcel creation via POST /parcels.
 *
 * Territory resolution strategy (no static wilaya->UUID map):
 * ZR Express territories (wilaya + commune) are identified by ZR's own UUIDs,
 * not the standard 1-58 Algerian wilaya numbers. Rather than hand-maintaining
 * a 1585-row table, createShipment() resolves the order's wilaya/commune names
 * dynamically via POST /territories/search at shipment-creation time:
 *   1. search wilaya name -> must match exactly one "wilaya"-level territory
 *   2. search commune name -> must match a "commune"-level territory whose
 *      parentId equals the wilaya's id found in step 1
 * If either step fails to resolve, createShipment THROWS with a clear message
 * (in French, matching the rest of the codebase's error strings) — the caller
 * (index.js tryAutoCreateShipment) already catches this, logs it, and pushes a
 * 'shipment_failed' notification, so the order shows up in the CRM with the
 * exact reason instead of silently creating a shipment with a wrong address.
 * ========================================================================== */

const { mapStatus } = require('../statusMap');

// ZR Express state name → CRM status
const STATUS_MAP = {
  // English state names from their API
  'pending':               'pending',
  'created':               'created',
  'picked up':             'created',
  'registered':            'created',
  'at hub':                'dispatched',
  'dispatched':            'dispatched',
  'in transit':            'in_transit',
  'on the way':            'in_transit',
  'at destination hub':    'at_office',
  'at office':             'at_office',
  'au bureau':             'at_office',
  'out for delivery':      'out_for_delivery',
  'delivery in progress':  'out_for_delivery',
  'delivered':             'delivered',
  'delivery failed':       'refused',
  'refused':               'refused',
  'refusé':                'refused',
  'customer not available':'refused',
  'returned to hub':       'returned',
  'return in transit':     'returned',
  'returned to supplier':  'returned',
  'retour':                'returned',
  'cancelled':             'cancelled',
  'annulé':                'cancelled',
};

/**
 * Verify a Svix webhook signature.
 * Signed content = "{svix-id}.{svix-timestamp}.{rawBody}"
 * Key = base64-decoded bytes of the secret (strip "whsec_" prefix if present)
 */
function verifySvixSignature(rawBody, headers, secret) {
  try {
    const crypto = require('crypto');
    const svixId        = headers['svix-id']        || '';
    const svixTimestamp = headers['svix-timestamp']  || '';
    const svixSignature = headers['svix-signature']  || '';
    if (!svixId || !svixTimestamp || !svixSignature) return true; // no signature, accept
    if (!secret) return true;

    const secretBase64 = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    const secretBytes  = Buffer.from(secretBase64, 'base64');
    const body = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
    const toSign = `${svixId}.${svixTimestamp}.${body}`;
    const computed = crypto.createHmac('sha256', secretBytes).update(toSign).digest('base64');

    return svixSignature.split(' ').some(sig => {
      const [ver, b64] = sig.split(',');
      return ver === 'v1' && b64 === computed;
    });
  } catch { return true; } // on error, accept (best-effort)
}

function stateToStatus(stateName, situationSlug) {
  if (!stateName && !situationSlug) return 'pending';
  const key = String(stateName || situationSlug || '').toLowerCase().trim();
  if (STATUS_MAP[key]) return STATUS_MAP[key];
  for (const [k, v] of Object.entries(STATUS_MAP)) {
    if (key.includes(k)) return v;
  }
  return mapStatus(stateName || situationSlug || '', STATUS_MAP);
}

function baseUrl(cfg) {
  return (cfg.apiUrl || 'https://api.zrexpress.app/api/v1').replace(/\/+$/, '');
}

/**
 * Generate a random RFC4122 v4 UUID. ZR Express rejects the all-zero nil UUID
 * (00000000-0000-0000-0000-000000000000) as an invalid customerId — its docs
 * say "any valid (random) GUID" works when not linking a registered customer,
 * but it must actually look like a real v4 UUID, not the reserved nil value.
 */
function randomUuid() {
  if (typeof require('crypto').randomUUID === 'function') {
    return require('crypto').randomUUID();
  }
  // Fallback for older Node versions without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function authHeaders(cfg) {
  return {
    'X-Tenant':     cfg.secretKey || '', // tenant UUID lives in the "Secret Key" field
    'X-Api-Key':    cfg.apiKey    || '', // ZR secret key lives in the "API Key" field
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  };
}

async function httpFetch(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { ok: res.ok, status: res.status, text, json };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Search ZR Express territories by name keyword.
 * Body shape confirmed against the live API: advancedSearch.fields/keyword is
 * OPTIONAL — pageNumber/pageSize alone returns the unfiltered list. With a
 * keyword, ZR's "NotEmptyValidator" rule requires fields to be present too.
 * @returns {Promise<Array>} raw territory items (id, name, level, parentId, …)
 */
async function searchTerritories(cfg, keyword) {
  const res = await httpFetch(`${baseUrl(cfg)}/territories/search`, {
    method: 'POST',
    headers: authHeaders(cfg),
    body: JSON.stringify({
      advancedSearch: { fields: ['Name'], keyword: keyword || '' },
      pageNumber: 1,
      pageSize: 50,
    }),
  }, 15000);

  if (!res.ok) {
    const detail = res.json?.detail || res.json?.errors?.[0]?.description || res.text?.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(`ZR Express: recherche territoire a échoué (${detail})`);
  }
  return res.json?.items || [];
}

/** Normalize a name for loose matching: lowercase, strip accents/punctuation. */
function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Algerian wilaya aliases → canonical normalized name used by ZR Express.
// Covers common misspellings, alternate spellings, and accent variants.
const WILAYA_ALIASES = {
  'adrar': 'adrar',
  'chlef': 'chlef', 'ech cheliff': 'chlef', 'el asnam': 'chlef',
  'laghouat': 'laghouat',
  'oum el bouaghi': 'oum el bouaghi', 'oum el-bouaghi': 'oum el bouaghi',
  'batna': 'batna',
  'bejaia': 'bejaia', 'béjaïa': 'bejaia', 'bjaia': 'bejaia',
  'biskra': 'biskra',
  'bechar': 'bechar', 'béchar': 'bechar',
  'blida': 'blida',
  'bouira': 'bouira',
  'tamanrasset': 'tamanrasset', 'tamanghasset': 'tamanrasset',
  'tebessa': 'tebessa', 'tébessa': 'tebessa',
  'tlemcen': 'tlemcen',
  'tiaret': 'tiaret',
  'tizi ouzou': 'tizi ouzou', 'tizi-ouzou': 'tizi ouzou',
  'alger': 'alger', 'algier': 'alger', 'algiers': 'alger', 'alger centre': 'alger',
  'djelfa': 'djelfa',
  'jijel': 'jijel',
  'setif': 'setif', 'sétif': 'setif',
  'saida': 'saida', 'saïda': 'saida',
  'skikda': 'skikda',
  'sidi bel abbes': 'sidi bel abbes', 'sidi bel abbès': 'sidi bel abbes',
  'annaba': 'annaba',
  'guelma': 'guelma',
  'constantine': 'constantine',
  'medea': 'medea', 'médéa': 'medea',
  'mostaganem': 'mostaganem',
  'msila': 'msila', "m'sila": 'msila',
  'mascara': 'mascara',
  'ouargla': 'ouargla',
  'oran': 'oran',
  'el bayadh': 'el bayadh',
  'illizi': 'illizi',
  'bordj bou arreridj': 'bordj bou arreridj', 'bordj bou arréridj': 'bordj bou arreridj',
  'boumerdes': 'boumerdes', 'boumerdès': 'boumerdes',
  'el tarf': 'el tarf',
  'tindouf': 'tindouf',
  'tissemsilt': 'tissemsilt',
  'el oued': 'el oued',
  'khenchela': 'khenchela',
  'souk ahras': 'souk ahras',
  'tipaza': 'tipaza', 'tipasa': 'tipaza',
  'mila': 'mila',
  'ain defla': 'ain defla', 'aïn defla': 'ain defla', 'ain-defla': 'ain defla',
  'naama': 'naama', 'naâma': 'naama',
  'ain temouchent': 'ain temouchent', 'aïn témouchent': 'ain temouchent',
  'ghardaia': 'ghardaia', 'ghardaïa': 'ghardaia',
  'relizane': 'relizane',
  'timimoun': 'timimoun',
  'bordj badji mokhtar': 'bordj badji mokhtar',
  'ouled djellal': 'ouled djellal',
  'beni abbes': 'beni abbes', 'béni abbès': 'beni abbes',
  'in salah': 'in salah',
  'in guezzam': 'in guezzam',
  'touggourt': 'touggourt',
  'djanet': 'djanet',
  "m'ghair": 'mghair', 'mghair': 'mghair',
  'el meniaa': 'el meniaa', 'el méniaa': 'el meniaa',
};

/**
 * Resolve a wilaya name to its ZR Express territory.
 * Uses alias map first to normalize the name, then searches ZR API.
 */
async function resolveWilaya(cfg, wilayaName) {
  const cleaned = String(wilayaName || '').trim();
  if (!cleaned) throw new Error('ZR Express: la wilaya de la commande est vide — impossible de créer le colis');

  // Normalize through alias map first.
  const normalized = normalizeName(cleaned);
  const canonical = WILAYA_ALIASES[normalized] || normalized;

  // Search ZR API with the canonical name.
  const items = await searchTerritories(cfg, canonical);
  const target = normalizeName(canonical);

  // ZR may return level as 'wilaya', 'Wilaya', or other variants — be flexible.
  const wilayas = items.filter(it =>
    String(it.level || '').toLowerCase().includes('wilaya') ||
    !it.parentId // top-level territories with no parent are wilayas
  );

  // Exact normalized match first.
  let match = wilayas.find(w => normalizeName(w.name) === target);
  // Fall back to "contains" in either direction.
  if (!match) {
    match = wilayas.find(w =>
      normalizeName(w.name).includes(target) ||
      target.includes(normalizeName(w.name))
    );
  }
  // Last resort: search all returned items (in case level field is absent).
  if (!match) {
    match = items.find(it =>
      normalizeName(it.name) === target ||
      normalizeName(it.name).includes(target) ||
      target.includes(normalizeName(it.name))
    );
  }

  if (!match) {
    throw new Error(`ZR Express: wilaya "${cleaned}" introuvable chez ZR Express — vérifier l'orthographe de la wilaya sur la commande`);
  }
  return match;
}

/**
 * Resolve a commune name to its ZR Express territory, scoped to a wilaya.
 * Falls back to wilaya-level match if commune not found (rare but safe).
 */
async function resolveCommune(cfg, communeName, wilaya) {
  const cleaned = String(communeName || '').trim();
  if (!cleaned) throw new Error(`ZR Express: la commune de la commande est vide pour la wilaya "${wilaya.name}" — impossible de créer le colis`);

  const normalized = normalizeName(cleaned);
  const items = await searchTerritories(cfg, normalized);
  const target = normalized;

  // Try scoped to wilaya first (parentId match).
  const scopedItems = items.filter(it =>
    it.parentId === wilaya.id ||
    String(it.level || '').toLowerCase().includes('commune')
  );

  let match = scopedItems.find(c => normalizeName(c.name) === target);
  if (!match) {
    match = scopedItems.find(c =>
      normalizeName(c.name).includes(target) ||
      target.includes(normalizeName(c.name))
    );
  }
  // Fallback: search all returned items ignoring parentId.
  if (!match) {
    match = items.find(it =>
      normalizeName(it.name) === target ||
      normalizeName(it.name).includes(target) ||
      target.includes(normalizeName(it.name))
    );
  }

  if (!match) {
    throw new Error(`ZR Express: commune "${cleaned}" introuvable dans la wilaya "${wilaya.name}" chez ZR Express — vérifier l'orthographe de la commune sur la commande`);
  }
  return match;
}

module.exports = {
  key: 'zr',
  label: 'ZR Express (Algérie)',
  canCreateOutbound: true,
  statusMap: STATUS_MAP,

  async testConnection(cfg) {
    if (!cfg.apiKey) return { ok: false, message: 'API Key manquant' };
    if (!cfg.secretKey) return { ok: false, message: 'Tenant ID manquant (champ Secret Key)' };
    try {
      const res = await httpFetch(`${baseUrl(cfg)}/territories/search`, {
        method: 'POST',
        headers: authHeaders(cfg),
        body: JSON.stringify({ pageNumber: 1, pageSize: 1 }),
      }, 15000);
      if (res.ok) return { ok: true, message: `Connecté — ${res.json?.totalCount || 0} territoires disponibles` };
      if (res.status === 401) return { ok: false, message: 'Clé API ou Tenant ID invalide (401)' };
      return { ok: false, message: `ZR Express répond ${res.status}` };
    } catch (e) {
      return { ok: false, message: 'Erreur réseau: ' + (e.name === 'AbortError' ? 'timeout' : e.message) };
    }
  },

  async createShipment(input, cfg) {
    const order = input.order || input;

    // 1. Resolve wilaya, then commune scoped to it. Either throws with a
    //    precise French message on failure — caught upstream by
    //    tryAutoCreateShipment(), which logs it and pushes a 'shipment_failed'
    //    notification so the order is visibly flagged in the CRM.
    const wilaya  = await resolveWilaya(cfg, order.wilaya || order.city);
    const commune = await resolveCommune(cfg, order.commune || order.city, wilaya);

    const customerName = String(order.client || 'Client').slice(0, 100) || 'Client';
    let phone = String(order.phone || '').replace(/\s+/g, '');
    // ZR expects an international format; the CRM stores local 0X… numbers.
    if (phone.startsWith('0')) phone = '+213' + phone.slice(1);
    if (!phone) phone = '+213000000000';

    const productName = String(order.product || 'Article').slice(0, 100).replace(/\|/g, '-');
    const quantity = Math.max(1, Number(order.quantity) || 1);
    // amount = the order's final total (price already holds total_price from
    // Shopify, i.e. product + shipping − discount), per ZR's "amount incl.
    // delivery fee" requirement.
    const amount = Number(order.price) || 0;
    const unitPrice = quantity > 0 ? amount / quantity : amount;

    const idExterne = String(order.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);

    const body = {
      customer: {
        customerId: randomUuid(),
        name: customerName,
        phone: { number1: phone },
      },
      deliveryAddress: {
        cityTerritoryId: wilaya.id,
        districtTerritoryId: commune.id,
        street: String(order.shippingNote || order.note || '').slice(0, 200),
      },
      orderedProducts: [
        {
          productName,
          unitPrice,
          quantity,
          stockType: 'none', // our products aren't registered in ZR's catalog
        },
      ],
      deliveryType: 'home',
      description: productName.slice(0, 250) || 'Commande CRM',
      amount,
      ...(idExterne ? { externalId: idExterne } : {}),
    };

    const res = await httpFetch(`${baseUrl(cfg)}/parcels`, {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify(body),
    }, 25000);

    if (!res.ok) {
      const errs = res.json?.errors;
      const detail = Array.isArray(errs) && errs.length
        ? errs.map(e => e.description || e.message).join(' / ')
        : (res.json?.detail || res.text?.slice(0, 200) || `HTTP ${res.status}`);
      throw new Error(`ZR Express: création du colis échouée — ${detail}`);
    }

    const parcelId = res.json?.id || '';
    if (!parcelId) throw new Error('ZR Express: réponse inattendue (pas d\'identifiant de colis)');

    return {
      trackingNumber: '', // ZR assigns the tracking number later, delivered via webhook
      providerShipmentId: parcelId,
      providerReference: idExterne,
      labelUrl: '',
      originalStatus: 'OrderReceived',
      description: 'Colis créé via API ZR Express — en attente du numéro de suivi (webhook)',
      raw: { parcelId, wilaya: wilaya.name, commune: commune.name, body },
    };
  },

  // No polling endpoint — ZR Express uses webhooks exclusively
  async getTracking(trackingNumber, cfg) {
    return [];
  },

  parseWebhook(headers, body, cfg) {
    const b = body || {};

    // Verify Svix signature
    if (cfg && cfg.webhookSecret) {
      if (!verifySvixSignature(body, headers, cfg.webhookSecret)) return null;
    }

    // Svix envelope: { eventType, occurredAt, data: ParcelWebhookDto }
    const eventType = b.eventType || '';
    const data      = b.data || b; // fallback if no envelope

    const trackingNumber  = data.trackingNumber  || b.trackingNumber || b.tracking || '';
    const externalId      = data.externalId      || '';
    const stateName       = data.state?.name     || '';
    const situationSlug   = data.situation?.slug || '';
    const situationName   = data.situation?.name || stateName || '';
    const occurredAt      = b.occurredAt         || data.lastStateUpdateAt || '';

    if (!trackingNumber && !externalId) return null;

    const crmStatus = stateToStatus(stateName, situationSlug);

    return {
      trackingNumber,
      externalId,  // our order ID — used by the route to find the order
      eventTime: occurredAt ? new Date(occurredAt).getTime() : Date.now(),
      originalStatus: situationName || stateName || eventType,
      crmStatus,
      description: situationName || stateName || '',
      raw: { inbound: true, eventType, body: data, headers: pickSvixHeaders(headers) },
    };
  },

  mapStatus(originalStatus) {
    if (!originalStatus) return 'pending';
    return stateToStatus(originalStatus, '');
  },
};

function pickSvixHeaders(h) {
  if (!h) return {};
  const out = {};
  for (const k of ['svix-id', 'svix-timestamp', 'svix-signature', 'webhook-id']) {
    if (h[k]) out[k] = h[k];
  }
  return out;
}
