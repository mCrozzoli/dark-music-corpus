# Dark Music Corpus — credits

The full list of what this project uses. It was compiled from the code (imports, vendored files,
embedded Max/Ableton components) on 2026-10-22.
This file goes into the public `dark-music-corpus` repo and the site's about page.

## People

**Built with DarkSonification. Designed by Miguel Angel Crozzoli; implemented with Claude AI agents.**

- **Miguel Angel Crozzoli**: concept, design, sonification and music. Composer of *Sounding Numbers*.
- **Christian Høgh**, master student at the Rhythmic Music Conservatory (RMC), Copenhagen: co-designer of the original Max for Live device (v0,
  2026). The DMC devices grew out of it, and its `featdistributor` design shaped DMC Map.
  (Instagram @christianhgh)
- ***Sounding Numbers***, Kairos (KAI0022047 / 0022047KAI), released 1 July 2024 (digital) and
  18 October 2024; 52 min. Composer: Miguel Angel Crozzoli. Performers: Miguel Angel Crozzoli, Calum
  Builder, Jūra Elena Šedytė, Valeria Miracapillo, Ida Nørby, Johannes Nästesjö.
  Sources: kairos-music.com/products/recording/0022047kai, prestomusic.com, klassiek-centraal.be.
  The demo corpus uses the 8 v2 masters of *I Am The Forest* I–V and *I Am The Ocean* I–III (57 min).
  The release has 7 tracks.
- **Support:** *acknowledgements to be added.*
- **Implementation:** Claude AI agents (Anthropic, Claude Code), with Miguel directing the design.

## Conceptual sources

- **Signal–Symbol framework.** Thor Magnusson, *Sonic Writing: Technologies of Material,
  Symbolic, and Signal Inscriptions*, Bloomsbury, 2019.
- **Dark Sonification.** M. A. Crozzoli et al., ICAD 2025.
- **Autographic / indexical layer.** Dietmar Offenhuber, *Autographic Design: The Matter of Data in
  a Self-Inscribing World*, MIT Press, 2023.
- **Demo piece.** Written after the late music of **Luigi Nono** (fragments, silences, *caminantes*,
  live electronics). It is an aesthetic homage only: no material by Nono is used or quoted.

## Audio corpus (demo)

- ***Sounding Numbers*** by Miguel Angel Crozzoli (Kairos, 2024). **All rights reserved.** Only short excerpts and the demo
  piece are published, for listening only. No masters are distributed.

## Machine-learning model

- **CLAP**: `laion/larger_clap_music` by LAION, via Hugging Face. Licence **Apache-2.0** (model card,
  checked 2026-10-22). Derived ONNX exports for the web carry the same licence and attribution. Y. Wu, K. Chen, T. Zhang, Y. Hui, T. Berg-Kirkpatrick, S. Dubnov, "Large-scale Contrastive
  Language-Audio Pretraining with Feature Fusion and Keyword-to-Caption Augmentation",
  ICASSP 2023.

## Algorithms (cited)

| Method | Reference |
|---|---|
| UMAP | L. McInnes, J. Healy, J. Melville, *UMAP: Uniform Manifold Approximation and Projection*, arXiv:1802.03426, 2018 |
| t-SNE | L. van der Maaten, G. Hinton, "Visualizing Data using t-SNE", JMLR 9, 2008 |
| Self-Organising Map | T. Kohonen, *Self-Organizing Maps*, Springer, 1995 |
| HDBSCAN | R. Campello, D. Moulavi, J. Sander, PAKDD 2013; L. McInnes, J. Healy, S. Astels, JOSS 2017 |
| k-means, GMM, agglomerative, spectral clustering, PCA | via scikit-learn (Pedregosa et al., JMLR 12, 2011) |
| Isolation Forest | F. T. Liu, K. M. Ting, Z.-H. Zhou, ICDM 2008 |
| Local Outlier Factor | M. Breunig, H.-P. Kriegel, R. Ng, J. Sander, SIGMOD 2000 |
| Louvain communities | V. Blondel, J.-L. Guillaume, R. Lambiotte, E. Lefebvre, J. Stat. Mech. 2008 |
| Audio novelty | J. Foote, "Automatic audio segmentation using a measure of audio novelty", ICME 2000 |
| MIR features | librosa: B. McFee et al., "librosa: Audio and Music Signal Analysis in Python", SciPy 2015 |

## Software: analysis engine and bridge (Python)

| Package | Version used | Licence |
|---|---|---|
| librosa | 0.11.0 | ISC |
| NumPy | 1.26.4 | BSD-3-Clause |
| SciPy | 1.16.3 | BSD-3-Clause |
| scikit-learn | 1.7.2 | BSD-3-Clause |
| umap-learn | 0.5.9 | BSD-3-Clause |
| pynndescent | 0.5.13 | BSD-2-Clause |
| pandas | 2.3.3 | BSD-3-Clause |
| PyArrow | 24.0.0 | Apache-2.0 |
| Numba | 0.62.1 | BSD-2-Clause |
| joblib | 1.5.2 | BSD-3-Clause |
| threadpoolctl | 3.6.0 | BSD-3-Clause |
| soundfile (libsndfile) | 0.13.1 | BSD-3-Clause (libsndfile: LGPL-2.1) |
| PyTorch | 2.14.1 | BSD-style (see its notices) |
| Hugging Face Transformers | 5.20.2 | Apache-2.0 |
| NetworkX | 3.5 | BSD-3-Clause |
| websockets | 16.0 | BSD-3-Clause |
| python-osc | 1.9.3 | Unlicense (public domain) |
| Matplotlib | 3.10.7 | Matplotlib licence (PSF-based) |
| Pillow | 11.3.0 | MIT-CMU |
| pytest (tests) | — | MIT |

Also: the **Dark Sonification** framework (`darksonification` package: DarkLibrosa
preprocessing, data processing, mapping utilities) and its web style kit (`darkstyle`).

## Software: web UI

- **D3.js v7** by Mike Bostock and contributors (ISC).
- The UI layout follows the Dark Sonification web interface pattern (right controls panel, left
  legend and config docks).

## Software: Max for Live devices and Live sets

- **Max 8 / Max for Live** by Cycling '74 (Ableton): the device environment, including Node for
  Max if the WebSocket link is added.
- **`Abl.Map` and `Abl.MapUi`** by Ableton: the parameter-mapping abstractions embedded in DMC Map
  and DMC Event. They are © Ableton, redistributed only inside the frozen devices, as is usual for
  Max for Live devices.
- **Ableton Live 11 Suite**: the DMC Starter template uses Live's built-in Operator, Instrument Rack
  and Reverb.
- The original DMC v0 device (Miguel Angel Crozzoli and Christian Høgh), kept as the lineage in
  `m4l/frozen/`.

## Software: film and demo production

- **Playwright** (Apache-2.0) with **Chromium** (BSD-style) for capturing the web UI.
- **FFmpeg** (LGPL-2.1+/GPL) for encoding.
- **PyObjC / Quartz** (MIT) for screen capture on macOS.
- The demo piece was rendered in Python (NumPy, SciPy, soundfile) from the project's own data.

## Licences of this project

- **Code**: devices, template, engine, UI. MIT.
- **Audio**: *Sounding Numbers* excerpts and the demo piece. All rights reserved, © Miguel Angel Crozzoli.
