# 追悼頁動態背景影片(可選)

把循環背景影片放在這個資料夾,然後在 `frontend/src/lib/memorial-themes.ts`
對應主題加 `heroVideo` 欄位即可,例如:

```ts
{
  id: "garden",
  label: "花園",
  heroVideo: "/memorial-bg/sakura.mp4",  // ← 指向這裡的檔案
  ...
}
```

需求:
- 格式 mp4(H.264),建議 1920x1080 以內、檔案 < 5MB、可無縫循環。
- 沒放影片也沒關係 —— 主題會 fallback 到 `heroBg` 漸層 + Canvas 動態粒子層
  (櫻花 / 燭光 / 星 / 雪 / 落葉),那層完全不需要任何素材。
