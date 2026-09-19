/**
 * Irys 帳戶工具(Arweave 上傳付款用)
 *
 *   npx tsx scripts/irys-account.ts              顯示付款地址、Irys 預存餘額、常見大小的上傳報價
 *   npx tsx scripts/irys-account.ts fund 0.002   從付款地址轉 0.002 ETH(主網)到 Irys 預存餘額
 *
 * 付款地址 = IRYS_PRIVATE_KEY(未設則 TURBO_PRIVATE_KEY)對應的以太坊地址,需先持有主網 ETH。
 * fund 會送出一筆以太坊主網交易,送出後無法撤回。
 */
import Irys from "@irys/sdk";
import { env } from "../src/lib/env.js";

const key = env.IRYS_PRIVATE_KEY || env.TURBO_PRIVATE_KEY;
if (!key) {
  console.error("未設定 IRYS_PRIVATE_KEY / TURBO_PRIVATE_KEY");
  process.exit(1);
}

const irys = new Irys({
  url: env.IRYS_NODE,
  token: "ethereum",
  key,
  ...(env.IRYS_PROVIDER_URL ? { config: { providerUrl: env.IRYS_PROVIDER_URL } } : {}),
});
await irys.ready();

const fmt = (atomic: Parameters<typeof irys.utils.fromAtomic>[0]) =>
  `${irys.utils.fromAtomic(atomic).toString()} ETH`;

const [cmd, amount] = process.argv.slice(2);
if (cmd === "fund") {
  const eth = Number(amount);
  if (!Number.isFinite(eth) || eth <= 0) {
    console.error("用法:npx tsx scripts/irys-account.ts fund <ETH 數量>");
    process.exit(1);
  }
  console.log(`從 ${irys.address} 轉 ${eth} ETH(主網)到 Irys 節點 ${env.IRYS_NODE} …`);
  const res = await irys.fund(irys.utils.toAtomic(eth));
  console.log(`完成:交易 ${res.id},預存增加 ${fmt(res.quantity)}`);
} else if (cmd) {
  console.error(`未知指令:${cmd}`);
  process.exit(1);
}

console.log(`付款地址:${irys.address}`);
console.log(`Irys 節點:${env.IRYS_NODE}`);
console.log(`預存餘額:${fmt(await irys.getLoadedBalance())}`);
const sizes: Array<[string, number]> = [
  ["100 KB", 100 * 1024],
  ["1 MB", 1024 ** 2],
  ["10 MB", 10 * 1024 ** 2],
  ["100 MB", 100 * 1024 ** 2],
];
for (const [label, bytes] of sizes) {
  console.log(`  上傳 ${label.padEnd(6)} ≈ ${fmt(await irys.getPrice(bytes))}`);
}
