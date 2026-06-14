# 追悼頁背景素材

主題背景圖 / 動圖,由 `frontend/src/lib/memorial-themes.ts` 的 `heroImage`
欄位引用,渲染在追悼頁 (MemorialScroll) 的 hero banner。

優先序:`heroVideo` (mp4) > `heroImage` (jpg/gif) > `heroBg` CSS 漸層。
想換素材:放新檔進這個資料夾,改對應主題的 `heroImage` 路徑即可。

## 目前素材來源 (皆取自 Wikimedia Commons 自由授權檔案)

| 檔案 | 主題 | 來源 (Wikimedia Commons) |
|---|---|---|
| paper.jpg | 宣紙 | File:Old paper1.jpg |
| candlelight.gif | 燭光 | File:Animation candle flame.gif |
| lotus.jpg | 蓮池 | File:Lotus flower (978659).jpg |
| night-sky.jpg | 星夜 | File:ESO - Milky Way.jpg |
| autumn.jpg | 秋楓 | File:Autumn-red-maple-leaves-lake-reflection - West Virginia - ForestWander.jpg |
| ocean.gif | 海洋 | File:Waves at the Fox Island boat launch animated.gif |
| garden.jpg | 花園 | File:Flower field of Hama-rikyū Garden 2.jpg |
| ink-wash.jpg | 水墨 | File:早春图轴.北宋.郭熙绘 (台北故宮博物院藏,公有領域) |

授權細節見各檔案的 Commons 頁面 (`https://commons.wikimedia.org/wiki/<來源檔名>`)。
正式上線前若要商用,請逐一確認授權條款 (多為 CC BY / CC BY-SA / Public Domain,
CC BY 系列需標註作者)。

## 影片背景 (可選)

格式 mp4 (H.264),建議 1920x1080 以內、檔案 < 5MB、可無縫循環,
放進來後在對應主題加 `heroVideo: "/memorial-bg/xxx.mp4"`。
