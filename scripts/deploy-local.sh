#!/usr/bin/env bash
# 把 DigitalTablet 部署到本地 anvil 鏈(docker compose 的 anvil 服務)。
#
# 冪等:先用 cast 檢查預期地址上有沒有 code,已部署就跳過。
# 預期地址 0x5FbDB2...aa3 = anvil 內建帳戶 0 的第一筆 CREATE(nonce 0)。
# 若 anvil 狀態不是全新(nonce 已前進),會部署到新地址並印出 —
# 記得把它更新到 .env 的 LOCAL_CONTRACT_ADDRESS;或 docker compose
# down -v 清掉 anvil-data 重來,地址就會回到預設值。
#
# 用法:  ./scripts/deploy-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# anvil 內建帳戶 0 的私鑰(公開的通用測試鑰,非機密)
DEPLOYER_PK="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
EXPECTED_ADDR="${LOCAL_CONTRACT_ADDRESS:-0x5FbDB2315678afecb367f032d93F642f64180aa3}"
NETWORK="${COMPOSE_NETWORK:-your-mama-isdead_default}"
FOUNDRY_IMAGE="ghcr.io/foundry-rs/foundry:latest"

echo "==> 檢查 anvil 是否在跑"
docker compose ps anvil --format '{{.Status}}' | grep -q "Up" || {
  echo "anvil 沒在跑,先啟動:docker compose up -d anvil"
  exit 1
}

echo "==> 檢查 $EXPECTED_ADDR 是否已有合約"
CODE=$(docker run --rm --network "$NETWORK" --entrypoint cast "$FOUNDRY_IMAGE" \
  code "$EXPECTED_ADDR" --rpc-url http://anvil:8545)
if [ "$CODE" != "0x" ] && [ -n "$CODE" ]; then
  echo "已部署,跳過。LOCAL_CONTRACT_ADDRESS=$EXPECTED_ADDR"
  exit 0
fi

echo "==> forge script 部署 DigitalTablet 到 anvil"
docker run --rm --network "$NETWORK" \
  -v "$PWD/contracts:/contracts" -w /contracts \
  -e DEPLOYER_PRIVATE_KEY="$DEPLOYER_PK" \
  -e FOUNDRY_DISABLE_NIGHTLY_WARNING=1 \
  --entrypoint forge "$FOUNDRY_IMAGE" \
  script script/Deploy.s.sol:Deploy --rpc-url http://anvil:8545 --broadcast

echo "==> 驗證部署結果"
CODE=$(docker run --rm --network "$NETWORK" --entrypoint cast "$FOUNDRY_IMAGE" \
  code "$EXPECTED_ADDR" --rpc-url http://anvil:8545)
if [ "$CODE" != "0x" ] && [ -n "$CODE" ]; then
  echo "✓ DigitalTablet 部署完成:$EXPECTED_ADDR(與 .env 預設一致,不用改設定)"
else
  echo "⚠ 合約沒有出現在預期地址 $EXPECTED_ADDR。"
  echo "  anvil 狀態不是全新(deployer nonce 已前進)。從上方 forge 輸出找"
  echo "  'DigitalTablet deployed at:' 的地址,填進 .env 的 LOCAL_CONTRACT_ADDRESS,"
  echo "  或 docker compose down -v 清掉鏈狀態後重跑本腳本。"
  exit 1
fi
