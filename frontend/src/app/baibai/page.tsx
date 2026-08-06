import { redirect } from "next/navigation";

/**
 * /baibai(線上紀念館)已與 /registry(燈塔總覽)合併 —— 兩頁功能完全重複
 * (同樣列出公開塔位、同樣進 /memorial/[tokenId] 追悼頁)。
 * 保留此路由做永久轉址,舊連結與書籤不會斷。
 */
export default function BaiBaiRedirect(): never {
  redirect("/registry");
}
