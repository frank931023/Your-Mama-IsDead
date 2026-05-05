# DSAS Compute Service

FastAPI inference service for the DSAS prototype. Loads per-NFT artifact bundles
(LoRA + voice + RAG index) from chain → IPFS, then serves chat / portrait / voice
endpoints behind JWT-gated routes.

For prototype scope:
- **Chat** is fully implemented (RAG retrieval + OpenAI streaming).
- **Portrait** and **Voice** are stubbed (return placeholder PNG / silent WAV) but
  carry production-style structure so they can be flipped to real backends
  (`diffusers` SDXL + LoRA, GPT-SoVITS / ElevenLabs) without router-level rewrites.

## Quick start

```bash
cd compute
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt

# Configure env (see app/config.py for full list)
export RPC_URL=https://sepolia.infura.io/v3/<key>
export CONTRACT_ADDRESS=0x...
export IPFS_GATEWAY=https://gateway.pinata.cloud/ipfs/
export OPENAI_API_KEY=sk-...
export JWT_SECRET=dev-secret

uvicorn app.main:app --reload --port 8000
```

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET  | `/`                                   | no  | health |
| GET  | `/health`                             | no  | health |
| GET  | `/persona/{tokenId}/manifest`         | no  | public manifest readout |
| POST | `/persona/{tokenId}/chat`             | yes | SSE token stream |
| POST | `/persona/{tokenId}/portrait`        | yes | PNG bytes (stubbed) |
| POST | `/persona/{tokenId}/voice`            | yes | WAV bytes (stubbed) |

Auth is `Authorization: Bearer <jwt>` signed with `JWT_SECRET` (HS256). The token
must contain an `address` claim — the wallet that proved ownership of the tokenId
in the upstream SIWE flow.

## Tests

```bash
pytest test/
```

## Switching to real ML backends

Search for `# REAL IMPLEMENTATION` comment blocks in:
- `app/services/lora_runner.py`
- `app/services/tts_runner.py`

Each block sketches the production code path (diffusers SDXL pipeline +
`load_lora_weights`, GPT-SoVITS API call) so the swap is mechanical.
