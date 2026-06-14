/**
 * 一次性 demo 腳本:用四張大頭照鑄造四座數位塔位(燈塔)。
 *
 * 流程(每個人):
 *   1. 上傳大頭照 → Pinata → portrait CID
 *   2. buildTabletMetadata 組 ERC-721 + DSAS metadata (生平/生卒/籍貫/墓誌銘/公開)
 *   3. pin metadata JSON → metadata CID
 *   4. mintRoot(to, ipfs://<metadata cid>) 上鏈 (deployer = MINTER_ROLE 簽)
 *   5. 等 receipt,從 Minted event / nextTokenId 取得 tokenId
 *
 * 鑄到 MINT_TO 地址(預設 = 現有傅聖祐持有者,讓四座新塔位同屬一家人)。
 * 用法:在 backend/ 目錄載入 .env 後 `node scripts/mint-demo-tablets.mjs`
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import FormData from "form-data";
import {
  createWalletClient,
  createPublicClient,
  http,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

// ── 設定 ──────────────────────────────────────────────────────────────────
const RPC_URL = process.env.RPC_URL;
const CONTRACT = getAddress(process.env.CONTRACT_ADDRESS);
const PINATA_JWT = process.env.PINATA_JWT;
const PK = (process.env.DEPLOYER_PRIVATE_KEY || "").startsWith("0x")
  ? process.env.DEPLOYER_PRIVATE_KEY
  : "0x" + process.env.DEPLOYER_PRIVATE_KEY;
const account = privateKeyToAccount(PK);
// 四座塔位的持有者(家人)。預設 = 現有傅聖祐的持有者。
const MINT_TO = getAddress(
  process.env.MINT_TO || "0xc042F4Db41024a7e3Cf9E0108D81dF074401E7a9",
);

const FACES_DIR = path.resolve("../competition_docx/_lighthouse_faces");

// ── 四位人物設定(虛構但合理,demo 用) ──────────────────────────────────────
const PEOPLE = [
  {
    face: "tl.jpg",
    name: "林懷恩",
    gender: "male",
    origin: "台灣・新竹",
    birth: { date: "1958-04-12", place: "新竹市" },
    death: { date: "2023-11-03", place: "台北市" },
    biography:
      "林懷恩教授一生鍾情於植物。1980 年畢業於台灣大學植物學系,赴美取得博士學位後返國任教三十餘年,專研台灣原生蕨類與山林生態,足跡踏遍中央山脈。他總說「每一片葉子都有它想說的故事」,課堂上以溫煦幽默著稱,學生暱稱他為「蕨類爺爺」。退休後仍每日清晨進實驗室照料標本,並義務帶領社區親子認識校園植物,直到生命最後一刻。他留下逾兩萬份親手採集的植物標本,捐贈予國家植物園。",
    epitaph: "願化作一株蕨,在你看不見的地方,繼續守護這片山林。",
  },
  {
    face: "tr.jpg",
    name: "高曉晴",
    gender: "female",
    origin: "台灣・台南",
    birth: { date: "1989-07-25", place: "台南市" },
    death: { date: "2024-02-18", place: "花蓮縣" },
    biography:
      "高曉晴是許多偏鄉孩子口中的「晴姐姐」。大學主修社會工作,畢業後沒有選擇都市的高薪,而是一頭栽進花東偏鄉的兒少陪伴計畫。她創辦課後陪讀據點,十年間陪伴超過三百名弱勢家庭的孩子長大,假日總帶著吉他與一籃水果出現在最需要的角落。她笑起來像陽光,總說「沒有一個孩子是應該被放棄的」。在一次風災後的救援行動中,她為了護送孩童撤離而不幸罹難,年僅三十四歲。",
    epitaph: "我把光留在你們眼裡了,記得替我,好好長大。",
  },
  {
    face: "bl.jpg",
    name: "陳之遠",
    gender: "male",
    origin: "台灣・台中",
    birth: { date: "1944-09-08", place: "台中市" },
    death: { date: "2022-06-30", place: "台中市" },
    biography:
      "陳之遠先生是一位以書為伴的長者。年輕時任職於市立圖書館,一做就是四十年,經手整理的古籍善本不計其數。退休後他將自家客廳改成社區書房,免費開放給左鄰右舍的孩子讀書,牆上掛著他親筆寫的「book 中自有日月長」。他記性極好,熟客只要報出書名,他便能說出那本書放在哪一層架上。晚年雖視力漸衰,仍堅持每天朗讀一段給來訪的孩子聽。他常說:「人會老,故事不會。」",
    epitaph: "書頁會泛黃,但被記住的人,永遠年輕。",
  },
  {
    face: "br.jpg",
    name: "蘇若蘭",
    gender: "female",
    origin: "台灣・高雄",
    birth: { date: "1991-12-03", place: "高雄市" },
    death: { date: "2024-05-09", place: "台北市" },
    biography:
      "蘇若蘭是一位以色彩說話的畫家。她畢業於藝術大學,作品多以家鄉港邊的光影為題,溫柔而靜謐。除了創作,她更熱衷於藝術療癒,長年在醫院的兒童病房帶領孩子畫畫,讓病榻上的童年也能擁有一片自由揮灑的天空。她相信「每個人心裡都住著一種顏色」,總能在最灰暗的地方,引導出一抹溫暖。她的畫筆停在三十二歲,但她陪伴過的孩子們,至今仍記得那位「會把眼淚畫成彩虹的姐姐」。",
    epitaph: "別難過,我只是去畫一片,更大的天空了。",
  },
];

// ── 合約 ABI(只取會用到的) ─────────────────────────────────────────────────
const ABI = [
  {
    type: "function",
    name: "mintRoot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "tokenURI_", type: "string" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "event",
    name: "Minted",
    inputs: [
      { name: "operator", type: "address", indexed: true },
      { name: "parentOwner", type: "address", indexed: false },
      { name: "parentId", type: "uint256", indexed: false },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
];

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

// ── 工具:上傳檔案 / pin JSON 到 Pinata ──────────────────────────────────────
async function pinFile(filePath, name) {
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath), { filename: name });
  form.append("pinataMetadata", JSON.stringify({ name, keyvalues: { app: "DSAS" } }));
  const res = await axios.post("https://api.pinata.cloud/pinning/pinFileToIPFS", form, {
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    headers: { ...form.getHeaders(), Authorization: `Bearer ${PINATA_JWT}` },
    timeout: 120_000,
  });
  return `ipfs://${res.data.IpfsHash}`;
}

async function pinJson(obj, name) {
  const res = await axios.post(
    "https://api.pinata.cloud/pinning/pinJSONToIPFS",
    { pinataContent: obj, pinataMetadata: { name, keyvalues: { app: "DSAS" } } },
    {
      timeout: 30_000,
      headers: { Authorization: `Bearer ${PINATA_JWT}`, "Content-Type": "application/json" },
    },
  );
  return `ipfs://${res.data.IpfsHash}`;
}

// ── 組 ERC-721 + DSAS metadata(對齊 metadata-builder.ts) ─────────────────────
function toUnix(iso) {
  return Math.floor(Date.parse(iso) / 1000);
}
function lifespan(b, d) {
  const bb = new Date(b), dd = new Date(d);
  let age = dd.getUTCFullYear() - bb.getUTCFullYear();
  const m = dd.getUTCMonth() - bb.getUTCMonth();
  if (m < 0 || (m === 0 && dd.getUTCDate() < bb.getUTCDate())) age -= 1;
  return age;
}
const GENDER = { male: "男", female: "女", other: "其他" };

function buildMetadata(p, portraitUri) {
  const deceased = {
    name: p.name,
    gender: p.gender,
    origin: p.origin,
    birth: p.birth,
    death: p.death,
    biography: p.biography,
    epitaph: p.epitaph,
  };
  const attributes = [
    { trait_type: "姓名", value: p.name },
    { trait_type: "性別", value: GENDER[p.gender] },
    { trait_type: "籍貫", value: p.origin },
    { trait_type: "出生日期", display_type: "date", value: toUnix(p.birth.date) },
    { trait_type: "逝世日期", display_type: "date", value: toUnix(p.death.date) },
    { trait_type: "享壽", value: lifespan(p.birth.date, p.death.date) },
    { trait_type: "世代", value: 0 },
  ];
  const description = `${p.birth.date.slice(0, 4)} 年生於${p.birth.place},${p.death.date.slice(0, 4)} 年逝於${p.death.place}。${p.biography}「${p.epitaph}」`;
  return {
    name: p.name,
    description,
    image: portraitUri,
    attributes,
    dsas: {
      version: "1.0",
      deceased,
      assets: { portrait: portraitUri, photos: [portraitUri] },
      public: true, // demo:直接公開,出現在公開哀悼版 / 燈塔總覽
      background: "paper",
    },
  };
}

// ── 主流程 ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`鑄造者(MINTER): ${account.address}`);
  console.log(`鑄到家人地址 : ${MINT_TO}`);
  console.log(`合約         : ${CONTRACT}\n`);

  const results = [];
  for (const p of PEOPLE) {
    console.log(`── ${p.name} ──`);
    const facePath = path.join(FACES_DIR, p.face);
    if (!fs.existsSync(facePath)) throw new Error(`找不到大頭照: ${facePath}`);

    process.stdout.write("  上傳大頭照… ");
    const portraitUri = await pinFile(facePath, `${p.name}-portrait.jpg`);
    console.log(portraitUri);

    process.stdout.write("  pin metadata… ");
    const metadata = buildMetadata(p, portraitUri);
    const metadataUri = await pinJson(metadata, `${p.name}-metadata.json`);
    console.log(metadataUri);

    process.stdout.write("  mintRoot 上鏈… ");
    const hash = await walletClient.writeContract({
      address: CONTRACT,
      abi: ABI,
      functionName: "mintRoot",
      args: [MINT_TO, metadataUri],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    // 從 Minted event 取 tokenId(topic[3] = indexed tokenId)
    let tokenId = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === CONTRACT.toLowerCase() && log.topics.length >= 4) {
        tokenId = BigInt(log.topics[3]).toString();
        break;
      }
    }
    console.log(`tx=${hash} tokenId=${tokenId}`);
    results.push({ name: p.name, tokenId, tx: hash, metadataUri });
    console.log("");
  }

  console.log("=== 完成 ===");
  for (const r of results) {
    console.log(`  #${r.tokenId}  ${r.name}  (${r.tx})`);
  }
  console.log("\n下一步:在前端按「掃描鏈上新鑄造」或重啟讓 backend sync,即可看到四座新燈塔。");
}

main().catch((e) => {
  console.error("鑄造失敗:", e?.shortMessage || e?.message || e);
  process.exit(1);
});
