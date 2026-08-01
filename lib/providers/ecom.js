/* =============================================================================
 * lib/providers/ecom.js — Ecom Delivery Algeria (ecom-dz.com) adapter.
 *
 * Auth:   X-API-Key (cfg.apiKey) + X-API-Token (cfg.secretKey)
 * Base:   https://ecom-dz.com/api_v2  (cfg.apiUrl)
 * Create: POST /colis  (array, 1-100 parcels)
 * Track:  GET  /colis/{tracking}
 * Webhook inbound payload: { id, date, tracking, ville, situation, commentaire }
 * Signature: x-webhook-signature = sha256=HEX_HMAC_SHA256(rawBody, secret)
 * ========================================================================== */

const crypto = require('crypto');
const { mapStatus } = require('../statusMap');

// Ecom Delivery situation → CRM status
const STATUS_MAP = {
  'en préparation':       'created',
  'commande confirmée':   'created',
  'en traitement':        'dispatched',
  'encours':              'in_transit',
  'au bureau':            'at_office',
  'sortir en livraison':  'out_for_delivery',
  'en livraison':         'out_for_delivery',
  'livrée':               'delivered',
  'livre':                'delivered',
  'encaisser':            'delivered',
  'recouvert':            'returned',
  'retour':               'returned',
  'ne réponde pas':       'pending',
  'ne reponde pas':       'pending',
  'client absent':        'refused',
  'refusée':              'refused',
  'refuse':               'refused',
  'annulée':              'cancelled',
  'annule':               'cancelled',
};

// Algeria wilaya name → numeric ID (1-58, Algerian standard)
const WILAYA_MAP = {
  'adrar':1,'chlef':2,'laghouat':3,'oum el bouaghi':4,'batna':5,
  'béjaïa':6,'bejaia':6,'biskra':7,'béchar':8,'bechar':8,'blida':9,
  'bouira':10,'tamanrasset':11,'tébessa':12,'tebessa':12,'tlemcen':13,
  'tiaret':14,'tizi ouzou':15,'alger':16,'alger centre':16,
  'alger-centre':16,'djelfa':17,'jijel':18,'sétif':19,'setif':19,
  'saïda':20,'saida':20,'skikda':21,'sidi bel abbès':22,'sidi bel abbes':22,
  'annaba':23,'guelma':24,'constantine':25,'médéa':26,'medea':26,
  'mostaganem':27,'msila':28,"m'sila":28,'mascara':29,'ouargla':30,
  'oran':31,'el bayadh':32,'illizi':33,'bordj bou arréridj':34,
  'bordj bou arreridj':34,'boumerdès':35,'boumerdes':35,'el tarf':36,
  'tindouf':37,'tissemsilt':38,'el oued':39,'khenchela':40,
  'souk ahras':41,'tipaza':42,'mila':43,'aïn defla':44,'ain defla':44,
  'naâma':45,'naama':45,'aïn témouchent':46,'ain temouchent':46,
  'ghardaïa':47,'ghardaia':47,'relizane':48,
  'timimoun':49,'bordj badji mokhtar':50,'ouled djellal':51,
  'béni abbès':52,'beni abbes':52,'in salah':53,'in guezzam':54,
  'touggourt':55,'djanet':56,"m'ghair":57,'el meniaa':58,
};

function getWilayaId(wilaya) {
  if (!wilaya) return 16; // default Alger
  const n = parseInt(wilaya, 10);
  if (!isNaN(n) && n >= 1 && n <= 58) return n;
  return WILAYA_MAP[String(wilaya).toLowerCase().trim()] || 16;
}

function authHeaders(cfg) {
  return {
    'X-API-Key':    cfg.apiKey   || '',
    'X-API-Token':  cfg.secretKey || '',
    'Content-Type': 'application/json',
  };
}

function baseUrl(cfg) {
  return (cfg.apiUrl || 'https://ecom-dz.com/api_v2').replace(/\/+$/, '');
}

async function httpFetch(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { }
    return { ok: res.ok, status: res.status, text, json };
  } finally { clearTimeout(t); }
}

module.exports = {
  key: 'ecom',
  label: 'Ecom Delivery (Algérie)',
  canCreateOutbound: true,
  statusMap: STATUS_MAP,

  async testConnection(cfg) {
    try {
      const res = await httpFetch(`${baseUrl(cfg)}/test`, { headers: authHeaders(cfg) }, 15000);
      if (res.ok) return { ok: true, message: `Connecté — compte: ${res.json?.nom_fournisseur || 'OK'}` };
      if (res.status === 401) return { ok: false, message: 'Clé/Token invalide (401)' };
      return { ok: false, message: `Ecom répond ${res.status}` };
    } catch (e) {
      return { ok: false, message: 'Erreur réseau: ' + (e.name === 'AbortError' ? 'timeout' : e.message) };
    }
  },

  async createShipment(input, cfg) {
    const order = input.order || input;

    // Build the parcel object per Ecom API spec
    const wilayaId = getWilayaId(order.wilaya || order.city);
    const nomComplet = String(order.client || '').slice(0, 20) || 'Client';
    const mobile1 = String(order.phone || '').replace(/\s+/g, '').slice(0, 25) || '0000000000';
    const commune = String(order.commune || order.city || 'Alger Centre').slice(0, 50);
    const article = String(order.product || 'Article').slice(0, 255);
    const idExterne = String(order.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);

    const parcel = {
      nom_complet: nomComplet,
      mobile_1: mobile1,
      id_wilaya: wilayaId,
      commune,
      article,
      quantite: Math.max(1, Number(order.quantity) || 1),
      total: Number(order.price) || 0,
      ...(idExterne ? { id_externe: idExterne } : {}),
      ...(order.shippingNote || order.note ? { note_fournisseur: String(order.shippingNote || order.note || '').slice(0, 255) } : {}),
    };

    const res = await httpFetch(`${baseUrl(cfg)}/colis`, {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify([parcel]),
    }, 25000);

    if (!res.ok && res.status !== 201) {
      throw new Error(`Ecom API error ${res.status}: ${res.json?.error?.message || res.text?.slice(0, 200) || 'unknown'}`);
    }

    const result = (res.json?.resultats || [])[0];
    if (!result) throw new Error('Ecom: réponse inattendue (pas de resultats)');
    if (!result.ok) throw new Error(`Ecom: création échouée — ${result.erreur || 'erreur inconnue'}`);

    return {
      trackingNumber: result.tracking || '',
      providerShipmentId: String(result.id_colis || ''),
      providerReference: idExterne,
      labelUrl: '',
      originalStatus: 'En Préparation',
      description: 'Colis créé via API Ecom Delivery',
      raw: result,
    };
  },

  async getTracking(trackingNumber, cfg) {
    if (!trackingNumber) return [];
    const res = await httpFetch(`${baseUrl(cfg)}/colis/${encodeURIComponent(trackingNumber)}`, {
      headers: authHeaders(cfg),
    }, 20000);
    if (!res.ok) return [];
    const data = res.json || {};
    const historique = Array.isArray(data.historique) ? data.historique : [];
    return historique.map(h => ({
      eventTime: h.date ? new Date(h.date).getTime() : Date.now(),
      originalStatus: h.situation || '',
      crmStatus: this.mapStatus(h.situation || ''),
      description: h.commentaire || h.situation || '',
      raw: h,
    }));
  },

  parseWebhook(headers, body, cfg) {
    const b = body || {};
    const tracking = b.tracking || b.trackingNumber || b.code_suivi || '';
    const situation = b.situation || b.status || b.etat || '';
    if (!tracking && !situation) return null;

    // Signature verification, failing CLOSED (audit SEC-04). This previously
    // only rejected a signature that was present AND wrong — omitting the
    // header skipped the check entirely, which is the bypass.
    if (cfg && cfg.webhookSecret) {
      const sig = (headers['x-webhook-signature'] || '').replace(/^sha256=/, '');
      if (!sig) return null;
      const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
      const expected = crypto.createHmac('sha256', cfg.webhookSecret).update(rawBody).digest('hex');
      const a = Buffer.from(sig, 'utf8');
      const b2 = Buffer.from(expected, 'utf8');
      if (a.length !== b2.length || !crypto.timingSafeEqual(a, b2)) return null;
    }

    return {
      trackingNumber: tracking,
      eventTime: b.date ? new Date(b.date).getTime() : Date.now(),
      originalStatus: situation,
      crmStatus: this.mapStatus(situation),
      description: b.commentaire || situation || '',
      raw: { inbound: true, body: b },
    };
  },

  mapStatus(originalStatus) {
    if (!originalStatus) return 'pending';
    const key = String(originalStatus).toLowerCase().trim();
    if (STATUS_MAP[key]) return STATUS_MAP[key];
    // partial match
    for (const [k, v] of Object.entries(STATUS_MAP)) {
      if (key.includes(k) || k.includes(key)) return v;
    }
    return mapStatus(originalStatus, STATUS_MAP);
  },
};
