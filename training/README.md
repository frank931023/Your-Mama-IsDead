# DSAS Off-line Training Pipeline

Seven-step CLI pipeline that turns the assets attached to a Digital Tablet NFT
(token URI on chain → IPFS metadata → photos / audios / texts / chatlogs)
into a packaged training artifact (LoRA + voice model + RAG index), uploads
the bundle back to IPFS, and writes the manifest URI on chain via
`setArtifactURI(tokenId, uri)`.

This module corresponds to **PROTOTYPE_PLAN.md §八 (線下訓練腳本)**. Read that
section first; the scripts below intentionally mirror its numbering.

## Layout

```
training/
├── configs/                # YAML hyperparameters (versioned)
├── pipelines/
│   ├── _common.py          # Shared utilities (chain, IPFS, logging, hashing)
│   ├── 01_fetch_assets.py
│   ├── 02_caption_images.py
│   ├── 03_train_lora.py
│   ├── 04_train_voice.py
│   ├── 05_build_rag.py     # ★ Fully real (sentence-transformers)
│   ├── 06_package_artifact.py
│   └── 07_upload_artifact.py
├── workspace/<tokenId>/    # Per-token scratch (ignored)
├── requirements.txt
└── README.md
```

## Quick start

```bash
cd training
python -m venv .venv
# Windows: .venv\Scripts\activate    Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt

# Drive the whole pipeline for tokenId 42:
python pipelines/01_fetch_assets.py     --token-id 42
python pipelines/02_caption_images.py   --token-id 42 --captioner stub
python pipelines/03_train_lora.py       --token-id 42 --config configs/lora_person.yaml
python pipelines/04_train_voice.py      --token-id 42 --backend stub
python pipelines/05_build_rag.py        --token-id 42
python pipelines/06_package_artifact.py --token-id 42 --version v1
python pipelines/07_upload_artifact.py  --token-id 42 --network sepolia
```

Every script is independently runnable, accepts `--token-id`, and is
**idempotent** — re-running skips work that's already done unless `--force`
is passed.

## Environment variables

Loaded from the **repo-root** `.env` via `python-dotenv`. See
`PROTOTYPE_PLAN.md §10.1` for the full list. The pipeline reads:

| Variable | Used by | Purpose |
|---|---|---|
| `RPC_URL` | 01, 07 | EVM JSON-RPC endpoint |
| `CHAIN_ID` | 07 | Numeric chain id (Sepolia = 11155111) |
| `CONTRACT_ADDRESS` | 01, 07 | Deployed `DigitalTablet` address |
| `TRAINER_PRIVATE_KEY` | 07 | Hex private key that calls `setArtifactURI` |
| `IPFS_GATEWAY` | 01 | HTTPS gateway for `ipfs://` rewrites |
| `PINATA_JWT` | 07 | Bearer token for Pinata pinning REST API |
| `HF_TOKEN` | 02, 03 | Hugging Face token (real-model branches) |

## Prototype scope vs real training

The heavy ML steps (LoRA training, voice fine-tune, image captioning) are
**stubbed** so the pipeline runs end-to-end on a CPU laptop. Stubs produce
output files of the correct *shape* (real `.safetensors` containers, real
JSON manifests) so downstream packaging / upload code is exercised. Each
heavy step has a `# TODO: replace stub with real training` marker plus a
comment indicating which library to swap in.

| Step | Stub behaviour | Real implementation |
|---|---|---|
| 02 captioning | Filename + metadata template | BLIP-2 / LLaVA via `transformers` (≥16 GB VRAM) |
| 03 LoRA | Tiny zero-init `lora.safetensors` | `kohya-ss/sd-scripts` or `diffusers` + `peft.LoraConfig` (24 GB VRAM, ~1 h on RTX 4090) |
| 04 voice | 1 KB binary placeholder | GPT-SoVITS fine-tune (~10 min ref audio, 12 GB VRAM) or ElevenLabs IVC API |
| 05 RAG | **Real** — `sentence-transformers/multilingual-e5-large` | (already real) |

If `sentence-transformers` is not installed step 05 falls back to a
deterministic hash-embedding stub and logs a warning — but you should always
run RAG with the real model for a meaningful index.

## GPU notes

- LoRA SDXL @ 1024px, rank 16, 2000 steps: ~24 GB VRAM, ~1 hour on RTX 4090
- BLIP-2 OPT-2.7B captioning: ~16 GB VRAM (or ~8 GB with 8-bit)
- GPT-SoVITS fine-tune: ~12 GB VRAM, needs 5–30 min of clean reference audio
- RAG embedding (`multilingual-e5-large`): 2 GB VRAM, runs fine on CPU

Heavy ML deps (`torch`, `diffusers`, `transformers`, `peft`) are *not* in
`requirements.txt` — install them with the matching CUDA wheel only on the
training host. Stubs and step 05 work without them.

## Workspace layout

```
workspace/<tokenId>/
├── metadata.json
├── manifest.fetched.json
├── raw/
│   ├── photos/  videos/  audios/  texts/  chatlogs/
├── captions/
│   ├── <basename>.txt    captions.jsonl
├── lora/
│   ├── lora.safetensors  config_snapshot.yaml  run.log
├── voice/
│   ├── voice_model.bin   voice_config.json
├── rag/
│   ├── index.json        embeddings.npy
└── dist/
    ├── artifact-v1.tar.gz   manifest.json
```

After step 07 the `manifest.json` has `models.{lora,voice,rag}.uri` filled
with `ipfs://<cid>` URIs and the on-chain `setArtifactURI` tx hash is
printed.
