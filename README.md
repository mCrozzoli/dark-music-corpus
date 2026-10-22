# Dark Music Corpus

Navigate a music corpus of your own, by ear and by eye, and play it into Ableton Live.

Dark Music Corpus cuts your audio into short clips, describes each clip by its sound (spectral shape, loudness,
timbre, pitch content, rhythm, and a CLAP audio embedding), and lays the corpus out as maps you can walk through.
The analysis runs in your browser: your audio never leaves your computer. A set of Max for Live devices brings
the clips and their descriptions into Ableton Live.

**Status: in development.** The Max for Live devices and the Live sets are here; the web tool is coming.

- **Max for Live devices** (v0.2, frozen, Live 11.3+ with Max for Live): [`m4l/`](m4l/) — guide in `m4l/README.md`.
- **Live sets**: [`live/`](live/) — the **DMC Starter** template and the set of the demo piece; guide in `live/README.md`.
- **Web tool**: https://mcrozzoli.github.io/dark-music-corpus/ (coming). Link test with the DMC Hub: `probe/ws.html`.
- The Live link works in Chrome (after allowing local-network access once) and Firefox; Safari blocks it.

Built with DarkSonification. Designed by Miguel Angel Crozzoli; implemented with Claude AI agents.
In collaboration with Christian Høgh (Rhythmic Music Conservatory, Copenhagen).

## Licences

- **Code, devices and template**: MIT (see `LICENSE`).
- **Audio** (the demo corpus excerpts from the record *Sounding Numbers*, Kairos KAI0022047, and the demo piece):
  all rights reserved, for listening only. Not covered by the MIT licence.
- Third-party software and models keep their own licences; full credits in [`CREDITS.md`](CREDITS.md).
