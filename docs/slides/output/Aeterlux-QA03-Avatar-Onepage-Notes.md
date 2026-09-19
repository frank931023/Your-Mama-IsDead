# Aeterlux QA 03 — 單頁流程圖

- 圖片：`Aeterlux-QA03-Avatar-Onepage.png`
- 製作日期：2026-09-16
- 生成方式：內建 image_gen，非 PPTX。原五頁簡報保持原檔。
- 圖中人物與頭像均為生成的概念示意，非模型實測成果。
- 沿用 Chatterbox Multilingual V3 替換方向；目前所讀專案文件仍提及 IndexTTS2，因此標為規劃流程，未宣稱完成部署。

## 30 秒講稿

我們先把素材分成外觀、聲音與記憶。外觀部分，一張正面照交給 LAM，重建可驅動的 3D 高斯潑濺頭像，建立後可重用。對話時，先根據相關記憶產生回覆文字，再把文字和本人錄音參考交給 Chatterbox 合成聲音。同一段聲音交給 Audio2Expression 產生嘴型與表情，並用 ARTalk 取得頭部動作。瀏覽器最後把頭像、動作參數和聲音同步呈現，形成即時說話的數位分身。

## 技術用語與分工

- 正確名稱是「3D 高斯潑濺」（3D Gaussian Splatting, 3DGS），不是「高斯波件」。它以具有位置、形狀、顏色與透明度的高斯基元表示外觀，並不是另一個負責讀照片的模型。
- LAM 是照片重建模型，輸出可被驅動的 Gaussian head 資產。單張照片看不到的區域由模型推估，不代表精確還原。
- Chatterbox 接收新文字與音色參考，合成新音訊。每次回答仍要執行 TTS，不是首次建立時就算好所有聲音。
- LAM_Audio2Expression 接收音訊並產生表情係數；專案採 ARTalk 的頭部姿態，兩者分工為專案整合選擇。ARTalk 本身也具臉部動作能力，不能說它天生只能輸出頭動。
- 前端 WebGL 渲染器接收頭像與驅動參數，配合音訊播放時鐘同步；不是把音訊直接丟給 LAM 重建模型來生成影片。
- E5 處理向量，pgvector 儲存／檢索相關記憶，LLM 根據檢索內容產生回覆。記憶更新時需更新索引。

## 核對來源

1. [LAM 官方程式與單圖重建說明](https://github.com/aigc3d/LAM)
2. [LAM 論文](https://arxiv.org/html/2502.17796v2)
3. [LAM_Audio2Expression 官方說明](https://github.com/aigc3d/LAM_Audio2Expression)
4. [LAM_WebRender 官方渲染器](https://github.com/aigc3d/LAM_WebRender)
5. [Chatterbox 官方 README 與 Multilingual V3](https://github.com/resemble-ai/chatterbox)
6. [ARTalk 官方程式](https://github.com/xg-chu/ARTalk)

專案對照：`frontend/src/components/LamAvatar.tsx`、`frontend/src/lib/head-pose.ts`、`backend/src/lib/render.ts`、`docs/slides/output/Aeterlux-QA03-Avatar-Speaker-Notes.md`、工作區根目錄 `lam-avatar-self-host.md`。

## 最終生成提示詞

```text
Use case: infographic-diagram.
Create ONE finished landscape 16:9 presentation infographic as a high resolution raster image (ideally 3840x2160), entirely in accurate Traditional Chinese with English model names preserved. This is for AETERLUX 數位記憶燈塔, a respectful memorial AI avatar project, to answer judges asking how photos, voices and memories become a speaking avatar. Make a new infographic, not a slide mockup, no screen/desk border. It must be clean, immediately understandable, beautifully aligned, legible from a projector, and technically exact. Use generous empty space, no dense paragraphs, no tables, no equations, no paper screenshots. A subtle editorial technical style: warm ivory #F4F2EA background, burgundy #862C29 titles, forest green #426449 photo/model flow, terracotta #B06F51 audio flow, charcoal text, soft sage and peach rounded rectangular panels. Sharp readable Traditional Chinese sans serif and carefully drawn simple illustrations.

Header: top left AETERLUX, small subtitle 數位記憶燈塔. Top right small chip QA 03｜規劃流程.
Large main heading exact:「從素材到會說話的數位分身」
Smaller subtitle exact:「先建立外觀，再讓聲音帶動嘴型、表情與頭部動作。」

Diagram occupies most of page, 2 horizontal lanes with a shared final output panel at the far right. All arrows must be unambiguous, avoid crossings, no arrow connecting unrelated modules.

UPPER lane, green, labeled「① 建立外觀｜建立時」:
A framed portrait illustration of a kindly generic older East Asian woman, label「一張正面照」
→ box「LAM」 with small caption「單張照片重建」
→ an elegant head silhouette made from many small softly edged colored Gaussian ellipses, NOT luminous particles, label「可驅動的 3DGS 頭像」 and small caption「3D 高斯潑濺」.
Then route a green arrow right into the UPPER input of the far-right shared output panel, label on arrow「頭像資產」. LAM is the reconstruction model before the Gaussian head; do NOT put a second LAM model downstream that supposedly generates video from sound. The 3DGS head illustration and final avatar depict the SAME generic older woman.

LOWER lane, peach, labeled「② 生成聲音與動作｜每次對話」:
A compact input group with a text bubble and an audio reference file icon, labels「回覆文字」and「本人錄音」
→ box title「Chatterbox」 subtitle「Multilingual V3 · TTS」
→ waveform node label「合成語音」
→ driver box with TWO clearly separated stacked entries:
「Audio2Expression」 smaller caption「嘴型與表情」
「ARTalk」 smaller caption「頭部動作」
Both entries receive the SAME synthesized audio waveform input. They run as parallel branches, NOT in series. No need to draw an arrow between the entries.
Driver box → right arrow labeled「動作參數」 into the MIDDLE input of the far-right shared output panel.
Also a thin orange line BRANCHES DIRECTLY FROM the「合成語音」waveform, runs below the driver box, then right into the LOWER input of shared output panel. Label that bypass line「同步播放聲音」. This represents the actual audio being played with the animation; it does NOT come from the head asset or from the driver box.

SHARED far-right output panel, occupies upper and lower lane heights, around 20 percent page width. Its title「瀏覽器 WebGL」
A tasteful illustration of a browser window containing the same kindly older woman's speaking 3D portrait, gentle open mouth and subtle curved motion marks, no exaggerated movement, no neon, no grieving imagery.
Below portrait prominent label「即時說話分身」
Small caption「頭像 ＋ 動作參數 ＋ 聲音」
This panel receives the three separate inputs: avatar asset, expression/head pose parameters, audio playback. The output is real-time rendered animation, do NOT call it a pre-recorded or AI-generated video.

BOTTOM slim contextual strip, clearly readable but visually secondary:
「回覆文字怎麼來？」
「對話紀錄／核可回憶 → E5＋pgvector → RAG＋LLM → 回覆文字」
This strip describes memory indexing/retrieval and response generation feeding the lower lane's text input. It may simply be presented as this text sequence without an extra long connector.

Bottom fine print exact:「模型分工依官方文件整理；Chatterbox 為替換規劃，尚未完成整合驗證。」
Source footer, legible small type, exact:
「來源：github.com/aigc3d/LAM · github.com/aigc3d/LAM_Audio2Expression · github.com/resemble-ai/chatterbox · github.com/xg-chu/ARTalk」

Design requirements: total only ONE page. Consistent deliberate hierarchy, large generous model labels. Smooth orthogonal connectors with distinct arrowheads. Rounded panels have subtle thin outlines, not heavy shadows. Every label spelled accurately, no simplified Chinese, no extra invented text or numbers, no speed or FPS claims, no pretend benchmark or screenshots of working software. The Gaussian head and browser portrait are conceptual illustrations.
```

