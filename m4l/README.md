# Dark Music Corpus · Max for Live devices (v0.2, 2026-10-22)

Seven frozen devices for Ableton Live 11.3 or later with Max for Live (Max 8.5). Each device is self-contained:
its scripts are embedded, and nothing else needs installing. Drag a device from this folder into a track, or start
from the **DMC Starter** template in `../live/`.

The devices listen to Dark Music Corpus: the web page (through the Hub) or the desktop engine (OSC on UDP 9000).
Their menus fill with the keys of your corpus once data arrives; a fresh device shows empty menus.

| Device | Type | Put it | Does |
|---|---|---|---|
| **DMC Hub** | audio effect | the **Master** track, one per set | Receives everything and shares it with the other DMC devices |
| **DMC Corpus** | instrument | its own track | Plays the clips themselves, from your audio files |
| **DMC Map** | audio effect | any track | Up to 8 keys → any Live parameter |
| **DMC Cluster** | MIDI effect | before an Instrument or Drum Rack | Each cluster selects a chain of the Rack (or plays a note) |
| **DMC Cluster FX** | audio effect | before an Audio Effect Rack | Each cluster selects a chain of the Rack |
| **DMC MIDI** | MIDI effect | before any instrument | Up to 8 keys → CC, notes, program change, pitch bend, aftertouch |
| **DMC Event** | MIDI effect | any MIDI track | Rules: when a key changes or crosses a value, or the engine reports an event → note, clip, scene, or a one-shot modulation |

## DMC Hub
- **Web link:** the page connects to `ws://127.0.0.1:9002/dmc` on your own computer. Only this site's page and pages
  on your own machine are accepted, and only one page at a time. Turn the link on with **web**; the port field sets
  9002. Chrome asks once to allow access to devices on your local network: allow it. Firefox connects directly.
  **Safari blocks the link**; use Chrome or Firefox to play into Live.
- **OSC:** also receives the desktop engine on UDP **9000** and answers on **9001**.
- **Readouts:** status (messages per second, link state), the keys of the current reading (*signal* / *symbol*),
  and the clip and cluster now playing.

## DMC Corpus
- **root:** set it to **the same folder you picked in the page.** Clip paths arrive relative to it.
- **Formats:** WAV and AIFF play natively. mp3, m4a and FLAC go through the system decoders. Ogg/Opus cannot be read
  by Live on macOS: convert those first.
- **follow:** every clip you select in the page plays. **keys:** *latest* replays the latest clip on a MIDI note,
  transposed; *by cluster* makes the keyboard a cluster palette (root key + c replays the last clip of cluster c).
- **pitch** (semitones, as on a turntable), **att / rel** fades in ms, **gain** in dB, **panic**.
  8 voices; a 9th steals the oldest.

## DMC Map
Per slot: **source** (a key, by name, saved with the set), **curve** (−1…1; 0 = linear), **ms** (smoothing),
**inv**, and Ableton's own **map · remote · min · max**. *Remote* gives absolute control; off modulates around the
knob. Symbol keys arrive as 0–1 (class / (n−1)), so a slot on a cluster key can drive a Rack's Chain Selector.

## DMC Cluster and DMC Cluster FX
- **source:** a key, symbol keys first. **Target:** the first Rack to the right on the same track (re-found when
  devices change; **rescan** if needed).
- **Zones:** *spread* (default) — right-click the Rack's chain-select ruler → *Distribute Ranges Equally*, and each
  chain gets one cluster. *index* — selector value = chain number.
- **wrap** with more clusters than chains; **hold** freezes the current chain. Signal keys are cut into equal zones.
- **notes** (MIDI version): each cluster change plays base + cluster (base 36 = C1, the first Drum Rack pad).

## DMC MIDI
Per slot: **source**, **mode** (Off · CC · Note · Program change · Velocity · Bend 14-bit · Aftertouch), **ch**,
**num** (CC; defaults 20–27 are free for MIDI-learn), **lo / hi** (output range; lo > hi inverts).
Header: **vel** and **len** (ms; 0 holds until the next note). Values send only when they change; a symbol key in
Note mode plays lo + class. Changing a slot or **panic** releases held notes.

## DMC Event
Eight rules. **source:** an engine event (onset, beat, novelty, first visit, revisit, cluster enter, outlier, trace
step, reading, zoom, marker) or any key. **if:** change · rises · falls · crosses · equals · every N, with a
**value**. **then:** note · clip (slot n on this track) · scene (n) · hit (a one-shot 1→0 envelope through the
rule's map strip to any parameter). Header: **vel**, **len**, **hyst** (re-arm band, so a value at the threshold
doesn't chatter), **gap** (minimum ms between firings).

## Licence
MIT (see `../LICENSE`). DMC Map and DMC Event embed Ableton's `Abl.Map` / `Abl.MapUi` from the Max for Live building
tools, inside the frozen devices, as Ableton distributes them. Full credits in `../CREDITS.md`.
