// ---------- State ----------
const STORAGE_KEY = 'walkForecastState_v1';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { home: null, classes: [], stops: [], ratings: [] };
    const parsed = JSON.parse(raw);
    if (!parsed.stops) parsed.stops = []; // backward-compat for saves made before stops existed
    if (!parsed.ratings) parsed.ratings = []; // backward-compat for saves made before personal ratings existed
    return parsed;
  } catch (e) {
    return { home: null, classes: [], stops: [], ratings: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

// ---------- Tab / climatology cache state ----------
let lastLiveDays = null;          // cached result of the last "This Week" generation, so switching tabs doesn't lose it
let climatologyProfiles = null;   // [12 monthly profiles], fetched once for the general area and reused everywhere
let climatologyFetchPromise = null; // in-flight fetch, so rapid tab-clicking doesn't trigger duplicate network calls
let activeTab = 'week';

function invalidateClimatologyCache() {
  climatologyProfiles = null;
  climatologyFetchPromise = null;
}

let personalNet = null; // cached trained model, retrained whenever a new rating comes in

function retrainPersonalNet() {
  personalNet = trainPersonalNet(state.ratings);
}


// ---------- DOM refs ----------
const homeLabelEl = document.getElementById('home-label');
const homeAddressEl = document.getElementById('home-address');
const homeLookupBtn = document.getElementById('home-lookup');
const homeResolvedEl = document.getElementById('home-resolved');
const classForm = document.getElementById('class-form');
const classListEl = document.getElementById('class-list');
const stopForm = document.getElementById('stop-form');
const stopListEl = document.getElementById('stop-list');
const generateBtn = document.getElementById('generate');
const statusEl = document.getElementById('status');
const resultsOutput = document.getElementById('results-output');
const legendEl = document.getElementById('legend');

// ---------- Init from saved state ----------
function initFromState() {
  if (state.home) {
    homeLabelEl.value = state.home.label || 'Home';
    homeAddressEl.value = state.home.address || '';
    if (state.home.lat != null && state.home.lon != null) {
      homeResolvedEl.textContent = `Resolved to: ${state.home.lat.toFixed(4)}, ${state.home.lon.toFixed(4)}`;
      homeResolvedEl.style.display = '';
    }
  }
  renderClassList();
  renderStopList();
}

let editingClassIndex = null;
let editingStopIndex = null;

function renderClassList() {
  classListEl.innerHTML = '';
  const dayNames = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };
  state.classes.forEach((c, idx) => {
    const li = document.createElement('li');
    const days = c.days.map(d => dayNames[d]).join('/');
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(c.name)}</strong>
        <div class="meta">${escapeHtml(c.address || `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`)} · ${c.start}–${c.end} · ${days}</div>
      </div>
      <div class="item-actions">
        <button class="edit-btn" data-idx="${idx}" title="Edit">✎</button>
        <button class="remove-btn" data-idx="${idx}" title="Remove">✕</button>
      </div>
    `;
    classListEl.appendChild(li);
  });
  classListEl.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      if (editingClassIndex === idx) cancelClassEdit();
      state.classes.splice(idx, 1);
      saveState();
      invalidateClimatologyCache();
      renderClassList();
    });
  });
  classListEl.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      startClassEdit(idx);
    });
  });
}

function startClassEdit(idx) {
  const c = state.classes[idx];
  editingClassIndex = idx;
  document.getElementById('c-name').value = c.name;
  document.getElementById('c-address').value = c.address || '';
  if (!c.address) {
    setStatus(`This class was saved before addresses were supported (was at ${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}) — re-enter its address to update it.`, null);
  }
  document.getElementById('c-start').value = c.start;
  document.getElementById('c-end').value = c.end;
  classForm.querySelectorAll('.days input[type="checkbox"]').forEach(cb => {
    cb.checked = c.days.includes(parseInt(cb.value, 10));
  });
  document.getElementById('c-submit').textContent = 'Save changes';
  document.getElementById('c-cancel').style.display = '';
  document.getElementById('c-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelClassEdit() {
  editingClassIndex = null;
  classForm.reset();
  document.getElementById('c-submit').textContent = '+ Add class';
  document.getElementById('c-cancel').style.display = 'none';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderStopList() {
  stopListEl.innerHTML = '';
  const dayNames = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };
  state.stops.forEach((s, idx) => {
    const li = document.createElement('li');
    const days = s.days.map(d => dayNames[d]).join('/');
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(s.name)}</strong>
        <div class="meta">${escapeHtml(s.address || `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`)} · ${s.start}–${s.end} · ${days}</div>
      </div>
      <div class="item-actions">
        <button class="edit-btn" data-idx="${idx}" title="Edit">✎</button>
        <button class="remove-btn" data-idx="${idx}" title="Remove">✕</button>
      </div>
    `;
    stopListEl.appendChild(li);
  });
  stopListEl.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      if (editingStopIndex === idx) cancelStopEdit();
      state.stops.splice(idx, 1);
      saveState();
      invalidateClimatologyCache();
      renderStopList();
    });
  });
  stopListEl.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      startStopEdit(idx);
    });
  });
}

function startStopEdit(idx) {
  const s = state.stops[idx];
  editingStopIndex = idx;
  document.getElementById('s-name').value = s.name;
  document.getElementById('s-address').value = s.address || '';
  if (!s.address) {
    setStatus(`This stop was saved before addresses were supported (was at ${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}) — re-enter its address to update it.`, null);
  }
  document.getElementById('s-start').value = s.start;
  document.getElementById('s-end').value = s.end;
  stopForm.querySelectorAll('.days input[type="checkbox"]').forEach(cb => {
    cb.checked = s.days.includes(parseInt(cb.value, 10));
  });
  document.getElementById('s-submit').textContent = 'Save changes';
  document.getElementById('s-cancel').style.display = '';
  document.getElementById('s-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelStopEdit() {
  editingStopIndex = null;
  stopForm.reset();
  document.getElementById('s-submit').textContent = '+ Add stop';
  document.getElementById('s-cancel').style.display = 'none';
}

// ---------- Home location persistence on input ----------
const UNIVERSITY_PROXIMITY_METERS = 3200; // ~2 miles — generous walking-adjacent radius

// Checks whether a coordinate sits near a university campus, using OpenStreetMap's
// free Overpass API (no key needed). This keeps the app scoped to its actual
// purpose — campus walking — rather than becoming a generic "check climate
// anywhere" tool, which is a different (and unintended) use case.
async function checkNearUniversity(lat, lon) {
  const query = `[out:json][timeout:15];(node["amenity"="university"](around:${UNIVERSITY_PROXIMITY_METERS},${lat},${lon});way["amenity"="university"](around:${UNIVERSITY_PROXIMITY_METERS},${lat},${lon});relation["amenity"="university"](around:${UNIVERSITY_PROXIMITY_METERS},${lat},${lon}););out center 1;`;
  const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query);
  const res = await fetch(url);
  if (!res.ok) throw new Error('University proximity check failed: ' + res.status);
  const data = await res.json();
  return Array.isArray(data.elements) && data.elements.length > 0;
}

// Geocodes a free-text address/place name into { lat, lon, displayName } using
// OpenStreetMap's Nominatim API (free, no API key). This is what lets users
// type "Jester West" or a street address instead of hunting down raw
// coordinates on Google Maps. Nominatim asks that requests identify the
// application via a custom header, which fetch() can't set for simple
// cross-origin requests — so we rely on the query string alone, keep request
// volume low (one lookup per user action, not per keystroke), and never
// auto-fire on every input change.
async function geocodeAddress(query) {
  const trimmed = query.trim();
  if (!trimmed) throw new Error('Enter an address or place name first.');
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(trimmed);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Address lookup failed: ' + res.status);
  const results = await res.json();
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`Couldn't find "${trimmed}" — try adding a city or being more specific.`);
  }
  const best = results[0];
  return { lat: parseFloat(best.lat), lon: parseFloat(best.lon), displayName: best.display_name };
}

// Attempts to set home: geocodes the typed address, then runs it through the
// existing university-proximity check before writing to state/localStorage.
// Keeps the two concerns separate (geocoding can fail for "address not
// found" reasons, the university check fails for "found it, but it's not
// near a campus" reasons) so the status message can be specific about which
// one actually happened.
async function trySetHome(address, label) {
  setStatus('Looking up that address…', null);
  let geocoded;
  try {
    geocoded = await geocodeAddress(address);
  } catch (err) {
    setStatus('⚠ ' + err.message, 'error');
    return false;
  }

  setStatus('Checking that this is near a university campus…', null);
  const nearUni = await checkNearUniversity(geocoded.lat, geocoded.lon);
  if (!nearUni) {
    setStatus(`⚠ "${geocoded.displayName}" doesn't look like it's within ~2 miles of a university campus — location not saved.`, 'error');
    return false;
  }

  state.home = {
    label: label || 'Home',
    address,
    lat: geocoded.lat,
    lon: geocoded.lon,
    verified: true,
  };
  saveState();
  invalidateClimatologyCache();
  homeResolvedEl.textContent = `Resolved to: ${geocoded.lat.toFixed(4)}, ${geocoded.lon.toFixed(4)}`;
  homeResolvedEl.style.display = '';
  setStatus('Home location saved.', 'ok');
  return true;
}

let homeVerificationInFlight = null; // tracks an in-progress check so other callers can wait for it instead of racing it

homeLookupBtn.addEventListener('click', async () => {
  const address = homeAddressEl.value;
  if (!address.trim()) {
    setStatus('Enter an address or place name first.', 'error');
    return;
  }
  homeVerificationInFlight = trySetHome(address, homeLabelEl.value)
    .catch(err => {
      console.error('Home lookup failed:', err);
      setStatus('Could not look up that address (network issue) — try again. (' + err.message + ')', 'error');
      return false;
    })
    .finally(() => { homeVerificationInFlight = null; });
  await homeVerificationInFlight;
});

// ---------- Add class ----------
classForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('c-name').value.trim();
  const address = document.getElementById('c-address').value.trim();
  const start = document.getElementById('c-start').value;
  const end = document.getElementById('c-end').value;
  const days = Array.from(classForm.querySelectorAll('.days input[type="checkbox"]:checked'))
    .map(cb => parseInt(cb.value, 10));

  if (!name || !address || !start || !end || days.length === 0) {
    setStatus('Fill out every field and pick at least one day.', 'error');
    return;
  }
  if (end <= start) {
    setStatus('Class end time must be after start time.', 'error');
    return;
  }

  setStatus('Looking up that address…', null);
  let geocoded;
  try {
    geocoded = await geocodeAddress(address);
  } catch (err) {
    setStatus('⚠ ' + err.message, 'error');
    return;
  }
  const { lat, lon } = geocoded;

  if (editingClassIndex !== null) {
    state.classes[editingClassIndex] = { name, address, lat, lon, start, end, days };
    setStatus('Class updated.', 'ok');
    cancelClassEdit();
  } else {
    state.classes.push({ name, address, lat, lon, start, end, days });
    classForm.reset();
    setStatus('Class added.', 'ok');
  }
  saveState();
  invalidateClimatologyCache();
  renderClassList();
});

document.getElementById('c-cancel').addEventListener('click', cancelClassEdit);

// ---------- Add/update stop ----------
stopForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('s-name').value.trim();
  const address = document.getElementById('s-address').value.trim();
  const start = document.getElementById('s-start').value;
  const end = document.getElementById('s-end').value;
  const days = Array.from(stopForm.querySelectorAll('.days input[type="checkbox"]:checked'))
    .map(cb => parseInt(cb.value, 10));

  if (!name || !address || !start || !end || days.length === 0) {
    setStatus('Fill out every field and pick at least one day.', 'error');
    return;
  }
  if (end <= start) {
    setStatus('Stop "leave" time must be after "arrive" time.', 'error');
    return;
  }

  setStatus('Looking up that address…', null);
  let geocoded;
  try {
    geocoded = await geocodeAddress(address);
  } catch (err) {
    setStatus('⚠ ' + err.message, 'error');
    return;
  }
  const { lat, lon } = geocoded;

  if (editingStopIndex !== null) {
    state.stops[editingStopIndex] = { name, address, lat, lon, start, end, days };
    setStatus('Stop updated.', 'ok');
    cancelStopEdit();
  } else {
    state.stops.push({ name, address, lat, lon, start, end, days });
    stopForm.reset();
    setStatus('Stop added.', 'ok');
  }
  saveState();
  invalidateClimatologyCache();
  renderStopList();
});

document.getElementById('s-cancel').addEventListener('click', cancelStopEdit);

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (type ? ' ' + type : '');
}

// ---------- Math helpers ----------
function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function timeStrToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTimeLabel(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  let h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ---------- Temperature -> color ----------
const TEMP_ANCHORS = [
  { t: 20, color: [27, 36, 112] },   // dark blue
  { t: 40, color: [59, 111, 224] },  // blue
  { t: 60, color: [63, 174, 87] },   // green
  { t: 70, color: [158, 209, 75] },  // yellowish green
  { t: 80, color: [245, 215, 66] },  // yellow
  { t: 95, color: [230, 67, 47] },   // red
  { t: 100, color: [139, 29, 29] },  // dark red
];

function lerp(a, b, f) { return a + (b - a) * f; }

function rgbForTempF(temp) {
  if (temp <= TEMP_ANCHORS[0].t) return TEMP_ANCHORS[0].color;
  if (temp >= TEMP_ANCHORS[TEMP_ANCHORS.length - 1].t) {
    return TEMP_ANCHORS[TEMP_ANCHORS.length - 1].color;
  }
  for (let i = 0; i < TEMP_ANCHORS.length - 1; i++) {
    const lo = TEMP_ANCHORS[i];
    const hi = TEMP_ANCHORS[i + 1];
    if (temp >= lo.t && temp <= hi.t) {
      const f = (temp - lo.t) / (hi.t - lo.t);
      return [
        Math.round(lerp(lo.color[0], hi.color[0], f)),
        Math.round(lerp(lo.color[1], hi.color[1], f)),
        Math.round(lerp(lo.color[2], hi.color[2], f)),
      ];
    }
  }
  return [136, 136, 136];
}

function colorForTempF(temp) {
  return rgbToHex(rgbForTempF(temp));
}

// Picks readable text color (light or dark) against a given background —
// needed because this palette spans very dark navy/maroon at the extremes,
// where the previously-hardcoded dark text became illegible.
function contrastTextColor([r, g, b]) {
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 100 ? '#0d1117' : '#f4f4f4';
}

function textColorForTempF(temp) {
  return contrastTextColor(rgbForTempF(temp));
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// 11-tier feels-like category ladder — covers the full range from dangerous cold
// to dangerous heat in one consistent scale, using "feels like" (heat index /
// wind chill adjusted), not raw temperature.
function categoryForFeelsLike(f) {
  if (f < 0) return 'Extreme cold';
  if (f <= 14) return 'Severe cold';
  if (f <= 31) return 'Freezing';
  if (f <= 40) return 'Cold';
  if (f <= 49) return 'Chilly';
  if (f <= 60) return 'Cool';
  if (f <= 74) return 'Comfortable';
  if (f <= 88) return 'Warm';
  if (f <= 96) return 'Hot';
  if (f <= 105) return 'Very hot';
  return 'Extreme';
}

const FEELS_LIKE_CATEGORIES = [
  { label: 'Extreme cold', repTemp: -10 },
  { label: 'Severe cold', repTemp: 7 },
  { label: 'Freezing', repTemp: 23 },
  { label: 'Cold', repTemp: 36 },
  { label: 'Chilly', repTemp: 45 },
  { label: 'Cool', repTemp: 55 },
  { label: 'Comfortable', repTemp: 67.5 },
  { label: 'Warm', repTemp: 81.5 },
  { label: 'Hot', repTemp: 92.5 },
  { label: 'Very hot', repTemp: 101 },
  { label: 'Extreme', repTemp: 115 },
];

function renderLegend() {
  legendEl.innerHTML = FEELS_LIKE_CATEGORIES.map(c =>
    `<span style="background:${colorForTempF(c.repTemp)}; color:${textColorForTempF(c.repTemp)};">${c.label}</span>`
  ).join('');
}
renderLegend();

// ---------- Weather fetch ----------
async function fetchHourlyForecast(lat, lon) {
  const fields = [
    'temperature_2m',
    'relativehumidity_2m',
    'precipitation',
    'precipitation_probability',
    'windspeed_10m',
    'weathercode',
  ].join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${fields}&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch&forecast_days=7&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather request failed: ' + res.status);
  const data = await res.json();
  return data.hourly; // { time, temperature_2m, relativehumidity_2m, precipitation, precipitation_probability, windspeed_10m, weathercode }
}

const CLIMATOLOGY_YEARS = 5; // years of history averaged per month (a quick-and-useful sample, not the 30-yr WMO standard)
const CLIMATOLOGY_REF_YEAR = 2001; // arbitrary non-leap reference year used to stamp synthetic "typical day" timestamps

// Open-Meteo's free historical archive — no API key required. Returns actual past
// hourly observations (ERA5 reanalysis), which we then average into monthly profiles.
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchHistoricalArchive(lat, lon, attempt = 1) {
  const endYear = new Date().getFullYear() - 1; // last fully-completed year
  const startYear = endYear - (CLIMATOLOGY_YEARS - 1);
  const fields = ['temperature_2m', 'relativehumidity_2m', 'precipitation', 'windspeed_10m', 'weathercode'].join(',');
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startYear}-01-01&end_date=${endYear}-12-31&hourly=${fields}&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch&timezone=auto`;

  let res;
  try {
    res = await fetch(url);
  } catch (networkErr) {
    console.error('Climate history fetch network error for URL:', url, networkErr);
    throw new Error(`Network/CORS error reaching archive-api.open-meteo.com (${networkErr.message}). Open the browser console for the full trace.`);
  }

  if (res.status === 429 && attempt <= 3) {
    const waitMs = attempt * 1500; // 1.5s, 3s, 4.5s backoff
    console.warn(`Climate history rate-limited (429), retrying in ${waitMs}ms (attempt ${attempt}/3)…`);
    await sleep(waitMs);
    return fetchHistoricalArchive(lat, lon, attempt + 1);
  }

  if (!res.ok) {
    let reason = res.statusText;
    try {
      const errBody = await res.json();
      if (errBody && errBody.reason) reason = errBody.reason;
    } catch (_) { /* body wasn't JSON, stick with statusText */ }
    console.error('Climate history fetch failed for URL:', url, '| status:', res.status, '| reason:', reason);
    throw new Error(`Historical weather request failed (${res.status}): ${reason}`);
  }

  const data = await res.json();
  return data.hourly;
}

// Buckets multiple years of hourly history into 12 monthly profiles (one synthetic
// "typical day," 24 hourly values each), shaped exactly like a live forecast's hourly
// object so legWeather()/weatherSnapshot() can consume it without any changes.
function buildMonthlyClimatology(hourlyArchive) {
  // buckets[month 0-11][hour 0-23] = running sums
  const buckets = Array.from({ length: 12 }, () =>
    Array.from({ length: 24 }, () => ({ n: 0, tempSum: 0, humSum: 0, windSum: 0, precipSum: 0, precipHours: 0, codeCounts: {} }))
  );

  const times = hourlyArchive.time;
  for (let i = 0; i < times.length; i++) {
    const t = times[i]; // "YYYY-MM-DDTHH:00"
    const month = parseInt(t.slice(5, 7), 10) - 1;
    const hour = parseInt(t.slice(11, 13), 10);
    const b = buckets[month][hour];
    const temp = hourlyArchive.temperature_2m[i];
    const hum = hourlyArchive.relativehumidity_2m[i];
    const wind = hourlyArchive.windspeed_10m[i];
    const precip = hourlyArchive.precipitation[i] ?? 0;
    const code = hourlyArchive.weathercode[i] ?? 0;
    if (temp == null) continue; // skip any gaps in the historical record
    b.n++;
    b.tempSum += temp;
    b.humSum += hum;
    b.windSum += wind;
    b.precipSum += precip;
    if (precip > 0) b.precipHours++;
    b.codeCounts[code] = (b.codeCounts[code] || 0) + 1;
  }

  const profiles = [];
  for (let month = 0; month < 12; month++) {
    const time = [], temperature_2m = [], relativehumidity_2m = [], precipitation = [], precipitation_probability = [], windspeed_10m = [], weathercode = [];
    for (let hour = 0; hour < 24; hour++) {
      const b = buckets[month][hour];
      const n = b.n || 1; // guard against an empty bucket (shouldn't happen with multi-year history)
      const pad = (x) => String(x).padStart(2, '0');
      time.push(`${CLIMATOLOGY_REF_YEAR}-${pad(month + 1)}-15T${pad(hour)}:00`);
      temperature_2m.push(b.tempSum / n);
      relativehumidity_2m.push(b.humSum / n);
      precipitation.push(b.precipSum / n);
      precipitation_probability.push(b.n ? (b.precipHours / b.n) * 100 : 0);
      windspeed_10m.push(b.windSum / n);
      // modal (most frequent) weather code for that hour-of-day in that month
      let modalCode = 0, modalCount = -1;
      for (const [code, count] of Object.entries(b.codeCounts)) {
        if (count > modalCount) { modalCount = count; modalCode = parseInt(code, 10); }
      }
      weathercode.push(modalCode);
    }
    profiles.push({ time, temperature_2m, relativehumidity_2m, precipitation, precipitation_probability, windspeed_10m, weathercode });
  }
  return profiles; // profiles[0] = January's typical day, ..., profiles[11] = December's
}

// Find the index of the nearest hour in the hourly forecast for a given JS Date
function nearestHourlyIndex(hourly, date) {
  const target = roundToHourLabel(date);
  let idx = hourly.time.indexOf(target);
  if (idx === -1) {
    let bestIdx = 0, bestDiff = Infinity;
    hourly.time.forEach((t, i) => {
      const diff = Math.abs(new Date(t).getTime() - date.getTime());
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    });
    idx = bestIdx;
  }
  return idx;
}

// Pull every weather variable at the nearest hour to a given JS Date
function weatherSnapshot(hourly, date) {
  const idx = nearestHourlyIndex(hourly, date);
  return {
    tempF: hourly.temperature_2m[idx],
    humidity: hourly.relativehumidity_2m ? hourly.relativehumidity_2m[idx] : null,
    precipIn: hourly.precipitation ? hourly.precipitation[idx] : 0,
    precipProb: hourly.precipitation_probability ? hourly.precipitation_probability[idx] : 0,
    windMph: hourly.windspeed_10m ? hourly.windspeed_10m[idx] : 0,
    code: hourly.weathercode ? hourly.weathercode[idx] : 0,
  };
}

// ---------- Weather code lookup (WMO codes used by Open-Meteo) ----------
const WEATHER_CODES = {
  0: { label: 'Clear', severity: 0 },
  1: { label: 'Mostly clear', severity: 0 },
  2: { label: 'Partly cloudy', severity: 0 },
  3: { label: 'Overcast', severity: 0 },
  45: { label: 'Fog', severity: 1 },
  48: { label: 'Freezing fog', severity: 2 },
  51: { label: 'Light drizzle', severity: 1 },
  53: { label: 'Drizzle', severity: 1 },
  55: { label: 'Heavy drizzle', severity: 2 },
  56: { label: 'Freezing drizzle', severity: 2 },
  57: { label: 'Freezing drizzle', severity: 2 },
  61: { label: 'Light rain', severity: 1 },
  63: { label: 'Rain', severity: 1 },
  65: { label: 'Heavy rain', severity: 3 },
  66: { label: 'Freezing rain', severity: 3 },
  67: { label: 'Freezing rain', severity: 3 },
  71: { label: 'Light snow', severity: 2 },
  73: { label: 'Snow', severity: 2 },
  75: { label: 'Heavy snow', severity: 3 },
  77: { label: 'Snow grains', severity: 2 },
  80: { label: 'Rain showers', severity: 1 },
  81: { label: 'Rain showers', severity: 2 },
  82: { label: 'Violent rain showers', severity: 3 },
  85: { label: 'Snow showers', severity: 2 },
  86: { label: 'Heavy snow showers', severity: 3 },
  95: { label: 'Thunderstorm', severity: 3 },
  96: { label: 'Thunderstorm w/ hail', severity: 3 },
  99: { label: 'Thunderstorm w/ hail', severity: 3 },
};

function codeInfo(code) {
  return WEATHER_CODES[code] || { label: 'Unknown', severity: 0 };
}

// Maps a weather code to which particle animation should play on that leg's row
function fxTypeForCode(code) {
  if ([95, 96, 99].includes(code)) return 'storm';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  return null;
}

// ---------- "Feels like" temperature ----------
// NWS-style heat index (valid roughly above 80F) and wind chill (valid roughly below 50F)
function heatIndexF(tempF, rh) {
  if (tempF < 80 || rh == null) return tempF;
  const T = tempF, R = rh;
  let hi =
    -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R -
    0.00683783 * T * T - 0.05481717 * R * R + 0.00122874 * T * T * R +
    0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
  return Math.max(hi, T);
}

function windChillF(tempF, windMph) {
  if (tempF > 50 || windMph < 3) return tempF;
  const T = tempF, V = windMph;
  const wc = 35.74 + 0.6215 * T - 35.75 * Math.pow(V, 0.16) + 0.4275 * T * Math.pow(V, 0.16);
  return Math.min(wc, T);
}

// Wind cools you any time the air is below skin temperature (~91F) — not just
// in the official sub-50F wind chill range. The NWS Heat Index formula itself
// is explicitly defined assuming calm/light wind, so it under-counts cooling
// on breezy hot days too. This is a deliberately gentle, capped adjustment
// (not the steep low-temp wind chill curve, which only applies <=50F and is
// already physically validated on its own) — it just fills the gap where wind
// was previously ignored entirely (51-79F) and softens heat index on windy days.
function windCoolingAdjustment(tempF, windMph) {
  if (windMph <= 3) return 0; // calm air — no meaningful convective/evaporative cooling boost
  const effectiveWind = Math.min(windMph, 40); // cap so extreme gusts don't extrapolate unrealistically
  return Math.min((effectiveWind - 3) * 0.2, 10); // up to ~10F cooler at very strong sustained wind
}

function feelsLikeF(snap) {
  if (snap.tempF <= 50) return windChillF(snap.tempF, snap.windMph); // NWS wind chill already fully wind-driven
  if (snap.tempF >= 80) {
    const hi = heatIndexF(snap.tempF, snap.humidity ?? 50);
    return hi - windCoolingAdjustment(snap.tempF, snap.windMph); // breeze takes the edge off heat index too
  }
  // 51-79F: previously ignored wind entirely — now applies the same gentle breeze cooling
  return snap.tempF - windCoolingAdjustment(snap.tempF, snap.windMph);
}

// ---------- Comfort score (0-100, higher = more pleasant to walk in) ----------
// Anchors follow NWS Heat Index / Wind Chill risk categories, so a given
// feels-like temperature maps to a score severity that matches its real-world
// danger level (Caution / Extreme Caution / Danger / Extreme Danger).
function interpolateScore(anchors, x) {
  if (x <= anchors[0].f) return anchors[0].s;
  const last = anchors[anchors.length - 1];
  if (x >= last.f) return last.s;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i], b = anchors[i + 1];
    if (x >= a.f && x <= b.f) {
      const t = (x - a.f) / (b.f - a.f);
      return a.s + (b.s - a.s) * t;
    }
  }
  return last.s;
}

// Heat side: 75-80 NWS "Caution" begins, 90 "Extreme Caution", 103 "Danger", 125 "Extreme Danger"
const HEAT_SCORE_ANCHORS = [
  { f: 75, s: 100 },
  { f: 80, s: 80 },
  { f: 90, s: 50 },
  { f: 103, s: 20 },
  { f: 125, s: 0 },
];
// Cold side: tiered to match practical "what do I need to wear" thresholds —
// hoodie territory (37-45F), jacket territory (32-37F), freezing/serious cold (20-32F),
// and extreme cold below 20F (frostbite risk territory, mirrors NWS wind chill warnings)
const COLD_SCORE_ANCHORS = [
  { f: -20, s: 0 },
  { f: 20, s: 18 },
  { f: 32, s: 38 },
  { f: 37, s: 58 },
  { f: 45, s: 78 },
  { f: 65, s: 100 },
];

function tempComfortScore(feelsLike) {
  if (feelsLike >= 65 && feelsLike <= 75) return 100;
  if (feelsLike > 75) return interpolateScore(HEAT_SCORE_ANCHORS, feelsLike);
  return interpolateScore(COLD_SCORE_ANCHORS, feelsLike);
}

function precipComfortScore(precipProb, precipIn) {
  const penalty = precipProb * 0.6 + Math.min(precipIn, 0.5) * 120;
  return clamp(100 - penalty, 0, 100);
}

function windComfortScore(windMph) {
  const penalty = Math.max(0, windMph - 8) * 2.5;
  return clamp(100 - penalty, 0, 100);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function comfortLabel(score) {
  if (score >= 85) return 'Great';
  if (score >= 70) return 'Good';
  if (score >= 50) return 'Fair';
  if (score >= 30) return 'Poor';
  return 'Harsh';
}

function comfortColor(score) {
  if (score >= 85) return '#3fae57';
  if (score >= 70) return '#9ed14b';
  if (score >= 50) return '#f5d742';
  if (score >= 30) return '#e6432f';
  return '#8b1d1d';
}

function textColorForComfortScore(score) {
  return score < 30 ? '#f4f4f4' : '#0d1117'; // only the dark-red "Harsh" tier needs light text
}

// ---------- Personal preference learning ----------
// A small neural net (5 inputs -> 8 hidden tanh units -> 1 sigmoid output),
// trained from scratch via backpropagation on the user's own 0-100 ratings.
// Inputs are the FULL weather context at rating time — feels-like temp,
// humidity, wind, chance of rain, and rain amount — not just temperature,
// since how a condition actually feels depends on all of these together
// (a hot day with no humidity feels nothing like the same temp at 90% RH).
const RATING_FEATURES = ['feelsLike', 'humidity', 'windMph', 'precipProb', 'precipIn'];
const PERSONAL_NET_HIDDEN = 8;
const PERSONAL_NET_EPOCHS = 3000;
const PERSONAL_NET_LR = 0.1;
const PERSONAL_NET_MIN_RATINGS = 3;
const PERSONAL_NET_RESTARTS = 12; // train this many times from different random inits, keep the best

// Each feature gets its own min/max (padded) from the observed ratings, since
// temp/humidity/wind/precip are on completely different scales and all need
// to land in roughly [-1, 1] for the network to train well.
function computeFeatureRanges(ratings) {
  return RATING_FEATURES.map(key => {
    const vals = ratings.map(r => r[key]);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.3 || Math.max(Math.abs(min), 1) * 0.3;
    return { min: min - pad, max: max + pad };
  });
}

function normalizeFeatures(item, ranges) {
  return RATING_FEATURES.map((key, i) => {
    const { min, max } = ranges[i];
    const range = (max - min) || 1;
    return (2 * (item[key] - min)) / range - 1;
  });
}

function forwardPass(net, x) {
  const h = net.W1.map((weights, j) => Math.tanh(weights.reduce((sum, w, k) => sum + w * x[k], 0) + net.b1[j]));
  const outRaw = h.reduce((sum, hv, j) => sum + hv * net.W2[j], 0) + net.b2;
  return 1 / (1 + Math.exp(-outRaw)); // sigmoid, in [0, 1]
}

function trainPersonalNetOnce(X, Y, numFeatures) {
  let W1 = Array.from({ length: PERSONAL_NET_HIDDEN }, () => Array.from({ length: numFeatures }, () => (Math.random() * 2 - 1) * 0.5));
  let b1 = Array.from({ length: PERSONAL_NET_HIDDEN }, () => 0);
  let W2 = Array.from({ length: PERSONAL_NET_HIDDEN }, () => (Math.random() * 2 - 1) * 0.5);
  let b2 = 0;

  for (let epoch = 0; epoch < PERSONAL_NET_EPOCHS; epoch++) {
    const gW1 = W1.map(row => row.map(() => 0));
    const gb1 = new Array(PERSONAL_NET_HIDDEN).fill(0);
    const gW2 = new Array(PERSONAL_NET_HIDDEN).fill(0);
    let gb2 = 0;

    for (let i = 0; i < X.length; i++) {
      const x = X[i], yTrue = Y[i];
      // forward pass
      const hRaw = W1.map((weights, j) => weights.reduce((sum, w, k) => sum + w * x[k], 0) + b1[j]);
      const h = hRaw.map(v => Math.tanh(v));
      const outRaw = h.reduce((sum, hv, j) => sum + hv * W2[j], 0) + b2;
      const yPred = 1 / (1 + Math.exp(-outRaw));

      // backward pass (MSE loss)
      const dOutRaw = 2 * (yPred - yTrue) * yPred * (1 - yPred);
      for (let j = 0; j < PERSONAL_NET_HIDDEN; j++) gW2[j] += dOutRaw * h[j];
      gb2 += dOutRaw;
      for (let j = 0; j < PERSONAL_NET_HIDDEN; j++) {
        const dhRaw = dOutRaw * W2[j] * (1 - h[j] * h[j]);
        for (let k = 0; k < numFeatures; k++) gW1[j][k] += dhRaw * x[k];
        gb1[j] += dhRaw;
      }
    }

    const m = X.length;
    for (let j = 0; j < PERSONAL_NET_HIDDEN; j++) {
      for (let k = 0; k < numFeatures; k++) W1[j][k] -= PERSONAL_NET_LR * gW1[j][k] / m;
      b1[j] -= PERSONAL_NET_LR * gb1[j] / m;
      W2[j] -= PERSONAL_NET_LR * gW2[j] / m;
    }
    b2 -= PERSONAL_NET_LR * gb2 / m;
  }

  return { W1, b1, W2, b2 };
}

function trainingLoss(net, X, Y) {
  let total = 0;
  for (let i = 0; i < X.length; i++) total += (forwardPass(net, X[i]) - Y[i]) ** 2;
  return total / X.length;
}

// A single random init of a tiny network trained with plain gradient descent
// can land in a bad local minimum — e.g. learning a monotonic trend when the
// real data peaks in the middle. Training several times from different random
// starting points and keeping the one with the lowest training loss is the
// standard, simple fix for this kind of non-convex optimization instability.
function trainPersonalNet(ratings) {
  if (ratings.length < PERSONAL_NET_MIN_RATINGS) return null;

  const ranges = computeFeatureRanges(ratings);
  const X = ratings.map(r => normalizeFeatures(r, ranges));
  const Y = ratings.map(r => r.rating / 100);

  let best = null, bestLoss = Infinity;
  for (let trial = 0; trial < PERSONAL_NET_RESTARTS; trial++) {
    const net = trainPersonalNetOnce(X, Y, RATING_FEATURES.length);
    const loss = trainingLoss(net, X, Y);
    if (loss < bestLoss) { bestLoss = loss; best = net; }
  }

  best.ranges = ranges;
  best.trainedOn = ratings.length;
  best.trainingLoss = bestLoss;
  return best;
}

// `conditions` needs values for every key in RATING_FEATURES (feelsLike,
// humidity, windMph, precipProb, precipIn) — i.e. a full leg object, not just
// a temperature.
function personalPredict(net, conditions) {
  if (!net) return null;
  const x = normalizeFeatures(conditions, net.ranges);
  const yPred = forwardPass(net, x);
  return Math.round(Math.max(0, Math.min(100, yPred * 100)));
}

// Grid search for the temperature the net predicts highest comfort at, holding
// humidity/wind/rain at fair-weather baseline values — robust to any learned
// shape (unlike solving for an analytic vertex), and naturally honest when the
// data only shows a trend rather than a true peak: it'll just land on the
// search boundary rather than asserting a false precise number.
const IDEAL_TEMP_SEARCH_MIN = -20;
const IDEAL_TEMP_SEARCH_MAX = 130;
const FAIR_WEATHER_BASELINE = { humidity: 50, windMph: 5, precipProb: 0, precipIn: 0 };

function findIdealTemp(net) {
  if (!net) return null;
  let bestTemp = null, bestScore = -1;
  for (let t = IDEAL_TEMP_SEARCH_MIN; t <= IDEAL_TEMP_SEARCH_MAX; t++) {
    const score = personalPredict(net, { feelsLike: t, ...FAIR_WEATHER_BASELINE });
    if (score > bestScore) { bestScore = score; bestTemp = t; }
  }
  const atBoundary = bestTemp === IDEAL_TEMP_SEARCH_MIN || bestTemp === IDEAL_TEMP_SEARCH_MAX;
  return { idealTemp: bestTemp, idealScore: bestScore, atBoundary };
}

function personalVibeLabel(idealResult) {
  if (!idealResult) return null;
  const { idealTemp, atBoundary } = idealResult;
  const suffix = atBoundary ? (idealTemp <= 0 ? ' (or colder — not enough data to find your actual peak)' : ' (or hotter — not enough data to find your actual peak)') : '';
  let vibe;
  if (idealTemp < 20) vibe = '🥶 Native polar bear — you want it ARCTIC.';
  else if (idealTemp < 40) vibe = '❄️ Serious cold-weather person.';
  else if (idealTemp < 55) vibe = '🧥 You lean cool/brisk.';
  else if (idealTemp < 68) vibe = '👍 Pretty standard comfort range.';
  else if (idealTemp < 80) vibe = '🌤️ You lean warm.';
  else if (idealTemp < 95) vibe = '☀️ Certified heat-lover.';
  else vibe = '🔥 You might actually be part lizard.';
  return `Ideal feels-like ≈ ${idealTemp}°F (fair weather)${suffix}. ${vibe}`;
}

// Build the worst-case snapshot between two points in time (departure and arrival),
// so a storm rolling in mid-walk doesn't get missed. originHourly is the forecast
// for where you're leaving FROM, destHourly is the forecast for where you're walking TO.
function legWeather(originHourly, destHourly, departDate, arriveDate) {
  const depart = weatherSnapshot(originHourly, departDate);
  const arrive = weatherSnapshot(destHourly, arriveDate);

  const worseCode = codeInfo(depart.code).severity >= codeInfo(arrive.code).severity ? depart.code : arrive.code;
  const precipProb = Math.max(depart.precipProb, arrive.precipProb);
  const precipIn = Math.max(depart.precipIn, arrive.precipIn);
  const windMph = Math.max(depart.windMph, arrive.windMph);

  const departFeels = feelsLikeF(depart);
  const arriveFeels = feelsLikeF(arrive);
  // use whichever feels-like is more extreme (further from the 65-75 comfort band)
  const distFromBand = (f) => f < 65 ? 65 - f : (f > 75 ? f - 75 : 0);
  const departIsWorse = distFromBand(departFeels) >= distFromBand(arriveFeels);
  const worstFeels = departIsWorse ? departFeels : arriveFeels;
  // The raw temp shown alongside feels-like MUST come from the same snapshot
  // that produced worstFeels — otherwise you get exactly the kind of physically
  // impossible pairing this was fixed for (e.g. "66°F feels like 86°F", where
  // 66°F never even crosses the heat-index threshold on its own; the 86°F was
  // actually computed from the arrival snapshot, not the departure one).
  const worstRawTemp = departIsWorse ? depart.tempF : arrive.tempF;

  const tScore = tempComfortScore(worstFeels);
  const pScore = precipComfortScore(precipProb, precipIn);
  const wScore = windComfortScore(windMph);
  const weightedAvg = 0.5 * tScore + 0.3 * pScore + 0.2 * wScore;

  const info = codeInfo(worseCode);

  // A weighted average can dilute a single extreme factor (e.g. freezing temps
  // averaged with calm wind/light rain still "look" moderate). Cap the overall
  // score so a genuinely dangerous condition can never read as Fair/Good.
  const tempCap =
    (worstFeels >= 103 || worstFeels < 20) ? 20 :   // Danger heat / Extreme cold
    (worstFeels >= 90 || worstFeels < 32) ? 45 :    // Extreme Caution heat / Freezing
    (worstFeels < 37) ? 65 :                        // Jacket weather
    (worstFeels <= 45) ? 80 :                       // Hoodie weather
    100;
  const weatherCap = info.severity === 3 ? 20 : info.severity === 2 ? 45 : 100;
  const overall = Math.round(Math.min(weightedAvg, tempCap, weatherCap));

  const badges = [];
  if (worstFeels >= 103) badges.push({ label: 'Extreme heat', color: '#8b1d1d' });
  else if (worstFeels >= 90) badges.push({ label: 'High heat', color: '#e6432f' });

  if (worstFeels < 20) badges.push({ label: 'Extreme cold', color: '#1b2470' });
  else if (worstFeels < 32) badges.push({ label: 'Freezing — serious cold', color: '#2a3a8f' });
  else if (worstFeels < 37) badges.push({ label: 'Cold — wear a jacket', color: '#3b6fe0' });
  else if (worstFeels <= 45) badges.push({ label: 'Chilly — grab a hoodie', color: '#6f9fe0' });

  if (info.severity >= 2) badges.push({ label: info.label, color: info.severity === 3 ? '#8b1d1d' : '#e6432f' });
  else if (precipProb >= 50) badges.push({ label: `${Math.round(precipProb)}% chance of rain`, color: '#3b6fe0' });

  const fxType = info.severity >= 2 ? fxTypeForCode(worseCode) : null;

  return {
    departTemp: depart.tempF,
    arriveTemp: arrive.tempF,
    rawTemp: worstRawTemp, // matches whichever snapshot drove feelsLike — always pair these two together
    humidity: departIsWorse ? depart.humidity : arrive.humidity, // matches the same snapshot as rawTemp/feelsLike
    windMph,
    precipProb,
    precipIn,
    feelsLike: Math.round(worstFeels),
    worstIsDepart: departIsWorse, // tells the renderer whether the shown weather is at departure or arrival time
    comfortScore: overall,
    badges,
    fxType,
  };
}

function roundToHourLabel(date) {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

function locKey(lat, lon) {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

// Every distinct location across home + classes + stops — shared by both the
// live forecast fetch and the climatology fetch so they never drift apart.
function collectUniqueLocations() {
  const uniqueLocs = new Map();
  uniqueLocs.set(locKey(state.home.lat, state.home.lon), { lat: state.home.lat, lon: state.home.lon });
  state.classes.forEach(c => uniqueLocs.set(locKey(c.lat, c.lon), { lat: c.lat, lon: c.lon }));
  state.stops.forEach(s => uniqueLocs.set(locKey(s.lat, s.lon), { lat: s.lat, lon: s.lon }));
  return uniqueLocs;
}

async function ensureHomeSet() {
  if (homeVerificationInFlight) await homeVerificationInFlight; // let any pending check from clicking "Find location" finish first

  const inputAddress = homeAddressEl.value.trim();
  const inputLabel = homeLabelEl.value;

  // Has anything changed since the last time we verified+saved a home? If the
  // address field still matches what's saved, there's no need to re-verify or
  // re-geocode.
  const inputMatchesSavedHome = state.home && inputAddress &&
    state.home.address === inputAddress;

  if (inputMatchesSavedHome && state.home.verified) {
    return true;
  }

  // Field has something in it that doesn't match the saved home (or there's
  // no saved home at all) — always trust what's CURRENTLY in the field over
  // whatever was saved before, so editing home and immediately hitting
  // Generate can never silently fall back to an old location.
  if (inputAddress) {
    try {
      return await trySetHome(inputAddress, inputLabel);
    } catch (err) {
      console.error('Home lookup/verification failed:', err);
      setStatus('Could not look up/verify that address (network issue) — try again. (' + err.message + ')', 'error');
      return false;
    }
  }

  // Field is empty right now, but a previously verified home exists — use it.
  if (state.home && state.home.lat != null && state.home.lon != null) {
    if (state.home.verified) return true;
    try {
      const ok = await trySetHome(state.home.address, state.home.label);
      if (!ok) state.home = null;
      return ok;
    } catch (err) {
      console.error('University proximity re-check failed:', err);
      setStatus('Could not verify university proximity (network issue) — try again. (' + err.message + ')', 'error');
      return false;
    }
  }
  setStatus('Set your home location first.', 'error');
  return false;
}

// ---------- Plan generation ----------
generateBtn.addEventListener('click', async () => {
  if (!(await ensureHomeSet())) return;
  if (state.classes.length === 0 && state.stops.length === 0) {
    setStatus('Add at least one class or stop first.', 'error');
    return;
  }

  const pace = parseFloat(document.getElementById('pace').value) || 3.0;
  const buffer = parseFloat(document.getElementById('buffer').value) || 0;

  // One forecast per unique location (home + every distinct class location),
  // so weather is never borrowed from a building you aren't actually walking through.
  const uniqueLocs = collectUniqueLocations();

  setStatus(`Fetching forecast for ${uniqueLocs.size} location${uniqueLocs.size > 1 ? 's' : ''}…`, null);
  resultsOutput.innerHTML = '<p class="empty-state">Loading…</p>';

  try {
    const entries = Array.from(uniqueLocs.entries());
    const forecasts = await Promise.all(entries.map(([, loc]) => fetchHourlyForecast(loc.lat, loc.lon)));
    const forecastByKey = new Map(entries.map(([key], i) => [key, forecasts[i]]));

    const days = buildSevenDayPlan(forecastByKey, pace, buffer);
    lastLiveDays = days;
    switchTab('week');
    setStatus('Forecast generated.', 'ok');
  } catch (err) {
    console.error(err);
    setStatus('Could not fetch weather data — check your internet connection. (' + err.message + ')', 'error');
    resultsOutput.innerHTML = '<p class="empty-state">Failed to load forecast.</p>';
  }
});

// ---------- Tabs: "This Week" + 12 monthly climatology tabs ----------
const tabsEl = document.getElementById('tabs');
const tabHintEl = document.getElementById('tab-hint');
const useLocationsRow = document.getElementById('use-locations-row');
const useLocationsCheckbox = document.getElementById('use-locations');
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

tabsEl.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

useLocationsCheckbox.addEventListener('change', () => {
  if (activeTab !== 'week') switchTab(activeTab); // re-render immediately with the new setting
});

// Builds a schedule-free "typical day" snapshot — just a few representative
// hours, using the same legWeather pipeline as everything else, but with the
// same profile and timestamp for both "ends" since there's no walk happening,
// just a point-in-time read of what that month's climate is generally like.
function buildClimatologySnapshot(monthIndex0, profiles) {
  const monthProfile = profiles[monthIndex0];
  const refDate = new Date(CLIMATOLOGY_REF_YEAR, monthIndex0, 15);
  const sampleHours = [
    { label: 'Morning (7 AM)', hour: 7 },
    { label: 'Midday (12 PM)', hour: 12 },
    { label: 'Afternoon (4 PM)', hour: 16 },
    { label: 'Evening (8 PM)', hour: 20 },
  ];
  return sampleHours.map(s => {
    const d = new Date(refDate);
    d.setHours(s.hour, 0, 0, 0);
    const w = legWeather(monthProfile, monthProfile, d, d);
    return { label: s.label, ...w };
  });
}

function renderClimateSnapshot(monthLabel, points) {
  resultsOutput.innerHTML = `
    <div class="day-card">
      <h3><span class="date-label">${escapeHtml(monthLabel)} — typical day</span></h3>
      ${points.map(p => `
        <div class="leg">
          ${buildWeatherFX(p.fxType)}
          <div class="depart-time">${escapeHtml(p.label)}</div>
          <div class="route">
            ${p.badges.length ? `<div class="badges">${p.badges.map(b =>
              `<span class="badge" style="background:${b.color}">${escapeHtml(b.label)}</span>`
            ).join('')}</div>` : '<div class="sub">Typical conditions at this time of day</div>'}
          </div>
          <div class="metrics">
            <div class="temp-pair">
              <div class="temp-swatch" style="background:${colorForTempF(p.rawTemp)}; color:${textColorForTempF(p.rawTemp)};">
                <span class="temp-label">Actual</span>
                ${Math.round(p.rawTemp)}°F
              </div>
              <div class="temp-swatch" style="background:${colorForTempF(p.feelsLike)}; color:${textColorForTempF(p.feelsLike)};">
                <span class="temp-label">Feels like</span>
                ${Math.round(p.feelsLike)}°F
                <div class="temp-category">${categoryForFeelsLike(p.feelsLike)}</div>
              </div>
            </div>
            <div class="comfort-chip" style="background:${comfortColor(p.comfortScore)}; color:${textColorForComfortScore(p.comfortScore)};">
              ${p.comfortScore} · ${comfortLabel(p.comfortScore)}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// Builds a "typical week" using each class/stop's REAL scheduled time, but
// ignores their coordinates entirely — every item is evaluated against the
// home location's climate only, with no walking distance/time involved.
// This is the toggle-off counterpart to buildClimatologyWeek.
function buildClimatologyTimesOnly(monthIndex0, profiles) {
  const dayNames = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday' };
  const refDate = new Date(CLIMATOLOGY_REF_YEAR, monthIndex0, 15);
  const monthProfile = profiles[monthIndex0];
  const results = [];

  for (let weekday = 1; weekday <= 5; weekday++) {
    const todaysItems = [...state.classes, ...state.stops]
      .filter(c => c.days.includes(weekday))
      .slice()
      .sort((a, b) => timeStrToMinutes(a.start) - timeStrToMinutes(b.start));

    if (todaysItems.length === 0) continue;

    const legs = todaysItems.map(item => {
      const startMin = timeStrToMinutes(item.start);
      const startDate = new Date(refDate);
      startDate.setHours(0, startMin, 0, 0);

      // No walk happens in this mode, so there's no meaningful "departure vs
      // arrival" — just one point-in-time read of the climate at the time the
      // item is actually scheduled. Passing the same date for both ends of
      // legWeather collapses its depart/arrive comparison into a single
      // snapshot, so the displayed conditions always match the time shown.
      const w = legWeather(monthProfile, monthProfile, startDate, startDate);

      return {
        from: item.name,
        to: null, // signals to renderResults this leg has no real route/distance
        distMiles: 0,
        walkMinutes: 0,
        departMin: startMin,
        arriveMin: startMin,
        departTemp: w.departTemp,
        arriveTemp: w.arriveTemp,
        rawTemp: w.rawTemp,
        feelsLike: w.feelsLike,
        worstIsDepart: w.worstIsDepart,
        comfortScore: w.comfortScore,
        badges: w.badges,
        fxType: w.fxType,
        invalid: false,
      };
    });

    results.push({ label: `${dayNames[weekday]} (typical)`, legs, totalMiles: null });
  }

  return results;
}

async function switchTab(tabKey) {
  activeTab = tabKey;
  tabsEl.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabKey);
  });
  tabHintEl.style.display = tabKey === 'week' ? 'none' : 'block';

  if (tabKey === 'week') {
    useLocationsRow.style.display = 'none';
    if (lastLiveDays) {
      renderResults(lastLiveDays, 'No classes fall in the next 7 days based on the days you selected.', { allowRating: true });
    } else {
      resultsOutput.innerHTML = '<p class="empty-state">Click "Generate 7-day walk forecast" to see this week.</p>';
    }
    return;
  }

  // Month tab
  if (!(await ensureHomeSet())) { switchTabUI('week'); return; }

  const monthIndex0 = parseInt(tabKey, 10);
  const pace = parseFloat(document.getElementById('pace').value) || 3.0;
  const buffer = parseFloat(document.getElementById('buffer').value) || 0;
  const hasSchedule = state.classes.length > 0 || state.stops.length > 0;
  const useLocations = useLocationsCheckbox.checked;

  useLocationsRow.style.display = hasSchedule ? 'flex' : 'none';

  try {
    const profiles = await ensureClimatologyLoaded();
    if (!hasSchedule) {
      // No classes/stops at all — nothing to toggle, just show the generic snapshot.
      const points = buildClimatologySnapshot(monthIndex0, profiles);
      renderClimateSnapshot(MONTH_NAMES[monthIndex0], points);
      setStatus(`Typical ${MONTH_NAMES[monthIndex0]} climate loaded (5-yr average). Add classes/stops for a full weekly view.`, 'ok');
    } else if (useLocations) {
      const days = buildClimatologyWeek(monthIndex0, profiles, pace, buffer);
      renderResults(days, `No classes fall on a weekday in ${MONTH_NAMES[monthIndex0]}.`);
      setStatus(`Typical ${MONTH_NAMES[monthIndex0]} week generated (5-yr average, using walking distances).`, 'ok');
    } else {
      const days = buildClimatologyTimesOnly(monthIndex0, profiles);
      renderResults(days, `No classes fall on a weekday in ${MONTH_NAMES[monthIndex0]}.`);
      setStatus(`Typical ${MONTH_NAMES[monthIndex0]} week generated (5-yr average, times only — no locations used).`, 'ok');
    }
  } catch (err) {
    console.error('Climate outlook failed:', err);
    setStatus('Could not load climate history — see details below.', 'error');
    resultsOutput.innerHTML = `<p class="empty-state">Failed to load climate outlook.<br><br><strong>Details:</strong> ${escapeHtml(err.message)}<br><br>Open the browser console (F12, or Cmd+Option+I on Mac) for the full trace if this keeps happening.</p>`;
  }
}

// Just updates which tab looks active, without re-fetching/re-rendering (used for error fallback)
function switchTabUI(tabKey) {
  activeTab = tabKey;
  tabsEl.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabKey);
  });
}

// Fetches + aggregates historical archive data ONCE for the general area (using
// home coordinates) and reuses it for every location — campus-distance locations
// don't have meaningfully different climates, so there's no need to fetch per-spot
// (and doing so was tripping Open-Meteo's concurrent-request rate limit anyway).
function ensureClimatologyLoaded() {
  if (climatologyProfiles) return Promise.resolve(climatologyProfiles);
  if (climatologyFetchPromise) return climatologyFetchPromise;

  setStatus(`Fetching ${CLIMATOLOGY_YEARS}-year climate history for your area…`, null);
  resultsOutput.innerHTML = '<p class="empty-state">Loading historical climate data — this is a bigger fetch than the 7-day forecast, give it a moment…</p>';

  climatologyFetchPromise = fetchHistoricalArchive(state.home.lat, state.home.lon)
    .then(archive => {
      const profiles = buildMonthlyClimatology(archive);
      climatologyProfiles = profiles;
      return profiles;
    })
    .catch(err => {
      climatologyFetchPromise = null; // allow retry on next tab click
      throw err;
    });

  return climatologyFetchPromise;
}

const INVALID_WALK_MINUTES = 40; // beyond this, treat the leg as a data-entry error, not a real walk

// Builds one day's full walking sequence (home -> item -> item -> ... -> home) and its legs.
// `getHourlyForKey(key)` abstracts away WHERE the weather data comes from — a live forecast
// lookup for the 7-day view, or a climatology profile lookup for the monthly outlook.
function buildDayLegs(todaysItems, dayDate, getHourlyForKey, paceMph, bufferMin) {
  const homeKey = locKey(state.home.lat, state.home.lon);
  const homeHourly = getHourlyForKey(homeKey);
  const legs = [];
  let prevLoc = { name: state.home.label, lat: state.home.lat, lon: state.home.lon, key: homeKey };

  todaysItems.forEach((cls) => {
    const distMiles = haversineMiles(prevLoc.lat, prevLoc.lon, cls.lat, cls.lon);
    const walkMinutes = (distMiles / paceMph) * 60;
    const isInvalid = walkMinutes > INVALID_WALK_MINUTES;
    const classStartMin = timeStrToMinutes(cls.start);
    const departMin = classStartMin - walkMinutes - bufferMin;

    const departDate = new Date(dayDate);
    departDate.setHours(0, departMin, 0, 0);
    const arriveDate = new Date(dayDate);
    arriveDate.setHours(0, classStartMin, 0, 0);

    const clsKey = locKey(cls.lat, cls.lon);
    // An implausible distance means the coordinates are probably a data-entry
    // mistake, not a real walk — rather than show nonsense (or nothing), fall
    // back to the home location's climate as a reasonable stand-in, and flag
    // it separately so it's clear the weather isn't location-specific here.
    const originHourly = isInvalid ? homeHourly : getHourlyForKey(prevLoc.key);
    const destHourly = isInvalid ? homeHourly : getHourlyForKey(clsKey);
    const legW = legWeather(originHourly, destHourly, departDate, arriveDate);

    legs.push({
      from: prevLoc.name,
      to: cls.name,
      distMiles,
      walkMinutes,
      departMin,
      arriveMin: classStartMin,
      departTemp: legW.departTemp,
      arriveTemp: legW.arriveTemp,
      rawTemp: legW.rawTemp,
      humidity: legW.humidity,
      windMph: legW.windMph,
      precipProb: legW.precipProb,
      precipIn: legW.precipIn,
      feelsLike: legW.feelsLike,
      worstIsDepart: legW.worstIsDepart,
      comfortScore: legW.comfortScore,
      badges: legW.badges,
      fxType: legW.fxType,
      invalid: isInvalid,
    });

    prevLoc = { name: cls.name, lat: cls.lat, lon: cls.lon, key: clsKey };
  });

  // last leg: back home after the final item
  const lastItem = todaysItems[todaysItems.length - 1];
  const distHome = haversineMiles(prevLoc.lat, prevLoc.lon, state.home.lat, state.home.lon);
  const walkHomeMinutes = (distHome / paceMph) * 60;
  const isHomeLegInvalid = walkHomeMinutes > INVALID_WALK_MINUTES;
  const departHomeMin = timeStrToMinutes(lastItem.end);
  const departHomeDate = new Date(dayDate);
  departHomeDate.setHours(0, departHomeMin, 0, 0);
  const arriveHomeDate = new Date(dayDate);
  arriveHomeDate.setHours(0, departHomeMin + walkHomeMinutes, 0, 0);

  // Destination is always home here, so its climate is already correct by
  // definition — only the origin needs the home-climate substitution if invalid.
  const originHourly = isHomeLegInvalid ? homeHourly : getHourlyForKey(prevLoc.key);
  const homeWeather = legWeather(originHourly, homeHourly, departHomeDate, arriveHomeDate);

  legs.push({
    from: prevLoc.name,
    to: state.home.label,
    distMiles: distHome,
    walkMinutes: walkHomeMinutes,
    departMin: departHomeMin,
    arriveMin: departHomeMin + walkHomeMinutes,
    departTemp: homeWeather.departTemp,
    arriveTemp: homeWeather.arriveTemp,
    rawTemp: homeWeather.rawTemp,
    humidity: homeWeather.humidity,
    windMph: homeWeather.windMph,
    precipProb: homeWeather.precipProb,
    precipIn: homeWeather.precipIn,
    feelsLike: homeWeather.feelsLike,
    worstIsDepart: homeWeather.worstIsDepart,
    comfortScore: homeWeather.comfortScore,
    badges: homeWeather.badges,
    fxType: homeWeather.fxType,
    invalid: isHomeLegInvalid,
  });

  const totalMiles = legs.filter(leg => !leg.invalid).reduce((sum, leg) => sum + leg.distMiles, 0);
  return { legs, totalMiles };
}

function buildSevenDayPlan(forecastByKey, paceMph, bufferMin) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const results = [];
  const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  for (let offset = 0; offset < 7; offset++) {
    const dayDate = new Date(today);
    dayDate.setDate(today.getDate() + offset);
    const weekday = dayDate.getDay(); // 0=Sun..6=Sat
    const isoWeekday = weekday === 0 ? 7 : weekday; // 1=Mon..7=Sun (we only use 1-5)

    const todaysItems = [...state.classes, ...state.stops]
      .filter(c => c.days.includes(isoWeekday))
      .slice()
      .sort((a, b) => timeStrToMinutes(a.start) - timeStrToMinutes(b.start));

    if (todaysItems.length === 0) continue;

    const { legs, totalMiles } = buildDayLegs(todaysItems, dayDate, (key) => forecastByKey.get(key), paceMph, bufferMin);
    results.push({ label: dayFmt.format(dayDate), legs, totalMiles });
  }

  return results;
}

// Builds a "typical week" for one calendar month using climatological averages
// instead of a live forecast. Reuses buildDayLegs exactly as the 7-day view does —
// only the weather data source changes.
function buildClimatologyWeek(monthIndex0, profiles, paceMph, bufferMin) {
  const dayNames = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday' };
  // Every weekday in a given month shares the same climatological profile — weather
  // doesn't know what day of the week it is — so we just need one reference date per
  // month (matching the synthetic timestamps built in buildMonthlyClimatology) reused
  // for every weekday that actually has classes/stops scheduled.
  const refDate = new Date(CLIMATOLOGY_REF_YEAR, monthIndex0, 15);
  const monthProfile = profiles[monthIndex0];
  const results = [];

  for (let weekday = 1; weekday <= 5; weekday++) {
    const todaysItems = [...state.classes, ...state.stops]
      .filter(c => c.days.includes(weekday))
      .slice()
      .sort((a, b) => timeStrToMinutes(a.start) - timeStrToMinutes(b.start));

    if (todaysItems.length === 0) continue;

    // Same profile for every location — one city-wide climate, not per-building.
    const getHourlyForKey = () => monthProfile;

    const { legs, totalMiles } = buildDayLegs(todaysItems, refDate, getHourlyForKey, paceMph, bufferMin);
    results.push({ label: `${dayNames[weekday]} (typical)`, legs, totalMiles });
  }

  return results;
}

// Builds the small "rate this" control + personal-comfort chip shown on each
// live-week leg. Takes the full leg object since the model now uses all of
// feels-like/humidity/wind/precip, not just temperature.
function buildRatingExtras(leg) {
  const conditions = { feelsLike: leg.feelsLike, humidity: leg.humidity, windMph: leg.windMph, precipProb: leg.precipProb, precipIn: leg.precipIn };
  const predicted = personalNet ? personalPredict(personalNet, conditions) : null;
  return `
    <div class="rating-widget">
      <button class="rate-btn"
        data-feels="${leg.feelsLike}"
        data-humidity="${leg.humidity}"
        data-wind="${leg.windMph}"
        data-precip-prob="${leg.precipProb}"
        data-precip-in="${leg.precipIn}"
      >⭐ Rate this</button>
      ${predicted != null ? `<span class="personal-chip" style="background:${comfortColor(predicted)}; color:${textColorForComfortScore(predicted)};">You: ${predicted}</span>` : ''}
    </div>
  `;
}

function renderPreferenceSummary() {
  const summaryEl = document.getElementById('preference-summary');
  if (!summaryEl) return;
  if (!personalNet || state.ratings.length < PERSONAL_NET_MIN_RATINGS) {
    summaryEl.style.display = 'none';
    return;
  }
  const ideal = findIdealTemp(personalNet);
  const vibeText = personalVibeLabel(ideal);
  summaryEl.innerHTML = `
    <span><strong>Your learned weather preference</strong> (from ${state.ratings.length} rating${state.ratings.length === 1 ? '' : 's'}): ${escapeHtml(vibeText)}</span>
    <button id="clear-ratings" class="btn-cancel">Clear ratings</button>
  `;
  summaryEl.style.display = 'flex';
  document.getElementById('clear-ratings').addEventListener('click', () => {
    if (confirm("Clear all your weather ratings? This can't be undone.")) {
      state.ratings = [];
      saveState();
      retrainPersonalNet();
      renderPreferenceSummary();
      switchTab(activeTab);
    }
  });
}

// Delegated click handler — legs get destroyed/recreated on every render, so
// listening on the stable parent container (instead of each button) means
// rate buttons keep working after every re-render without re-attaching.
resultsOutput.addEventListener('click', (e) => {
  const btn = e.target.closest('.rate-btn');
  if (!btn) return;
  const feels = parseFloat(btn.dataset.feels);
  const humidity = parseFloat(btn.dataset.humidity);
  const windMph = parseFloat(btn.dataset.wind);
  const precipProb = parseFloat(btn.dataset.precipProb);
  const precipIn = parseFloat(btn.dataset.precipIn);
  const input = prompt(`How does this feel to you?\n${Math.round(feels)}°F feels-like, ${Math.round(humidity)}% humidity, ${Math.round(windMph)} mph wind, ${Math.round(precipProb)}% chance of rain\nRate it 0 (awful) to 100 (perfect):`);
  if (input === null) return; // cancelled
  const rating = parseFloat(input);
  if (isNaN(rating) || rating < 0 || rating > 100) {
    alert('Please enter a number between 0 and 100.');
    return;
  }
  state.ratings.push({ feelsLike: feels, humidity, windMph, precipProb, precipIn, rating, timestamp: Date.now() });
  saveState();
  retrainPersonalNet();
  renderPreferenceSummary();
  switchTab(activeTab); // re-render so "You: X" chips reflect the freshly retrained model everywhere
});

function buildWeatherFX(type) {
  if (!type) return '';
  if (type === 'rain') {
    const drops = Array.from({ length: 14 }, () => {
      const left = Math.random() * 100;
      const delay = (Math.random() * 1.2).toFixed(2);
      const duration = (0.6 + Math.random() * 0.5).toFixed(2);
      return `<span class="drop" style="left:${left}%; animation-delay:${delay}s; animation-duration:${duration}s;"></span>`;
    }).join('');
    return `<div class="weather-fx rain">${drops}</div>`;
  }
  if (type === 'snow') {
    const flakes = Array.from({ length: 12 }, () => {
      const left = Math.random() * 100;
      const delay = (Math.random() * 3).toFixed(2);
      const duration = (2.5 + Math.random() * 2).toFixed(2);
      const size = (3 + Math.random() * 3).toFixed(1);
      return `<span class="flake" style="left:${left}%; width:${size}px; height:${size}px; animation-delay:${delay}s; animation-duration:${duration}s;"></span>`;
    }).join('');
    return `<div class="weather-fx snow">${flakes}</div>`;
  }
  if (type === 'storm') {
    const drops = Array.from({ length: 16 }, () => {
      const left = Math.random() * 100;
      const delay = (Math.random() * 1).toFixed(2);
      const duration = (0.4 + Math.random() * 0.3).toFixed(2);
      return `<span class="drop" style="left:${left}%; animation-delay:${delay}s; animation-duration:${duration}s;"></span>`;
    }).join('');
    const flashDelay = (Math.random() * 2).toFixed(2);
    return `<div class="weather-fx storm">${drops}<span class="flash" style="animation-delay:${flashDelay}s;"></span></div>`;
  }
  return '';
}

function renderResults(days, emptyMessage, options = {}) {
  const allowRating = !!options.allowRating;

  if (days.length === 0) {
    resultsOutput.innerHTML = `<p class="empty-state">${emptyMessage || 'No classes fall in the days you selected.'}</p>`;
    return;
  }

  resultsOutput.innerHTML = days.map(day => `
    <div class="day-card">
      <h3><span class="date-label">${escapeHtml(day.label)}</span>${day.totalMiles != null ? `<span class="day-total">${day.totalMiles.toFixed(2)} mi total</span>` : ''}</h3>
      ${day.legs.map(leg => `
        <div class="leg ${leg.invalid ? 'leg-invalid' : ''}">
          ${buildWeatherFX(leg.fxType)}
          <div class="depart-time">${minutesToTimeLabel(leg.departMin)}</div>
          <div class="route">
            <div class="names">${leg.to ? `${escapeHtml(leg.from)} → ${escapeHtml(leg.to)}` : escapeHtml(leg.from)}</div>
            ${leg.to
              ? `<div class="sub">${leg.distMiles.toFixed(2)} mi · ~${Math.round(leg.walkMinutes)} min walk</div>`
              : `<div class="sub">Climate only — no location/walking distance used</div>`}
            ${leg.invalid ? `<div class="invalid-warning">⚠ ${Math.round(leg.walkMinutes)} min is way past walking range — coordinates for "${escapeHtml(leg.from)}" or "${escapeHtml(leg.to)}" are likely off. Weather below uses your home location's climate as a stand-in.</div>` : ''}
            ${(!leg.worstIsDepart && leg.arriveMin != null) ? `<div class="time-note">⏱ Conditions shown are at arrival (${minutesToTimeLabel(leg.arriveMin)}), not departure — that's when the weather is worse on this leg.</div>` : ''}
            ${leg.badges.length ? `<div class="badges">${leg.badges.map(b =>
              `<span class="badge" style="background:${b.color}">${escapeHtml(b.label)}</span>`
            ).join('')}</div>` : ''}
            ${allowRating ? buildRatingExtras(leg) : ''}
          </div>
          <div class="metrics">
            <div class="temp-pair">
              <div class="temp-swatch" style="background:${colorForTempF(leg.rawTemp)}; color:${textColorForTempF(leg.rawTemp)};">
                <span class="temp-label">Actual</span>
                ${Math.round(leg.rawTemp)}°F
              </div>
              <div class="temp-swatch" style="background:${colorForTempF(leg.feelsLike)}; color:${textColorForTempF(leg.feelsLike)};">
                <span class="temp-label">Feels like</span>
                ${Math.round(leg.feelsLike)}°F
                <div class="temp-category">${categoryForFeelsLike(leg.feelsLike)}</div>
              </div>
            </div>
            <div class="comfort-chip" style="background:${comfortColor(leg.comfortScore)}; color:${textColorForComfortScore(leg.comfortScore)};">
              ${leg.comfortScore} · ${comfortLabel(leg.comfortScore)}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// ---------- Boot ----------
initFromState();
retrainPersonalNet();
renderPreferenceSummary();
