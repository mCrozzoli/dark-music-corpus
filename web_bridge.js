// Dark Music Corpus — the web build's stand-in for viz/bridge.py (Phase A–C, 2026-10-22).
//
// The page (viz/index.html, patched by build/build_web.py) talks to a bridge over fetch("/api/…") and a WebSocket.
// Here there is no server: this file answers those calls inside the page.
//   · fetch: /api/data → data/payload.json.gz (the desktop bridge's own payload, exported by build/export_demo.py),
//     /api/defaults, /api/keys_catalogue, /api/corpora → static JSON; /api/presets, /api/traces → browser storage;
//     /clip → the audio provider (below).
//   · the page's WebSocket to "the bridge" becomes an in-page object (PageSocket) that handles the same messages as
//     bridge.py's handler: nav, reading, zoom, marker(s), probe, live, recompute/cancel/undo/defaults.
//   · the Live side: bridge.py's class Live, ported (announce, schema blocks, rows, clips, events E1/E3/E4–E8,
//     rate-limited pump, hello until ack, keepalive), sent to the DMC Hub over ws://127.0.0.1:9002/dmc in the
//     WS_CONTRACT shape {a, args} / {b: [...]} instead of OSC over UDP.
(() => {
  "use strict";
  const NATIVE_FETCH = window.fetch.bind(window);           // before anything fetches (W.ready runs at load)
  const BASE = new URL(".", document.currentScript ? document.currentScript.src : location.href);
  const url = (p) => new URL(p, BASE).href;
  const LS = { get(k, d) { try { const v = localStorage.getItem("dmc." + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
               set(k, v) { try { localStorage.setItem("dmc." + k, JSON.stringify(v)); } catch (_) {} } };
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  async function gunzipJson(path) {
    const r = await NATIVE_FETCH(url(path));
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    const ds = new DecompressionStream("gzip");
    return JSON.parse(await new Response(r.body.pipeThrough(ds)).text());
  }
  const staticJson = (path) => NATIVE_FETCH(url(path)).then((r) => r.json());

  // ------------------------------------------------------------------ the dataset (demo for now; own corpus in Phase D)
  const W = (window.DMC_WEB = { ready: null, data: null, link: null, audio: null, mode: "demo" });
  // cross-origin isolation (CLAP on several threads): register coi-sw.js once and reload once; never loop
  if (!self.crossOriginIsolated && "serviceWorker" in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || (!self.crossOriginIsolated && new URLSearchParams(location.search).get("coi") === "1")) {
    // reload only once the worker is ACTIVE (a reload right after register() lands on an uncontrolled page)
    navigator.serviceWorker.register(url("coi-sw.js")).then(() => navigator.serviceWorker.ready).then(() => {
      let tried = false; try { tried = sessionStorage.getItem("dmc.coi") === "1"; } catch (_) {}
      if (!tried) { try { sessionStorage.setItem("dmc.coi", "1"); } catch (_) {} location.reload(); }
    }).catch(() => {});
  }
  W.ready = (async () => {
    const [data, link] = await Promise.all([gunzipJson("data/payload.json.gz"), staticJson("data/link.json")]);
    W.data = data; W.linkData = link;
    W.clipRow = new Map(data.levels.l1.clip_id.map((c, i) => [c, i]));
    W.clipAt = new Map(data.levels.l1.clip_id.map((c, i) => [`${data.levels.l1.file[i]}@${(+data.levels.l1.t0[i]).toFixed(3)}`, c]));
    return data;
  })();

  // ------------------------------------------------------------------ audio provider
  // demo: compressed excerpts (data/excerpts/…, pending Miguel's choice) or, on a local dev server with ?dev=1, the
  // design's own WAV proxies cut in the page. Own corpus (Phase D): the decoded files in memory.
  const Q = new URLSearchParams(location.search);
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  W.audio = {
    mode: Q.get("dev") === "1" && LOCAL ? "dev-proxies" : "excerpts",
    tracks: new Map(),                                           // file index → Promise<AudioBuffer> (dev-proxies)
    async clip(f, t0, t1) {
      if (this.mode === "own") return wavWindow(await ownTrack(f), t0, t1);
      if (this.mode === "dev-proxies") {
        const tr = W.data.tracks[f];
        if (!this.tracks.has(f)) {
          const p = `/projects/designs/dark_music_corpus/darkdata/proxies/${W.data.corpus_name}/${tr.rel_path.replace(/\.[^.]+$/, ".wav")}`;
          this.tracks.set(f, NATIVE_FETCH(p).then((r) => r.arrayBuffer()).then((b) => new OfflineAudioContext(2, 1, 48000).decodeAudioData(b)));
        }
        return wavWindow(await this.tracks.get(f), t0, t1);
      }
      const cid = W.clipAt.get(`${f}@${(+t0).toFixed(3)}`);
      if (cid == null) throw new Error("no such clip in the demo");
      const ext = await pickExt(cid);
      const r = await NATIVE_FETCH(url(`data/excerpts/${String(cid).replace(/:/g, "_")}.${ext}`));
      if (!r.ok) throw new Error("this clip has no excerpt in the demo");
      return r.arrayBuffer();
    },
    trackUrl(f) {                                                // demo: no whole tracks are hosted ("play on" is off)
      if (this.mode !== "own") return null;
      if (!this.urls.has(f)) this.urls.set(f, URL.createObjectURL(OWN.files[f]));
      return this.urls.get(f);
    },
    urls: new Map(),
  };
  // own corpus: the visitor's File objects; a decoded track is kept for the two most recent files
  const OWN = (W.own = { files: [], decoded: new Map() });
  async function ownTrack(f) {
    if (!OWN.decoded.has(f)) {
      OWN.decoded.set(f, OWN.files[f].arrayBuffer().then((b) => new OfflineAudioContext(2, 1, 48000).decodeAudioData(b)));
      while (OWN.decoded.size > 2) OWN.decoded.delete(OWN.decoded.keys().next().value);
    }
    return OWN.decoded.get(f);
  }
  // canPlayType says "maybe" for Ogg Opus on engines that then fail to decode it (WebKit): decide by decoding once
  let EXT = null, EXT_PROBE = null;
  function pickExt(cid) {
    if (EXT) return Promise.resolve(EXT);
    if (!EXT_PROBE) EXT_PROBE = (async () => {
      const name = String(cid).replace(/:/g, "_");
      for (const ext of ["opus", "mp3"]) {
        try { const b = await (await NATIVE_FETCH(url(`data/excerpts/${name}.${ext}`))).arrayBuffer();
              await new OfflineAudioContext(1, 1, 48000).decodeAudioData(b); return (EXT = ext); } catch (_) {}
      }
      return (EXT = "mp3");
    })();
    return EXT_PROBE;
  }
  function wavWindow(buf, t0, t1) {                              // a 16-bit PCM WAV of [t0, t1) — what /clip returns
    const sr = buf.sampleRate, a = Math.max(0, Math.floor(t0 * sr)), b = Math.min(buf.length, Math.ceil(t1 * sr)), n = b - a, ch = Math.min(2, buf.numberOfChannels);
    const out = new DataView(new ArrayBuffer(44 + n * ch * 2)), w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); out.setUint32(4, 36 + n * ch * 2, true); w(8, "WAVE"); w(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
    out.setUint16(22, ch, true); out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
    w(36, "data"); out.setUint32(40, n * ch * 2, true);
    const C = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
    for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) out.setInt16(o, Math.max(-1, Math.min(1, C[c][a + i])) * 0x7fff, true);
    return out.buffer;
  }

  // ------------------------------------------------------------------ fetch
  window.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === "string" ? input : input.url, location.href);
    const p = u.pathname, m = (init.method || "GET").toUpperCase();
    if (u.origin !== location.origin || !(p.startsWith("/api/") || p === "/clip")) return NATIVE_FETCH(input, init);
    try {
      await W.ready;
      if (p === "/api/ports") return json({ ws: "page" });
      if (p === "/api/data") return json(W.data);
      if (p === "/api/defaults") return NATIVE_FETCH(url("data/defaults.json"));
      if (p === "/api/keys_catalogue") return NATIVE_FETCH(url("data/keys_catalogue.json"));
      if (p === "/api/corpora") return json([{ name: W.data.corpus_name, path: `data/corpora/${W.data.corpus_name}`, files: W.data.tracks.length,
                                              duration_s: W.data.tracks.reduce((s, t) => s + t.duration, 0), symlink: false }]);
      const shipped = async (kind) => kind === "presets" ? await NATIVE_FETCH(url("data/presets/index.json")).then((r) => r.ok ? r.json() : []).catch(() => []) : [];
      for (const kind of ["presets", "traces"]) {                  // presets: the desktop's shipped ones (lab/presets) + the ones saved in this browser
        if (p === `/api/${kind}`) {
          if (m === "POST") { const b = JSON.parse(init.body || "{}"), all = LS.get(kind, {}); all[String(b.name).replace(/[^A-Za-z0-9_.-]/g, "_")] = b.data; LS.set(kind, all); return json({ ok: true }); }
          return json([...new Set([...(await shipped(kind)), ...Object.keys(LS.get(kind, {}))])].sort());
        }
        if (p.startsWith(`/api/${kind}/`)) { const n = decodeURIComponent(p.split("/").pop()), all = LS.get(kind, {});
          if (n in all) return json(all[n]);
          if ((await shipped(kind)).includes(n)) return NATIVE_FETCH(url(`data/presets/${encodeURIComponent(n)}.json`));
          return json({ error: "not found" }, 404); }
      }
      if (p === "/clip") {
        const b = await W.audio.clip(+u.searchParams.get("f"), +u.searchParams.get("t0"), +u.searchParams.get("t1"));
        return new Response(b, { headers: { "Content-Type": W.audio.mode !== "excerpts" ? "audio/wav" : EXT === "opus" ? "audio/ogg" : "audio/mpeg" } });
      }
      return json({ error: "not available in the web version" }, 404);
    } catch (e) { return json({ error: String(e && e.message || e) }, 500); }
  };

  // ------------------------------------------------------------------ the Hub link (bridge.Live, ported)
  const now = () => performance.now() / 1000;
  class Link {
    constructor(page) {
      this.page = page; this.enabled = false; this.host = "127.0.0.1"; this.port = 9002; this.rate = 20;
      this.ws = null; this.wsState = "off"; this.pending = null; this.lastAck = 0; this.ackSet = null; this.hub = null;
      this.sent = []; this.reading = null; this.lastHello = 0; this.lastFull = 0; this.lastCluster = null; this.reannounce = false;
      this.visitsClip = {}; this.visitsCluster = {}; this.visitVersion = null; this.e4 = []; this.queue = [];
      setInterval(() => this.pump(), 1000 / 20); setInterval(() => this.page.push(this.status()), 1000);
    }
    get connected() { return this.lastAck > 0 && now() - this.lastAck < 12; }
    configure({ enabled, host, port, rate } = {}) {
      if (port != null && +port !== this.port) { this.port = +port; this.close(); this.lastAck = 0; }
      if (rate != null) this.rate = Math.max(0.5, Math.min(120, +rate));
      if (enabled != null) { this.enabled = !!enabled; if (this.enabled) { this.lastHello = 0; this.open(); } else this.close(); }
    }
    open() {
      if (this.ws) return;
      this.wsState = "connecting";
      let ws; try { ws = new NATIVE_WS(`ws://${this.host}:${this.port}/dmc`); } catch (e) { this.wsState = "refused"; this.ws = null; return; }
      this.ws = ws;
      ws.onopen = () => { this.wsState = "linked"; this.announce(); };
      ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
        if (m.a === "/dmc/ack") { const was = this.connected; this.lastAck = now(); this.ackSet = m.args && m.args[0]; if (!was) this.reannounce = true; }
        else if (m.a === "/dmc/hub") this.hub = { version: m.args[0], root_set: !!m.args[1] };
        else if (m.a === "/dmc/busy") this.wsState = "busy";
        else if (m.a === "/dmc/transport") this.transport = m.args; };
      ws.onclose = (e) => { this.ws = null; this.lastAck = 0;
        this.wsState = e.code === 4009 ? "busy" : e.code === 4003 ? "refused (origin)" : this.enabled ? "no Hub" : "off";
        if (this.enabled) setTimeout(() => this.enabled && this.open(), 3000); };
      ws.onerror = () => {};
    }
    close() { if (this.ws) { try { this.ws.close(1000); } catch (_) {} } this.ws = null; this.wsState = this.enabled ? "no Hub" : "off"; }
    _send(a, args) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify({ a, args })); this.sent.push(now()); } }
    _batch(msgs) { if (this.ws && this.ws.readyState === 1 && msgs.length) { this.ws.send(JSON.stringify({ b: msgs })); for (let i = 0; i < msgs.length; i++) this.sent.push(now()); } }
    msgsPerS() { const t = now(); this.sent = this.sent.filter((x) => t - x < 1); return this.sent.length; }
    schemaBlock(block, keys, infos) {                            // dmc.osc.send_schema_block, as one batch
      const b = [{ a: "/dmc/schema/begin", args: [block, keys.length] }];
      for (const k of keys) {
        b.push({ a: "/dmc/schema/key", args: [String(k[0]), String(k[1]), +k[2], +k[3], +k[4], +k[5], k[6] | 0, k.length > 7 ? k[7] | 0 : -1, k.length > 8 ? String(k[8]) : ""] });
        b.push({ a: "/dmc/schema/info", args: [String(k[0]), String((infos || {})[k[0]] || "")] });
      }
      b.push({ a: "/dmc/schema/end", args: [block] });
      this._batch(b);
    }
    liveKeys() {                                                 // the _live block + this page's probes (S9)
      const L = W.linkData, keys = L.live_keys.slice(), infos = Object.assign({}, L.live_infos);
      for (const [name, p] of Object.entries(this.page.probes)) { keys.push(p.key); infos[name] = p.desc; }
      return { keys, infos };
    }
    announce(reading) {
      if (!this.enabled) return;
      this._send("/dmc/hello", [W.linkData.set_id, W.linkData.version]);
      this.announceLive(); this.announceReading(reading);
      this.lastHello = this.lastFull = now();
    }
    announceLive() { if (!this.enabled) return; const { keys, infos } = this.liveKeys(); if (keys.length) this.schemaBlock(W.linkData.live_block, keys, infos); }
    announceReading(reading) {
      if (!this.enabled) return;
      const R = W.data.readings; this.reading = reading || this.reading || R[0]; if (!R.includes(this.reading)) this.reading = R[0];
      const r = W.linkData.readings[this.reading]; this.schemaBlock(this.reading, r.osc_keys, r.infos);
    }
    fam(code) { const f = W.linkData.families[code]; return f || { enabled: false }; }
    event(code, type, key, value, cid = "") { if (this.enabled && this.fam(code).enabled) this._send("/dmc/event", [String(type), String(key), value, String(cid)]); }
    nav(reading, idx, kind = "hover", step = null) {
      if (!this.enabled) return;
      if (reading !== this.reading) this.announceReading(reading);
      this.pending = [reading, idx | 0, kind, step];
    }
    flush() {
      if (!this.enabled || !this.pending) return;
      const [reading, i, kind, step] = this.pending; this.pending = null;
      const D = W.data, L = D.levels.l1, rd = L.readings[reading];
      if (this.visitVersion !== D.version) { this.visitVersion = D.version; this.visitsClip = {}; this.visitsCluster = {}; }
      const cid = String(L.clip_id[i]), lk = this.liveKeys(), keys = W.linkData.readings[reading].osc_keys.concat(lk.keys);
      const args = [reading, cid];
      for (const k of keys) {
        const name = k[0], pr = this.page.probes[name];
        let v = pr ? pr.values[i] : L.kv[name] != null ? L.kv[name][i] : 0;
        args.push(name, k[1] === "symbol" ? Math.round(v) : +v);
      }
      this._send("/dmc/row", args);
      const c = rd.c[i];
      if (c !== this.lastCluster) {
        this.event("E1", "cluster_enter", `${reading}.cluster`, c, cid);
        const vc = (this.visitsCluster[reading] = this.visitsCluster[reading] || {}); vc[c] = (vc[c] || 0) + 1;
        this.event("E6", vc[c] === 1 ? "first_visit" : "revisit", `${reading}.cluster`, c, cid);
        this.lastCluster = c;
      }
      if (rd.o[i]) this.event("E3", "outlier", `${reading}.outlier_score`, +rd.os[i], cid);
      const n = (this.visitsClip[cid] || 0) + 1; this.visitsClip[cid] = n;
      this.event("E6", n === 1 ? "first_visit" : "revisit", "clip", n, cid);
      const fl = L.flags || {};
      if (fl.novelty_peak && fl.novelty_peak.includes(i)) this.event("E5", "novelty", "delta.novelty", +((L.kv["delta.novelty"] || [])[i] ?? 1), cid);
      if (fl.section_start && fl.section_start.includes(i)) this.event("E5", "boundary", "section.index", Math.round((L.kv["section.index"] || [])[i] ?? 0), cid);
      if (kind === "trace") this.event("E7", "trace_step", "trace", step | 0, cid);
      else if (kind === "follow" || kind === "step") this.event("E7", "step", "track.clip_index", step != null ? step | 0 : i, cid);
      const mk = this.page.markers[cid]; if (mk) this.event("E8", "marker", mk.name, mk.n, cid);
      const tr = D.tracks[L.file[i]];
      this._send("/dmc/clip", [cid, tr.rel_path, +L.t0[i], +L.t1[i], 0.8, c, +rd.x[i] * 2 - 1]);
      this.scheduleE4(tr.file_id, L.t0[i], L.t1[i], cid);
    }
    scheduleE4(fileId, t0, t1, cid) {
      for (const h of this.e4) clearTimeout(h); this.e4 = [];
      const q = this.fam("E4"), ev = W.linkData.events_e4[fileId];
      if (!(this.enabled && q.enabled && ev)) return;
      if (q.onsets !== false) ev.onset_t.forEach((t, k) => { if (t >= t0 && t < t1 && ev.onset_s[k] >= (q.min_strength ?? 0.1)) this.e4.push(setTimeout(() => this._send("/dmc/event", ["onset", "rhythm.onset", +ev.onset_s[k], cid]), (t - t0) * 1000)); });
      if (q.beats !== false) { let k = 0; for (const t of ev.beat_t) if (t >= t0 && t < t1) { const kk = k++; this.e4.push(setTimeout(() => this._send("/dmc/event", ["beat", "rhythm.beat", kk, cid]), (t - t0) * 1000)); } }
    }
    pump() {                                                    // bridge.pump, at 20 Hz; rows at most this.rate
      const t = now();
      if (t - (this.lastFlush || 0) >= 1 / this.rate) { this.flush(); this.lastFlush = t; }
      if (!this.enabled || !this.ws || this.ws.readyState !== 1) return;
      if (this.reannounce) { this.reannounce = false; this.announce(); }
      else if (!this.connected && t - this.lastHello > 2) this.announce();
      else if (t - this.lastFull > 15) this.announce();
      else if (this.connected && t - this.lastHello > 5) { this._send("/dmc/hello", [W.linkData.set_id, W.linkData.version]); this.lastHello = t; }
    }
    status() {
      return { type: "live", enabled: this.enabled, host: this.host, port: this.port, connected: this.connected, ack_set: this.ackSet,
               msgs_per_s: this.msgsPerS(), rate: this.rate, reading: this.reading, transport: this.transport || null,
               since_ack_s: this.lastAck ? +(now() - this.lastAck).toFixed(1) : null, web: this.wsState, hub: this.hub };
    }
  }

  // ------------------------------------------------------------------ the page's "bridge" socket
  class PageSocket {
    constructor() {
      this.readyState = 0; this.onopen = this.onmessage = this.onclose = this.onerror = null;
      this.markers = {}; this.probes = {}; page = this;
      W.ready.then(() => {
        this.markers = LS.get(`markers.${W.data.corpus_name}`, {});
        this.link = W.link = new Link(this);
        this.readyState = 1; this.onopen && this.onopen({});
        this.push({ type: "hello", version: W.data.version, warm: true });
        this.push(this.link.status());
      });
    }
    push(m) { if (this.readyState === 1 && this.onmessage) setTimeout(() => this.onmessage({ data: JSON.stringify(m) }), 0); }
    close() {}
    send(raw) {
      let m; try { m = JSON.parse(raw); } catch (_) { return; }
      const L = this.link, D = W.data;
      switch (m.type) {
        case "nav": L.nav(m.reading, m.idx, m.kind || "hover", m.step); break;
        case "reading":
          if (L.enabled) { L.announceReading(m.name); const k = D.readings.indexOf(m.name); if (k >= 0) L.event("E7", "reading", m.name, k, ""); }
          else L.reading = m.name;
          break;
        case "zoom": L.event("E7", "zoom", "map", +(m.k ?? 1), ""); break;
        case "marker": {
          const cid = D.levels.l1.clip_id[m.idx | 0];
          if (m.remove) delete this.markers[cid];
          else { const n = Object.keys(this.markers).length + 1;
                 this.markers[cid] = { name: m.name || `m${n}`, n, t: new Date().toISOString().slice(0, 19).replace("T", " ") };
                 L.event("E8", "marker", this.markers[cid].name, this.markers[cid].n, cid); }
          LS.set(`markers.${D.corpus_name}`, this.markers);
          this.push({ type: "markers", markers: this.markers });
          break;
        }
        case "markers": this.push({ type: "markers", markers: this.markers }); break;
        case "probe": this.probe(m); break;
        case "live": L.configure(m); this.push(L.status()); break;
        case "recompute":
          if (W.mode === "own") recompute(m);
          else this.push({ type: "job", state: "error", error: "the demo is precomputed: load your own corpus (◫ your corpus) to recompute" });
          break;
        case "undo":
          if (W.mode === "own" && W.prev) swapTo(W.prev, "undo"); break;
        case "defaults":
          if (W.mode === "own") NATIVE_FETCH(url("data/defaults.json")).then((r) => r.json()).then((d) => runJob({ phase2: d.phase2, readings: d.readings }, "defaults"));
          else this.push({ type: "job", state: "swapped", version: W.data.version, why: "defaults" });
          break;
        case "cancel": cancelJob(); break;
      }
    }
    probe(m) {                                                   // S9: reference clip — CLAP space centred when computed, else the live features
      try {
        if (m.clear) { delete this.probes[m.name]; this.link.announceLive(); return this.push({ type: "probe", name: m.name, desc: "", values: null }); }
        if (m.text != null) return this.probeText(String(m.text).trim());
        const L = W.data.levels.l1, n = L.n, ref = m.ref | 0;
        if (W.mode === "demo") return this.demoClap().then(() => W.clap ? this.probeClap(ref) : this.probeMir(ref));
        if (W.mode === "own" && W.clap) return this.probeClap(ref);
        return this.probeMir(ref);
      } catch (e) { this.push({ type: "probe", error: String(e.message || e) }); }
    }
    probeMir(ref) {
      try {
        const L = W.data.levels.l1, n = L.n;
        const feats = Object.keys(L.feats);
        const A = feats.map((k) => { const v = L.feats[k], s = v.slice().sort((a, b) => a - b), med = s[n >> 1]; let sd = 0, mu = 0;
          for (const x of v) mu += x; mu /= n; for (const x of v) sd += (x - mu) ** 2; sd = Math.sqrt(sd / n) + 1e-9; return v.map((x) => (x - med) / sd); });
        const norm = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (const c of A) s += c[i] * c[i]; norm[i] = Math.sqrt(s) + 1e-9; }
        const vals = new Array(n); for (let i = 0; i < n; i++) { let s = 0; for (const c of A) s += c[i] * c[ref]; vals[i] = +(s / (norm[i] * norm[ref])).toFixed(4); }
        const name = "probe.reference", desc = `cosine similarity (live features, centred) to the reference clip ${L.clip_id[ref]}`;
        let mn = Infinity, mx = -Infinity, mu = 0; for (const v of vals) { mn = Math.min(mn, v); mx = Math.max(mx, v); mu += v; } mu /= n;
        let sd = 0; for (const v of vals) sd += (v - mu) ** 2; sd = Math.sqrt(sd / n);
        this.probes[name] = { values: vals, desc, key: [name, "signal", mn, mx, mu, sd, 0, -1, "S9"] };
        this.link.announceLive();
        this.push({ type: "probe", name, desc, values: vals });
      } catch (e) { this.push({ type: "probe", error: String(e.message || e) }); }
    }
    async demoClap() {                                            // the demo's CLAP matrix (export_demo.py), loaded on the first probe
      if (W.mode !== "demo" || W.clap) return;
      const [q, s] = await Promise.all([NATIVE_FETCH(url("data/clap_l1.i8")), NATIVE_FETCH(url("data/clap_l1_scale.f32"))]);
      if (!q.ok || !s.ok) return;
      const Q = new Int8Array(await q.arrayBuffer()), sc = new Float32Array(await s.arrayBuffer()), n = sc.length, d = Q.length / n, C = new Float32Array(Q.length);
      for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) C[i * d + j] = Q[i * d + j] * sc[i];
      W.clap = C;
    }
    async probeText(text) {                                       // bridge.compute_probe "text": CLAP similarity of every clip to the prompt
      try { await this.demoClap(); } catch (_) {}
      if (!W.clap) return this.push({ type: "probe", error: W.mode === "own" ? "the text probe needs CLAP: analyse your corpus again with “+ CLAP”"
                                                                       : "the demo's CLAP embeddings did not load" });
      const TM = TEXT_MODEL(); if (TM.error) return this.push({ type: "probe", error: TM.error });   // the corpus's own CLAP checkpoint
      const L = W.data.levels.l1, n = L.n, C = W.clap, d = C.length / n, w = engine();
      const note = (t) => { const el = document.getElementById("pb-note"); if (el) { el.style.color = ""; el.textContent = t; } };
      note("probe: loading the CLAP text model (127 MB, once)…");
      w.onmessage = (ev) => { const m = ev.data;
        if (m.type === "progress" && m.stage === "text_model") note(`probe: loading the CLAP text model · ${(m.got / 1e6).toFixed(0)} / ${(m.total / 1e6).toFixed(0)} MB (once)`);
        else if (m.type === "error") this.push({ type: "probe", error: m.error });
        else if (m.type === "text_embed") {
          if (m.collapsed) return this.push({ type: "probe", error: `the text model maps different prompts to almost the same vector (mean cosine ${m.mean_pairwise}): text probes would be meaningless` });
          const T = m.vec, vals = new Array(n);
          for (let i = 0; i < n; i++) { let s = 0, nn = 0; for (let j = 0; j < d; j++) { const a = C[i * d + j]; s += a * T[j]; nn += a * a; } vals[i] = +(s / (Math.sqrt(nn) + 1e-9)).toFixed(4); }
          const name = "probe.text", desc = `CLAP similarity to “${text}”`;
          let mn = Infinity, mx = -Infinity, mu = 0; for (const v of vals) { mn = Math.min(mn, v); mx = Math.max(mx, v); mu += v; } mu /= n;
          let sd = 0; for (const v of vals) sd += (v - mu) ** 2; sd = Math.sqrt(sd / n);
          this.probes[name] = { values: vals, desc, key: [name, "signal", mn, mx, mu, sd, 0, -1, "S9"] };
          this.link.announceLive(); this.push({ type: "probe", name, desc, values: vals });
        } };
      w.postMessage(Object.assign({ type: "text", text }, TM));
    }
    probeClap(ref) {                                              // bridge.compute_probe "reference": CLAP, centred (CLAP is anisotropic)
      const L = W.data.levels.l1, n = L.n, C = W.clap, d = C.length / n, mu = new Float64Array(d);
      for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) mu[j] += C[i * d + j] / n;
      const nrm = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < d; j++) { const v = C[i * d + j] - mu[j]; s += v * v; } nrm[i] = Math.sqrt(s) + 1e-9; }
      const vals = new Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < d; j++) s += (C[i * d + j] - mu[j]) * (C[ref * d + j] - mu[j]); vals[i] = +(s / (nrm[i] * nrm[ref])).toFixed(4); }
      const name = "probe.reference", desc = `cosine similarity (CLAP, centred) to the reference clip ${L.clip_id[ref]}`;
      let mn = Infinity, mx = -Infinity, mu2 = 0; for (const v of vals) { mn = Math.min(mn, v); mx = Math.max(mx, v); mu2 += v; } mu2 /= n;
      let sd = 0; for (const v of vals) sd += (v - mu2) ** 2; sd = Math.sqrt(sd / n);
      this.probes[name] = { values: vals, desc, key: [name, "signal", mn, mx, mu2, sd, 0, -1, "S9"] };
      this.link.announceLive(); this.push({ type: "probe", name, desc, values: vals });
    }
  }

  // ------------------------------------------------------------------ your corpus: decode here, analyse in the worker
  const AUDIO_EXT = /\.(wav|aiff?|flac|mp3|m4a|ogg|opus)$/i;
  let worker = null, page = null, lastConfig = null;
  function engine() {
    if (!worker) worker = new Worker(url("core/engine.js"), { type: "module" });
    return worker;
  }
  W.engine = engine;                                              // for tests (the Phase 2 table: {type: "dump"})
  W.decodeNative = (buf) => decodeNative(buf);                    // for tests (decode parity with libsndfile)
  function note(html, done) {
    let el = document.getElementById("web-progress");
    if (!el) { el = document.createElement("div"); el.id = "web-progress";
      el.style.cssText = "position:fixed;top:48px;left:50%;transform:translateX(-50%);z-index:20;padding:8px 14px;border-radius:6px;font:12px/1.4 var(--ui,system-ui);background:var(--panel,#1c1a24);color:var(--ink,#eee);box-shadow:0 6px 24px rgba(0,0,0,.35);max-width:min(560px,90vw)";
      document.body.appendChild(el); }
    el.innerHTML = html; el.hidden = false; if (done) setTimeout(() => { el.hidden = true; }, 6000);
  }
  // the CLAP checkpoints this page carries (phase2.features.clap.model); all three share the RoBERTa tokenizer
  const CLAP_MODELS = {
    "laion/larger_clap_music_and_speech": { dir: "models/clap/", fused: false, text: [63267462, 63267461] },
    "laion/larger_clap_music": { dir: "models/clap-music/", fused: false, text: null,
      textError: "laion/larger_clap_music: the text tower maps different prompts to almost the same vector (mean pairwise cosine 0.999 > 0.98); text keys skipped" },
    "laion/clap-htsat-fused": { dir: "models/clap-htsat-fused/", fused: true, text: [63267403, 63267402] } };
  const CLAP_DEFAULT = "laion/larger_clap_music_and_speech";
  const clapId = (p2) => { const m = (((p2 || {}).features || {}).clap || {}).model; return CLAP_MODELS[m] ? m : CLAP_DEFAULT; };
  const corpusClap = () => (W.mode === "own" && OWN.clapModel) || CLAP_DEFAULT;     // the model the corpus's embeddings come from
  const TEXT_MODEL = (id = corpusClap()) => { const M = CLAP_MODELS[id]; if (!M.text) return { error: M.textError, model: id };
    const P = url(M.dir + "text_model_int8.onnx.part");          // for the text probe and Y11 (text tags)
    return { model: id, parts: [{ url: P + "0", bytes: M.text[0] }, { url: P + "1", bytes: M.text[1] }],
             vocab: url("models/clap/tokenizer/vocab.json"), merges: url("models/clap/tokenizer/merges.txt"), ort: url("vendor/ort/ort.wasm.min.mjs"), wasm: url("vendor/ort/") }; };
  function runWorker(msg, onProgress) {
    if (msg.type === "finish") Object.assign(msg, { textModel: TEXT_MODEL(), labelsCsv: OWN.labelsCsv || null, clapUsed: OWN.clapDone ? corpusClap() : null });
    return new Promise((res, rej) => {
      const w = engine();
      w.onmessage = (ev) => { const m = ev.data;
        if (m.type === "progress") onProgress && onProgress(m);
        else if (m.type === "done") res(m); else if (m.type === "error") rej(new Error(m.error));
        else if (m.type === "cancelled") rej(Object.assign(new Error("cancelled"), { cancelled: true })); };
      w.postMessage(msg);
    });
  }
  // undo / defaults / stop (bridge.py: STATE.previous, STATE.default, the job's cancel token)
  const CANCEL = self.crossOriginIsolated && typeof SharedArrayBuffer === "function" ? new Int32Array(new SharedArrayBuffer(4)) : null;
  let job = null;                                                 // {discarded} while a recompute runs
  W.cur = null; W.prev = null;
  function swapTo(state, why) {                                   // STATE.swap: previous ← current, current ← state
    W.prev = W.cur; W.cur = state; adopt(state.r); lastConfig = state.config;
    page.push({ type: "job", state: "swapped", version: state.r.payload.version, why });
  }
  function readingsEvent(p) {                                     // the worker's progress → bridge.py's readings events
    if (p.stage === "compare") return { type: p.state === "end" ? "stage_end" : "stage_start", stage: "compare" };
    if (p.stage !== "readings") return null;
    if (p.sub) return { type: "stage_start", stage: p.sub };
    return { type: "progress", stage: "readings", done: p.done, total: p.total, reading: p.reading || "", level: p.level || "", seconds: p.seconds || 0, cache_hits: p.cache_hits || {} };
  }
  async function runJob(config, why) {                            // one readings pass; why = null (Apply) or "defaults"
    if (job) return page.push({ type: "job", state: "busy" });
    job = { discarded: false }; if (CANCEL) Atomics.store(CANCEL, 0, 0);
    const t0 = performance.now();
    if (!why) page.push({ type: "job", state: "start" });
    try {
      const ev = (e) => !why && page.push({ type: "event", phase: "phase2", ev: e });
      if (p2Key(config.phase2) !== OWN.p2Done) {                   // dmc.engine.run: the corpus or its Phase 2 config changed
        OWN.p2Done = null; const tp = performance.now(); ev({ type: "stage_start", stage: "features" });
        await runPhase2(config.phase2 || {}, OWN.withClap, (what, m) => {
          if (what === "file") ev({ type: "progress", stage: "features", done: m.i, total: m.total, rate: m.rate, eta_s: m.rate ? (m.total - m.i) / m.rate : null });
          else if (what === "clap") ev({ type: "progress", stage: "clap", done: m.fileIndex, total: m.n }); });
        ev({ type: "stage_end", stage: "features" }); job.p2s = +((performance.now() - tp) / 1000).toFixed(1);
      } else ev({ skipped: true });
      const r = await runWorker({ type: "finish", cancel: CANCEL, config: Object.assign({}, config, { corpus_name: W.data.corpus_name }) }, (p) => {
        const ev = readingsEvent(p); if (ev && !why) page.push({ type: "event", phase: "readings", ev }); });
      if (job.discarded) return;
      const state = { r, config: { phase2: config.phase2, readings: config.readings } };
      if (why) return swapTo(state, why);
      W.prev = W.cur; W.cur = state; adopt(r); lastConfig = state.config;
      const s = +((performance.now() - t0) / 1000).toFixed(1);
      page.push({ type: "job", state: "done", version: r.payload.version, timings: { total: s, phase2: job.p2s ?? null, readings: +(s - (job.p2s || 0)).toFixed(1) } });
    } catch (e) { if (!job.discarded) page.push(e.cancelled ? { type: "job", state: "cancelled" } : { type: "job", state: "error", error: String(e.message || e) }); }
    finally { job = null; }
  }
  function cancelJob() {
    if (!job) return;
    if (CANCEL) Atomics.store(CANCEL, 0, 1);                      // the worker stops at its next check
    else { job.discarded = true; page.push({ type: "job", state: "cancelled" }); }   // not isolated (Safari): the result is dropped when it arrives
  }
  function adopt(r, files) {
    W.data = r.payload; W.linkData = r.link; W.mode = "own"; W.clap = r.clap || null;
    W.clipRow = new Map(r.payload.levels.l1.clip_id.map((c, i) => [c, i]));
    W.clipAt = new Map(r.payload.levels.l1.clip_id.map((c, i) => [`${r.payload.levels.l1.file[i]}@${(+r.payload.levels.l1.t0[i]).toFixed(3)}`, c]));
    if (files) { OWN.files = files; OWN.decoded.clear(); for (const u of W.audio.urls.values()) URL.revokeObjectURL(u); W.audio.urls.clear(); }
    W.audio.mode = "own";
    if (page) { page.markers = LS.get(`markers.${r.payload.corpus_name}`, {}); page.probes = {}; if (page.link && page.link.enabled) page.link.announce(); }
  }
  // Phase 2 in the browser (dmc.engine.run): decode, the native mono mix (librosa's mean of the channels), the analysis rate,
  // then the worker segments and extracts per the config. Re-run only when the Phase 2 config changed (as the desktop does).
  const P2_PROCESS = ["workers", "threads_per_worker", "max_tasks_per_child"], CLAP_PROCESS = ["device", "batch_size", "backend", "allow_download", "checkpoint"];
  const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
  const p2Key = (p2) => { const c = JSON.parse(JSON.stringify(p2 || {})); for (const k of P2_PROCESS) delete c[k];
    if (c.features && c.features.clap) for (const k of CLAP_PROCESS) delete c.features.clap[k]; return JSON.stringify(sortKeys(c)); };
  // the file's own sample rate, from its header: decodeAudioData resamples to its context's rate, so decoding in a context
  // at the native rate gives the native signal (as librosa.load(sr=None)). WAV / RF64, AIFF / AIFC, FLAC, MP3, Ogg (Vorbis, Opus).
  function nativeRate(buf) {
    const b = new Uint8Array(buf), dv = new DataView(buf), tag = (o, n = 4) => String.fromCharCode(...b.subarray(o, o + n));
    try {
      if ((tag(0) === "RIFF" || tag(0) === "RF64") && tag(8) === "WAVE") { for (let o = 12; o + 8 <= b.length;) { const id = tag(o), sz = dv.getUint32(o + 4, true); if (id === "fmt ") return dv.getUint32(o + 12, true); o += 8 + sz + (sz & 1); } }
      if (tag(0) === "FORM" && (tag(8) === "AIFF" || tag(8) === "AIFC")) { for (let o = 12; o + 8 <= b.length;) { const id = tag(o), sz = dv.getUint32(o + 4); if (id === "COMM") {
            const e = o + 16, ex = ((b[e] & 0x7f) << 8) | b[e + 1], hi = dv.getUint32(e + 2), lo = dv.getUint32(e + 6); return Math.round((hi * 2 ** 32 + lo) * 2 ** (ex - 16383 - 63)); } o += 8 + sz + (sz & 1); } }
      if (tag(0) === "fLaC") return (b[18] << 12) | (b[19] << 4) | (b[20] >> 4);
      if (tag(0) === "OggS") { const i = b.findIndex((x, k) => k > 27 && tag(k, 8) === "OpusHead"); if (i > 0) return 48000;
        const v = b.findIndex((x, k) => k > 27 && x === 1 && tag(k + 1, 6) === "vorbis"); if (v > 0) return dv.getUint32(v + 12, true); }
      let o = 0; if (tag(0, 3) === "ID3") o = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
      for (; o + 4 < b.length; o++) if (b[o] === 0xff && (b[o + 1] & 0xe0) === 0xe0) { const ver = (b[o + 1] >> 3) & 3, si = (b[o + 2] >> 2) & 3; if (ver === 1 || si === 3) continue;
          return [[11025, 12000, 8000], null, [22050, 24000, 16000], [44100, 48000, 32000]][ver][si]; }
    } catch (e) { /* unknown header */ }
    return null;
  }
  // WAV / AIFF PCM decoded here, as libsndfile does for librosa.load (ints ÷ 2^(bits−1) in float32, floats as stored):
  // exact, where the browser's decoder adds a small gain and conversion noise (TESTS §9). Other formats: the browser's decoder.
  function decodePcm(buf) {
    const b = new Uint8Array(buf), dv = new DataView(buf), tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    let fmt = null, data = null, le = true;
    if ((tag(0) === "RIFF" || tag(0) === "RF64") && tag(8) === "WAVE") {
      let ds64 = null;
      for (let o = 12; o + 8 <= b.length;) { const id = tag(o); let sz = dv.getUint32(o + 4, true);
        if (id === "ds64") ds64 = Number(dv.getBigUint64(o + 16, true));
        if (id === "fmt ") { let code = dv.getUint16(o + 8, true); const ch = dv.getUint16(o + 10, true), sr = dv.getUint32(o + 12, true), bits = dv.getUint16(o + 22, true);
          if (code === 0xfffe && sz >= 40) code = dv.getUint16(o + 32, true);                           // WAVE_FORMAT_EXTENSIBLE: the sub-format GUID
          fmt = { float: code === 3, pcm: code === 1, ch, sr, bits }; }
        if (id === "data") { if (sz === 0xffffffff && ds64 != null) sz = ds64; data = [o + 8, Math.min(sz, b.length - o - 8)]; break; }
        o += 8 + sz + (sz & 1); }
    } else if (tag(0) === "FORM" && (tag(8) === "AIFF" || tag(8) === "AIFC")) {
      le = false;
      for (let o = 12; o + 8 <= b.length;) { const id = tag(o), sz = dv.getUint32(o + 4);
        if (id === "COMM") { const ch = dv.getUint16(o + 8), bits = dv.getUint16(o + 14), e = o + 16, ex = ((b[e] & 0x7f) << 8) | b[e + 1];
          const sr = Math.round((dv.getUint32(e + 2) * 2 ** 32 + dv.getUint32(e + 6)) * 2 ** (ex - 16383 - 63)), comp = tag(8) === "AIFC" ? tag(o + 26) : "NONE";
          if (comp === "sowt") le = true; fmt = { float: comp === "fl32" || comp === "FL32" || comp === "fl64" || comp === "FL64", pcm: comp === "NONE" || comp === "sowt", ch, sr, bits: comp.startsWith("fl") || comp.startsWith("FL") ? (comp.endsWith("64") ? 64 : 32) : bits }; }
        if (id === "SSND") { const off = dv.getUint32(o + 8); data = [o + 16 + off, Math.min(sz - 8 - off, b.length - o - 16 - off)]; }
        o += 8 + sz + (sz & 1); }
      if (fmt && fmt.pcm && fmt.bits === 8) fmt.signed8 = true;                                      // AIFF 8-bit is signed
    }
    if (!fmt || !data || !(fmt.pcm || fmt.float)) return null;
    const { ch, bits } = fmt, bps = Math.ceil(bits / 8), n = Math.floor(data[1] / (bps * ch)), y = Array.from({ length: ch }, () => new Float32Array(n));
    for (let i = 0, o = data[0]; i < n; i++) for (let c = 0; c < ch; c++, o += bps) {
      let v;
      if (fmt.float) v = bits === 64 ? dv.getFloat64(o, le) : dv.getFloat32(o, le);
      else if (bps === 1) v = fmt.signed8 ? dv.getInt8(o) / 128 : (b[o] - 128) / 128;
      else if (bps === 2) v = dv.getInt16(o, le) / 32768;
      else if (bps === 3) { const x = le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) : ((b[o] << 16) | (b[o + 1] << 8) | b[o + 2]); v = ((x << 8) >> 8) / 8388608; }
      else v = dv.getInt32(o, le) / 2147483648;
      y[c][i] = v;
    }
    return { sampleRate: fmt.sr, numberOfChannels: ch, length: n, getChannelData: (c) => y[c] };
  }
  async function decodeNative(buf) {
    const pcm = decodePcm(buf); if (pcm) return pcm;
    const b = new Uint8Array(buf), flacBits = String.fromCharCode(b[0], b[1], b[2], b[3]) === "fLaC" ? (((b[20] & 1) << 4) | (b[21] >> 4)) + 1 : 0;
    const sr = nativeRate(buf), ctx = sr ? new OfflineAudioContext(1, 1, sr) : new AudioContext();
    let dec; try { dec = await ctx.decodeAudioData(buf.slice(0)); } finally { if (ctx.close) ctx.close(); }
    if (flacBits === 16) {                                          // Chromium scales 16-bit FLAC by 1/32767 above zero (1/32768 below): back to k / 32768 (libsndfile)
      const chs = Array.from({ length: dec.numberOfChannels }, (_, c) => dec.getChannelData(c));
      const asym = chs.some((x) => { for (let i = 0; i < x.length; i += 97) if (x[i] > 0 && x[i] * 32768 !== Math.round(x[i] * 32768)) return true; return false; });
      if (asym) return { sampleRate: dec.sampleRate, numberOfChannels: chs.length, length: dec.length,
        getChannelData: (c) => Float32Array.from(chs[c], (v) => Math.round(v * (v > 0 ? 32767 : 32768)) / 32768) };
    }
    return dec;
  }

  async function runPhase2(p2, withClap, report) {                // → the files the worker accepted
    const w = engine(), files = [], all = OWN.all, useClap = withClap && ((p2.features || {}).clap || {}).enabled !== false;
    w.postMessage({ type: "reset" });
    if (useClap) await new Promise((res, rej) => { w.onmessage = (ev) => { const m = ev.data;
        if (m.type === "progress" && m.stage === "clap_model") report("clap_model", m); else if (m.type === "clap_ready") { W.clapThreads = m.threads; res(); } else if (m.type === "error") rej(new Error(m.error)); };
      w.postMessage({ type: "clap", model: url(CLAP_MODELS[clapId(p2)].dir + "audio_model_int8.onnx"), fused: CLAP_MODELS[clapId(p2)].fused, ort: url("vendor/ort/ort.wasm.min.mjs"), wasm: url("vendor/ort/") }); });
    const t0 = performance.now(); let i = 0;
    for (const f of all) {
      if (CANCEL && Atomics.load(CANCEL, 0) || (job && job.discarded)) throw Object.assign(new Error("cancelled"), { cancelled: true });
      const rel = (f.webkitRelativePath || f.name).split("/").slice(1).join("/") || f.name;
      report("file", { i, total: all.length, rel, rate: i / Math.max((performance.now() - t0) / 1000, 1e-9) });
      try {
        const dec = await decodeNative(await f.arrayBuffer()), srNat = dec.sampleRate, nc = dec.numberOfChannels, yNat = Float32Array.from(dec.getChannelData(0));
        for (let c = 1; c < nc; c++) { const ch = dec.getChannelData(c); for (let k = 0; k < yNat.length; k++) yNat[k] += ch[k]; }     // np.mean(axis=0) in float32: sum, then ÷ n
        if (nc > 1) for (let k = 0; k < yNat.length; k++) yNat[k] /= nc;
        if (!yNat.length) throw new Error("decoded 0 samples");
        const sr = +((p2.audio || {}).sr || srNat), k = files.length; files.push(f);
        await runWorkerFile({ type: "file", i: k, total: all.length, name: f.name, rel_path: rel, folder: rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "",
                              sr, yNat, srNat, p2, cancel: CANCEL }, (m) => report("clap", Object.assign({ fileIndex: i, n: all.length, rel }, m)));
      } catch (e) { if (e && e.cancelled) throw e; if (String(e && e.message || e).includes("__cancelled__")) throw Object.assign(new Error("cancelled"), { cancelled: true });
        if (String(e && e.message || e).includes("not available in the browser")) throw e; console.warn("skipped", rel, e); }
      i++;
    }
    OWN.p2Done = p2Key(p2); OWN.clapDone = useClap; OWN.clapModel = useClap ? clapId(p2) : null;
    return files;
  }
  async function analyseFolder(list) {
    const p2 = (lastConfig || W.data.config || {}).phase2 || {}, ext = (((p2.scan || {}).extensions) || [".wav", ".aif", ".aiff", ".flac", ".mp3"]).map((e) => e.toLowerCase());
    const relOf = (f) => f.webkitRelativePath || f.name, cp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    const all = Array.from(list).filter((f) => ext.some((e) => f.name.toLowerCase().endsWith(e))).sort((a, b) => cp(relOf(a), relOf(b)));
    const csv = Array.from(list).find((f) => { const p = relOf(f).split("/"); return p.length <= 2 && p[p.length - 1] === "labels.csv"; });
    OWN.labelsCsv = csv ? await csv.text() : null;                 // keys Y5: a labels.csv at the corpus root (as data/corpora/<corpus>/labels.csv on the desktop)
    if (!all.length) { note(`no audio files in that folder (${ext.join(", ")})`, true); return; }
    const root = (all[0].webkitRelativePath || "").split("/")[0] || "your_corpus";
    const mb = all.reduce((s, f) => s + f.size, 0) / 1e6;
    const withClap = await new Promise((res) => {
      note(`<b>${root}</b> · ${all.length} files (${mb.toFixed(0)} MB). Analyse with:<div style="display:flex;gap:8px;margin-top:8px">` +
           `<button class="wbtn" id="wc-mir">sound features</button><button class="wbtn" id="wc-clap">sound features + CLAP</button></div>` +
           `<div style="margin-top:6px;opacity:.75">CLAP adds an AI audio embedding: two more maps, closer to how sounds are perceived. It downloads a 77 MB model once and takes about ${self.crossOriginIsolated ? "a quarter of a second" : "a second or more"} per clip (one clip per second of audio). Nothing is uploaded either way.</div>`);
      document.getElementById("wc-mir").onclick = () => res(false); document.getElementById("wc-clap").onclick = () => res(true);
    });
    const t0 = performance.now(); OWN.all = all; OWN.withClap = withClap; if (CANCEL) Atomics.store(CANCEL, 0, 0);
    const files = await runPhase2(p2, withClap, (what, m) => {
      if (what === "clap_model") note(`loading the CLAP model · ${(m.got / 1e6).toFixed(0)}${m.total ? " / " + (m.total / 1e6).toFixed(0) : ""} MB (once; the browser keeps it)`);
      else if (what === "file") note(`reading <b>${m.i + 1}/${m.total}</b> · ${m.rel}`);
      else if (what === "clap") note(`CLAP · file <b>${m.fileIndex + 1}/${m.n}</b> ${m.rel} · clip ${m.done}/${m.of}${W.clapThreads ? ` · ${W.clapThreads} thread${W.clapThreads > 1 ? "s" : ""}` : ""}`); });
    if (!files.length) { note("none of these files could be decoded by this browser", true); return; }
    note(`analysing <b>${files.length}</b> files: maps, clusters, neighbours…`);
    const cfg = Object.assign({}, lastConfig || W.data.config, { corpus_name: root.replace(/[^A-Za-z0-9_.-]/g, "_") });
    const r = await runWorker({ type: "finish", config: cfg }, (m) => m.stage === "readings" && note(`analysing · ${m.sub || (m.reading + " · " + m.level)} · ${m.done}/${m.total}`));
    adopt(r, files); W.cur = { r, config: { phase2: cfg.phase2, readings: cfg.readings } }; W.prev = null;
    if (page) page.push({ type: "hello", version: r.payload.version });
    const unplayable = all.filter((f) => /\.(ogg|opus)$/i.test(f.name)).length;
    note(`<b>${root}</b>: ${files.length} files, ${r.payload.levels.l1.n} clips, analysed in ${((performance.now() - t0) / 1000).toFixed(0)} s in this browser — nothing was uploaded.` +
         ` In Live, set DMC Corpus's <b>root</b> to this same folder.` + (unplayable ? ` ${unplayable} ogg/opus file(s) will analyse here but Live cannot load them.` : ""), true);
  }
  function runWorkerFile(msg, onClap) {
    const tr = [msg.yNat.buffer];
    return new Promise((res, rej) => { const w = engine();
      w.onmessage = (ev) => { const m = ev.data;
        if (m.type === "progress" && m.stage === "features") res();
        else if (m.type === "progress" && m.stage === "clap") onClap(m);
        else if (m.type === "cancelled") rej(Object.assign(new Error("cancelled"), { cancelled: true }));
        else if (m.type === "error") rej(new Error(m.error)); };
      w.postMessage(msg, tr); });
  }

  function recompute(m) { return runJob({ phase2: m.phase2, readings: m.readings }, null); }   // the config panel's Apply, on your corpus
  document.addEventListener("DOMContentLoaded", () => {
    const b = document.getElementById("web-corpus"), inp = document.getElementById("web-corpus-input");
    if (b && inp) { b.onclick = () => inp.click(); inp.onchange = () => { if (inp.files.length) analyseFolder(inp.files).catch((e) => note("analysis failed: " + (e.message || e), true)); inp.value = ""; }; }
  });
  W.analyseFolder = analyseFolder;

  const NATIVE_WS = window.WebSocket;
  window.WebSocket = function (u, p) { return /:page$/.test(String(u)) ? new PageSocket() : new NATIVE_WS(u, p); };
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
})();
