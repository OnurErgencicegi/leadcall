import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
// Varsayılan olarak sadece bu bilgisayardan erişilir (ağdaki başkaları anahtarlarına/kayıtlarına ulaşamaz).
const HOST = process.env.HOST || '127.0.0.1';
const DEFAULT_MODEL = 'meta/llama-3.3-70b-instruct';
const GROQ_BASE = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
const NVIDIA_BASE = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';

// ---------- Basit dosya tabanlı depo ----------
const DATA_DIR = path.join(__dirname, 'data');
const REC_DIR = path.join(DATA_DIR, 'recordings');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(REC_DIR, { recursive: true });

let db = { businesses: {} };
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch {
  /* ilk çalıştırma */
}
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- Ayarlar (uygulama içinden girilir; .env isteğe bağlıdır) ----------
// Öncelik: Ayarlar ekranında girilen değer > .env dosyası > varsayılan
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
} catch {
  /* henüz ayar yok */
}
function saveSettings() {
  const tmp = SETTINGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SETTINGS_FILE);
}
const SECRET_KEYS = ['SERPAPI_API_KEY', 'SERPER_API_KEY', 'GOOGLE_PLACES_API_KEY', 'GROQ_API_KEY', 'NVIDIA_API_KEY'];
const cfg = (k) => (k in settings ? String(settings[k] ?? '') : process.env[k] || '');
const demoOn = () => ('DEMO' in settings ? settings.DEMO === '1' : process.env.DEMO === '1');
const nvidiaModel = () => cfg('NVIDIA_MODEL') || DEFAULT_MODEL;
const myOffer = () => cfg('MY_OFFER') || 'Henüz tanımlanmadı (genel B2B hizmet/ürün satışı varsay).';

// ---------- Yardımcılar ----------
const STAGES = ['new', 'contacted', 'interested', 'rejected', 'won'];

function bestScore(b) {
  const scores = (b.calls || []).map((c) => c.analysis?.score).filter((s) => typeof s === 'number');
  return scores.length ? scores[scores.length - 1] : null; // en son görüşmenin skoru
}
function view(b) {
  return { ...b, score: bestScore(b), callCount: (b.calls || []).length };
}

function demoPlaces(city, category) {
  const names = [
    'Güven', 'Merkez', 'Yıldız', 'Anadolu', 'Evrensel', 'Başkent', 'Kardeşler', 'Mavi',
  ];
  return names.map((n, i) => ({
    id: `demo-${city}-${category}-${i}`.toLowerCase().replace(/\s+/g, '-'),
    name: `${n} ${category}`,
    address: `${city}, Örnek Mah. ${i + 1}. Sk. No:${i + 3}`,
    phone: `0258 555 00 ${String(10 + i)}`,
    phoneIntl: `+90 258 555 00 ${String(10 + i)}`,
    rating: 3.6 + (i % 5) * 0.3,
    ratingCount: 5 + i * 7,
    website: '',
    mapsUrl: '',
  }));
}

async function xfetch(label, url, opts) {
  try {
    return await fetch(url, opts);
  } catch {
    throw new Error(`${label} servisine ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.`);
  }
}

async function googleSearch(city, category) {
  const places = [];
  let pageToken;
  for (let i = 0; i < 3; i++) {
    const body = { textQuery: `${city} ${category}`, languageCode: 'tr', regionCode: 'TR', pageSize: 20 };
    if (pageToken) body.pageToken = pageToken;
    const r = await xfetch('Google Places', 'https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': cfg('GOOGLE_PLACES_API_KEY'),
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.rating,places.userRatingCount,places.websiteUri,places.googleMapsUri,nextPageToken',
      },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Google Places hatası (${r.status}): ${data.error?.message || 'bilinmiyor'}`);
    for (const p of data.places || []) {
      places.push({
        id: p.id,
        name: p.displayName?.text || 'İsimsiz',
        address: p.formattedAddress || '',
        phone: p.nationalPhoneNumber || '',
        phoneIntl: p.internationalPhoneNumber || '',
        rating: p.rating ?? null,
        ratingCount: p.userRatingCount ?? 0,
        website: p.websiteUri || '',
        mapsUrl: p.googleMapsUri || '',
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return { demo: false, places };
}

// Serper.dev: Google Maps sonuçlarını döndürür (kredi kartsız ücretsiz kredi ile başlanır)
async function serperSearch(city, category) {
  const pages = Math.max(1, Math.min(5, Number(process.env.SERPER_PAGES) || 2));
  const byId = new Map();
  for (let page = 1; page <= pages; page++) {
    const r = await xfetch('Serper', `${process.env.SERPER_BASE_URL || 'https://google.serper.dev'}/maps`, {
      method: 'POST',
      headers: { 'X-API-KEY': cfg('SERPER_API_KEY'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `${category} ${city}`, gl: 'tr', hl: 'tr', page }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Serper hatası (${r.status}): ${data.message || 'bilinmiyor'}`);
    const got = data.places || [];
    if (!got.length) break;
    let added = 0;
    for (const p of got) {
      const raw = p.placeId || p.cid || crypto.createHash('md5').update(`${p.title}|${p.address}`).digest('hex');
      const id = `serper-${raw}`;
      if (byId.has(id)) continue;
      added++;
      byId.set(id, {
        id,
        name: p.title || 'İsimsiz',
        address: p.address || '',
        phone: p.phoneNumber || '',
        phoneIntl: p.phoneNumber || '',
        rating: p.rating ?? null,
        ratingCount: p.ratingCount || 0,
        website: p.website || '',
        mapsUrl: p.cid ? `https://www.google.com/maps?cid=${p.cid}` : '',
      });
    }
    if (!added) break; // sayfa tekrar ediyorsa dur
  }
  return [...byId.values()];
}

// SerpApi (serpapi.com): Google Maps sonuçlarını telefonlarıyla döndürür
async function serpapiSearch(city, category) {
  const pages = Math.max(1, Math.min(5, Number(process.env.SERPAPI_PAGES || process.env.SERPER_PAGES) || 2));
  const byId = new Map();
  for (let page = 0; page < pages; page++) {
    const params = { engine: 'google_maps', type: 'search', q: `${category} ${city}`, hl: 'tr', gl: 'tr', api_key: cfg('SERPAPI_API_KEY') };
    if (page) params.start = String(page * 20);
    const r = await xfetch('SerpApi', `https://serpapi.com/search.json?${new URLSearchParams(params)}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) {
      if (page > 0 || /any results/i.test(String(data.error || ''))) break; // sonuç bitti
      throw new Error(`SerpApi hatası (${r.status}): ${data.error || 'bilinmiyor'}`);
    }
    const got = data.local_results || [];
    if (!got.length) break;
    let added = 0;
    for (const p of got) {
      const raw = p.place_id || p.data_id || crypto.createHash('md5').update(`${p.title}|${p.address}`).digest('hex');
      const id = `serpapi-${raw}`;
      if (byId.has(id)) continue;
      added++;
      byId.set(id, {
        id,
        name: p.title || 'İsimsiz',
        address: p.address || '',
        phone: p.phone || '',
        phoneIntl: p.phone || '',
        rating: p.rating ?? null,
        ratingCount: p.reviews || 0,
        website: p.website || '',
        mapsUrl: p.place_id ? `https://www.google.com/maps/place/?q=place_id:${p.place_id}` : '',
      });
    }
    if (!added) break;
  }
  return [...byId.values()];
}

// OpenStreetMap Nominatim: anahtar gerekmez, ama Türkiye'de küçük işletmeler için veri seyrek olabilir
async function osmSearch(city, category) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    q: `${category} ${city}`,
    format: 'jsonv2',
    addressdetails: '1',
    extratags: '1',
    limit: '40',
    countrycodes: 'tr',
    'accept-language': 'tr',
  }).toString();
  const r = await fetch(url, { headers: { 'User-Agent': 'LeadCall/1.0 (kisisel kullanim)' } }).catch(() => {
    throw new Error('OpenStreetMap\'e ulaşılamadı. İnternet bağlantını kontrol et.');
  });
  if (!r.ok) throw new Error(`OpenStreetMap hatası (${r.status})`);
  const rows = await r.json();
  return rows.map((p) => {
    const x = p.extratags || {};
    const phone = x.phone || x['contact:phone'] || x['contact:mobile'] || '';
    return {
      id: `osm-${p.osm_type}-${p.osm_id}`,
      name: p.name || String(p.display_name || '').split(',')[0] || 'İsimsiz',
      address: p.display_name || '',
      phone,
      phoneIntl: phone,
      rating: null,
      ratingCount: 0,
      website: x.website || x['contact:website'] || '',
      mapsUrl: `https://www.openstreetmap.org/${p.osm_type}/${p.osm_id}`,
    };
  });
}

function activeProvider() {
  if (demoOn()) return 'demo';
  if (cfg('GOOGLE_PLACES_API_KEY')) return 'google';
  if (cfg('SERPAPI_API_KEY')) return 'serpapi';
  if (cfg('SERPER_API_KEY')) return 'serper';
  return 'osm';
}

async function searchPlaces(city, category) {
  const source = activeProvider();
  let places;
  if (source === 'demo') places = demoPlaces(city, category);
  else if (source === 'google') places = (await googleSearch(city, category)).places;
  else if (source === 'serpapi') places = await serpapiSearch(city, category);
  else if (source === 'serper') places = await serperSearch(city, category);
  else places = await osmSearch(city, category);
  return { demo: source === 'demo', source, places };
}

async function transcribe(buf, mime) {
  if (!cfg('GROQ_API_KEY')) throw new Error('Groq anahtarı tanımlı değil; ses yazıya çevrilemedi. Ayarlar’dan ekleyebilirsin.');
  const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: mime }), `kayit.${ext}`);
  fd.append('model', process.env.GROQ_STT_MODEL || 'whisper-large-v3');
  fd.append('language', 'tr');
  fd.append('response_format', 'json');
  fd.append('temperature', '0');
  const r = await xfetch('Groq', `${GROQ_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg('GROQ_API_KEY')}` },
    body: fd,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Groq hatası (${r.status}): ${data.error?.message || 'bilinmiyor'}`);
  return (data.text || '').trim();
}

function extractJson(text) {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Modelden JSON alınamadı.');
  return JSON.parse(clean.slice(start, end + 1));
}

async function analyze(business, transcript) {
  if (!cfg('NVIDIA_API_KEY')) throw new Error('NVIDIA anahtarı tanımlı değil; analiz yapılamadı. Ayarlar’dan ekleyebilirsin.');
  if (!transcript || transcript.length < 15) throw new Error('Konuşma metni çok kısa; analiz için yeterli içerik yok.');

  const previous = (business.calls || [])
    .filter((c) => c.analysis?.summary)
    .slice(-3)
    .map((c, i) => `Önceki görüşme ${i + 1}: ${c.analysis.summary}`)
    .join('\n');

  const system = `Sen deneyimli bir B2B satış koçusun. Bir satış temsilcisinin potansiyel müşteriyle yaptığı telefon görüşmesinin metnini değerlendirirsin.
Sadece geçerli JSON döndür, başka metin yazma. Tüm metinler Türkçe olsun. Konuşmada olmayan bilgiyi uydurma.
Şema:
{
  "score": 0-100 arasında tam sayı (bu işletmeye geri dönüş yapmanın değeri / satışa dönüşme ihtimali),
  "verdict": "Çok sıcak | Sıcak | Ilık | Soğuk",
  "summary": "2-3 cümlelik görüşme özeti",
  "notes": ["görüşmeden çıkan somut notlar: isimler, rakamlar, tarihler, ihtiyaçlar"],
  "objections": ["karşı tarafın itirazları ya da tereddütleri"],
  "next_action": "bir sonraki somut adım",
  "follow_up": "ne zaman geri dönülmeli (ör. 'Salı günü', '2 hafta sonra', 'gerek yok')"
}`;

  const user = `Satıcının sunduğu şey: ${myOffer()}
İşletme: ${business.name} (${business.address})
${previous ? previous + '\n' : ''}
Görüşme metni:
"""
${transcript.slice(0, 24000)}
"""`;

  const r = await xfetch('NVIDIA', `${NVIDIA_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg('NVIDIA_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: nvidiaModel(),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: 1200,
      stream: false,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`NVIDIA hatası (${r.status}): ${data.detail || data.error?.message || data.message || 'bilinmiyor'}`);
  const parsed = extractJson(data.choices?.[0]?.message?.content || '');
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
  const list = (v) => (Array.isArray(v) ? v.map(String) : []);
  return {
    score,
    verdict: String(parsed.verdict || (score >= 75 ? 'Çok sıcak' : score >= 55 ? 'Sıcak' : score >= 30 ? 'Ilık' : 'Soğuk')),
    summary: String(parsed.summary || ''),
    notes: list(parsed.notes),
    objections: list(parsed.objections),
    next_action: String(parsed.next_action || ''),
    follow_up: String(parsed.follow_up || ''),
    model: nvidiaModel(),
  };
}

async function processCall(business, call) {
  call.error = null;
  try {
    if (!call.transcript && call.audioFile) {
      const buf = fs.readFileSync(path.join(REC_DIR, call.audioFile));
      call.transcript = await transcribe(buf, call.mime || 'audio/webm');
    }
  } catch (e) {
    call.error = e.message;
    return;
  }
  try {
    call.analysis = await analyze(business, call.transcript);
  } catch (e) {
    call.error = e.message;
  }
}

function markContacted(b) {
  if (b.stage === 'new') b.stage = 'contacted';
  b.lastContactAt = new Date().toISOString();
}

// ---------- Uygulama ----------
const app = express();
// Başka sitelerin tarayıcı üzerinden bu yerel uygulamaya erişmesini engelle (DNS rebinding)
app.use((req, res, next) => {
  if (process.env.HOST) return next();
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (['localhost', '127.0.0.1', '[::1]'].includes(host)) return next();
  res.status(403).send('Erişim reddedildi.');
});
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    console.error(e);
    res.status(500).json({ error: e.message });
  });

app.get('/api/status', (_req, res) => {
  res.json({
    provider: activeProvider(),
    transcription: !!cfg('GROQ_API_KEY'),
    analysis: !!cfg('NVIDIA_API_KEY'),
    offer: !!cfg('MY_OFFER'),
    demo: demoOn(),
    model: nvidiaModel(),
  });
});

const keyInfo = (k) => {
  const v = cfg(k);
  return { set: !!v, hint: v ? '••••' + (v.length > 12 ? v.slice(-4) : '') : '', fromEnv: !(k in settings) && !!v };
};

app.get('/api/settings', (_req, res) => {
  res.json({
    MY_OFFER: cfg('MY_OFFER'),
    NVIDIA_MODEL: nvidiaModel(),
    defaultModel: DEFAULT_MODEL,
    demo: demoOn(),
    keys: Object.fromEntries(SECRET_KEYS.map((k) => [k, keyInfo(k)])),
  });
});

// Gönderilmeyen alan değişmez. Anahtar için null = kaldır, metin = yeni değer.
app.put('/api/settings', (req, res) => {
  const b = req.body || {};
  for (const k of SECRET_KEYS) {
    if (b[k] === null) settings[k] = '';
    else if (typeof b[k] === 'string' && b[k].trim()) settings[k] = b[k].replace(/[\s"']/g, '').slice(0, 300);
  }
  if (typeof b.MY_OFFER === 'string') settings.MY_OFFER = b.MY_OFFER.trim().slice(0, 1000);
  if (typeof b.NVIDIA_MODEL === 'string') {
    const m = b.NVIDIA_MODEL.trim().slice(0, 120);
    if (m && m !== DEFAULT_MODEL) settings.NVIDIA_MODEL = m;
    else delete settings.NVIDIA_MODEL;
  }
  if (typeof b.demo === 'boolean') settings.DEMO = b.demo ? '1' : '0';
  saveSettings();
  res.json({ ok: true });
});

// Anahtarın gerçekten çalışıp çalışmadığını dener
app.post('/api/settings/test', async (req, res) => {
  const svc = String(req.body?.service || '');
  const bad = (status) =>
    status === 401 || status === 403
      ? 'Anahtar kabul edilmedi. Kopyalarken eksik ya da fazla karakter kalmış olabilir; yeniden yapıştır.'
      : status === 429
        ? 'Ücretsiz limit dolmuş görünüyor. Biraz bekleyip tekrar dene.'
        : `Servis ${status} koduyla yanıt verdi.`;
  try {
    let r;
    if (svc === 'serpapi') {
      if (!cfg('SERPAPI_API_KEY')) return res.json({ ok: false, message: 'Önce anahtarı yapıştırıp kaydet.' });
      r = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(cfg('SERPAPI_API_KEY'))}`); // kredi harcamaz
    } else if (svc === 'serper') {
      if (!cfg('SERPER_API_KEY')) return res.json({ ok: false, message: 'Önce anahtarı yapıştırıp kaydet.' });
      r = await fetch(`${process.env.SERPER_BASE_URL || 'https://google.serper.dev'}/search`, {
        method: 'POST',
        headers: { 'X-API-KEY': cfg('SERPER_API_KEY'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: 'test', gl: 'tr', hl: 'tr', num: 1 }),
      });
    } else if (svc === 'groq') {
      if (!cfg('GROQ_API_KEY')) return res.json({ ok: false, message: 'Önce anahtarı yapıştırıp kaydet.' });
      r = await fetch(`${GROQ_BASE}/models`, { headers: { Authorization: `Bearer ${cfg('GROQ_API_KEY')}` } });
    } else if (svc === 'nvidia') {
      if (!cfg('NVIDIA_API_KEY')) return res.json({ ok: false, message: 'Önce anahtarı yapıştırıp kaydet.' });
      r = await fetch(`${NVIDIA_BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg('NVIDIA_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: nvidiaModel(), messages: [{ role: 'user', content: 'Merhaba' }], max_tokens: 1, stream: false }),
      });
    } else {
      return res.status(400).json({ ok: false, message: 'Bilinmeyen servis.' });
    }
    res.json(r.ok ? { ok: true, message: 'Çalışıyor.' } : { ok: false, message: bad(r.status) });
  } catch {
    res.json({ ok: false, message: 'Servise ulaşılamadı. İnternet bağlantını kontrol et.' });
  }
});

function upsertPlace(p, city, category, source) {
  const existing = db.businesses[p.id];
  db.businesses[p.id] = {
    stage: 'new',
    note: '',
    calls: [],
    createdAt: new Date().toISOString(),
    ...existing,
    ...p, // bilgiler güncellensin, geçmiş (calls/stage/note) korunsun
    city,
    category,
    source,
  };
  return view(db.businesses[p.id]);
}

// Elle / Excel'den yapıştırılan liste: her satır "İşletme adı ; telefon ; adres"
app.post('/api/import', (req, res) => {
  const city = String(req.body.city || '').trim();
  const category = String(req.body.category || '').trim();
  const lines = String(req.body.text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const items = [];
  for (const line of lines) {
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    const [name = '', phone = '', ...rest] = line.split(sep).map((s) => s.trim());
    if (!name || /^(ad|isim|işletme|name)$/i.test(name)) continue;
    const id = 'manual-' + crypto.createHash('md5').update(`${name.toLowerCase()}|${phone.replace(/\D/g, '')}`).digest('hex').slice(0, 16);
    items.push(
      upsertPlace(
        { id, name, address: rest.join(', ') || [city].filter(Boolean).join(''), phone, phoneIntl: phone, rating: null, ratingCount: 0, website: '', mapsUrl: '' },
        city,
        category,
        'manual'
      )
    );
  }
  if (!items.length) return res.status(400).json({ error: 'Satır bulunamadı. Her satıra: işletme adı ; telefon ; adres yaz.' });
  saveDb();
  res.json({ items });
});

app.post(
  '/api/search',
  wrap(async (req, res) => {
    const city = String(req.body.city || '').trim();
    const category = String(req.body.category || '').trim();
    if (!city || !category) return res.status(400).json({ error: 'Şehir ve iş kolu gerekli.' });
    // Ücretli/kotalı API'yi boşuna harcamamak için aynı arama 7 gün boyunca kayıttan gelir
    db.searches = db.searches || {};
    const key = `${city.toLocaleLowerCase('tr')}|${category.toLocaleLowerCase('tr')}`;
    const cached = db.searches[key];
    if (cached && !req.body.refresh && Date.now() - cached.at < 7 * 864e5) {
      const items = cached.ids.map((id) => db.businesses[id]).filter(Boolean).map(view);
      return res.json({ demo: false, source: cached.source, cached: true, items });
    }
    const { demo, source, places } = await searchPlaces(city, category);
    const items = places.map((p) => upsertPlace(p, city, category, source));
    if (places.length && !demo) db.searches[key] = { at: Date.now(), ids: places.map((p) => p.id), source };
    saveDb();
    res.json({ demo, source, cached: false, items });
  })
);

app.get('/api/businesses', (req, res) => {
  const onlyContacted = req.query.contacted === '1';
  const items = Object.values(db.businesses)
    .filter((b) => demoOn() || b.source !== 'demo')
    .filter((b) => !onlyContacted || b.stage !== 'new' || (b.calls || []).length)
    .sort((a, b) => (b.lastContactAt || b.createdAt || '').localeCompare(a.lastContactAt || a.createdAt || ''))
    .map(view);
  res.json({ items });
});

app.get('/api/businesses/:id', (req, res) => {
  const b = db.businesses[req.params.id];
  if (!b) return res.status(404).json({ error: 'İşletme bulunamadı.' });
  res.json(view(b));
});

app.patch('/api/businesses/:id', (req, res) => {
  const b = db.businesses[req.params.id];
  if (!b) return res.status(404).json({ error: 'İşletme bulunamadı.' });
  if (typeof req.body.note === 'string') b.note = req.body.note.slice(0, 5000);
  if (STAGES.includes(req.body.stage)) {
    b.stage = req.body.stage;
    if (b.stage !== 'new') b.lastContactAt = b.lastContactAt || new Date().toISOString();
  }
  saveDb();
  res.json(view(b));
});

// Ses kaydı yükle -> yazıya çevir -> analiz et
app.post(
  '/api/businesses/:id/calls',
  express.raw({ type: () => true, limit: '40mb' }),
  wrap(async (req, res) => {
    const b = db.businesses[req.params.id];
    if (!b) return res.status(404).json({ error: 'İşletme bulunamadı.' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Ses verisi boş.' });
    const mime = (req.headers['content-type'] || 'audio/webm').split(';')[0];
    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
    const id = crypto.randomUUID();
    const audioFile = `${id}.${ext}`;
    fs.writeFileSync(path.join(REC_DIR, audioFile), req.body); // önce kaydı güvene al
    const call = {
      id,
      at: new Date().toISOString(),
      duration: Number(req.query.duration) || null,
      audioFile,
      mime,
      transcript: '',
      analysis: null,
      error: null,
    };
    b.calls.push(call);
    markContacted(b);
    saveDb();
    await processCall(b, call);
    saveDb();
    res.json({ call, business: view(b) });
  })
);

// Metin yapıştırarak (ses olmadan) analiz
app.post(
  '/api/businesses/:id/calls/text',
  wrap(async (req, res) => {
    const b = db.businesses[req.params.id];
    if (!b) return res.status(404).json({ error: 'İşletme bulunamadı.' });
    const transcript = String(req.body.transcript || '').trim();
    if (!transcript) return res.status(400).json({ error: 'Metin boş.' });
    const call = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      duration: null,
      audioFile: null,
      mime: null,
      transcript,
      analysis: null,
      error: null,
    };
    b.calls.push(call);
    markContacted(b);
    saveDb();
    await processCall(b, call);
    saveDb();
    res.json({ call, business: view(b) });
  })
);

// Hata aldıysa yeniden dene
app.post(
  '/api/businesses/:id/calls/:callId/retry',
  wrap(async (req, res) => {
    const b = db.businesses[req.params.id];
    const call = b?.calls.find((c) => c.id === req.params.callId);
    if (!call) return res.status(404).json({ error: 'Görüşme bulunamadı.' });
    await processCall(b, call);
    saveDb();
    res.json({ call, business: view(b) });
  })
);

app.delete('/api/businesses/:id/calls/:callId', (req, res) => {
  const b = db.businesses[req.params.id];
  const i = b?.calls.findIndex((c) => c.id === req.params.callId) ?? -1;
  if (i < 0) return res.status(404).json({ error: 'Görüşme bulunamadı.' });
  const [call] = b.calls.splice(i, 1);
  if (call.audioFile) fs.rm(path.join(REC_DIR, call.audioFile), () => {});
  saveDb();
  res.json(view(b));
});

app.get('/api/recordings/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const p = path.join(REC_DIR, file);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.sendFile(p);
});

function openBrowser(url) {
  if (process.env.NO_OPEN === '1') return;
  try {
    const [cmd, args] =
      process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    /* tarayıcı açılamazsa adres yazıdan kullanılır */
  }
}

function start(port, tries = 0) {
  const server = app.listen(port, HOST);
  server.once('listening', () => {
    const url = `http://localhost:${port}`;
    console.log(`\nLeadCall hazır: ${url}`);
    console.log('Tarayıcı kendiliğinden açılmazsa bu adresi kopyalayıp tarayıcına yapıştır.');
    console.log('Kapatmak için bu pencerede Ctrl+C’ye bas.\n');
    openBrowser(url);
  });
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries < 10) {
      console.log(`${port} numaralı kapı dolu, ${port + 1} deneniyor…`);
      start(port + 1, tries + 1);
    } else {
      console.error('LeadCall başlatılamadı:', e.message);
      process.exit(1);
    }
  });
}
start(PORT);
