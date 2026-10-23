// Dark Music Corpus — the MIR feature groups in the browser (test 1, 2026-10-22).
// A line-for-line port of what the desktop engine computes with librosa 0.11 through DarkLibrosa
// (darklibrosa._extract_frame_features + dmc/features.py): sr 22050, n_fft 2048, hop 512, centred frames, per-clip
// mean/std/min/max over the frames whose centres fall in the clip. Groups: spectral (zcr, centroid, bandwidth,
// rolloff, flatness, contrast ×7, flux = onset strength), energy (rms + rms_db, dynamic_range_db), mfcc ×13,
// chroma_stft ×12 (with librosa's tuning estimate). Rhythm (tempogram) is not ported in this test.
export const SR = 22050, N_FFT = 2048, HOP = 512, NB = N_FFT / 2 + 1;

// ---------------------------------------------------------------- audio: the browser's own decode + resample
export async function loadMono22k(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const ctx = new AudioContext();
  const dec = await ctx.decodeAudioData(buf);
  ctx.close();
  const off = new OfflineAudioContext(1, Math.ceil(dec.duration * SR), SR);   // downmix (0.5·(L+R)) + resample
  const src = off.createBufferSource(); src.buffer = dec; src.connect(off.destination); src.start();
  const out = await off.startRendering();
  return { y: out.getChannelData(0), nativeSr: dec.sampleRate, duration: dec.duration };
}

// ---------------------------------------------------------------- FFT (radix-2, in place)
function fftFactory(n) {
  const lev = Math.log2(n) | 0, cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), rev = new Uint32Array(n);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  for (let i = 0; i < n; i++) { let r = 0, x = i; for (let j = 0; j < lev; j++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  return (re, im) => {
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, step = n / size;
      for (let i = 0; i < n; i += size) for (let j = i, k = 0; j < i + half; j++, k += step) {
        const tr = re[j + half] * cos[k] + im[j + half] * sin[k], ti = -re[j + half] * sin[k] + im[j + half] * cos[k];
        re[j + half] = re[j] - tr; im[j + half] = im[j] - ti; re[j] += tr; im[j] += ti;
      }
    }
  };
}
const fft = fftFactory(N_FFT);
const HANN = Float64Array.from({ length: N_FFT }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N_FFT));   // periodic

// |STFT|, centre=True, pad_mode="constant" → frames × NB (row-major, one Float32Array per frame)
function stftMag(y) {
  const T = 1 + Math.floor(y.length / HOP), pad = N_FFT / 2, re = new Float64Array(N_FFT), im = new Float64Array(N_FFT), S = [];
  for (let t = 0; t < T; t++) {
    const s0 = t * HOP - pad;
    for (let i = 0; i < N_FFT; i++) { const k = s0 + i; re[i] = (k >= 0 && k < y.length ? y[k] : 0) * HANN[i]; im[i] = 0; }
    fft(re, im);
    const m = new Float32Array(NB); for (let b = 0; b < NB; b++) m[b] = Math.hypot(re[b], im[b]); S.push(m);
  }
  return S;
}
const FREQ = Float64Array.from({ length: NB }, (_, b) => b * SR / N_FFT);

// ---------------------------------------------------------------- mel (slaney) + power_to_db + DCT
const hz2mel = (f) => f < 1000 ? f / (200 / 3) : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27);
const mel2hz = (m) => m < 15 ? m * (200 / 3) : 1000 * Math.exp((Math.log(6.4) / 27) * (m - 15));
function melFilter(nMels = 128) {
  const mmin = hz2mel(0), mmax = hz2mel(SR / 2), mf = Float64Array.from({ length: nMels + 2 }, (_, i) => mel2hz(mmin + (mmax - mmin) * i / (nMels + 1)));
  const W = [];
  for (let i = 0; i < nMels; i++) {
    const w = new Float64Array(NB), d0 = mf[i + 1] - mf[i], d1 = mf[i + 2] - mf[i + 1], en = 2 / (mf[i + 2] - mf[i]);
    for (let b = 0; b < NB; b++) { const lo = (FREQ[b] - mf[i]) / d0, hi = (mf[i + 2] - FREQ[b]) / d1; w[b] = Math.max(0, Math.min(lo, hi)) * en; }
    W.push(w);
  }
  return W;
}
const MEL = melFilter();
function powerToDb(rows) {                                         // ref 1, amin 1e-10, top_db 80 over the whole array
  let mx = -Infinity;
  for (const r of rows) for (let i = 0; i < r.length; i++) { r[i] = 10 * Math.log10(Math.max(1e-10, r[i])); if (r[i] > mx) mx = r[i]; }
  for (const r of rows) for (let i = 0; i < r.length; i++) if (r[i] < mx - 80) r[i] = mx - 80;
  return rows;
}
function dctOrtho(x, n) {
  const N = x.length, out = new Float64Array(n);
  for (let k = 0; k < n; k++) { let s = 0; for (let i = 0; i < N; i++) s += x[i] * Math.cos(Math.PI / N * (i + 0.5) * k); out[k] = s * Math.sqrt((k === 0 ? 1 : 2) / N); }
  return out;
}

// ---------------------------------------------------------------- chroma (librosa.filters.chroma + estimate_tuning)
const hzToOcts = (f, tuning) => Math.log2(f / ((440 * Math.pow(2, tuning / 12)) / 16));
function chromaFilter(tuning) {
  const n = 12, fr = []; for (let i = 1; i < N_FFT; i++) fr.push(n * hzToOcts(i * SR / N_FFT, tuning));
  const frq = [fr[0] - 1.5 * n, ...fr], bw = frq.map((v, i) => i < frq.length - 1 ? Math.max(frq[i + 1] - v, 1) : 1);
  const W = Array.from({ length: n }, () => new Float64Array(frq.length));
  for (let j = 0; j < frq.length; j++) {
    let nrm = 0;
    for (let c = 0; c < n; c++) { let D = frq[j] - c; D = ((D + 6 + 10 * n) % n + n) % n - 6; const v = Math.exp(-0.5 * Math.pow(2 * D / bw[j], 2)); W[c][j] = v; nrm += v * v; }
    nrm = Math.sqrt(nrm) || 1;
    const oct = Math.exp(-0.5 * Math.pow((frq[j] / n - 5) / 2, 2));
    for (let c = 0; c < n; c++) W[c][j] = W[c][j] / nrm * oct;
  }
  const R = Array.from({ length: n }, (_, c) => W[((c + 3) % n + n) % n].slice(0, NB));   // base_c: roll by -3
  return R;
}
function estimateTuning(P) {                                       // piptrack(S=power) + pitch_tuning, resolution 0.01
  const pitches = [], mags = [];
  for (const S of P) {
    let mx = 0; for (let b = 0; b < NB; b++) if (S[b] > mx) mx = S[b];
    const ref = 0.1 * mx, X = (b) => (S[b] > ref ? S[b] : 0);
    for (let b = 1; b < NB - 1; b++) {
      if (FREQ[b] < 150 || FREQ[b] >= 4000) continue;
      const x = X(b); if (!(x > X(b - 1) && x >= X(b + 1))) continue;
      const avg = 0.5 * (S[b + 1] - S[b - 1]), pa = S[b + 1] + S[b - 1] - 2 * S[b], pb = avg;   // librosa _pi_stencil
      const sh = Math.abs(pb) >= Math.abs(pa) ? 0 : -pb / pa, pitch = (b + sh) * SR / N_FFT;
      if (pitch > 0) { pitches.push(pitch); mags.push(S[b] + 0.5 * avg * sh); }
    }
  }
  if (!pitches.length) return 0;
  const sorted = Float64Array.from(mags).sort(), m = sorted.length, med = m % 2 ? sorted[(m - 1) / 2] : 0.5 * (sorted[m / 2 - 1] + sorted[m / 2]);
  const nb = 100, counts = new Float64Array(nb);
  for (let i = 0; i < pitches.length; i++) {
    if (mags[i] < med || !(pitches[i] > 0)) continue;
    let r = (12 * hzToOcts(pitches[i], 0)) % 1; if (r < 0) r += 1; if (r >= 0.5) r -= 1;
    let k = Math.floor((r + 0.5) / (1 / nb)); if (k >= nb) k = nb - 1; counts[k]++;
  }
  let best = 0; for (let k = 1; k < nb; k++) if (counts[k] > counts[best]) best = k;
  return -0.5 + best / nb;
}

// ---------------------------------------------------------------- the frame features of one file
export function frameFeatures(y) {
  const S = stftMag(y), T = S.length, F = {};
  // zcr: frame 2048, centred, pad "edge", threshold 1e-10
  const zcr = new Float64Array(T), rms = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    const s0 = t * HOP - N_FFT / 2; let c = 0, prev = null, e = 0;
    for (let i = 0; i < N_FFT; i++) {
      let k = s0 + i; const ke = Math.min(Math.max(k, 0), y.length - 1); let v = y[ke]; if (Math.abs(v) <= 1e-10) v = 0;
      const neg = v < 0 || Object.is(v, -0); if (prev !== null && neg !== prev) c++; if (prev === null) c += 0; prev = neg;
      const vc = (k >= 0 && k < y.length) ? y[k] : 0; e += vc * vc;
    }
    zcr[t] = c / N_FFT; rms[t] = Math.sqrt(e / N_FFT);
  }
  F.zcr = zcr; F.rms = rms;
  const cen = new Float64Array(T), bw = new Float64Array(T), ro = new Float64Array(T), fl = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    const s = S[t]; let tot = 0; for (let b = 0; b < NB; b++) tot += s[b];
    let c = 0; for (let b = 0; b < NB; b++) c += FREQ[b] * s[b] / (tot || 1); cen[t] = tot ? c : 0;
    let v = 0; for (let b = 0; b < NB; b++) v += (s[b] / (tot || 1)) * (FREQ[b] - c) ** 2; bw[t] = Math.sqrt(v);
    let cum = 0, r = FREQ[NB - 1]; for (let b = 0; b < NB; b++) { cum += s[b]; if (cum >= 0.85 * tot) { r = FREQ[b]; break; } } ro[t] = r;
    let lg = 0, am = 0; for (let b = 0; b < NB; b++) { const p = Math.max(1e-10, s[b] * s[b]); lg += Math.log(p); am += p; } fl[t] = Math.exp(lg / NB) / (am / NB);
  }
  Object.assign(F, { spectral_centroid: cen, spectral_bandwidth: bw, spectral_rolloff: ro, spectral_flatness: fl });
  // contrast: fmin 200, 6 bands, quantile 0.02, power_to_db(peak) - power_to_db(valley) per band over the file
  const octa = [0, ...Array.from({ length: 7 }, (_, i) => 200 * 2 ** i)];
  for (let k = 0; k < 7; k++) {
    const band = []; for (let b = 0; b < NB; b++) if (FREQ[b] >= octa[k] && FREQ[b] <= octa[k + 1]) band.push(b);
    let sel = band.slice(); if (k > 0) sel = [band[0] - 1, ...sel]; if (k === 6) for (let b = band[band.length - 1] + 1; b < NB; b++) sel.push(b);
    const nCur = sel.length, sub = k < 6 ? sel.slice(0, -1) : sel, q = Math.max(1, Math.round(0.02 * nCur));
    const pk = [new Float64Array(T)], vl = [new Float64Array(T)];
    for (let t = 0; t < T; t++) { const v = Float64Array.from(sub, (b) => S[t][b]).sort(); let a = 0, z = 0; for (let i = 0; i < q; i++) { a += v[i]; z += v[v.length - 1 - i]; } vl[0][t] = a / q; pk[0][t] = z / q; }
    powerToDb(pk); powerToDb(vl);
    F[`spectral_contrast_${k}`] = Float64Array.from(pk[0], (p, t) => p - vl[0][t]);
  }
  // mel power → dB (shared by flux = onset strength and mfcc)
  const melDb = S.map((s) => { const m = new Float64Array(128); for (let i = 0; i < 128; i++) { const w = MEL[i]; let a = 0; for (let b = 0; b < NB; b++) if (w[b]) a += w[b] * s[b] * s[b]; m[i] = a; } return m; });
  powerToDb(melDb);
  const flux = new Float64Array(T);
  for (let t = 1; t < T; t++) { let a = 0; for (let i = 0; i < 128; i++) a += Math.max(0, melDb[t][i] - melDb[t - 1][i]); if (t + 2 < T) flux[t + 2] = a / 128; }
  F.spectral_flux = flux;                                          // lag 1 + n_fft/(2·hop) = 3 frames of left padding
  for (let k = 0; k < 13; k++) F[`mfcc_${k}`] = new Float64Array(T);
  for (let t = 0; t < T; t++) { const c = dctOrtho(melDb[t], 13); for (let k = 0; k < 13; k++) F[`mfcc_${k}`][t] = c[k]; }
  // chroma_stft on power, with the file's tuning
  const P = S.map((s) => Float64Array.from(s, (v) => v * v)), tuning = estimateTuning(P), CH = chromaFilter(tuning);
  for (let c = 0; c < 12; c++) F[`chroma_${c}`] = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    const raw = new Float64Array(12); let mx = 0;
    for (let c = 0; c < 12; c++) { let a = 0; const w = CH[c]; for (let b = 0; b < NB; b++) a += w[b] * P[t][b]; raw[c] = a; if (Math.abs(a) > mx) mx = Math.abs(a); }
    for (let c = 0; c < 12; c++) F[`chroma_${c}`][t] = mx > 1.1754944e-38 ? raw[c] / mx : raw[c];
  }
  return { F, T, tuning };
}

// ---------------------------------------------------------------- per-clip summaries (features.clip_frame_ranges + summarize)
export function summarize(F, T, tStart, tEnd) {
  const names = Object.keys(F), cols = [], rows = [];
  for (const n of names) for (const s of ["mean", "std", "min", "max"]) cols.push(`${n}_${s}`);
  cols.push("rms_db", "dynamic_range_db");
  for (let i = 0; i < tStart.length; i++) {
    const a = tStart[i] * SR, b = tEnd[i] * SR;
    let f0 = Math.ceil(a / HOP), f1 = Math.floor((b - 1) / HOP) + 1;
    const mid = Math.min(Math.max(Math.round((a + b) / 2 / HOP), 0), T - 1);
    if (f1 <= f0) { f0 = mid; f1 = mid + 1; } else { f0 = Math.min(Math.max(f0, 0), T - 1); f1 = Math.min(Math.max(f1, 1), T); }
    f1 = Math.max(f1, f0 + 1);
    const row = [];
    for (const n of names) {
      const x = F[n]; let s = 0, mn = Infinity, mx = -Infinity; for (let t = f0; t < f1; t++) { s += x[t]; if (x[t] < mn) mn = x[t]; if (x[t] > mx) mx = x[t]; }
      const m = s / (f1 - f0); let v = 0; for (let t = f0; t < f1; t++) v += (x[t] - m) ** 2;
      row.push(m, Math.sqrt(v / (f1 - f0)), mn, mx);
    }
    const r = Array.from(F.rms.slice(f0, f1), (v) => Math.max(v, 1e-5)), mean = r.reduce((p, q) => p + q, 0) / r.length;
    const pct = (q) => { const s = r.slice().sort((p, z) => p - z), pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); };
    row.push(20 * Math.log10(mean), 20 * Math.log10(pct(0.95) / pct(0.10)));
    rows.push(row);
  }
  return { cols, rows };
}

// ---------------------------------------------------------------- whole-file (L0) summaries — features.summarize's `whole`
export function summarizeWhole(F, T) {
  const row = [];
  for (const n of Object.keys(F)) {
    const x = F[n]; let s = 0, mn = Infinity, mx = -Infinity; for (let t = 0; t < T; t++) { s += x[t]; if (x[t] < mn) mn = x[t]; if (x[t] > mx) mx = x[t]; }
    const m = s / T; let v = 0; for (let t = 0; t < T; t++) v += (x[t] - m) ** 2; row.push(m, Math.sqrt(v / T), mn, mx);
  }
  const r = Array.from(F.rms, (v) => Math.max(v, 1e-5)), mean = r.reduce((p, q) => p + q, 0) / r.length;
  const s = r.slice().sort((p, z) => p - z), pct = (q) => { const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); };
  row.push(20 * Math.log10(mean), 20 * Math.log10(pct(0.95) / pct(0.10)));
  return row;
}

// ---------------------------------------------------------------- rhythm (features._rhythm + rhythm_events), from the onset envelope
// tempogram: librosa.feature.tempogram (autocorrelation of a Hann-windowed, linear-ramp-padded onset envelope, ∞-normalised);
// tempo: argmax of log1p(1e6·g) + a log-normal prior at 120 BPM over 30–320 BPM; beat_strength: max − median over 30–300 BPM;
// onsets: librosa.onset.onset_detect's peak picking on the normalised envelope. Beats (beat_track) are not ported.
export function rhythm(env, T, clips, durTotal, winS = 8.0) {
  const win = Math.max(16, Math.round(winS * SR / HOP)), half = win >> 1, n = env.length;
  const pad = new Float64Array(n + 2 * half);
  for (let i = 0; i < half; i++) { pad[i] = env[0] * i / half; pad[n + 2 * half - 1 - i] = env[n - 1] * i / half; }   // linear_ramp to 0
  for (let i = 0; i < n; i++) pad[half + i] = env[i];
  let F = 1; while (F < 2 * win) F <<= 1;
  const fftN = fftFactory(F), hw = Float64Array.from({ length: win }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / win));
  const bpm = Float64Array.from({ length: win }, (_, k) => k === 0 ? Infinity : 60 * SR / (HOP * k));
  const prior = Float64Array.from(bpm, (b) => (isFinite(b) && b >= 30 && b <= 320) ? -0.5 * (Math.log2(b) - Math.log2(120)) ** 2 : -Infinity);
  const band = Array.from(bpm, (b) => isFinite(b) && b >= 30 && b <= 300);
  const TG = new Array(n), re = new Float64Array(F), im = new Float64Array(F);
  for (let t = 0; t < n; t++) {
    re.fill(0); im.fill(0); for (let i = 0; i < win; i++) re[i] = pad[t + i] * hw[i];
    fftN(re, im); for (let i = 0; i < F; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
    fftN(re, im);                                                 // the power spectrum's FFT = the autocorrelation (real, ×F)
    const ac = new Float32Array(win); let mx = 0; for (let k = 0; k < win; k++) { ac[k] = re[k] / F; if (Math.abs(ac[k]) > mx) mx = Math.abs(ac[k]); }
    if (mx > 0) for (let k = 0; k < win; k++) ac[k] /= mx; TG[t] = ac;
  }
  // onsets (onset_detect defaults at sr 22050 / hop 512: pre_max 1, post_max 1, pre_avg 4, post_avg 5, wait 1, delta 0.07)
  let lo = Infinity, hi = -Infinity; for (const v of env) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const x = Float64Array.from(env, (v) => hi > lo ? (v - lo) / (hi - lo) : 0), on = [];
  let last = -Infinity;
  for (let t = 0; t < n; t++) {
    let mxw = -Infinity; for (let k = Math.max(0, t - 1); k < Math.min(n, t + 1); k++) mxw = Math.max(mxw, x[k]);
    let s = 0, c = 0; for (let k = Math.max(0, t - 4); k < Math.min(n, t + 5); k++) { s += x[k]; c++; }
    if (x[t] === mxw && x[t] >= s / c + 0.07 && t - last > 1) { on.push(t); last = t; }
  }
  const onCum = new Int32Array(n + 1); { const m = new Uint8Array(n); for (const t of on) m[t] = 1; for (let t = 0; t < n; t++) onCum[t + 1] = onCum[t] + m[t]; }
  const one = (a, b, dur) => {
    const g = new Float64Array(win); for (let t = a; t < b; t++) for (let k = 0; k < win; k++) g[k] += TG[t][k]; for (let k = 0; k < win; k++) g[k] /= Math.max(1, b - a);
    let best = 1, bv = -Infinity; for (let k = 1; k < win; k++) { const v = Math.log1p(1e6 * g[k]) + prior[k]; if (v > bv) { bv = v; best = k; } }
    const bv2 = []; for (let k = 0; k < win; k++) if (band[k]) bv2.push(g[k]); bv2.sort((p, q) => p - q);
    const strength = bv2.length ? bv2[bv2.length - 1] - (bv2.length % 2 ? bv2[bv2.length >> 1] : 0.5 * (bv2[bv2.length / 2 - 1] + bv2[bv2.length / 2])) : NaN;
    return [bpm[best], (onCum[Math.min(b, n)] - onCum[Math.min(a, n)]) / Math.max(dur, 1e-6), strength];
  };
  const rows = clips.map(([a, b, dur]) => one(a, b, dur));
  return { cols: ["tempo", "onset_rate", "beat_strength"], rows, whole: one(0, n, durTotal),
           onset_t: on.map((t) => t * HOP / SR), onset_s: on.map((t) => hi > 0 ? env[t] / hi : 0) };
}
// librosa.beat.beat_track(onset_envelope=env, sr=22050, hop_length=512) (librosa 0.11): the global tempo (feature.tempo:
// mean tempogram over an 8 s window, log-normal prior at 120 BPM, nothing above 320 BPM), then the dynamic programme
// (tightness 100, trim). Kept as in librosa: np.round's half-to-even, the local score's same-mode convolution that skips
// frame 0, the 0.01 · max threshold before the first beat, the last beat among cumscore's local maxima ≥ half their median.
const roundEven = (x) => { const r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 ? r - 1 : r; };
export function beatTrack(env) {
  const n = env.length; if (!n || !env.some((v) => v)) return { tempo: 0, beats: [] };
  const win = Math.floor(8.0 * SR / HOP), half = win >> 1;           // time_to_frames(ac_size = 8.0) floors
  const pad = new Float64Array(n + 2 * half);
  for (let i = 0; i < half; i++) { pad[i] = env[0] * i / half; pad[n + 2 * half - 1 - i] = env[n - 1] * i / half; }
  for (let i = 0; i < n; i++) pad[half + i] = env[i];
  let F = 1; while (F < 2 * win) F <<= 1;
  const fftN = fftFactory(F), hw = Float64Array.from({ length: win }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / win));
  const g = new Float64Array(win), re = new Float64Array(F), im = new Float64Array(F);
  for (let t = 0; t < n; t++) {
    re.fill(0); im.fill(0); for (let i = 0; i < win; i++) re[i] = pad[t + i] * hw[i];
    fftN(re, im); for (let i = 0; i < F; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; } fftN(re, im);
    let mx = 0; for (let k = 0; k < win; k++) mx = Math.max(mx, Math.abs(re[k])); if (mx > 0) for (let k = 0; k < win; k++) g[k] += re[k] / mx;
  }
  for (let k = 0; k < win; k++) g[k] /= n;
  let maxIdx = 0; const bpms = Float64Array.from({ length: win }, (_, k) => k === 0 ? Infinity : 60 * SR / (HOP * k));
  while (maxIdx < win && !(bpms[maxIdx] < 320)) maxIdx++;
  let best = 0, bv = -Infinity;
  for (let k = maxIdx; k < win; k++) { const v = Math.log1p(1e6 * g[k]) - 0.5 * (Math.log2(bpms[k]) - Math.log2(120)) ** 2; if (v > bv) { bv = v; best = k; } }
  const tempo = bpms[best], fpb = roundEven(SR / HOP * 60 / tempo);
  // __normalize_onsets (std, ddof 1) and __beat_local_score
  let mu = 0; for (const v of env) mu += v; mu /= n; let sd = 0; for (const v of env) sd += (v - mu) ** 2; sd = Math.sqrt(sd / Math.max(1, n - 1));
  const on = Float64Array.from(env, (v) => v / (sd + 1.1754944e-38)), K = 2 * fpb + 1, K2 = K >> 1;
  const w = Float64Array.from({ length: K }, (_, k) => Math.exp(-0.5 * ((k - fpb) * 32 / fpb) ** 2)), ls = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = Math.max(0, i + K2 - n + 1); k < Math.min(i + K2, K); k++) s += w[k] * on[i + K2 - k]; ls[i] = s; }
  // __beat_track_dp
  let lmax = -Infinity; for (const v of ls) lmax = Math.max(lmax, v);
  const thr = 0.01 * lmax, back = new Int32Array(n), cum = new Float64Array(n), lf = Math.log(fpb), h2 = roundEven(fpb / 2); let first = true;
  for (let i = 0; i < n; i++) {
    let bs = -Infinity, loc0 = -1;
    for (let loc = i - h2; loc > i - 2 * fpb - 1; loc--) { if (loc < 0) break; const sc = cum[loc] - 100 * (Math.log(i - loc) - lf) ** 2; if (sc > bs) { bs = sc; loc0 = loc; } }
    cum[i] = loc0 >= 0 ? ls[i] + bs : ls[i];
    if (first && ls[i] < thr) back[i] = -1; else { back[i] = loc0; first = false; }
  }
  // __last_beat: the last local maximum of cumscore ≥ half the median of the local maxima
  const isMax = (i) => cum[i] > (i > 0 ? cum[i - 1] : cum[0]) && cum[i] >= (i < n - 1 ? cum[i + 1] : cum[n - 1]);
  const maxima = []; for (let i = 0; i < n; i++) if (isMax(i)) maxima.push(cum[i]); maxima.sort((a, b) => a - b);
  const med = maxima.length ? (maxima.length % 2 ? maxima[maxima.length >> 1] : 0.5 * (maxima[maxima.length / 2 - 1] + maxima[maxima.length / 2])) : 0;
  let tail = n - 1; for (let i = n - 1; i >= 0; i--) if (isMax(i) && cum[i] >= 0.5 * med) { tail = i; break; }
  const beat = new Uint8Array(n); for (let i = tail; i >= 0; i = back[i]) beat[i] = 1;
  // __trim_beats: drop leading/trailing frames whose local score ≤ half the RMS of the hanning-smoothed beat envelope
  const bl = []; for (let i = 0; i < n; i++) if (beat[i]) bl.push(ls[i]);
  const hw5 = [0, 0.5, 1, 0.5, 0], conv = new Float64Array(bl.length + 4);
  for (let a = 0; a < bl.length; a++) for (let k = 0; k < 5; k++) conv[a + k] += bl[a] * hw5[k];
  const sm = conv.slice(2, Math.min(conv.length, n + 2)); let ms = 0; for (const v of sm) ms += v * v; const trim = sm.length ? 0.5 * Math.sqrt(ms / sm.length) : 0;
  for (let i = 0; i < n && ls[i] <= trim; i++) beat[i] = 0;
  for (let i = n - 1; i >= 0 && ls[i] <= trim; i--) beat[i] = 0;
  const beats = []; for (let i = 0; i < n; i++) if (beat[i]) beats.push(i * HOP / SR);
  return { tempo, beats };
}
export { fftFactory };
