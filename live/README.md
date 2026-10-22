# Dark Music Corpus · Ableton Live sets

Collected Live projects (Live 11.3): each folder carries its own copies of the DMC devices, so it opens on any
computer with Max for Live. Open the `.als` inside the folder.

| Project | What |
|---|---|
| `DMC Starter Project/` | The template: every DMC device in place, ready for your corpus. Start here. |
| `DMC Nono Demo Project/` | The set the demo piece was built with, settings intact, as an example of a finished patch. No audio is included: point its DMC Corpus **root** at your own corpus folder. |

## DMC Starter

| Track | Devices | Use |
|---|---|---|
| **Master** | DMC Hub | Receives the page (`ws://127.0.0.1:9002/dmc`) and the desktop engine (UDP 9000). Leave it here. |
| **Corpus** | DMC Corpus | Plays the clips. Set **root** to your corpus folder: the same folder you pick in the page. |
| **Clusters** | DMC Cluster → empty Instrument Rack | Add one instrument per chain, then right-click the chain-select ruler → *Distribute Ranges Equally*. Pick a cluster key. |
| **MIDI** | DMC MIDI → Operator | Keys → CC or notes. Swap Operator for any instrument. |
| **Events** | DMC Event → Operator | Rules: a key or an engine event → note, clip, scene or hit. |
| 5, 6 Audio | — | Free, for resampling or recording. |
| **Return A** | DMC Map → Reverb | Corpus-wide keys (density, outlier score…) → reverb and mix. |

Sources and mappings start empty on purpose: the menus fill from the Hub once data arrives.

## Getting started
1. Open `DMC Starter Project/DMC Starter.als`.
2. In DMC Corpus, set **root** to your corpus folder.
3. Open the Dark Music Corpus page in Chrome or Firefox, pick the same folder, let it analyse, and turn on the link
   (Chrome asks once to allow access to your local network).
4. Click through the map: the Hub's light turns on, the menus fill, and DMC Corpus plays the clips you select.
