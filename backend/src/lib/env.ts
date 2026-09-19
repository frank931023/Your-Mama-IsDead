/**
 * 集中式環境變數載入 + 驗證
 *
 * 所有設定值都在這個檔案的 zod schema 集中,避免散落在各模組各自讀
 * process.env 而出錯。啟動時若 schema 驗證失敗會直接 throw 並列出
 * 缺失的欄位,讓開發者一眼看到該補哪些 .env 設定。
 *
 * 載入順序:
 *   1. dotenv 自動讀根目錄 .env 寫入 process.env
 *   2. zod schema 驗證並轉型 (e.g. CHAIN_ID 從字串 coerce 成 number)
 *   3. 結果快取在 cached,後續 import { env } 直接拿
 */
import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  // required
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars"),
  RPC_URL: z.string().url("RPC_URL must be a valid URL"),
  CONTRACT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "CONTRACT_ADDRESS must be a 0x address"),
  CHAIN_ID: z.coerce.number().int().positive(),
  SIWE_DOMAIN: z.string().min(1),

  // optional
  BACKEND_PORT: z.coerce.number().int().positive().default(14000),
  BACKEND_HOST: z.string().default("0.0.0.0"),
  FRONTEND_URL: z.string().url().optional(),

  // 隱藏特定鏈上 tokenId(逗號分隔,例如 "1,2,3,4,5,6,7")。
  // ERC-721 一旦鑄造就無法銷毀,demo 時若鏈上有不想展示的舊塔位,
  // 在這裡列出即可:scan / registry / lazy-sync 一律跳過,前端也就看不到。
  // 預設空字串 = 不排除任何 token。
  EXCLUDED_TOKEN_IDS: z.string().default(""),
  PINATA_JWT: z.string().optional(),
  // ── 儲存層 ────────────────────────────────────────────────────────
  // 預設儲存模式;/admin 可在執行期覆寫(存 Redis)。未設則依已設定的
  // 金鑰推導:有 Arweave 簽名金鑰 → arweave,否則有 PINATA_JWT → pinata,否則 local。
  STORAGE_DRIVER: z.enum(["arweave", "pinata", "local"]).optional(),
  // ── Arweave 永存層 (lib/arweave.ts) ───────────────────────────────
  // 上傳經 bundler 打包成 ANS-104 data item 送上 Arweave:
  //   irys  — 主要。以 Ethereum 私鑰簽名,費用從該地址在 IRYS_NODE 上的
  //           預存餘額扣(需先用主網 ETH fund)。IRYS_PRIVATE_KEY 未設時沿用
  //           TURBO_PRIVATE_KEY。⚠ Irys 公告舊版 Arweave 端點 2026-11-01 退役。
  //   turbo — 備援。<100KiB 免費,大檔需在 turbo.ar.io 儲值 Turbo Credits。
  // 主要 bundler 上傳失敗會自動改走另一個。
  ARWEAVE_BUNDLER: z.enum(["irys", "turbo"]).default("irys"),
  IRYS_NODE: z.string().url().default("https://node1.irys.xyz"),
  IRYS_PRIVATE_KEY: z.string().optional(),
  // Irys 查餘額 / fund 用的以太坊主網 RPC;未設用 SDK 內建預設。
  IRYS_PROVIDER_URL: z.string().url().optional(),
  TURBO_PRIVATE_KEY: z.string().optional(),
  ARWEAVE_GATEWAY: z.string().url().default("https://arweave.net"),
  COMPUTE_URL: z.string().url().optional(),
  IPFS_GATEWAY: z.string().url().default("https://gateway.pinata.cloud/ipfs/"),
  TRAINER_API_KEY: z.string().optional(),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Cloud-mode persona providers (optional). When set, the /cloud-* endpoints
  // can answer chat / voice / portrait without needing the offline training
  // pipeline + on-chain artifactURI.
  // Chat: Anthropic preferred when both keys present (more reliable, cheaper),
  // falls back to OpenAI. Voice/image still need OPENAI_API_KEY.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_CHAT_MODEL: z.string().default("claude-sonnet-4-6"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_CHAT_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_TTS_MODEL: z.string().default("tts-1"),
  OPENAI_TTS_VOICE: z.string().default("shimmer"),
  OPENAI_STT_MODEL: z.string().default("whisper-1"),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),

  // fal.ai — diffusion + video providers (Kling / Hailuo / Veo / FLUX). Used
  // when set as alternative to / fallback for OpenAI image gen, and as the
  // primary path for short-video generation (`/cloud-video`).
  FAL_API_KEY: z.string().optional(),
  FAL_IMAGE_MODEL: z.string().default("fal-ai/flux/schnell"),
  FAL_VIDEO_MODEL: z.string().default("fal-ai/kling-video/v1.6/standard/text-to-video"),

  // Simli — realtime lip-synced talking-head avatar. When SIMLI_API_KEY is set,
  // the frontend can request a per-session compose token and render a live
  // avatar in the chat view. The face ID is the Simli avatar identifier
  // (created via dashboard or POST /faces/trinity); falls back to Simli's
  // public preset face "Tina" so the integration works out-of-the-box during
  // dev and whenever a tablet has no personal faceId yet.
  SIMLI_API_KEY: z.string().optional(),
  SIMLI_DEFAULT_FACE_ID: z.string().default("cace3ef7-a4c4-425d-a8cf-a5358eb0c427"),
  SIMLI_MAX_SESSION_SECONDS: z.coerce.number().int().positive().default(600),
  SIMLI_MAX_IDLE_SECONDS: z.coerce.number().int().positive().default(180),

  // ── 本地測試模式(/admin 頁可切換)──────────────────────────────
  // ADMIN_PASSWORD:admin 頁單密碼。沒設則 admin API 整組回 503。
  ADMIN_PASSWORD: z.string().optional(),
  // 本地鏈(anvil)profile;chain mode 切到 "local" 時使用。
  // LOCAL_CONTRACT_ADDRESS 預設值 = 全新 anvil 用內建帳戶 0 部署第一筆
  // 交易的決定性地址(CREATE address 由部署者+nonce 決定)。
  LOCAL_RPC_URL: z.string().url().default("http://anvil:8545"),
  LOCAL_CHAIN_ID: z.coerce.number().int().positive().default(31337),
  LOCAL_CONTRACT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .default("0x5FbDB2315678afecb367f032d93F642f64180aa3"),
  // storage mode "local" 時檔案落地目錄(容器內路徑,掛 named volume)
  LOCAL_UPLOAD_DIR: z.string().default("/data/local-uploads"),
  // 組本地檔案對外 URI 用的 origin(瀏覽器要打得到)
  PUBLIC_BACKEND_ORIGIN: z.string().url().default("http://localhost:14000"),

  // Self-hosted LAM render machine (YMID-RENDER-API). Reached over Tailscale.
  // Handles LLM + voice clone (IndexTTS2) + audio2expression (LAM A2E) +
  // head-pose (ARTalk) + 3DGS avatar build. When RENDER_BASE is set the
  // frontend talks to it directly over WebSocket for chat; the backend only
  // mints the short-lived HS256 token (RENDER_JWT_SECRET, shared with the
  // render machine) and proxies the one-time avatar/voice asset builds.
  RENDER_BASE: z.string().url().optional(), // e.g. http://100.122.149.34:8012
  RENDER_JWT_SECRET: z.string().optional(), // shared secret with render machine
  RENDER_JWT_AUDIENCE: z.string().default("ymid-render"),
  RENDER_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(1800),

  // ── 線上公祭即時通道 (lib/livekit.ts) ─────────────────────────────
  // ws      — 自建 WebSocket hub (ceremony-hub.ts):在線人數、儀式、化身走動、聊天氣泡
  // livekit — LiveKit 房間:同樣的即時事件改走 data channel,另外支援多人語音
  // 未設時:LiveKit 金鑰齊全 → livekit,否則 ws。LiveKit 連不上時前端會自動退回 ws。
  CEREMONY_TRANSPORT: z.preprocess(emptyToUndefined, z.enum(["ws", "livekit"]).optional()),
  // 瀏覽器連線用的 URL,例:ws://localhost:7880(docker 內建 dev server)或 wss://xxx.livekit.cloud
  LIVEKIT_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  // 後端呼叫 LiveKit server API 用的位址;未設則由 LIVEKIT_URL 換成 http(s)
  LIVEKIT_HOST_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  LIVEKIT_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  LIVEKIT_API_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  LIVEKIT_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(7200),
});

/** docker env_file 會把 `KEY=` 傳成空字串;視同未設定。 */
function emptyToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/**
 * 第一次呼叫時讀取並驗證 process.env,後續呼叫直接回傳快取結果。
 * 驗證失敗會 throw,把所有缺失欄位列在錯誤訊息裡。
 */
export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const env: Env = loadEnv();
