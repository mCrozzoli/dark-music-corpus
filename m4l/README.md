# DMC devices for Ableton Live

Seven Max for Live devices that bring a **Dark Music Corpus** reading into Ableton Live. The page
(or the desktop engine) analyses your corpus of sounds: it measures features, maps the clips,
groups them into clusters and finds outliers. As you navigate, it sends **keys** to Live. Each key is one named
stream of data, such as `mirclap_umap.cluster`, `spectral.centroid` or `energy.rms`. The devices pick keys
**by name**, so recomputing a reading never breaks your mappings.

Requires **Ableton Live 11 Suite or 12** (or Standard + Max for Live), macOS or Windows.
The devices are frozen: everything they need is inside them.

## Install

1. Download the release zip and unzip it anywhere (e.g. `Documents/Dark Music Corpus`).
2. In Live's browser: **Places → Add Folder…** → choose that folder.
3. Open `DMC Starter Project/DMC Starter.als` for a ready-made set, or drag devices in by hand.
4. Put **DMC Hub** on the Master track. You need exactly one Hub per set.

## How data reaches Live

| Source | How |
|---|---|
| **The web page** (mcrozzoli.github.io/dark-music-corpus) | Click **Ableton: link** in the page. It connects to the Hub on your own computer at `ws://127.0.0.1:9002/dmc`. Chrome asks once to allow local network access. |
| **Desktop engine / any OSC app** | OSC over UDP to port **9000** (DESIGN §4 message set; flat `name value …` rows also work). |

**Browsers:**
- **Chrome** works after you click **Allow** once on its "access devices on your local network" prompt.
- **Firefox** works directly.
- **Safari** can explore and listen, but cannot link to Live: it blocks an https page from talking to
  your computer. Use Chrome or Firefox to drive Ableton.

The Hub accepts the page only from the official site (or `localhost` while developing), and only
on your own machine, so no other website or computer can drive your Live set.

## The devices

The data comes in three kinds:

- **Signal**: continuous keys such as position, features, density and deviation.
- **Symbol**: categories such as clusters, labels, sections and outlier flags.
- **Event**: discrete moments such as an onset, a novelty peak, a revisit, or a cluster change.

The source menus group keys by family (`· S7 deviation`, `· Y1 clusters`…). Hover a menu to read
the key's description in Live's Info View.

### DMC Hub (audio effect, on Master)
The receiver. It shows the connection state (`receiving on :9000`, `web linked`), the current reading
with its number of keys per family, and the clip and cluster you are on. Its controls are **port**
(UDP), **On**, **reply** port, **web** on/off and **web port**. Leave it on Master.

### DMC Corpus (instrument)
It plays **the clips themselves**: the exact window of the sound you navigate to.

| Control | What |
|---|---|
| **root** | Your corpus folder: **the same folder you picked in the page**. Clip paths arrive relative to it. |
| **follow** | Every clip you navigate to plays. |
| **keys** | *latest*: MIDI notes replay the latest clip, transposed. *by cluster*: note = root key + cluster, so the keyboard becomes a cluster palette. |
| root key · pitch · att · rel · gain · panic | Playback controls. |

It reads **WAV and AIFF** directly; **mp3, m4a and FLAC** go through the system's decoders.
Ogg/Opus is not supported, so convert those files first. It has 8 voices; when all are busy, a new clip takes the oldest voice.

### DMC Map (audio effect)
It has **8 slots**. Each turns one key into **any Live parameter**.
- **source**: the key.
- **curve**: from −1 to 1; 0 is linear.
- **ms**: smoothing time.
- **inv**: inverts the value.
- **Map**: click it, then click any parameter in Live.
- **Remote** (absolute control) or **Mod** (modulation around the knob), with **min / max**.

Stack several Map devices if you need more slots. A typical use is on a Return track,
where global keys such as density or outlier score shape the whole mix.

### DMC Cluster (MIDI effect) / DMC Cluster fx (audio effect)
A key, usually a cluster key, selects **one chain** of the Rack to its right. There is one chain per
cluster: a different instrument or effect for each region of the map.

| Control | What |
|---|---|
| source | The key (symbol families listed first). |
| **Zones** | *spread* matches Live's **Distribute Ranges Equally**; *index* uses chain number = cluster. |
| wrap · hold | *wrap* folds extra clusters onto the chains; *hold* freezes the current chain. |
| **noise** | Points between clusters (HDBSCAN noise): *hold* keeps the current chain and plays no note; *last chain* gives them the Rack's last chain, and the clusters share the others. |
| notes (MIDI build) | One note per cluster change (base + cluster), e.g. for Drum Rack pads. |

Set-up: put an Instrument or Audio Effect Rack after it, give it one chain per cluster, then
right-click the chain-select ruler → *Distribute Ranges Equally*.

### DMC MIDI (MIDI effect)
It has **8 slots**. Each turns a key into **CC / Note / PgmChg / Velocity / Bend / AT**, with
**ch**, **num** (the CC number), and a **lo / hi** output range.

- Symbol keys in *Note* mode play one pitch per cluster.
- A *Velocity* slot sets the velocity of the device's Note slots from data.
- Changing source or mode always sends note-offs.

### DMC Event (MIDI effect)
It has **8 rules**: *when something happens, do something*.

| Column | What |
|---|---|
| source | An **engine event** (onset, beat, novelty, first_visit, revisit, cluster_enter, outlier, trace_step, marker…) or any key. |
| **if** | change · rises above · falls below · crosses · equals · every N. |
| value | Threshold (% of the key's range), class number, or N. |
| **then** | **note** · **clip** (fire clip slot n on this track) · **scene** (fire scene n) · **hit** (a short envelope to any parameter, through the Map strip). |
| header | **vel**, **len** (note and hit length), **hyst** (so values at the threshold don't retrigger), **gap** (minimum time between firings). |

## A typical set (DMC Starter)

| Track | Devices |
|---|---|
| Master | DMC Hub |
| Corpus | DMC Corpus (set root!) |
| Clusters | DMC Cluster → Instrument Rack, one chain per cluster |
| MIDI | DMC MIDI → any instrument |
| Events | DMC Event → any instrument |
| Return A | DMC Map → Reverb (global keys → mix) |

The rule of thumb:
- **Corpus** plays *what* the data is;
- **Cluster** chooses *which* sound family it belongs to;
- **Map, MIDI and Event** let its features and moments shape *how* it sounds.

## Troubleshooting

- **The Hub's light stays grey.** Check that nothing else uses UDP 9000, or change the Hub's
  port. Only one Hub per set.
- **The status line shows `UDP error EADDRINUSE` or `web error EADDRINUSE`.** Another Hub, or
  another app, is already using the port. Remove the extra Hub or change the port.
- **The page can't link in Safari.** That is expected; use Chrome or Firefox for the Live link.
- **Chrome can't link.** Allow "access devices on your local network" for the site
  (lock icon → Site settings → Local network access).
- **The page says "refused".** Use the official page address. The Hub only accepts that site and `localhost`.
- **Corpus is silent.** Set **root** to the same folder you picked in the page, and use WAV, AIFF,
  mp3, m4a or FLAC files.
- **The Cluster readout says "no Rack to the right".** Put an Instrument or Audio Effect Rack
  directly after it.

## Credits and licence

The devices and template are MIT-licensed. They are built with Max for Live (Cycling '74 / Ableton) and
include Ableton's `Abl.Map` abstractions inside the frozen devices. The DMC devices grew out of the
original device by Miguel Angel Crozzoli and Christian Høgh. See `CREDITS.md`.
