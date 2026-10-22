// Dark Music Corpus — the analysis engine in a Web Worker (Phase D, 2026-10-22).
// A port of dev/engine/dmc (segment.py, features.py, readings.py, the default key families of keys.py) that turns the
// visitor's own audio into the SAME payload viz/bridge.py serves (/api/data), so the page cannot tell the difference.
//
// main thread → worker:  {type:"file", i, name, rel_path, folder, y: Float32Array (mono, 22050 Hz), peak: [clip peaks]?, duration}
//                         {type:"finish", config: {phase2, readings}}
// worker → main thread:  {type:"progress", stage, done, total, …} · {type:"done", payload, link} · {type:"error", error}
//
// Ported: fixed 2 s / 50 % segmentation with zero-crossing snap; the MIR groups (core/mir.js, desktop-equivalent, see
// TESTS_2026-10-22.md); rhythm (tempo, onset rate, beat strength, onsets); readings with robust scaling + clip, UMAP,
// k-means with k auto by silhouette, isolation forest, kNN, 2-D density; keys S1 (x, y), Y1 (cluster), Y4 (outlier),
// S11 (outlier score), S8 (density), S2 (raw features), Y5 (track, folder). Not yet: CLAP readings, the other key
// families, t-SNE/PCA/SOM, the other clusterings, beat tracking, the readings comparison.
import { SR, HOP, frameFeatures, summarize, summarizeWhole, rhythm } from "./mir.js";
import { UMAP } from "../vendor/umap-js.esm.js";

const files = [];                                               // per file: {name, rel_path, folder, file_id, t0, t1, rows, cols, whole, events}
const post = (m, tr) => self.postMessage(m, tr || []);

// ------------------------------------------------------------------ helpers
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
async function fileId(rel, n) {                                 // a stable 10-hex id (the desktop's content_hash role)
  const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${rel}|${n}`));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 10);
}
function fixedSegments(dur, size = 2.0, overlap = 0.5, minTail = 0.5) {   // segment.fixed_segments
  const EPS = 1e-9; if (dur <= size + EPS) return [[0, dur]];
  const hop = size * (1 - overlap), segs = []; for (let k = 0; k * hop + size <= dur + EPS; k++) segs.push([k * hop, k * hop + size]);
  const tail = dur - segs[segs.length - 1][1];
  if (tail > EPS && tail >= minTail && dur - size > segs[segs.length - 1][0] + EPS) segs.push([dur - size, dur]);
  return segs;
}
function snap(x, s, radius) {                                   // segment.snap_to_zero_crossing
  const n = x.length; if (s <= 0 || s >= n) return Math.min(Math.max(s, 0), n);
  const lo = Math.max(0, s - radius), hi = Math.min(n - 1, s + radius); let best = s, bd = Infinity;
  for (let i = lo; i < hi; i++) if ((x[i] <= 0) !== (x[i + 1] <= 0)) { const j = Math.abs(x[i + 1]) < Math.abs(x[i]) ? i + 1 : i; if (Math.abs(j - s) < bd) { bd = Math.abs(j - s); best = j; } }
  return best;
}
const median = (a) => { const s = Float64Array.from(a).sort(), n = s.length; return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]); };
const quantile = (s, q) => { const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); };
const rankPct = (v) => { const idx = Array.from(v, (_, i) => i).sort((a, b) => v[a] - v[b]), r = new Float64Array(v.length); let i = 0;
  while (i < idx.length) { let j = i; while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k]] = avg / v.length; i = j + 1; } return r; };

// ------------------------------------------------------------------ one file
async function addFile(m) {
  const y = m.y, dur = y.length / SR, rel = m.rel_path, fid = await fileId(rel, y.length);
  const segs = fixedSegments(dur).map(([a, b]) => [snap(y, Math.round(a * SR), Math.round(0.005 * SR)) / SR, snap(y, Math.round(b * SR), Math.round(0.005 * SR)) / SR]);
  const t0 = segs.map((s) => s[0]), t1 = segs.map((s) => s[1]);
  const ff = frameFeatures(y), { F, T } = ff;
  const groupsOf = (name) => name.startsWith("mfcc") ? "mfcc" : name.startsWith("chroma") ? "chroma" : name === "rms" ? "energy" : "spectral";
  const s = summarize(F, T, t0, t1);                            // cols: <feature>_<stat> …, rms_db, dynamic_range_db
  const whole = summarizeWhole(F, T);
  const ranges = t0.map((a, k) => { const A = a * SR, B = t1[k] * SR; let f0 = Math.ceil(A / HOP), f1 = Math.floor((B - 1) / HOP) + 1;
    const mid = Math.min(Math.max(Math.round((A + B) / 2 / HOP), 0), T - 1); if (f1 <= f0) { f0 = mid; f1 = mid + 1; } else { f0 = Math.min(Math.max(f0, 0), T - 1); f1 = Math.min(Math.max(f1, 1), T); }
    return [f0, Math.max(f1, f0 + 1), t1[k] - a]; });
  const rh = rhythm(F.spectral_flux, T, ranges, dur);
  const peak = t0.map((a, k) => { let p = 0; for (let i = Math.floor(a * SR), e = Math.min(y.length, Math.ceil(t1[k] * SR)); i < e; i++) p = Math.max(p, Math.abs(y[i])); return 20 * Math.log10(Math.max(p, 1e-9)); });
  let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v));
  const cols = s.cols.concat(["peak_db"], rh.cols), rows = s.rows.map((r, k) => r.concat([peak[k]], rh.rows[k]));
  const groups = {}; for (const c of cols) { const base = c.replace(/_(mean|std|min|max)$/, "");
    const g = ["tempo", "onset_rate", "beat_strength"].includes(c) ? "rhythm" : ["rms_db", "dynamic_range_db", "peak_db"].includes(c) ? "energy" : groupsOf(base);
    (groups[g] = groups[g] || []).push(c); }
  files[m.i] = { name: m.name, rel_path: rel, folder: m.folder || "", file_id: fid, duration: dur, t0, t1, cols, rows, groups,
                 whole: whole.concat([20 * Math.log10(Math.max(pk, 1e-9))], rh.whole), events: { onset_t: rh.onset_t, onset_s: rh.onset_s, beat_t: [] } };
}

// ------------------------------------------------------------------ readings (readings.py)
function selectColumns(groups, spec) {
  const f = spec.features, stats = new Set(f.stats || ["mean", "std", "min", "max"]), excl = f.exclude || [];
  const wanted = (c) => { if (excl.some((e) => c === e || c.startsWith(e + "_"))) return false; const m = c.match(/_(mean|std|min|max)$/); return !m || stats.has(m[1]); };
  const blocks = {}; for (const g of f.groups || []) { const cols = (groups[g] || []).filter(wanted); if (cols.length) blocks[g] = cols; }
  return blocks;
}
function prepare(get, n, blocks, spec) {                        // readings.prepare: impute, drop constant, robust scale + clip
  const sc = spec.scaler || { method: "robust", clip: 5 }, out = [], used = {};
  for (const [b, cols] of Object.entries(blocks)) {
    let kept = 0;
    for (const c of cols) {
      let v = Float64Array.from({ length: n }, (_, i) => get(c, i)); const fin = Array.from(v).filter(Number.isFinite);
      const med0 = fin.length ? median(fin) : 0; for (let i = 0; i < n; i++) if (!Number.isFinite(v[i])) v[i] = med0;
      let mu = 0; for (const x of v) mu += x; mu /= n; let sd = 0; for (const x of v) sd += (x - mu) ** 2; sd = Math.sqrt(sd / n);
      if (!(sd > 1e-12)) continue;
      if (sc.method === "robust" || !sc.method) { const s = Float64Array.from(v).sort(); let iqr = quantile(s, 0.75) - quantile(s, 0.25); if (!(iqr > 1e-12)) iqr = sd; const md = quantile(s, 0.5); v = v.map((x) => (x - md) / (iqr > 1e-12 ? iqr : 1)); }
      else if (sc.method === "standard") v = v.map((x) => (x - mu) / sd);
      if (sc.clip) v = v.map((x) => Math.max(-sc.clip, Math.min(sc.clip, x)));
      out.push(v); kept++;
    }
    if (kept) used[b] = kept;
  }
  const X = Array.from({ length: n }, (_, i) => Float64Array.from(out, (col) => col[i]));
  return { X, features: used, dims: out.length };
}
const d2 = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) { const t = a[k] - b[k]; s += t * t; } return s; };
function kmeans(X, k, seed, nInit = 10, iters = 100) {
  const n = X.length, d = X[0].length, R = rng(seed); let best = null;
  for (let run = 0; run < nInit; run++) {
    const C = [X[Math.floor(R() * n)].slice()], D = new Float64Array(n).fill(Infinity);   // k-means++
    while (C.length < k) { let tot = 0; for (let i = 0; i < n; i++) { D[i] = Math.min(D[i], d2(X[i], C[C.length - 1])); tot += D[i]; }
      let r = R() * tot, j = 0; for (; j < n - 1 && (r -= D[j]) > 0; j++); C.push(X[j].slice()); }
    const lab = new Int32Array(n); let inertia = 0;
    for (let it = 0; it < iters; it++) {
      let moved = 0; inertia = 0;
      for (let i = 0; i < n; i++) { let bj = 0, bd = Infinity; for (let j = 0; j < k; j++) { const v = d2(X[i], C[j]); if (v < bd) { bd = v; bj = j; } } if (lab[i] !== bj) { lab[i] = bj; moved++; } inertia += bd; }
      const S = Array.from({ length: k }, () => new Float64Array(d)), N = new Int32Array(k);
      for (let i = 0; i < n; i++) { N[lab[i]]++; const s = S[lab[i]]; for (let t = 0; t < d; t++) s[t] += X[i][t]; }
      for (let j = 0; j < k; j++) if (N[j]) for (let t = 0; t < d; t++) C[j][t] = S[j][t] / N[j];
      if (!moved && it) break;
    }
    if (!best || inertia < best.inertia) best = { inertia, lab: Int32Array.from(lab) };
  }
  return best.lab;
}
function silhouette(X, lab, sampleN, seed) {                    // sklearn silhouette_score with sample_size
  const n = X.length, R = rng(seed + 7), idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const S = idx.slice(0, Math.min(n, sampleN)), ks = Math.max(...lab) + 1; let tot = 0, cnt = 0;
  for (const i of S) {
    const sum = new Float64Array(ks), num = new Int32Array(ks);
    for (const j of S) if (j !== i) { sum[lab[j]] += Math.sqrt(d2(X[i], X[j])); num[lab[j]]++; }
    if (!num[lab[i]]) continue; const a = sum[lab[i]] / num[lab[i]]; let b = Infinity;
    for (let c = 0; c < ks; c++) if (c !== lab[i] && num[c]) b = Math.min(b, sum[c] / num[c]);
    if (isFinite(b)) { tot += (b - a) / Math.max(a, b); cnt++; }
  }
  return cnt ? tot / cnt : 0;
}
function clustering(X, cl, seed) {                              // readings.run_clustering, k-means only for now
  const n = X.length; let labels, info = { method: "kmeans" };
  if (n < 3) labels = new Int32Array(n);
  else if (cl.k === "auto") {
    const [lo, hi] = cl.k_range || [3, 10], scores = {}; let best = null;
    for (let k = Math.max(2, lo); k <= Math.min(hi, n - 1); k++) { const lab = kmeans(X, k, seed); if (new Set(lab).size < 2) continue;
      const s = silhouette(X, lab, Math.min(n, 2000), seed); scores[k] = +s.toFixed(4); if (!best || s > best[1]) best = [k, s, lab]; }
    labels = best ? best[2] : new Int32Array(n); if (best) info.k_auto = { criterion: "silhouette", scores, chosen: best[0] };
  } else labels = kmeans(X, Math.min(+cl.k || 6, Math.max(1, n - 1)), seed);
  const sizes = {}; for (const c of labels) sizes[c] = (sizes[c] || 0) + 1;
  const order = Object.keys(sizes).map(Number).sort((a, b) => sizes[b] - sizes[a] || a - b), remap = new Map(order.map((c, i) => [c, i]));
  const out = Int32Array.from(labels, (c) => remap.get(c));
  info.n_clusters = order.length; info.noise_class = null; info.sizes = order.map((c) => sizes[c]);
  if (order.length >= 2) info.silhouette = +silhouette(X, out, Math.min(n, 2000), seed).toFixed(4);
  return { labels: out, info };
}
function iforest(X, contamination = 0.03, seed = 42, nTrees = 200) {   // sklearn IsolationForest: max_samples 256, score = mean path
  const n = X.length, d = X[0].length, R = rng(seed + 13), psi = Math.min(256, n), H = Math.ceil(Math.log2(psi));
  const cN = (m) => m > 2 ? 2 * (Math.log(m - 1) + 0.5772156649) - 2 * (m - 1) / m : m === 2 ? 1 : 0;
  const build = (idx, h) => {
    if (h >= H || idx.length <= 1) return { size: idx.length };
    const f = Math.floor(R() * d); let lo = Infinity, hi = -Infinity; for (const i of idx) { lo = Math.min(lo, X[i][f]); hi = Math.max(hi, X[i][f]); }
    if (!(hi > lo)) return { size: idx.length };
    const s = lo + R() * (hi - lo), L = [], Rr = []; for (const i of idx) (X[i][f] < s ? L : Rr).push(i);
    return { f, s, l: build(L, h + 1), r: build(Rr, h + 1) };
  };
  const trees = []; for (let t = 0; t < nTrees; t++) { const idx = []; const used = new Set(); while (idx.length < psi) { const i = Math.floor(R() * n); if (!used.has(i)) { used.add(i); idx.push(i); } } trees.push(build(idx, 0)); }
  const path = (x, node, h) => node.size != null ? h + cN(node.size) : path(x, x[node.f] < node.s ? node.l : node.r, h + 1);
  const raw = X.map((x) => { let s = 0; for (const t of trees) s += path(x, t, 0); return Math.pow(2, -(s / nTrees) / cN(psi)); });
  const thr = quantile(Float64Array.from(raw).sort(), 1 - contamination);
  return { flag: Int32Array.from(raw, (v) => v > thr ? 1 : 0), score: rankPct(raw) };
}
function knn(Z, k) {
  const n = Z.length; k = Math.min(k, n - 1); const idx = new Int32Array(n * Math.max(k, 0)), dist = new Float32Array(n * Math.max(k, 0));
  if (k < 1) return { idx, dist, k: 0 };
  for (let i = 0; i < n; i++) {
    const best = []; for (let j = 0; j < n; j++) if (j !== i) { const v = d2(Z[i], Z[j]); if (best.length < k || v < best[best.length - 1][0]) { best.push([v, j]); best.sort((a, b) => a[0] - b[0]); if (best.length > k) best.pop(); } }
    best.forEach(([v, j], t) => { idx[i * k + t] = j; dist[i * k + t] = Math.sqrt(v); });
  }
  return { idx, dist, k };
}
const unit = (v) => { let lo = Infinity, hi = -Infinity; for (const x of v) { lo = Math.min(lo, x); hi = Math.max(hi, x); } return Array.from(v, (x) => hi - lo > 1e-12 ? (x - lo) / (hi - lo) : 0.5); };
function computeReading(get, n, groups, spec, level, progress) {
  const blocks = selectColumns(groups, spec), { X, features } = prepare(get, n, blocks, spec), seed = spec.seed ?? 42;
  progress("dr");
  let emb;
  if (n <= 3) emb = X.map((x) => [x[0] || 0, x[1] || 0]);
  else { const nn = Math.max(2, Math.min(spec.dr.n_neighbors ?? 15, n - 1));
         emb = new UMAP({ nComponents: 2, nNeighbors: nn, minDist: spec.dr.min_dist ?? 0.1, random: rng(seed) }).fit(X.map((r) => Array.from(r))); }
  progress("cluster"); const cl = clustering(X, spec.cluster || { k: "auto" }, seed);
  progress("anomaly"); const an = n >= 5 ? iforest(X, (spec.anomaly || {}).contamination ?? 0.03, seed) : { flag: new Int32Array(n), score: new Float64Array(n) };
  progress("knn"); const kn = knn(X, (spec.knn || {}).k ?? 10), k2 = knn(emb, 10);
  const inv = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let t = 0; t < k2.k; t++) s += k2.dist[i * k2.k + t]; inv[i] = k2.k ? 1 / (s / k2.k + 1e-12) : 1; }
  const density = k2.k ? rankPct(inv) : new Float64Array(n).fill(0.5);
  return { x: unit(emb.map((e) => e[0])), y: unit(emb.map((e) => e[1])), c: Array.from(cl.labels), o: Array.from(an.flag), os: Array.from(an.score), d: Array.from(density),
           n_clusters: cl.info.n_clusters, noise_class: null, k_auto: cl.info.k_auto || null, silhouette: cl.info.silhouette ?? null,
           spec, features, knn: Array.from(kn.idx), k: kn.k };
}

// ------------------------------------------------------------------ keys (readings.key_stats / osc_key_tuple) and the payload
function keyStats(name, values, kind, family, desc, nClasses = 0, labels = null) {
  const v = Array.from(values).filter(Number.isFinite); let mn = Infinity, mx = -Infinity, mu = 0; for (const x of v) { mn = Math.min(mn, x); mx = Math.max(mx, x); mu += x; } mu = v.length ? mu / v.length : 0;
  let sd = 0; for (const x of v) sd += (x - mu) ** 2; sd = v.length ? Math.sqrt(sd / v.length) : 0;
  const k = { name, kind, min: v.length ? mn : 0, max: v.length ? mx : 0, mean: mu, std: sd, n_classes: nClasses, noise_class: -1, family, desc };
  if (labels) { k.labels = labels; k.desc = (desc ? desc + " · " : "") + labels.map((l, i) => `${i}=${l}`).join(" "); }
  return k;
}
const tuple = (k) => [k.name, k.kind, k.min, k.max, k.mean, k.std, k.n_classes, k.noise_class ?? -1, k.family || ""];
const round = (v, nd = 4) => Number.isFinite(v) ? +(+v).toPrecision(nd) : 0;
const S2 = { "spectral.centroid": "spectral_centroid_mean", "spectral.flatness": "spectral_flatness_mean", "energy.rms": "rms_mean",
             "energy.rms_db": "rms_db", "rhythm.onset_rate": "onset_rate", "rhythm.beat_strength": "beat_strength" };

function finish(cfg) {
  const F = files.filter(Boolean); if (!F.length) throw new Error("no audio files could be read");
  const cols = F[0].cols, groups = F[0].groups, ci = new Map(cols.map((c, i) => [c, i]));
  const l1 = []; F.forEach((f, fi) => f.rows.forEach((r, k) => l1.push({ fi, k, r })));
  const n1 = l1.length, n0 = F.length, get1 = (c, i) => l1[i].r[ci.get(c)], get0 = (c, i) => F[i].whole[ci.get(c)];
  // readings.py: spec = deep_merge(defaults, reading) (the config lists each reading's overrides only)
  const merge = (a, b) => { if (b == null) return a; if (typeof a !== "object" || a == null || Array.isArray(a) || typeof b !== "object" || Array.isArray(b)) return b;
    const o = Object.assign({}, a); for (const [k, v] of Object.entries(b)) o[k] = merge(a[k], v); return o; };
  const rc = cfg.readings || {}, defs = rc.defaults || {};
  const specs = (rc.readings || []).map((r) => Object.assign(merge(defs, Object.fromEntries(Object.entries(r).filter(([k]) => k !== "name"))), { name: r.name, seed: r.seed ?? rc.seed ?? 42 }))
    .filter((s) => !((s.features || {}).groups || []).includes("clap"));
  if (!specs.length) specs.push({ name: "mir_umap", features: { groups: ["spectral", "energy", "mfcc", "chroma", "rhythm"], stats: ["mean", "std"], exclude: ["tempo"] },
                                  scaler: { method: "robust", clip: 5 }, dr: { method: "umap", n_neighbors: 15, min_dist: 0.1 }, cluster: { method: "kmeans", k: "auto", k_range: [3, 10] },
                                  anomaly: { method: "iforest", contamination: 0.03 }, knn: { k: 10 }, seed: 42 });
  const levels = { l1: { n: n1, file: l1.map((e) => e.fi), feats: {}, readings: {} }, l0: { n: n0, file: F.map((_, i) => i), feats: {}, readings: {} } };
  for (const [key, col] of Object.entries(S2)) if (ci.has(col)) { levels.l1.feats[key] = l1.map((e) => round(e.r[ci.get(col)])); levels.l0.feats[key] = F.map((f) => round(f.whole[ci.get(col)])); }
  const total = specs.length * 2; let done = 0;
  for (const spec of specs) for (const [lv, n, get] of [["l1", n1, get1], ["l0", n0, get0]]) {
    const r = computeReading(get, n, groups, spec, lv, (stage) => post({ type: "progress", stage: "readings", sub: `${lv}.${spec.name}.${stage}`, done, total }));
    if (lv === "l0") { delete r.knn; delete r.k; }
    levels[lv].readings[spec.name] = r; done++;
    post({ type: "progress", stage: "readings", done, total, reading: spec.name, level: lv });
  }
  // keys: _live (S2 + Y5) and per reading (S1 x/y, Y1 cluster, Y4 outlier, S11 outlier score, S8 density)
  const live = [];
  for (const key of Object.keys(levels.l1.feats)) live.push(keyStats(key, levels.l1.feats[key], "signal", "S2", `${S2[key]} (mean over the clip's frames)`));
  const trackIdx = l1.map((e) => e.fi); live.push(keyStats("label.track", trackIdx, "symbol", "Y5", "the track (by file path order)", n0, F.map((f) => f.name.replace(/\.[^.]+$/, ""))));
  const folders = [...new Set(F.map((f) => f.folder))];
  const kv = {}; for (const k of Object.keys(levels.l1.feats)) kv[k] = levels.l1.feats[k]; kv["label.track"] = trackIdx;
  if (folders.length > 1) { const fv = l1.map((e) => folders.indexOf(F[e.fi].folder)); live.push(keyStats("label.folder", fv, "symbol", "Y5", "the sub-folder", folders.length, folders)); kv["label.folder"] = fv; }
  const rkeys = {};
  for (const spec of specs) { const r = levels.l1.readings[spec.name], nm = spec.name;
    const ks = [keyStats(`${nm}.x`, r.x, "signal", "S1", "map x (0–1)"), keyStats(`${nm}.y`, r.y, "signal", "S1", "map y (0–1)"),
                keyStats(`${nm}.cluster`, r.c, "symbol", "Y1", `cluster (k-means, k ${r.n_clusters})`, r.n_clusters),
                keyStats(`${nm}.outlier`, r.o, "symbol", "Y4", "outlier (isolation forest)", 2),
                keyStats(`${nm}.outlier_score`, r.os, "signal", "S11", "how unusual the clip is (rank, 1 = most)"),
                keyStats(`${nm}.density`, r.d, "signal", "S8", "how crowded its neighbourhood on the map is (rank)")];
    rkeys[nm] = ks; r.osc_keys = ks.map(tuple); levels.l0.readings[nm].osc_keys = r.osc_keys;
    kv[`${nm}.x`] = r.x; kv[`${nm}.y`] = r.y; kv[`${nm}.cluster`] = r.c; kv[`${nm}.outlier`] = r.o; kv[`${nm}.outlier_score`] = r.os; kv[`${nm}.density`] = r.d; }
  Object.assign(levels.l1, { clip_id: l1.map((e) => `${F[e.fi].file_id}:${Math.round(F[e.fi].t0[e.k] * 1000)}`), t0: l1.map((e) => +F[e.fi].t0[e.k].toFixed(6)),
                             t1: l1.map((e) => +F[e.fi].t1[e.k].toFixed(6)), kv, flags: {} });
  for (const lv of ["l1", "l0"]) for (const r of Object.values(levels[lv].readings)) for (const f of ["x", "y", "os", "d"]) r[f] = r[f].map((v) => round(v));
  const meta = (k) => ({ name: k.name, kind: k.kind, family: k.family, desc: k.desc, n_classes: k.n_classes, noise_class: k.noise_class === -1 ? null : k.noise_class, labels: k.labels || null, min: k.min, max: k.max });
  const version = String(Date.now());
  const payload = { version, label: "your corpus", corpus: "your corpus", corpus_name: cfg.corpus_name || "your_corpus", readings: specs.map((s) => s.name),
    live: Object.keys(levels.l1.feats), keys: { live: live.map(meta), readings: Object.fromEntries(Object.entries(rkeys).map(([n, ks]) => [n, ks.map(meta)])),
      warnings: ["computed in your browser: the CLAP readings and some key families of the desktop engine are not available here yet"] },
    tracks: F.map((f) => ({ file_id: f.file_id, name: f.name.replace(/\.[^.]+$/, ""), rel_path: f.rel_path, duration: +f.duration.toFixed(2) })),
    levels, comparison: {}, config: { phase2: cfg.phase2 || {}, readings: cfg.readings || {} } };
  const link = { set_id: `dmc_${payload.corpus_name}`, version: "web-0.1", live_block: "_live", live_keys: live.map(tuple),
    live_infos: Object.fromEntries(live.map((k) => [k.name, k.desc])),
    readings: Object.fromEntries(Object.entries(rkeys).map(([n, ks]) => [n, { osc_keys: ks.map(tuple), infos: Object.fromEntries(ks.map((k) => [k.name, k.desc])) }])),
    families: { E1: { enabled: true }, E3: { enabled: true }, E4: { enabled: true, onsets: true, beats: false, min_strength: 0.1 }, E5: { enabled: false }, E6: { enabled: true }, E7: { enabled: true }, E8: { enabled: true } },
    events_e4: Object.fromEntries(F.map((f) => [f.file_id, f.events])) };
  return { payload, link };
}

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === "file") { await addFile(m); post({ type: "progress", stage: "features", done: m.i + 1, total: m.total, name: m.name }); }
    else if (m.type === "reset") files.length = 0;
    else if (m.type === "finish") { const t = performance.now(); const r = finish(m.config || {}); post({ type: "done", ...r, seconds: +((performance.now() - t) / 1000).toFixed(1) }); }
  } catch (e) { post({ type: "error", error: String(e && e.stack || e) }); }
};
