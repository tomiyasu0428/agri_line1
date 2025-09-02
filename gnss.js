// GNSS shim for Android GLO 2 via Bluetooth SPP (NMEA)
// - If native bridge is present, overrides geolocation to feed high-rate fixes
// - Otherwise, leaves browser geolocation as-is

(function(){
  'use strict';
  if (!('geolocation' in navigator)) return;

  const originalGeo = navigator.geolocation;
  const state = {
    lat: null,
    lon: null,
    acc: null, // meters
    spd: null, // m/s
    cog: null, // deg
    timestamp: null,
    hdop: null,
    haveLatLon: false,
  };

  // Utilities
  function toNumber(s){ const n = Number(s); return Number.isFinite(n) ? n : null; }
  function parseLat(field, hemi){ // ddmm.mmmm
    if (!field || !hemi) return null;
    const v = Number(field);
    if (!Number.isFinite(v)) return null;
    const dd = Math.floor(v / 100);
    const mm = v - dd * 100;
    let deg = dd + (mm / 60);
    if (hemi === 'S') deg = -deg;
    return deg;
  }
  function parseLon(field, hemi){ // dddmm.mmmm
    if (!field || !hemi) return null;
    const v = Number(field);
    if (!Number.isFinite(v)) return null;
    const dd = Math.floor(v / 100);
    const mm = v - dd * 100;
    let deg = dd + (mm / 60);
    if (hemi === 'W') deg = -deg;
    return deg;
  }
  function knotsToMs(kn){ const n = Number(kn); return Number.isFinite(n) ? n * 0.514444 : null; }

  // Minimal checksum check (optional)
  function validChecksum(line){
    const i = line.indexOf('*');
    if (i < 0) return true; // accept
    const provided = parseInt(line.slice(i+1).trim(), 16);
    const body = line.startsWith('$') ? line.slice(1, i) : line.slice(0, i);
    let sum = 0; for (let k=0;k<body.length;k++){ sum ^= body.charCodeAt(k); }
    return (provided === sum);
  }

  function updateFromFix(fix){
    if (fix == null) return;
    if (typeof fix === 'string'){
      try { fix = JSON.parse(fix); } catch(_){ return; }
    }
    if (typeof fix !== 'object') return;
    if (typeof fix.lat === 'number' && typeof fix.lon === 'number'){
      state.lat = fix.lat; state.lon = fix.lon; state.haveLatLon = true;
    }
    if (typeof fix.accuracy === 'number') state.acc = fix.accuracy;
    if (typeof fix.speed === 'number') state.spd = fix.speed;
    if (typeof fix.course === 'number') state.cog = fix.course;
    state.timestamp = typeof fix.time === 'number' ? fix.time : Date.now();
    if (typeof fix.hdop === 'number') state.hdop = fix.hdop;
    dispatchToWatchers();
  }

  function parseNmea(line){
    if (!line || line.charAt(0) !== '$') return;
    if (!validChecksum(line)) return;
    const star = line.indexOf('*');
    const core = star >= 0 ? line.slice(1, star) : line.slice(1);
    const parts = core.split(',');
    const talkerType = parts[0];
    const type = talkerType.slice(-3);

    switch(type){
      case 'GGA': {
        // $..GGA, time, lat, NS, lon, EW, fix, sats, hdop, alt, M, ...
        const lat = parseLat(parts[2], parts[3]);
        const lon = parseLon(parts[4], parts[5]);
        const hdop = toNumber(parts[8]);
        const alt = toNumber(parts[9]); // unused
        if (lat != null && lon != null){ state.lat = lat; state.lon = lon; state.haveLatLon = true; }
        if (Number.isFinite(hdop)) state.hdop = hdop;
        // Convert hdop to rough accuracy if not provided: ~ hdop * 5 m (heuristic)
        if (state.hdop != null && (state.acc == null || !Number.isFinite(state.acc))) state.acc = state.hdop * 5;
        state.timestamp = Date.now();
        break;
      }
      case 'RMC': {
        // $..RMC, time, status, lat, NS, lon, EW, spd(kn), cog, date, ...
        const status = parts[2]; if (status && status !== 'A') break; // only Active
        const lat = parseLat(parts[3], parts[4]);
        const lon = parseLon(parts[5], parts[6]);
        const spd = knotsToMs(parts[7]);
        const cog = toNumber(parts[8]);
        if (lat != null && lon != null){ state.lat = lat; state.lon = lon; state.haveLatLon = true; }
        if (Number.isFinite(spd)) state.spd = spd;
        if (Number.isFinite(cog)) state.cog = cog;
        state.timestamp = Date.now();
        break;
      }
      case 'VTG': {
        // $..VTG, cogT, T, cogM, M, spd(kn), N, spd(kmh), K
        const spdKmh = toNumber(parts[7]);
        if (Number.isFinite(spdKmh)) state.spd = spdKmh / 3.6;
        const cog = toNumber(parts[1]);
        if (Number.isFinite(cog)) state.cog = cog;
        state.timestamp = Date.now();
        break;
      }
      default: break;
    }
    dispatchToWatchers();
  }

  // Geolocation override machinery
  let watchIdSeq = 1;
  const watchers = new Map(); // id -> {success, error}
  let lastDispatchAt = 0;

  function makePosition(){
    return {
      coords: {
        latitude: state.lat,
        longitude: state.lon,
        accuracy: state.acc ?? 999,
        speed: state.spd ?? null,
        heading: state.cog ?? null,
      },
      timestamp: state.timestamp ?? Date.now(),
    };
  }

  function dispatchToWatchers(){
    if (!state.haveLatLon) return;
    const now = Date.now();
    // throttle to ~60Hz max
    if (now - lastDispatchAt < 16) return;
    lastDispatchAt = now;
    const pos = makePosition();
    watchers.forEach(w => { try { w.success(pos); } catch(_){} });
  }

  function overrideGeolocation(){
    const poly = {
      getCurrentPosition(success, error){
        if (state.haveLatLon) { try { success(makePosition()); } catch(_){}; return; }
        // if we have no fix yet, wait briefly or error
        const tid = setTimeout(()=>{ try { error && error({ code: 2, message: 'Position unavailable' }); } catch(_){}; }, 1500);
        const tmpId = watchIdSeq++;
        watchers.set(tmpId, { success: (p)=>{ clearTimeout(tid); try { success(p); } catch(_){}; watchers.delete(tmpId); }, error });
      },
      watchPosition(success, error){
        const id = watchIdSeq++;
        watchers.set(id, { success, error });
        // push immediately if available
        if (state.haveLatLon) { try { success(makePosition()); } catch(_){} }
        return id;
      },
      clearWatch(id){ watchers.delete(id); },
    };
    // Replace only the methods we emulate; keep others if any
    navigator.geolocation = Object.assign({}, originalGeo, poly);
    console.log('[GNSS] Geolocation overridden for Android GNSS bridge');
  }

  // Public bridge functions (for native Android)
  // - Prefer calling window.GnssBridge.feedFix({...}) with lat/lon/accuracy/speed/course/time
  // - Alternatively, call window.GnssBridge.feedNmea('$GPRMC,...') per sentence
  const GnssBridge = {
    feedFix: updateFromFix,
    feedNmea: parseNmea,
  };
  Object.defineProperty(window, 'GnssBridge', { value: GnssBridge, writable: false });

  // Detect native bridge signal to enable override
  // Heuristic: if an Android interface signals readiness, we override geolocation.
  // Native should call: window.GnssBridgeReady && window.GnssBridgeReady();
  window.GnssBridgeReady = function(){ try { overrideGeolocation(); } catch(_){} };

  // Also auto-enable if window.AndroidNmeaBridge exists (convention)
  if (window.AndroidNmeaBridge) {
    try { overrideGeolocation(); } catch(_){}
  }
})();

