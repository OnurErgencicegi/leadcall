const $ = (s, r = document) => r.querySelector(s);

const STAGE_LABEL = { new: 'Henüz aranmadı', contacted: 'Görüşüldü', interested: 'İlgili', rejected: 'Reddetti', won: 'Müşteri' };
const FILTERS = [
  { key: 'all', label: 'Hepsi', fn: () => true },
  { key: 'new', label: 'Henüz aranmadı', fn: (b) => b.stage === 'new' },
  { key: 'talked', label: 'Aradıklarım', fn: (b) => b.stage !== 'new' },
  { key: 'hot', label: 'Sıcak (%60+)', fn: (b) => (b.score ?? -1) >= 60 },
  { key: 'rejected', label: 'Reddedenler', fn: (b) => b.stage === 'rejected' },
];
const QUICK = ['site yönetim şirketi', 'apartman yönetimi', 'emlak ofisi', 'diş kliniği', 'muhasebe bürosu', 'inşaat firması', 'restoran', 'otel', 'güzellik salonu'];
const SOURCE_LABEL = { google: 'Google Haritalar', serpapi: 'Google Haritalar (SerpApi)', serper: 'Google Haritalar', osm: 'OpenStreetMap', demo: 'örnek veri', manual: 'elle eklendi' };

const state = {
  tab: 'results',
  lists: { results: [], saved: [] },
  titles: { results: '', saved: '' },
  source: '', cached: false, noResult: false,
  filter: 'all', selectedId: null,
  searching: false, status: null, rec: null, proc: null, lastQuery: null,
};

// ---------- Yardımcılar ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => { try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol) ? x.href : ''; } catch { return ''; } };
const telHref = (b) => { const n = String(b.phoneIntl || b.phone || '').replace(/[^\d+]/g, ''); return n ? `tel:${n}` : ''; };
const scoreClass = (n) => (n >= 60 ? 'hot' : n >= 35 ? 'warm' : 'cold');
const heatLabel = (n) => (n >= 60 ? 'Sıcak' : n >= 35 ? 'Ilık' : 'Soğuk');
const fmtDate = (iso) => new Date(iso).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
const fmtDur = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const isMobile = () => matchMedia('(max-width: 960px)').matches;
const allItems = () => [...state.lists.results, ...state.lists.saved];
const currentList = () => state.lists[state.tab] || [];
const current = () => allItems().find((x) => x.id === state.selectedId);

function toast(msg, kind = 'ok', ms = 6000) {
  const t = document.createElement('div');
  t.className = 'toast' + (kind === 'bad' ? ' bad' : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

async function api(url, opts) {
  let r;
  try { r = await fetch(url, opts); } catch { throw new Error('Uygulamaya ulaşılamadı. LeadCall’ın çalıştığı pencere açık mı?'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || data.message || `Bir sorun oluştu (${r.status}).`);
  return data;
}
const jsonOpts = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function upsert(b) {
  for (const k of Object.keys(state.lists)) {
    const i = state.lists[k].findIndex((x) => x.id === b.id);
    if (i >= 0) state.lists[k][i] = b;
  }
}

// ---------- Kurulum durumu ----------
function readiness() {
  const s = state.status;
  if (!s) return [];
  return [
    { ok: s.offer, title: 'Ne sattığını yaz', hint: 'Yapay zeka geri dönüş puanını buna göre verir.' },
    {
      ok: ['google', 'serpapi', 'serper'].includes(s.provider), title: 'İşletme arama anahtarı',
      hint: s.provider === 'demo' ? 'Şu an örnek (sahte) veri açık.' : s.provider === 'osm' ? 'Şimdilik ücretsiz harita verisi kullanılıyor; telefonlar çoğu zaman eksik çıkar.' : 'Telefon numaralı sonuçlar için.',
    },
    { ok: s.transcription, title: 'Sesi yazıya çevirme', hint: 'Kaydettiğin görüşmenin metne dönmesi için.' },
    { ok: s.analysis, title: 'Yapay zeka analizi', hint: 'Görüşme özeti ve geri dönüş puanı için.' },
  ];
}
function renderSetupPill() {
  const items = readiness();
  const pill = $('#setupPill');
  const done = items.filter((i) => i.ok).length;
  pill.hidden = !items.length || done === items.length;
  pill.textContent = `Kurulum ${done}/${items.length}`;
  pill.setAttribute('aria-label', `Kurulum ${done}/${items.length} tamam. Ayarları açmak için dokun.`);
}
async function refreshStatus() {
  try { state.status = await api('/api/status'); } catch { state.status = null; }
  renderSetupPill();
}

// ---------- Sekmeler ve liste ----------
function renderTabs() {
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === state.tab)));
  $('#importBox').hidden = state.tab !== 'import';
}

function welcomeHtml() {
  const items = readiness();
  const check = items.length
    ? `<ul class="checklist">${items.map((i) => `<li><span class="tick ${i.ok ? 'ok' : ''}" aria-hidden="true">${i.ok ? '✓' : ''}</span><span><b>${esc(i.title)}</b>${i.ok ? '' : `<small>${esc(i.hint)}</small>`}</span></li>`).join('')}</ul>`
    : '';
  return `<div class="welcome">
    <div class="panel"><h2>Nasıl çalışır?</h2>
      <ol class="how">
        <li><div><b>Şehir ve iş kolunu yaz</b><span>Yukarıdaki kutulara yaz, “İşletmeleri bul”a bas.</span></div></li>
        <li><div><b>Listeden birini seç ve ara</b><span>Numarası ekranda. Aramayı kaydetmek için mikrofon düğmesine bas.</span></div></li>
        <li><div><b>Geri dönüş puanını gör</b><span>Yapay zeka görüşmeyi özetler ve bu işletmeye tekrar dönmeye değip değmediğini söyler.</span></div></li>
      </ol></div>
    ${items.length && items.every((i) => i.ok)
      ? `<div class="panel"><h2>Her şey hazır</h2><p class="hint" style="font-size:16px;margin:0 0 16px">Anahtarların bulundu (.env dosyasından ya da Ayarlar’dan). Yukarıya şehir ve iş kolunu yazıp “İşletmeleri bul”a basman yeterli.</p>
          <div class="actions"><button class="btn" data-act="setup">Ayarlara bak</button></div></div>`
      : `<div class="panel"><h2>Kurulum</h2>${check}
          <div class="actions"><button class="btn primary" data-act="setup">Ayarları aç</button><button class="btn" data-act="demo">Önce örnek verilerle dene</button></div></div>`}
    </div>`;
}

function renderList() {
  const isImport = state.tab === 'import';
  const items = currentList();
  const f = FILTERS.find((x) => x.key === state.filter) || FILTERS[0];
  const rows = items.filter(f.fn);
  $('#listTools').hidden = isImport || !items.length || state.searching;
  $('#list').hidden = isImport;
  $('#empty').hidden = isImport;

  if (items.length) {
    $('#chips').innerHTML = FILTERS.map((x) => `<button class="chip" aria-pressed="${state.filter === x.key}" data-f="${x.key}">${x.label}<span class="n">${items.filter(x.fn).length}</span></button>`).join('');
    const src = state.tab === 'results' && state.source ? ` · ${SOURCE_LABEL[state.source] || ''}` : '';
    let extra = '';
    if (state.tab === 'results' && state.status?.demo) extra = `<div class="note"><span>Örnek veri modu açık: bu işletmeler gerçek değil.</span><button class="btn small" data-act="demo-off">Gerçek veriye dön</button></div>`;
    else if (state.tab === 'results' && state.source === 'osm') extra = `<div class="note"><span>Ücretsiz harita verisi kullanıldı; telefon numaraları eksik olabilir.</span><button class="btn small" data-act="setup">Telefonlu sonuç için anahtar ekle</button></div>`;
    $('#meta').innerHTML = `${extra}${esc(state.titles[state.tab])}${esc(src)} — ${rows.length} işletme${state.tab === 'results' && state.cached ? ` · <button class="linkbtn" style="padding:0;min-height:0;margin:0" data-act="refresh">Güncel sonuçları getir</button>` : ''}`;
  }

  if (state.searching) {
    $('#list').innerHTML = '<li class="sk"></li><li class="sk"></li><li class="sk"></li><li class="sk"></li>';
    $('#empty').innerHTML = '';
    return;
  }

  $('#list').innerHTML = rows.map((b) => `
    <li class="row ${b.id === state.selectedId ? 'sel' : ''}">
      <button class="row-btn" data-id="${esc(b.id)}" ${b.id === state.selectedId ? 'aria-current="true"' : ''}>
        <span class="r-main">
          <div class="r-name">${esc(b.name)}</div>
          <div class="r-sub"><span class="r-phone">${esc(b.phone || 'Telefon yok')}</span> · ${esc(b.address)}</div>
        </span>
        <span class="r-side">
          <span class="status" data-stage="${esc(b.stage)}">${esc(STAGE_LABEL[b.stage] || b.stage)}${b.callCount ? ` · ${b.callCount}` : ''}</span>
          ${b.score != null ? `<span class="heat ${scoreClass(b.score)}">%${b.score} ${heatLabel(b.score)}</span>` : ''}
        </span>
      </button>
    </li>`).join('');

  const e = $('#empty');
  e.className = 'empty';
  if (!items.length && !isImport) {
    if (state.tab === 'results' && state.noResult) {
      e.className = 'empty simple';
      e.innerHTML = `<p><b>Bu arama için sonuç çıkmadı.</b><br>Yazımı değiştirmeyi dene (ör. “emlak” yerine “emlak ofisi”). Ya da kendi listeni ekle.</p>
        <button class="btn" data-act="import">Kendi listemi ekle</button>`;
    } else if (state.tab === 'results') {
      e.innerHTML = welcomeHtml();
    } else {
      e.className = 'empty simple';
      e.textContent = 'Henüz kayıtlı işletme yok. Bir işletmeyi aradığında ya da not aldığında burada görünür.';
    }
  } else if (items.length && !rows.length) {
    e.className = 'empty simple';
    e.innerHTML = '<p>Bu filtreye uyan işletme yok.</p><button class="btn" data-f="all">Hepsini göster</button>';
  } else {
    e.innerHTML = '';
  }
}

// ---------- Ayrıntı ----------
const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>';

function dial(score, cls) {
  const L = 157.08;
  const d = ((L * score) / 100).toFixed(1);
  return `<svg class="dial" viewBox="0 0 120 80" role="img" aria-label="Geri dönüş skoru yüzde ${score}">
    <path class="dial-track" d="M10 66 A50 50 0 0 1 110 66" fill="none" stroke-width="12" stroke-linecap="round"/>
    ${score > 0 ? `<path class="dial-arc ${cls}" d="M10 66 A50 50 0 0 1 110 66" fill="none" stroke-width="12" stroke-linecap="round" stroke-dasharray="${d} ${L}"/>` : ''}
    <text class="dial-num" x="60" y="58" text-anchor="middle">%${score}</text>
    <text class="dial-cap" x="60" y="77" text-anchor="middle">geri dönüş</text></svg>`;
}

function callHtml(c) {
  const a = c.analysis;
  let body = '';
  if (a) {
    const cls = scoreClass(a.score);
    body += `<div class="dialwrap">${dial(a.score, cls)}<div><div class="verdict ${cls}">${esc(a.verdict || heatLabel(a.score))}</div><div class="hint">Bu işletmeye geri dönmek ne kadar değerli?</div></div></div>`;
    if (a.summary) body += `<p>${esc(a.summary)}</p>`;
    if (a.notes?.length) body += `<h4>Notlar</h4><ul>${a.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
    if (a.objections?.length) body += `<h4>İtirazlar</h4><ul>${a.objections.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
    if (a.next_action) body += `<div class="next"><b>Sonraki adım${a.follow_up ? ` · ${esc(a.follow_up)}` : ''}</b>${esc(a.next_action)}</div>`;
  }
  if (c.error) {
    const needsKey = /tanımlı değil/.test(c.error);
    body += `<div class="err">${esc(c.error)}<div>${needsKey ? '<button class="btn small" data-open-settings>Ayarları aç</button>' : ''}<button class="btn small" data-retry="${esc(c.id)}">Yeniden dene</button></div></div>`;
  }
  return `<div class="call">
    <div class="call-head"><span>${esc(fmtDate(c.at))}${c.duration ? ' · ' + fmtDur(c.duration) : ''}</span><button class="btn small quiet danger" data-del="${esc(c.id)}">Sil</button></div>
    ${body}
    ${c.audioFile ? `<audio controls preload="none" src="/api/recordings/${encodeURIComponent(c.audioFile)}"></audio>` : ''}
    ${c.transcript ? `<details><summary>Konuşma metnini göster</summary><div class="transcript">${esc(c.transcript)}</div></details>` : ''}
  </div>`;
}

function renderDetail() {
  const b = current();
  const el = $('#detail');
  document.body.classList.toggle('noscroll', !!b && isMobile());
  if (!b) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const recording = !!state.rec?.recorder;
  const proc = state.proc?.bizId === b.id ? state.proc.msg : '';
  const tel = telHref(b), web = safeUrl(b.website), maps = safeUrl(b.mapsUrl);
  el.innerHTML = `
    <button class="btn quiet back" data-close>← Listeye dön</button>
    <div class="d-top">
      <div>
        <h2 class="d-name">${esc(b.name)}</h2>
        <div class="d-line">${esc(b.address)}</div>
        ${b.rating ? `<div class="d-line">★ ${esc(Number(b.rating).toFixed(1))} · ${esc(b.ratingCount)} yorum</div>` : ''}
        ${web || maps ? `<div class="d-links">${web ? `<a href="${esc(web)}" target="_blank" rel="noopener">Web sitesi</a>` : ''}${maps ? `<a href="${esc(maps)}" target="_blank" rel="noopener">Haritada aç</a>` : ''}</div>` : ''}
      </div>
      <button class="close" data-close aria-label="Kapat">×</button>
    </div>

    <div class="callbox">
      ${b.phone
        ? `<div class="phone-big">${esc(b.phone)}</div><div class="actions">${tel ? `<a class="btn primary" href="${esc(tel)}">Ara</a>` : ''}<button class="btn" data-copy="${esc(b.phone)}">Kopyala</button></div>`
        : '<div class="phone-none">Bu işletmenin telefon numarası yok. Web sitesinden bulabilirsin.</div>'}
    </div>
    ${b.phone ? '<p class="hint" style="margin-top:-8px">Bilgisayarda “Ara” çalışmazsa numarayı kopyalayıp telefonundan ara.</p>' : ''}

    <div class="field"><label for="stageSel">Durum</label>
      <select id="stageSel">${Object.entries(STAGE_LABEL).map(([k, v]) => `<option value="${k}" ${b.stage === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label for="noteBox">Notum</label><textarea id="noteBox" placeholder="Kısa not yaz, kendiliğinden kaydolur.">${esc(b.note)}</textarea></div>

    <section class="recorder" aria-labelledby="recTitle">
      <button class="mic ${recording ? 'rec' : ''}" id="micBtn" ${proc ? 'disabled' : ''} aria-label="${recording ? 'Kaydı bitir' : 'Kaydı başlat'}">${recording ? STOP : MIC}</button>
      <div>
        <h3 id="recTitle">Görüşmeyi kaydet</h3>
        <p class="hint">Karşı tarafın sesi de kaydolsun diye aramayı hoparlöre al. Kayıttan önce karşı tarafı bilgilendir.</p>
        <div class="rec-state"><span class="mic-label">${recording ? 'Kaydı bitir' : 'Kaydı başlat'}</span><span class="timer" id="timer" aria-live="off"></span></div>
      </div>
      <div class="rec-extra">
        ${proc ? `<div class="proc" role="status">${esc(proc)}</div>` : ''}
        <button class="linkbtn" data-toggle-text>Ya da konuşma metnini yapıştır</button>
        <div class="textbox" id="textBox" hidden>
          <label class="sr-only" for="pasteText">Görüşme metni</label>
          <textarea id="pasteText" placeholder="Görüşme metnini buraya yapıştır…"></textarea>
          <button class="btn primary" id="sendText">Analiz et</button>
        </div>
      </div>
    </section>

    <h3 class="d-title">Görüşme geçmişi (${b.calls.length})</h3>
    <div>${b.calls.length ? [...b.calls].reverse().map(callHtml).join('') : '<p class="hint">Bu işletmeyle henüz kayıtlı görüşme yok.</p>'}</div>`;
  if (recording) updateTimer();
}

function closeDetail() {
  if (state.rec?.recorder) return toast('Önce devam eden kaydı bitir.', 'bad');
  state.selectedId = null; renderList(); renderDetail();
}
function select(id) {
  if (state.rec?.recorder) return toast('Önce devam eden kaydı bitir.', 'bad');
  state.selectedId = id; renderList(); renderDetail();
  if (isMobile()) $('#detail').scrollTop = 0;
}

// ---------- Kayıt ----------
function pickMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return opts.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}
function updateTimer() {
  const t = $('#timer');
  if (t && state.rec) t.textContent = fmtDur((Date.now() - state.rec.start) / 1000);
}

async function toggleRecord() {
  if (state.rec?.recorder) { state.rec.recorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return toast('Bu tarayıcı ses kaydını desteklemiyor. Chrome, Edge, Firefox ya da Safari’nin güncel sürümünü kullan.', 'bad');
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    const mime = pickMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    const bizId = state.selectedId;
    state.rec = { recorder, start: Date.now(), bizId, timerId: setInterval(updateTimer, 500) };
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      clearInterval(state.rec?.timerId);
      stream.getTracks().forEach((t) => t.stop());
      const duration = Math.round((Date.now() - state.rec.start) / 1000);
      state.rec = null;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (duration < 2 || !blob.size) { renderDetail(); return toast('Kayıt çok kısa olduğu için kaydedilmedi.', 'bad'); }
      renderDetail();
      await upload(bizId, blob, duration);
    };
    recorder.start(1000);
    renderDetail();
  } catch (e) {
    const msg = e.name === 'NotAllowedError' ? 'Mikrofon izni verilmedi. Adres çubuğundaki mikrofon simgesinden izin verip tekrar dene.'
      : e.name === 'NotFoundError' ? 'Mikrofon bulunamadı. Bilgisayara bir mikrofon bağlı mı?'
      : 'Mikrofona erişilemedi: ' + e.message;
    toast(msg, 'bad', 9000);
  }
}

async function runCall(bizId, msg, request) {
  state.proc = { bizId, msg };
  if (state.selectedId === bizId) renderDetail();
  try { upsert((await request()).business); }
  catch (e) { toast(e.message, 'bad', 9000); }
  state.proc = null;
  renderList();
  if (state.selectedId === bizId) {
    renderDetail();
    const d = $('#detail'), t = $('.d-title');
    if (d && t) d.scrollTop = t.offsetTop - 16; // sonucu hemen göster
  }
}
const upload = (bizId, blob, duration) =>
  runCall(bizId, 'Kayıt alındı. Yazıya çevriliyor ve analiz ediliyor… (yarım dakika kadar sürebilir)', () =>
    api(`/api/businesses/${bizId}/calls?duration=${duration}`, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob }));

// ---------- Arama ----------
async function runSearch(city, category, refresh = false) {
  state.tab = 'results'; state.searching = true; state.noResult = false; state.selectedId = null;
  state.lastQuery = { city, category };
  renderTabs(); renderList(); renderDetail();
  const btn = $('#searchBtn');
  btn.disabled = true; btn.classList.add('busy'); btn.textContent = 'Aranıyor…';
  try {
    const { items, source, cached } = await api('/api/search', jsonOpts('POST', { city, category, refresh }));
    state.lists.results = items; state.titles.results = `${city} · ${category}`;
    state.source = source; state.cached = !!cached; state.noResult = !items.length; state.filter = 'all';
    localStorage.setItem('lc_last', JSON.stringify({ city, category }));
  } catch (err) {
    toast(err.message, 'bad', 9000);
  }
  state.searching = false;
  btn.disabled = false; btn.classList.remove('busy'); btn.textContent = 'İşletmeleri bul';
  renderList();
  $('#layout').scrollIntoView({ block: 'start' });
}

async function showSaved() {
  state.tab = 'saved'; state.selectedId = null; state.filter = 'all';
  renderTabs(); renderDetail();
  try {
    const { items } = await api('/api/businesses?contacted=1');
    state.lists.saved = items; state.titles.saved = 'Aradıkların ve not aldıkların';
  } catch (err) { toast(err.message, 'bad'); }
  renderList();
}

// ---------- Ayarlar ----------
const dlg = $('#settings');
const KEYS = {
  SERPAPI_API_KEY: 'serpapi', SERPER_API_KEY: 'serper', GROQ_API_KEY: 'groq', NVIDIA_API_KEY: 'nvidia', GOOGLE_PLACES_API_KEY: null,
};
let pendingClear = {};

function secretField(key, info, label) {
  const cleared = pendingClear[key];
  const ph = cleared ? 'Kaydedince kaldırılacak' : info.set ? `Kayıtlı ${info.hint} — değiştirmek için yenisini yapıştır` : 'Anahtarı buraya yapıştır';
  return `<div class="field"><label for="in-${key}">${label}</label>
    <div class="secret-row">
      <input class="text-in" id="in-${key}" data-key="${key}" type="password" spellcheck="false" autocomplete="off" placeholder="${esc(ph)}" ${cleared ? 'disabled' : ''} />
      ${KEYS[key] ? `<button type="button" class="btn" data-test="${KEYS[key]}">Test et</button>` : ''}
      ${info.set && !cleared ? `<button type="button" class="btn quiet danger" data-clear="${key}">Kaldır</button>` : ''}
    </div>
    ${info.fromEnv ? '<p class="hint">Bu anahtar .env dosyasından geliyor.</p>' : ''}
    ${KEYS[key] ? `<div class="test-msg" id="test-${KEYS[key]}" role="status"></div>` : ''}</div>`;
}

async function renderSettings(opts = {}) {
  const [s, st] = await Promise.all([api('/api/settings'), api('/api/status')]);
  state.status = st; renderSetupPill();
  const k = s.keys;
  const pill = (ok, t = 'Hazır', f = 'Eksik') => `<span class="pill ${ok ? 'ok' : ''}">${ok ? t : f}</span>`;
  $('#settingsForm').innerHTML = `
    <h2 id="settingsTitle">Ayarlar</h2>
    <p class="lead">Anahtarları buraya yapıştır, hepsi bu. Dosya düzenlemene gerek yok. Anahtarlar sadece bu bilgisayarda saklanır.</p>

    <section class="s-sec">
      <div class="s-head"><h3>Ne satıyorsun?</h3>${pill(!!s.MY_OFFER)}</div>
      <p>Yapay zeka, görüşmenin değerini senin sattığın şeye göre puanlar.</p>
      <label class="sr-only" for="in-offer">Ne sattığın</label>
      <textarea id="in-offer" placeholder="Örn. Site yönetim şirketlerine aidat takip ve muhasebe yazılımı satıyorum.">${esc(s.MY_OFFER)}</textarea>
    </section>

    <section class="s-sec">
      <div class="s-head"><h3>İşletmeleri nereden bulalım?</h3>${pill(k.SERPAPI_API_KEY.set || k.SERPER_API_KEY.set || k.GOOGLE_PLACES_API_KEY.set, 'Telefonlu sonuç açık', 'Ücretsiz harita verisi')}</div>
      <p>SerpApi ya da Serper, Google Haritalar sonuçlarını telefon numaralarıyla getirir. İkisinden biri yeter. Anahtar eklemezsen ücretsiz harita verisi kullanılır; küçük işletmelerin telefonu çoğu zaman eksik olur.</p>
      ${secretField('SERPAPI_API_KEY', k.SERPAPI_API_KEY, 'SerpApi anahtarı')}
      <details><summary>SerpApi anahtarını nasıl alırım?</summary><ol>
        <li><a href="https://serpapi.com" target="_blank" rel="noopener">serpapi.com</a> adresinde hesap aç.</li>
        <li>Hesabındaki API Key’i kopyala.</li><li>Yukarıya yapıştır, “Test et”e bas (test kredi harcamaz).</li></ol></details>
      ${secretField('SERPER_API_KEY', k.SERPER_API_KEY, 'Serper anahtarı (serper.dev, SerpApi kullanmıyorsan)')}
      <details><summary>Serper anahtarını nasıl alırım?</summary><ol>
        <li><a href="https://serper.dev" target="_blank" rel="noopener">serper.dev</a> adresine git ve ücretsiz hesap aç.</li>
        <li>Hesabındaki API Key’i kopyala.</li><li>Yukarıdaki kutuya yapıştır, “Test et”e bas.</li></ol></details>
      <details><summary>Google Places anahtarım var</summary>
        ${secretField('GOOGLE_PLACES_API_KEY', k.GOOGLE_PLACES_API_KEY, 'Google Places anahtarı')}
        <p class="hint">Doluysa Serper yerine bu kullanılır.</p></details>
      <label class="switch"><input type="checkbox" id="in-demo" ${s.demo ? 'checked' : ''} /><span><b>Örnek (sahte) veriyle dene</b><br><span class="hint">Anahtarsız denemek için. İşletmeler gerçek değildir.</span></span></label>
    </section>

    <section class="s-sec">
      <div class="s-head"><h3>Konuşmayı yazıya çevir</h3>${pill(k.GROQ_API_KEY.set)}</div>
      <p>Kaydettiğin ses Groq ile Türkçe metne çevrilir. Ücretsizdir.</p>
      ${secretField('GROQ_API_KEY', k.GROQ_API_KEY, 'Groq anahtarı')}
      <details><summary>Anahtarı nasıl alırım?</summary><ol>
        <li><a href="https://console.groq.com" target="_blank" rel="noopener">console.groq.com</a> adresine git, hesap aç.</li>
        <li>“API Keys” bölümünden yeni anahtar oluştur ve kopyala.</li><li>Yukarıya yapıştır, “Test et”e bas.</li></ol></details>
    </section>

    <section class="s-sec">
      <div class="s-head"><h3>Yapay zeka analizi</h3>${pill(k.NVIDIA_API_KEY.set)}</div>
      <p>Görüşmeyi özetler, notları çıkarır ve geri dönüş puanı verir. Ücretsiz katmanda dakikada yaklaşık 40 istek hakkı var.</p>
      ${secretField('NVIDIA_API_KEY', k.NVIDIA_API_KEY, 'NVIDIA anahtarı')}
      <details><summary>Anahtarı nasıl alırım?</summary><ol>
        <li><a href="https://build.nvidia.com" target="_blank" rel="noopener">build.nvidia.com</a> adresine git, ücretsiz giriş yap.</li>
        <li>“Get API Key” ile anahtarı oluştur. <code>nvapi-</code> ile başlar.</li><li>Yukarıya yapıştır, “Test et”e bas.</li></ol></details>
      <details><summary>Gelişmiş: model adı</summary>
        <div class="field"><label for="in-model">Model</label><input class="text-in" id="in-model" value="${esc(s.NVIDIA_MODEL)}" spellcheck="false" /></div></details>
    </section>

    <div class="sheet-foot"><button type="button" class="btn" data-cancel>Vazgeç</button><button type="submit" class="btn primary" id="saveSettings">Kaydet</button></div>`;
  if (opts.focus) $(`#in-${opts.focus}`)?.focus();
}

async function saveSettings() {
  const body = { MY_OFFER: $('#in-offer').value, NVIDIA_MODEL: $('#in-model').value, demo: $('#in-demo').checked };
  document.querySelectorAll('[data-key]').forEach((i) => {
    const key = i.dataset.key;
    if (pendingClear[key]) body[key] = null;
    else if (i.value.trim()) body[key] = i.value.trim();
  });
  await api('/api/settings', jsonOpts('PUT', body));
  pendingClear = {};
  await refreshStatus();
}

async function openSettings(opts) {
  pendingClear = {};
  try { await renderSettings(opts); dlg.showModal(); }
  catch (e) { toast(e.message, 'bad'); }
}

$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#saveSettings'); btn.disabled = true; btn.classList.add('busy');
  try {
    await saveSettings(); dlg.close(); renderList();
    toast('Ayarlar kaydedildi.');
  } catch (err) { toast(err.message, 'bad'); }
  btn.disabled = false; btn.classList.remove('busy');
});
$('#settingsForm').addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.hasAttribute('data-cancel')) dlg.close();
  else if (t.dataset.clear) {
    pendingClear[t.dataset.clear] = true;
    const offer = $('#in-offer').value, model = $('#in-model').value, demo = $('#in-demo').checked;
    await renderSettings();
    $('#in-offer').value = offer; $('#in-model').value = model; $('#in-demo').checked = demo;
  } else if (t.dataset.test) {
    const svc = t.dataset.test, out = $(`#test-${svc}`);
    out.className = 'test-msg'; out.textContent = 'Deneniyor…'; t.disabled = true;
    try {
      await saveSettings();
      const r = await api('/api/settings/test', jsonOpts('POST', { service: svc }));
      out.className = 'test-msg ' + (r.ok ? 'ok' : 'bad'); out.textContent = (r.ok ? '✓ ' : '✕ ') + r.message;
    } catch (err) { out.className = 'test-msg bad'; out.textContent = '✕ ' + err.message; }
    t.disabled = false;
  }
});
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
$('#settingsBtn').addEventListener('click', () => openSettings());
$('#setupPill').addEventListener('click', () => openSettings());

// ---------- Olaylar ----------
$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch($('#city').value.trim(), $('#category').value.trim());
});
$('#quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-q]'); if (!b) return;
  $('#category').value = b.dataset.q;
  ($('#city').value.trim() ? $('#searchBtn') : $('#city')).focus();
});

$('.tabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]'); if (!t) return;
  if (state.rec?.recorder) return toast('Önce devam eden kaydı bitir.', 'bad');
  if (t.dataset.tab === 'saved') return showSaved();
  state.tab = t.dataset.tab; state.selectedId = null; state.filter = 'all';
  renderTabs(); renderList(); renderDetail();
  if (state.tab === 'import') $('#importText').focus();
});

$('#importGo').addEventListener('click', async () => {
  const city = $('#city').value.trim(), category = $('#category').value.trim();
  const btn = $('#importGo'); btn.disabled = true;
  try {
    const { items } = await api('/api/import', jsonOpts('POST', { text: $('#importText').value, city, category }));
    state.lists.results = items; state.titles.results = `${city || 'Elle eklenen'} · ${category || 'liste'}`;
    state.source = 'manual'; state.cached = false; state.noResult = false; state.tab = 'results'; state.filter = 'all'; state.selectedId = null;
    $('#importText').value = '';
    renderTabs(); renderList(); renderDetail();
    toast(`${items.length} işletme listeye eklendi.`);
  } catch (err) { toast(err.message, 'bad'); }
  btn.disabled = false;
});

document.addEventListener('click', async (e) => {
  const f = e.target.closest('[data-f]');
  if (f) { state.filter = f.dataset.f; return renderList(); }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  if (act === 'setup') openSettings();
  else if (act === 'import') { state.tab = 'import'; renderTabs(); renderList(); $('#importText').focus(); }
  else if (act === 'refresh' && state.lastQuery) runSearch(state.lastQuery.city, state.lastQuery.category, true);
  else if (act === 'demo-off') { try { await api('/api/settings', jsonOpts('PUT', { demo: false })); await refreshStatus(); state.lists.results = []; renderList(); toast('Örnek veri modu kapandı.'); } catch (err) { toast(err.message, 'bad'); } }
  else if (act === 'demo') {
    try {
      await api('/api/settings', jsonOpts('PUT', { demo: true })); await refreshStatus();
      if (!$('#city').value.trim()) $('#city').value = 'Denizli';
      if (!$('#category').value.trim()) $('#category').value = 'site yönetim şirketi';
      runSearch($('#city').value.trim(), $('#category').value.trim());
    } catch (err) { toast(err.message, 'bad'); }
  }
});

$('#list').addEventListener('click', (e) => {
  const r = e.target.closest('[data-id]'); if (r) select(r.dataset.id);
});

$('#detail').addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  const id = state.selectedId;
  if (t.hasAttribute('data-close')) closeDetail();
  else if (t.id === 'micBtn') toggleRecord();
  else if (t.hasAttribute('data-toggle-text')) { const x = $('#textBox'); x.hidden = !x.hidden; if (!x.hidden) $('#pasteText').focus(); }
  else if (t.hasAttribute('data-open-settings')) openSettings();
  else if (t.dataset.copy) {
    try { await navigator.clipboard.writeText(t.dataset.copy); toast('Numara kopyalandı.'); }
    catch { toast('Kopyalanamadı. Numarayı elle seçip kopyala.', 'bad'); }
  } else if (t.id === 'sendText') {
    const transcript = $('#pasteText').value.trim(); if (!transcript) return toast('Önce konuşma metnini yapıştır.', 'bad');
    runCall(id, 'Analiz ediliyor…', () => api(`/api/businesses/${id}/calls/text`, jsonOpts('POST', { transcript })));
  } else if (t.dataset.retry) {
    runCall(id, 'Yeniden deneniyor…', () => api(`/api/businesses/${id}/calls/${t.dataset.retry}/retry`, { method: 'POST' }));
  } else if (t.dataset.del) {
    if (!confirm('Bu görüşme kaydı silinsin mi? Ses kaydı da silinir.')) return;
    try { upsert(await api(`/api/businesses/${id}/calls/${t.dataset.del}`, { method: 'DELETE' })); } catch (err) { toast(err.message, 'bad'); }
    renderList(); renderDetail();
  }
});

$('#detail').addEventListener('change', async (e) => {
  if (e.target.id !== 'stageSel') return;
  try { upsert(await api(`/api/businesses/${state.selectedId}`, jsonOpts('PATCH', { stage: e.target.value }))); toast('Durum güncellendi.'); }
  catch (err) { toast(err.message, 'bad'); }
  renderList();
});
$('#detail').addEventListener('focusout', async (e) => {
  if (e.target.id !== 'noteBox') return;
  const b = current(); if (!b || b.note === e.target.value) return;
  try { upsert(await api(`/api/businesses/${b.id}`, jsonOpts('PATCH', { note: e.target.value }))); } catch { toast('Not kaydedilemedi.', 'bad'); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selectedId && !dlg.open) closeDetail();
});

// ---------- Başlangıç ----------
(async function init() {
  $('#quick').innerHTML = QUICK.map((q) => `<button type="button" class="qchip" data-q="${esc(q)}">${esc(q)}</button>`).join('');
  try { const l = JSON.parse(localStorage.getItem('lc_last') || 'null'); if (l) { $('#city').value = l.city; $('#category').value = l.category; } } catch {}
  await refreshStatus();
  renderTabs(); renderList();
})();
