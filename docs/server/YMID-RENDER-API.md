# Avatar Render API — Integration Guide for Your-Mama-IsDead

This document is for the **Your-Mama-IsDead backend (Fastify) developers**. It describes
the API exposed by the avatar-render machine and how to connect to it over Tailscale.

The render machine handles **LLM execution, voice cloning (IndexTTS2), audio→expression
(LAM Audio2Expression), and head-pose (ARTalk)**. Your backend handles **everything
else** — auth, NFT ownership, persona prompts, RAG retrieval, memory, message history.

---

## 1. Topology

```
┌────────────────────────────┐         ┌────────────────────────────┐
│ YMID frontend (Next.js)    │         │ YMID backend (Fastify+TS)  │
│  /tablet/[tokenId]         │ ── HTTP ▶ - verify NFT ownership     │
│                            │ ◀──json─ │ - load persona config     │
│                            │         │ - retrieve RAG context    │
│                            │         │ - sign JWT (HS256)        │
│                            │         └────────────────────────────┘
│                            │
│         ┌──────────────────┘
│         ▼ WS (binary heavy)
│  ws://100.122.149.34:8012/render?token=<jwt>
│                                                  ┌──────────────────────────────┐
│         ───────────────────────────────────────▶ │ Render API (this machine)    │
│         {messages, voice, avatar, request_id}    │  - vLLM Qwen3-14B            │
│                                                  │  - IndexTTS2 (voice clone)   │
│         ◀────────────── stream ──────────────── │  - LAM A2E + ARTalk          │
│         text_delta JSON +                        │  - 3DGS avatar zip builder   │
│         binary chunks (WAV + ARKit + head pose)  └──────────────────────────────┘
└────────────────────────────┘
```

Key principle: **the render machine is stateless and persona-agnostic**. Every chat turn
ships the full `messages` array from your backend. To add RAG, memory, or change the
persona, you only touch your backend — never this server.

---

## 2. Network — Tailscale

The render machine sits on your tailnet:

```
Hostname   desktop-kbkgfe1
IPv4       100.122.149.34
MagicDNS   desktop-kbkgfe1.tailee002e.ts.net
Port       8012  (HTTP + WebSocket)
```

Any tailnet device (your Fastify backend, your Next.js dev box, mobile dev with
Tailscale app) can reach it. Tailscale's WireGuard tunnel already encrypts
everything end-to-end, so plain `http://` / `ws://` is fine — no need for TLS
inside the tailnet.

**Base URL** (use in your backend config):

```ts
const RENDER_BASE = process.env.RENDER_BASE ?? 'http://100.122.149.34:8012';
const RENDER_WS   = RENDER_BASE.replace(/^http/, 'ws') + '/render';
```

If you later add new tailnet machines, the IP stays put. If you scale to multiple
render boxes, expose a Tailscale hostname behind a small load balancer (out of scope
here).

---

## 3. Authentication — JWT (HS256)

A single shared secret is used between YMID backend and the render machine. Set
the same value in both environments:

```
# render machine (already configured, ask host admin for the value)
JWT_SECRET=<base64 ≥32 bytes>
JWT_AUDIENCE=ymid-render           # optional but recommended

# YMID backend env
RENDER_JWT_SECRET=<same value>
RENDER_JWT_AUDIENCE=ymid-render
```

### Signing a token (Node / Fastify)

```ts
import jwt from 'jsonwebtoken';

function signRenderToken(opts: {
  userId: string;          // your internal user id
  tokenId: string;         // the NFT token id (i.e. which persona)
  voice: string;           // voice label the user has uploaded
  avatar: string;          // avatar label
  ttlSec?: number;         // default 30 min
}): string {
  return jwt.sign(
    {
      sub: opts.userId,
      aud: 'ymid-render',
      persona: opts.tokenId,
      voice: opts.voice,
      avatar: opts.avatar,
    },
    process.env.RENDER_JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: opts.ttlSec ?? 1800 },
  );
}
```

### Claims read by the render machine

| Claim     | Required | Used for                                                |
| --------- | -------- | ------------------------------------------------------- |
| `sub`     | yes      | logged for debugging                                    |
| `aud`     | iff `JWT_AUDIENCE` is set on render machine | rejected if mismatch     |
| `exp`     | yes      | rejected if expired                                     |
| `voice`   | no       | default voice label if request omits one                |
| anything else | no   | render machine ignores it (use it for your own bookkeeping) |

If `JWT_SECRET` is empty on the render machine, auth is **off** (dev mode).
In production you MUST set it.

### Where the token goes

| Endpoint           | Where to put the token                          |
| ------------------ | ----------------------------------------------- |
| `WS /render`       | URL query string: `?token=<jwt>`                |
| `POST /upload_voice`  | header `Authorization: Bearer <jwt>`         |
| `POST /upload_avatar` | header `Authorization: Bearer <jwt>`         |
| `DELETE /voices/{label}`  | header `Authorization: Bearer <jwt>`     |
| `DELETE /avatars/{label}` | header `Authorization: Bearer <jwt>`     |
| `GET /healthz`, `GET /voices`, `GET /avatars` | none — open for monitoring |

---

## 4. Asset pre-build (one-time per persona)

Voice and avatar are built **once per deceased person** at NFT mint time, then
referenced by label in chat. Your backend calls these from its persona setup
flow.

### POST `/upload_voice` — build a cloned voice profile

`multipart/form-data`:

| Field   | Type   | Notes                                                            |
| ------- | ------ | ---------------------------------------------------------------- |
| `file`  | binary | Audio clip of the deceased. wav / mp3 / m4a / webm / ogg. **Best: 5–10 s, clean, single speaker, no background music.** Max 25 MB. |
| `label` | string | Safe identifier `[A-Za-z0-9_-]+`, e.g. `grandma_lin_2024`        |

Server converts to 22.05 kHz mono WAV via ffmpeg and stores it.

**Response (200)**:
```json
{ "label": "grandma_lin_2024", "path": "/workspace/outputs/voices/grandma_lin_2024.wav", "size": 220140 }
```

Reserved labels: `libai` (default demo voice).

**Node example**:
```ts
import FormData from 'form-data';
import axios from 'axios';
import { createReadStream } from 'fs';

async function uploadVoice(token: string, label: string, wavPath: string) {
  const fd = new FormData();
  fd.append('label', label);
  fd.append('file', createReadStream(wavPath));
  const { data } = await axios.post(`${RENDER_BASE}/upload_voice`, fd, {
    headers: { ...fd.getHeaders(), Authorization: `Bearer ${token}` },
  });
  return data;            // { label, path, size }
}
```

### POST `/upload_avatar` — build a 3DGS avatar from a photo

`multipart/form-data`:

| Field   | Type   | Notes                                                       |
| ------- | ------ | ----------------------------------------------------------- |
| `file`  | binary | Photo of the deceased. png / jpg / webp. **Best: clear, front-facing, well-lit head shot.** Max 20 MB. |
| `label` | string | Safe identifier                                             |

**This call blocks for ~100 seconds** while LAM reconstructs the 3D Gaussian
Splat avatar. Render machine serializes builds with a mutex.

**Response (200)**:
```json
{
  "label": "grandma_lin_2024",
  "url": "/static/avatars/grandma_lin_2024.zip",
  "took_sec": 102.4,
  "size": 4257879
}
```

The frontend can then download the avatar at
`${RENDER_BASE}/static/avatars/grandma_lin_2024.zip` and feed it into the
LAM_WebRender component.

Reserved labels: `my_avatar`, `barbara`.

**Caveat**: the per-photo skin / ARKit rig is currently shared across all uploads
(FBX SDK was wiped on a container recreate and is non-redistributable). The
avatar **looks like** the uploaded photo but expression deformation follows a
generic FLAME-ish rig. For most chat use cases this reads fine; tell host admin
if you need true per-identity retargeting and they will reinstall FBX SDK.

### GET `/voices` — list voices

```jsonc
{
  "voices": [
    { "label": "libai", "path": "...", "default": true },
    { "label": "grandma_lin_2024", "path": "...", "default": false }
  ]
}
```

### GET `/avatars` — list avatars

```jsonc
{
  "avatars": [
    { "label": "my_avatar", "url": "/static/my_avatar.zip", "builtin": true, "size": 4257863 },
    { "label": "grandma_lin_2024", "url": "/static/avatars/grandma_lin_2024.zip", "builtin": false, "size": 4257879 }
  ]
}
```

---

## 5. WebSocket `/render` — the chat stream

**One WS connection per active chat session.** The frontend opens this directly
to the render machine. Your backend's only job is to mint the JWT.

```
ws://100.122.149.34:8012/render?token=<jwt>
```

### Client → server messages (text frames, JSON)

```jsonc
// User turn — required fields: messages
{
  "type": "chat",
  "request_id": "uuid-or-anything",    // echoed in every response
  "messages": [
    { "role": "system",    "content": "你是林阿嬤..." },
    { "role": "user",      "content": "奶奶你最近好嗎" },
    { "role": "assistant", "content": "..." },
    { "role": "user",      "content": "今天天氣真好" }       // ← latest
  ],
  "voice": "grandma_lin_2024",         // optional, falls back to JWT.voice
  "avatar": "grandma_lin_2024",        // optional — render machine doesn't use
                                       //   it but echoes it for client routing
  "temperature": 0.7                   // optional, default 0.7
}

// Keepalive
{ "type": "ping" }
```

**Build `messages` your way**: include system prompt with persona, retrieved RAG
chunks, conversation history. The render machine treats this as an opaque
OpenAI-style array and forwards it verbatim to the local Qwen3-14B.

### Server → client — TEXT frames

```jsonc
{ "type": "text_delta", "text": "今天",  "request_id": "..." }   // streamed LLM tokens
{ "type": "text_delta", "text": "天氣",  "request_id": "..." }
...
{ "type": "done",       "request_id": "..." }                    // turn complete
{ "type": "error",      "request_id": "...", "msg": "..." }      // on any failure
{ "type": "pong" }                                               // ping reply
```

The `<think>…</think>` blocks emitted by Qwen3 are stripped server-side, so
text_delta only contains user-visible content.

### Server → client — BINARY frames (audio + expression + head pose)

One binary frame **per sentence**, sent in order, while text streaming.

Wire format:

```
[ 4 bytes  ] uint32 little-endian   meta_len
[ meta_len ] UTF-8 JSON              metadata (see below)
[ audio_len ] bytes                  audio_wav (24 kHz mono PCM16 WAV)
[ frames_len ] bytes                 float32 LE, shape (num_frames, 52), row-major
[ pose_len  ] bytes                  float32 LE, shape (num_frames, 3), row-major
                                     OPTIONAL — absent if ARTalk disabled
```

`meta` JSON:

```jsonc
{
  "type": "chunk",
  "chunk_id": 0,                      // 0-indexed within the turn
  "request_id": "...",                // if you echoed it
  "audio_len": 246350,
  "frames_len": 51792,                // num_frames * 52 * 4
  "pose_len":   3108,                 // num_frames * 3 * 4  (or 0)
  "pose_dim":   3,
  "num_frames": 261,
  "fps":        30,
  "sentence":   "奶奶想你了。"
}
```

`frames` is the 52-dim ARKit blendshape weight per frame at 30 fps. Channel
order is the LAM_Audio2Expression / ARKit canonical list (see appendix).

`pose` is the head bone axis-angle in radians per frame. Apply to a bone named
`head` in the rigged 3DGS avatar.

### TypeScript decoder

```ts
function decodeChunk(buf: ArrayBuffer): {
  meta: any; audio: ArrayBuffer; frames: Float32Array; pose: Float32Array | null;
} {
  const v = new DataView(buf);
  const metaLen = v.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, metaLen)));
  const audioStart  = 4 + metaLen;
  const audioEnd    = audioStart + meta.audio_len;
  const framesEnd   = audioEnd + meta.frames_len;
  const poseEnd     = framesEnd + (meta.pose_len ?? 0);
  return {
    meta,
    audio:  buf.slice(audioStart, audioEnd),
    frames: new Float32Array(buf.slice(audioEnd, framesEnd)),
    pose:   (meta.pose_len ?? 0) > 0
              ? new Float32Array(buf.slice(framesEnd, poseEnd))
              : null,
  };
}
```

### Full TypeScript client example

```ts
import WebSocket from 'ws';                // backend
// const ws = new WebSocket(url);          // browser uses the global

const ws = new WebSocket(`${RENDER_WS}?token=${jwt}`);
ws.binaryType = 'arraybuffer';

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'chat',
    request_id: '550e8400-e29b-41d4-a716-446655440000',
    messages: [
      { role: 'system', content: '你是林阿嬤，1932 生於台南……' },
      ...history,                          // your stored chat history
      ...ragHits.map(h => ({ role: 'system', content: `[記憶] ${h.text}` })),
      { role: 'user', content: userMessage },
    ],
    voice: 'grandma_lin_2024',
  }));
});

ws.on('message', (data, isBinary) => {
  if (!isBinary) {
    const evt = JSON.parse(data.toString());
    if (evt.type === 'text_delta')  appendToUI(evt.text);
    else if (evt.type === 'done')   markTurnComplete();
    else if (evt.type === 'error')  console.error(evt.msg);
  } else {
    const { meta, audio, frames, pose } = decodeChunk(data);
    audioQueue.enqueue(audio);
    avatarDriver.feedExpression(frames, meta.num_frames, meta.fps);
    if (pose) avatarDriver.feedHeadPose(pose);
  }
});
```

---

## 6. Performance characteristics — read this before integrating

| Stage                           | Latency (per sentence)              |
| ------------------------------- | ----------------------------------- |
| LLM first token (vLLM, Qwen3-14B-AWQ on RTX 5090) | ~100 ms          |
| LLM full response (5 sentences ≈ 10 s of speech)  | ~3–4 s           |
| TTS per sentence (IndexTTS2)    | ~RTF 2.7 (1 s audio takes 2.7 s)   |
| A2E per sentence                | ~0.5 s                              |
| ARTalk per sentence (parallel with A2E) | ~0.5 s                      |

**Implication**: TTS is the bottleneck. If you start audio playback the instant
chunk 0 arrives, you'll hear silence between sentences because chunk N+1
synthesis lags. **Pre-buffer ~3 s of audio in the browser before starting
playback** for smooth speech. (The reference chat UI does this — see
`prebufHeldDuration` in [chat.html](outputs/chat.html).)

### Concurrency

* IndexTTS2 daemon serialises calls via a mutex; concurrent users wait in line.
* A2E and ARTalk also share one GPU. Realistic capacity: 1 active chat at a
  time, brief queueing for short overlaps.
* For multi-user production, either scale horizontally (more render boxes
  behind a hash router) or limit chat concurrency at YMID backend.

### Tunables

The host admin sets these as env vars on the render machine. If your UI
testers complain about specific behaviours, ask them to adjust:

| Env var | Default | Use when…                            |
| --- | --- | --- |
| `JAW_GAIN`         | 1.0   | mouth movement looks too weak / strong |
| `BLINK_GAIN`       | 3.0   | blinks invisible / too pronounced      |
| `HEAD_GAIN`        | 1.2   | head movement too still / shaky        |
| `EYE_LOOK_DAMPING` | 0.0   | eyes look around weirdly (raise to 0.x to allow some, leave at 0 to lock gaze ahead) |
| `ARTALK_STYLE`     | natural_0 | switch to happy_0 / curious_0 / angry_0 / doubtful_0 for different motion personality |

---

## 7. Error semantics

| Where               | Outcome                                         |
| ------------------- | ----------------------------------------------- |
| Bad / missing token on WS | Connection closed with code **4401** before accept |
| Bad token on HTTP   | `401 invalid token`                             |
| Missing field in `chat` message | `{ "type":"error", "msg":"…" }` text frame; connection stays open |
| TTS daemon down     | `{ "type":"error", "msg":"…" }` mid-stream, then `done` |
| Build failed (`/upload_avatar`) | `500` with `{ "error":"build failed", "log_tail":"…" }` |

Reconnect logic: on connection close, mint a fresh token, reconnect. Tokens are
short-lived (default 30 min); don't try to refresh in-flight.

---

## 8. Appendix — ARKit channel order

The 52-dim per-frame vector in binary chunks uses this order (same as Apple
ARKit + LAM_Audio2Expression). Indices are 0-based.

```
 0 browDownLeft           18 eyeSquintLeft         36 mouthPucker
 1 browDownRight          19 eyeSquintRight        37 mouthRight
 2 browInnerUp            20 eyeWideLeft           38 mouthRollLower
 3 browOuterUpLeft        21 eyeWideRight          39 mouthRollUpper
 4 browOuterUpRight       22 jawForward            40 mouthShrugLower
 5 cheekPuff              23 jawLeft               41 mouthShrugUpper
 6 cheekSquintLeft        24 jawOpen               42 mouthSmileLeft
 7 cheekSquintRight       25 jawRight              43 mouthSmileRight
 8 eyeBlinkLeft           26 mouthClose            44 mouthStretchLeft
 9 eyeBlinkRight          27 mouthDimpleLeft       45 mouthStretchRight
10 eyeLookDownLeft        28 mouthDimpleRight      46 mouthUpperUpLeft
11 eyeLookDownRight       29 mouthFrownLeft        47 mouthUpperUpRight
12 eyeLookInLeft          30 mouthFrownRight       48 noseSneerLeft
13 eyeLookInRight         31 mouthFunnel           49 noseSneerRight
14 eyeLookOutLeft         32 mouthLeft             50 tongueOut    ← unused, kept at 0
15 eyeLookOutRight        33 mouthLowerDownLeft
16 eyeLookUpLeft          34 mouthLowerDownRight
17 eyeLookUpRight         35 mouthPressLeft
```

---

## 9. Quick checklist for integration

1. Get `JWT_SECRET` from host admin (set the same value as
   `RENDER_JWT_SECRET` on your backend).
2. Build voices and avatars once per persona via `POST /upload_voice` and
   `POST /upload_avatar`. Stash the returned labels in your Postgres
   `persona` table.
3. When a user opens `/tablet/[tokenId]`, your backend:
   - verifies NFT ownership
   - looks up the persona's `voice` + `avatar` labels
   - retrieves any RAG context from Qdrant (you can skip this for v1)
   - mints a JWT with `{sub, aud:'ymid-render', voice, avatar, exp}`
   - returns `{ wsUrl, jwt, persona, history }` to the frontend
4. Frontend opens `ws://100.122.149.34:8012/render?token=<jwt>`.
5. For each user message, frontend sends `{type:'chat', messages:[…full
   array…], voice, request_id}`.
6. Frontend renders incoming `text_delta` immediately and queues binary chunks
   for synced audio + avatar playback (use the pre-buffer pattern).
7. Reconnect with a fresh token on close.

Anything not covered here: ping host admin.
