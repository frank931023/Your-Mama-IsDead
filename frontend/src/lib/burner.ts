/**
 * Burner 測試錢包 — 免安裝擴充的拋棄式開發錢包
 *
 * 在 localStorage 產生並保存一把真實私鑰(viem local account),包成
 * wagmi v2 connector。簽名是真簽名:SIWE 登入、useSignMessage、
 * useWriteContract 全走標準 EIP-1193 路徑,後端完全無感。
 *
 * 限制:錢包沒有 gas。要實際送交易(mint / setTokenURI)得先把地址
 * 拿去 Sepolia faucet 領一點 ETH;純簽名(SIWE)與讀取則零門檻。
 *
 * 觸發方式:導覽列燭焰 logo 連點 5 下(見 SiteChrome.tsx)。
 * 私鑰只存在瀏覽器 localStorage,清掉即銷毀;正式環境請勿放真資產。
 */
import { createConnector } from "wagmi";
import {
  createWalletClient,
  http,
  numberToHex,
  SwitchChainError,
  type Chain,
  type Hex,
} from "viem";
import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";

const PK_STORAGE_KEY = "aeterlux.burner.pk";
const CONNECTED_FLAG_KEY = "aeterlux.burner.connected";

export const BURNER_CONNECTOR_ID = "aeterluxBurner";

/** 取出(或首次產生)burner 私鑰對應的帳戶。僅能在瀏覽器呼叫。 */
export function getOrCreateBurnerAccount(): PrivateKeyAccount {
  let pk = window.localStorage.getItem(PK_STORAGE_KEY) as Hex | null;
  if (!pk) {
    pk = generatePrivateKey();
    window.localStorage.setItem(PK_STORAGE_KEY, pk);
  }
  return privateKeyToAccount(pk);
}

/** 重新整理後是否應自動接回 burner(上次以 burner 連線且未主動斷開) */
export function shouldReconnectBurner(): boolean {
  return (
    typeof window !== "undefined" &&
    window.localStorage.getItem(CONNECTED_FLAG_KEY) === "1" &&
    Boolean(window.localStorage.getItem(PK_STORAGE_KEY))
  );
}

type BurnerProvider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
};

export function burnerConnector() {
  return createConnector<BurnerProvider>((config) => {
    let currentChainId: number = config.chains[0].id;

    const findChain = (id: number): Chain | undefined =>
      config.chains.find((c) => c.id === id);

    const provider: BurnerProvider = {
      async request({ method, params }) {
        const account = getOrCreateBurnerAccount();
        const chain = findChain(currentChainId) ?? config.chains[0];
        const p = (params ?? []) as any[];

        switch (method) {
          case "eth_accounts":
          case "eth_requestAccounts":
            return [account.address];

          case "eth_chainId":
            return numberToHex(currentChainId);

          // SIWE / useSignMessage:params = [hexMessage, address]
          case "personal_sign":
            return account.signMessage({ message: { raw: p[0] as Hex } });

          case "eth_signTypedData_v4":
            return account.signTypedData(JSON.parse(p[1] as string));

          // useWriteContract / sendTransaction:本地簽名後直接廣播
          case "eth_sendTransaction": {
            const tx = p[0] as {
              to?: Hex;
              data?: Hex;
              value?: Hex;
              gas?: Hex;
            };
            const client = createWalletClient({
              account,
              chain,
              transport: http(),
            });
            return client.sendTransaction({
              to: tx.to,
              data: tx.data,
              value: tx.value ? BigInt(tx.value) : undefined,
              gas: tx.gas ? BigInt(tx.gas) : undefined,
            });
          }

          case "wallet_switchEthereumChain": {
            const id = Number((p[0] as { chainId: Hex }).chainId);
            if (!findChain(id)) throw new SwitchChainError(new Error(`unsupported chain ${id}`));
            currentChainId = id;
            config.emitter.emit("change", { chainId: id });
            return null;
          }

          // 其餘讀取類 RPC(eth_call / estimateGas / getBalance…)轉發公共節點
          default: {
            const transport = http(chain.rpcUrls.default.http[0])({ chain });
            return transport.request({ method, params } as any);
          }
        }
      },
    };

    return {
      id: BURNER_CONNECTOR_ID,
      name: "測試錢包 (Burner)",
      type: "burner" as const,

      async connect(
        {
          chainId,
          withCapabilities,
        }: { chainId?: number; isReconnecting?: boolean; withCapabilities?: boolean } = {},
      ) {
        const account = getOrCreateBurnerAccount();
        if (chainId && findChain(chainId)) currentChainId = chainId;
        window.localStorage.setItem(CONNECTED_FLAG_KEY, "1");
        // wagmi 新版可能以 withCapabilities 要求帶 capabilities 的帳戶格式
        const accounts = (withCapabilities
          ? [{ address: account.address, capabilities: {} }]
          : [account.address]) as any;
        return { accounts, chainId: currentChainId };
      },

      async disconnect() {
        // 只清「已連線」旗標,私鑰保留 — 地址在多次測試間保持穩定,
        // faucet 領過的 gas 不會浪費。要銷毀請清 localStorage。
        window.localStorage.removeItem(CONNECTED_FLAG_KEY);
      },

      async getAccounts() {
        return [getOrCreateBurnerAccount().address] as const;
      },

      async getChainId() {
        return currentChainId;
      },

      async isAuthorized() {
        return shouldReconnectBurner();
      },

      async switchChain({ chainId }: { chainId: number }) {
        const chain = findChain(chainId);
        if (!chain) throw new SwitchChainError(new Error(`unsupported chain ${chainId}`));
        currentChainId = chainId;
        config.emitter.emit("change", { chainId });
        return chain;
      },

      onAccountsChanged() {},
      onChainChanged() {},
      async onDisconnect() {
        config.emitter.emit("disconnect");
      },

      async getProvider() {
        return provider;
      },
    };
  });
}
