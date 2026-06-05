# Avatar Render Server — Operations Runbook

This is the maintenance doc for the machine that serves the
[`YMID-RENDER-API`](./YMID-RENDER-API.md). It describes what runs here,
how to start/stop/restart, where to look when something breaks, and what to
back up. The API itself is documented separately.

Audience: whoever owns the box. Today that is the same person who built it,
so this also serves as a "future you" memory aid.

---

## 1. What this server does

It accepts WebSocket chat sessions from the Your-Mama-IsDead frontend,
runs the full virtual-character chat pipeline locally on one RTX 5090, and
streams back text + audio + ARKit expression frames + head pose:

```
text in  ──▶ Qwen3-14B (local, vLLM, AWQ int4)
          ──▶ IndexTTS2 (voice clone, daemon)
          ──▶ LAM_Audio2Expression  (audio → 52-d ARKit blendshapes 30 fps)
          ──▶ ARTalk                (audio → FLAME pose + blink, 30 fps)
          ──▶ binary WS chunks out
```

It also exposes asset-build endpoints (`/upload_voice`, `/upload_avatar`)
that the YMID backend calls once per deceased person at NFT mint time.

---

## 2. Host

- **Hardware**: RTX 5090 (32 GB VRAM), CUDA arch sm_120 (Blackwell)
- **OS**: Windows 11
- **Container runtime**: Docker Desktop with WSL2 backend
- **Tailscale**: machine on tailnet as `desktop-kbkgfe1` /
  `100.122.149.34` / `desktop-kbkgfe1.tailee002e.ts.net`

Project root on host: `c:\Users\user\Desktop\AI AVATAR\lam\`

---

## 3. Network exposure

| Port  | Service       | Reachable from        | Notes                              |
| ----- | ------------- | --------------------- | ---------------------------------- |
| 8011  | static HTTP   | tailnet               | legacy / unused, keep for now      |
| 8012  | backend API   | tailnet               | the real entrypoint                |
| 8013  | TTS daemon    | container-internal    | NOT mapped to host                 |
| 8014  | vLLM          | container-internal    | NOT mapped to host                 |

Tailscale's WireGuard already encrypts all 100.x traffic, so plain HTTP /
ws:// is safe on the tailnet. Adding HTTPS via `tailscale serve` is optional
(currently OFF — see *Decisions* §10).

---

## 4. File layout

### Host

```
lam/
├── .env                      # secrets + tunables (gitignored)
├── .gitignore
├── docker-compose.yml        # container definition
├── Dockerfile
├── YMID-RENDER-API.md        # API doc for clients
├── SERVER.md                 # this file
├── scripts/                  # bind-mounted into container at /workspace/scripts
│   ├── backend.py            # FastAPI server (port 8012)
│   ├── tts_daemon.py         # IndexTTS2 wrapper (port 8013)
│   ├── a2e_service.py        # LAM Audio2Expression wrapper
│   ├── artalk_service.py     # ARTalk wrapper
│   ├── build_avatar_zip.py   # LAM 3DGS reconstruction
│   ├── start_backend.sh      # restart backend with .env vars (DOES NOT recreate container)
│   ├── ensure_main_env.sh    # reinstall main-env pip deps after a recreate
│   └── smoke_*.py            # smoke tests
├── repos/                    # cloned source — bind-mounted, survives recreate
│   ├── LAM/                  # 3DGS reconstruction
│   ├── LAM_Audio2Expression/ # audio → ARKit
│   ├── ARTalk/               # speech → FLAME motion
│   └── index-tts/            # IndexTTS2 source (used via editable install)
├── weights/                  # model checkpoints — bind-mounted, ~23 GB
│   ├── LAM-20K/              # 3DGS reconstruction backbone
│   ├── LAM-assets/           # FLAME, third-party models
│   ├── LAM_audio2exp/        # A2E streaming weights
│   ├── IndexTTS-2/           # ~5.5 GB
│   └── Qwen3-14B-AWQ/        # ~10 GB
├── inputs/                   # user-supplied raw uploads
└── outputs/                  # all artifacts the backend reads / writes
    ├── chat.html             # demo UI
    ├── my_avatar.zip         # built-in avatar
    ├── barbara.zip           # built-in avatar
    ├── libai.wav             # default voice reference
    ├── voices/<label>.wav    # user-uploaded voice clones
    ├── avatars/<label>.zip   # user-uploaded avatars
    ├── _uploads/             # raw upload staging
    └── _chat_logs/           # backend / tts / vllm runtime logs
```

### Container (`lam`)

Persistent paths (survive recreate):
```
/workspace/repos       ← bind
/workspace/weights     ← bind  (~23 GB)
/workspace/inputs      ← bind
/workspace/outputs     ← bind
/workspace/scripts     ← bind (ro)
/workspace/venvs       ← named volume (lam_venvs)
/root/.cache/huggingface  ← named volume (hf_cache)
/root/.cache/torch        ← named volume (torch_cache)
```

Everything ELSE in the container's writable layer **disappears on
`docker compose up -d` recreate** — see §8.

---

## 5. Services & how they run

Three services all run **inside the single `lam` container**:

| Service          | Process            | Port | Python env                              | Loads in VRAM |
| ---------------- | ------------------ | ---- | --------------------------------------- | ------------- |
| Backend          | `backend.py`       | 8012 | main env (torch 2.7.1+cu128)            | A2E (~0.5 GB) + ARTalk (~2 GB) on demand |
| IndexTTS2 daemon | `tts_daemon.py`    | 8013 | `/workspace/venvs/tts` (torch 2.8+cu128)| ~7 GB persistent |
| vLLM             | `vllm.entrypoints` | 8014 | `/workspace/venvs/vllm` (torch 2.11+cu128, FlashInfer off, Triton attn) | ~13 GB persistent |

Each service has its own Python venv because their torch / transformers
pins conflict.

### Process supervision

There is NO supervisor (no systemd / supervisord). Each service is launched
once via `docker exec -d` and stays up. Restart procedures below.

### vLLM specifics

Launch command (in `tts.log` / `vllm.log`):
```bash
TORCH_CUDA_ARCH_LIST="12.0" \
VLLM_ATTENTION_BACKEND=TRITON_ATTN \
VLLM_USE_FLASHINFER_SAMPLER=0 \
/workspace/venvs/vllm/bin/python -m vllm.entrypoints.openai.api_server \
  --model /workspace/weights/Qwen3-14B-AWQ \
  --served-model-name qwen3-14b \
  --quantization awq_marlin \
  --dtype float16 \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.4 \
  --enforce-eager \
  --host 127.0.0.1 --port 8014
```

The `FLASHINFER` toggles are because FlashInfer fails to detect sm_120 and
falsely reports "requires sm75 or higher". Triton attention + native sampler
works around it.

---

## 6. Starting / stopping / restarting

### First boot (or after a container recreate)

Run these in order from the host (PowerShell or git bash, MSYS_NO_PATHCONV=1
if using git bash):

```bash
# 1. Container itself (if not running)
docker compose up -d         # if container was destroyed
# OR
docker start lam             # if container exists but is stopped

# 2. (Only after a recreate) Reinstall main-env pip deps
docker exec lam bash /workspace/scripts/ensure_main_env.sh

# 3. (Only after a recreate) Recompile CUDA modules
docker exec lam bash -c '
  export TORCH_CUDA_ARCH_LIST=12.0 FORCE_CUDA=1
  pip install --no-build-isolation \
    "git+https://github.com/ashawkey/diff-gaussian-rasterization/" \
    "git+https://github.com/camenduru/simple-knn/" \
    "nvdiffrast@git+https://github.com/ShenhanQian/nvdiffrast@backface-culling"'

# 4. Start TTS daemon (model load: ~6 min cold, ~30 s warm)
docker exec -d lam bash -c '
  exec /workspace/venvs/tts/bin/python /workspace/scripts/tts_daemon.py \
    > /workspace/outputs/_chat_logs/tts.log 2>&1'

# 5. Start vLLM (model load: ~30 s)
docker exec -d lam bash -c '
  TORCH_CUDA_ARCH_LIST="12.0" \
  VLLM_ATTENTION_BACKEND=TRITON_ATTN \
  VLLM_USE_FLASHINFER_SAMPLER=0 \
  exec /workspace/venvs/vllm/bin/python -m vllm.entrypoints.openai.api_server \
    --model /workspace/weights/Qwen3-14B-AWQ \
    --served-model-name qwen3-14b \
    --quantization awq_marlin \
    --dtype float16 --max-model-len 8192 \
    --gpu-memory-utilization 0.4 --enforce-eager \
    --host 127.0.0.1 --port 8014 \
    > /workspace/outputs/_chat_logs/vllm.log 2>&1'

# 6. Start backend (reads .env)
bash scripts/start_backend.sh
```

### Routine restart (just backend)

After editing `backend.py`, changing `.env`, or backend crashed:

```bash
cd "c:/Users/user/Desktop/AI AVATAR/lam"
bash scripts/start_backend.sh
```

This kills any existing `backend.py` and relaunches it with **all env vars
read from `.env`**. Does NOT touch the container, vLLM, or TTS daemon.

### Stopping

```bash
# Stop backend only
docker exec lam pkill -f scripts/backend.py

# Stop everything (services keep their model weights on disk; only kills procs)
docker exec lam bash -c '
  pkill -f scripts/backend.py
  pkill -f scripts/tts_daemon.py
  pkill -f vllm.entrypoints'

# Stop container (writable layer survives until recreate)
docker stop lam

# Nuke container (writable layer GONE — see §8 recovery)
docker compose down
```

### Health check

```bash
docker exec lam curl -s http://127.0.0.1:8012/healthz
# {"a2e":true,"tts":true,"artalk":true,"auth":"jwt-hs256",
#  "llm_model":"qwen3-14b","llm_endpoint":"http://127.0.0.1:8014/v1"}
```

All three booleans must be `true`. `auth: "open"` means JWT_SECRET is empty
in `.env` — fine for dev, NOT for production.

---

## 7. `.env` reference

All tunables live in `lam/.env` (gitignored). The backend reads it via
`scripts/start_backend.sh`. **Editing `.env` requires a backend restart.**

```bash
# ===== JWT auth (shared with YMID backend) =====
JWT_SECRET=<64-char urlsafe>     # MUST match RENDER_JWT_SECRET on YMID side
JWT_AUDIENCE=ymid-render         # optional; if set, rejects tokens with wrong aud
JWT_ALG=HS256

# ===== CORS =====
CORS_ORIGINS=*                   # or comma-sep allowlist for prod

# ===== LLM =====
OPENAI_API_KEY=EMPTY             # placeholder; not used when LLM_BASE_URL set
LLM_BASE_URL=http://127.0.0.1:8014/v1   # local vLLM
LLM_MODEL=qwen3-14b              # vLLM --served-model-name

# ===== Avatar / face pipeline =====
USE_ARTALK_POSE=1                # turn off to use A2E only (no head pose / blinks)
ARTALK_STYLE=natural_0           # natural_0/1, happy_0/1/2, angry_0, curious_0, doubtful_0/1
HEAD_GAIN=1.2                    # multiply head_pose vector before driving head bone
JAW_GAIN=1.0                     # ARTalk jaw → jawOpen multiplier
BLINK_GAIN=3.0                   # FLAME blink amplification (raw peak ~0.4 ⇒ ×3 ≈ visible)
IDLE_BLINK_MIN_SEC=3.5           # idle blink schedule range
IDLE_BLINK_MAX_SEC=6.0
EYE_LOOK_DAMPING=0.0             # 0 = freeze gaze ahead, 1 = passthrough A2E eye-look
EYE_SQUINT_DAMPING=1.0           # multiplier on A2E squint channels
EYE_WIDE_DAMPING=1.0             # multiplier on A2E wide channels
BROW_DAMPING=1.0                 # multiplier on A2E brow channels

# ===== Reference voice =====
REF_WAV=/workspace/outputs/libai.wav   # default voice ref when client omits 'voice'
```

To rotate the JWT secret: regenerate, edit `.env`, restart backend, push
new value to YMID's env, restart YMID backend. **Done atomically** —
existing tokens will be rejected immediately.

---

## 8. ⚠️ Container recreate wipes the writable layer

`docker compose up -d` after any compose edit **destroys** the container
and creates a new one. The writable layer is gone. Persistent paths
(bind mounts + named volumes from §4) survive.

**What gets wiped:**
- All main-env pip installs done at runtime (transformers, fastapi, openai,
  httpx, librosa, addict, trimesh, accelerate, … plus monkey patches on
  chumpy / fdlite)
- Source-compiled CUDA modules: `diff_gaussian_rasterization`, `simple_knn`,
  `nvdiffrast` — these were compiled for sm_120 Blackwell
- FBX SDK (Autodesk, non-redistributable) — currently NOT reinstalled, see
  `memory/project_fbx_sdk_workaround.md`

**What survives:**
- Image-baked deps: torch 2.7.1+cu128, pytorch3d 0.7.8, plus everything in
  the Dockerfile
- `/workspace/repos`, `/workspace/weights`, `/workspace/inputs`,
  `/workspace/outputs`, `/workspace/scripts`
- Named volumes: `lam_venvs` (TTS + vLLM venvs), `hf_cache`, `torch_cache`

**Recovery after recreate** — see §6 First boot, steps 2–6.

The cleanest long-term fix is to bake all runtime deps + compiled CUDA
modules into the Dockerfile and rebuild the image once. **Not done yet** —
on the to-do list.

---

## 9. Logs

All logs live under `outputs/_chat_logs/` (bind-mounted, accessible from
host):

| File          | Source                |
| ------------- | --------------------- |
| `backend.log` | `backend.py` stdout+stderr |
| `tts.log`     | `tts_daemon.py` stdout+stderr |
| `vllm.log`    | vLLM api_server stdout+stderr |
| `tts_test.wav`| last manual TTS smoke output |

No rotation — they grow unbounded. Truncate manually when needed:

```bash
docker exec lam bash -c '> /workspace/outputs/_chat_logs/backend.log'
```

Common things to grep:

```bash
docker exec lam grep -E "ERROR|chunk |ARTalk ready" \
  /workspace/outputs/_chat_logs/backend.log | tail -20
```

---

## 10. Decisions logged elsewhere

These are documented in `~/.claude/projects/.../memory/`:

- `project_lam_container_recreate.md` — what wipes on recreate
- `project_tts_choice.md` — why IndexTTS2 in isolated venv
- `project_avatar_zip.md` — the ARKit 51/264 zip structure requirement
- `project_a2e_frame_shape.md` — A2E json `frames[i]` shape gotcha
- `project_fbx_sdk_workaround.md` — generic rig for new avatars

---

## 11. Storage & GPU budget

### Disk

```
/workspace/weights      ~23 GB    LAM (3.4 GB) + IndexTTS-2 (5.5 GB) + Qwen3-14B (10 GB) + LAM-assets (4 GB)
/workspace/venvs        ~17 GB    tts venv (~7 GB) + vllm venv (~10 GB)
/workspace/repos        ~7.4 GB   LAM + LAM_A2E + ARTalk + IndexTTS
/workspace/outputs      ~50 MB    avatar zips, voice samples, demo audio, logs
```

### VRAM (RTX 5090 = 32 GB)

| When | GPU used | Notes |
|------|----------|-------|
| Idle (no model loaded) | ~7 GB | Windows + WSL + CUDA driver overhead |
| + IndexTTS2 daemon     | ~14 GB total |  IndexTTS2 ~7 GB |
| + A2E + ARTalk loaded by backend | ~17 GB total | A2E + ARTalk ~3 GB |
| + vLLM Qwen3-14B-AWQ   | ~28 GB total | vLLM ~11 GB persistent + KV cache |
| Peak (during LAM avatar build) | ~30 GB | transient ~5 min during reconstruction |

Less than 3 GB headroom under full load. If chat concurrency goes up, **the
first thing to break will be GPU OOM during a chat that overlaps with an
avatar build**. Mitigations:
- Serialise avatar builds (currently done via `_avatar_build_lock`)
- Lower `--gpu-memory-utilization` from 0.4 → 0.35 for vLLM if needed
- Or move avatar builds to nighttime

---

## 12. Performance characteristics

| Operation                          | Cold | Warm  |
| ---------------------------------- | ---- | ----- |
| Container restart                  | 5 s  | 5 s   |
| Main env reinstall (after recreate)| ~5 min | — |
| CUDA modules rebuild (after recreate) | ~5 min | — |
| TTS daemon model load              | ~6 min | ~30 s |
| vLLM model load                    | ~60 s | ~60 s |
| Backend startup (A2E + ARTalk)     | ~12 s | ~12 s |
| Per-sentence TTS (IndexTTS2)       | RTF 2.7 | (same) |
| Per-sentence A2E + ARTalk          | ~0.5 s | (parallel with TTS via thread) |
| LAM avatar build (single photo → zip) | ~100 s | (same) |
| LLM first token (Qwen3-14B)        | ~100 ms | ~100 ms |

**Critical**: IndexTTS2 RTF > 1 means audio synthesis is slower than
playback. Without client-side pre-buffer, sentences arrive too late and
playback stutters. The reference `chat.html` pre-buffers 3 s of audio
before starting playback — **YMID frontend MUST do the same** or speech
will be choppy.

---

## 13. Troubleshooting

| Symptom | Diagnosis | Fix |
|---|---|---|
| `healthz` returns 404 / connection refused | backend.py not running | `bash scripts/start_backend.sh` |
| `healthz` shows `"a2e":true, "tts":false, "artalk":true` | TTS daemon dead | Restart TTS daemon (§6 step 4) |
| `healthz` shows `"auth":"open"` | JWT_SECRET empty in .env | Edit .env, restart backend |
| `/render` returns 4401 "missing token" | client sent no `?token=` | client bug — check JWT minting |
| `/render` returns 4401 "invalid token" | secret mismatch between YMID and this server | Re-sync `JWT_SECRET` |
| `/render` returns 4401 "token expired" | client cached an old JWT | Mint fresh token |
| `/render` works but no audio chunks come | TTS daemon serializing previous request | Wait, or check `tts.log` for crash |
| Backend log: `RuntimeError: FlashInfer requires GPUs with sm75 or higher` | vLLM picked FlashInfer path on Blackwell | Already worked around with env vars — only happens if launch command lost them |
| `/upload_avatar` returns 500 with `ModuleNotFoundError: No module named 'trimesh'` (or chumpy / accelerate / etc) | container was recreated, main env wiped | `bash ensure_main_env.sh` |
| `/upload_avatar` returns 500 with FBX SDK error | known limitation | The generic-rig workaround should have kicked in; check `build_avatar_zip.py:borrow_generic_rig` |
| Avatar mouth not moving in browser | bsNames order mismatch | Already fixed in chat.html with hardcoded A2E_CHANNEL_NAMES; if reused elsewhere, copy that array |
| Eyes drifting in browser | `lEye`/`rEye` bones not locked | Frontend regex in chat.html `installDrivers` — make sure target uses same logic |
| GPU OOM under chat | Concurrent avatar build + chat | Wait for build to finish; or reduce vLLM `--gpu-memory-utilization` |
| `docker exec` hangs on Windows | Docker Desktop crashed | `wsl --shutdown` then relaunch Docker Desktop |

---

## 14. Backup / disaster recovery

What's irreplaceable:

| Asset | Where | Recoverable? |
|---|---|---|
| User-uploaded voice clones | `outputs/voices/<label>.wav` | NO — back up |
| User-built avatar zips | `outputs/avatars/<label>.zip` | YES, can rebuild from `inputs/_uploads/<label>.<ext>` if you keep raw uploads, but takes ~100 s each |
| Raw photo uploads | `outputs/_uploads/*` | (caller-side) |
| `.env` (`JWT_SECRET`) | `lam/.env` | NO — back up, ideally in a password manager |
| Model checkpoints | `weights/` | YES, redownloadable from HF |
| Source repos | `repos/` | YES, git pull |
| Compiled CUDA modules | container writable layer | YES, recompile (~5 min) |
| FBX SDK install | (currently gone) | NO automated path — see `memory/project_fbx_sdk_workaround.md` |

**Minimal backup set**: `lam/.env`, `lam/outputs/voices/`,
`lam/outputs/avatars/`, `lam/outputs/_uploads/`. Everything else is
reconstructable in <30 min.

---

## 15. Update procedures

### Upgrade Qwen3 to a different model

```bash
# 1. Download new model
docker exec lam python -c "
from huggingface_hub import snapshot_download
snapshot_download(repo_id='Qwen/Qwen3-30B-A3B-AWQ',
                  local_dir='/workspace/weights/Qwen3-30B-A3B-AWQ')"

# 2. Edit .env
# LLM_MODEL=qwen3-30b
# (vLLM launch script — update --model and --served-model-name)

# 3. Restart vLLM (NOT backend, vLLM is on its own venv)
docker exec lam pkill -f vllm.entrypoints
# Relaunch vLLM (see §6 step 5)

# 4. Restart backend
bash scripts/start_backend.sh
```

### Upgrade backend.py / chat.html

Edit on host (`scripts/` and `outputs/` are bind-mounted). The container
sees changes immediately. For backend code changes:

```bash
bash scripts/start_backend.sh
```

For chat.html: hard-refresh the browser (Ctrl+Shift+R).

### Add a new avatar tunable

1. Add to backend.py near other tunables
2. Add to .env with a sane default
3. Document in §7 above
4. Restart backend

---

## 16. Quick reference card

```bash
# Health
docker exec lam curl -s http://127.0.0.1:8012/healthz

# Restart backend (most common)
bash scripts/start_backend.sh

# Watch backend log
docker exec lam tail -f /workspace/outputs/_chat_logs/backend.log

# Smoke test /render (uses JWT from .env)
docker cp .env lam:/workspace/.env
docker exec lam python /workspace/scripts/smoke_render.py

# GPU state
docker exec lam nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader

# Service procs
docker exec lam ps -ef | grep -E "backend.py|tts_daemon|vllm" | grep -v grep

# Disk usage
docker exec lam du -sh /workspace/weights /workspace/venvs /workspace/repos

# Open chat UI in browser
# → http://localhost:8012/
# → http://100.122.149.34:8012/  (from any tailnet device)
```
