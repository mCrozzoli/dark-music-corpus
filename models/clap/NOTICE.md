# CLAP audio encoder — notice

`audio_model_int8.onnx` is the audio encoder of **`laion/larger_clap_music`** by **LAION**
(https://huggingface.co/laion/larger_clap_music), exported to ONNX (torch.onnx, opset 17) from the Hugging Face
Transformers model and quantised to 8-bit weights (ONNX Runtime dynamic quantisation) for the Dark Music Corpus web tool,
2026-10-22. Only the audio side is included; the text side is not.

Licence: **Apache License 2.0** (as stated on the model card), which also covers this derived file.
http://www.apache.org/licenses/LICENSE-2.0

Citation: Y. Wu, K. Chen, T. Zhang, Y. Hui, T. Berg-Kirkpatrick, S. Dubnov, "Large-scale Contrastive Language-Audio
Pretraining with Feature Fusion and Keyword-to-Caption Augmentation", ICASSP 2023.

Changes from the original: format conversion (PyTorch → ONNX), 8-bit dynamic quantisation of the weights. Against the
original model on 185 clips of the demo corpus, the embeddings keep a cosine similarity of 0.9993 or more.
