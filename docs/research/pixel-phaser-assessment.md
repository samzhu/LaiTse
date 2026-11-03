# TECH-002：自研、像素人物與 Phaser 查核

- 查核日期：2026-11-02（Asia/Taipei）。
- 需求決策：[決策紀錄](../collaboration/decisions.md) 的 DEC-001、DEC-002。
- 其他框架／服務：[維護與授權比較](framework-maintenance-licenses.md)。
- 狀態：官方來源研究；未安裝、未做角色資產或執行相容性測試。

## 1. 已確定的產品界線

來坐自行開發，不採用／fork／客製 WorkAdventure 作為基底。使用成熟框架與 SDK 仍在評估中，並未要求自行重寫渲染器、網路協定或影音底層。

人物以像素圖呈現；這項決策不自動擴張為整個網站 UI、場景、字體都採像素風。人物尺寸、方向數、行走幀數、換裝與色盤尚未決定。[Sprite Fusion Pixel Snapper](https://github.com/Hugo-Dz/spritefusion-pixel-snapper) 為人類指定的研究參考，並非已指定必須將該工具嵌入產品。

## 2. Phaser 是否活躍、開源且可商用？

**是。依本輪查到的官方證據，Phaser 有近期實質維護、MIT 授權，允許商業產品使用。**

| 問題 | 查核結果 | 官方證據 |
|---|---|---|
| 是否仍維護 | repo 未封存；查到穩定版 v4.2.1，2026-07-09 發布，包含渲染、ESM、縮放與 tween 修正 | [Release](https://github.com/phaserjs/phaser/releases/tag/v4.2.1)、[GitHub metadata API](https://api.github.com/repos/phaserjs/phaser) |
| 是否有後續開發 | default branch 的 2026-08-21 人類提交包括 TintModes 功能及 4.3 changelog 準備；不把它當作 4.3 已正式發布 | [功能提交](https://github.com/phaserjs/phaser/commit/b1987e7fe0c93841f62021a4cb2fbb4b912bfb7d)、[changelog 提交](https://github.com/phaserjs/phaser/commit/02d8931b626d9764c133cbb3fbf99966c03c757c) |
| 是否開源 | 核心 framework 是 MIT | [LICENSE](https://github.com/phaserjs/phaser/blob/master/LICENSE.md) |
| 是否可商用 | 官方明確允許商業專案使用，不需向 Phaser 支付框架授權費或另請許可 | [官方授權說明](https://phaser.io/download/license) |
| 是否必須公開來坐原始碼 | MIT 未要求產品開源；分發包含框架程式的副本或實質部分時，須保留原著作權與許可聲明 | [MIT 全文](https://raw.githubusercontent.com/phaserjs/phaser/master/LICENSE.md) |

活躍是依 release 及實質開發作出的判斷，不是 SLA 或未來維護保證；距查核日最近的上述證據約兩個多月。GitHub 查到 `pushed_at` 不作為獨立維護證明。

**版本修正：**前一輪引用的 React 模板包含 Phaser 3 歷史內容；本輪官方穩定 release 已到 Phaser 4。後續驗證應先用選定 Phaser 4 穩定版及相容模板，不混用 3／4 範例，也不因版本較新就假設所有外掛可直接沿用。精確依賴版本尚未定案。

**產品區別：**本結論針對 Phaser 開源框架。Phaser 網站的編輯器、Phaser AE、雲端或素材服務須另看其條款；不能把「MIT framework」延伸成整個供應商的所有產品都免費或開源。

## 3. Pixel Snapper 的正確用途

官方 README 將它定位為修整像素格線與量化色盤的工具，支援原生 CLI、批次處理與 WASM；不是人物生成器、動畫編輯器或多人場景引擎。[README](https://github.com/Hugo-Dz/spritefusion-pixel-snapper#readme)

| 問題 | 查核結果 |
|---|---|
| 開源／商用 | repo 為 MIT，允許商用與修改；重用程式須保留聲明。這不授予任意輸入圖片、美術或 Sprite Fusion 其他服務的權利。[LICENSE](https://github.com/Hugo-Dz/spritefusion-pixel-snapper/blob/main/LICENSE) |
| 維護活動 | 未封存；2026-07-16 合併 CLI 功能，改到 `src/lib.rs` 與 `src/main.rs`；2026-10-20 最近提交是 README 更新，應區分文件活動與功能開發。[CLI 合併](https://github.com/Hugo-Dz/spritefusion-pixel-snapper/commit/5743009265051098831ad7298092072325d1149b)、[README 提交](https://github.com/Hugo-Dz/spritefusion-pixel-snapper/commit/02f9315d73d3219274d17767b36d9a231a6b1f4b) |
| 發布成熟度 | GitHub releases API 本輪回傳空清單；Cargo manifest 是 1.0.0，不能把 manifest 版本當已驗證的正式發版節奏。[Releases API](https://api.github.com/repos/Hugo-Dz/spritefusion-pixel-snapper/releases)、[Cargo.toml](https://github.com/Hugo-Dz/spritefusion-pixel-snapper/blob/main/Cargo.toml) |
| 可做什麼 | 輸入圖片，校正格線、指定 pixel size 與色盤，輸出 PNG；可批次處理。[README](https://github.com/Hugo-Dz/spritefusion-pixel-snapper#readme) |
| 不足以證明什麼 | 沒有證據顯示能自動產生一致的行走方向、對齊每一幀腳底／中心點，或修正跨幀角色造型；這些須另驗資產品質 |

依此建議（尚未採用）：把它放在**離線美術製作流程**，產出 PNG／sprite sheet 後再交給 Phaser；不需要讓每位使用者在執行時載入 Rust／WASM 圖片處理工具，也不代表來坐後端需採 Rust。

候選資產流程：確定人物規格 → 繪製／產生有使用權的原稿 → 必要時用 Pixel Snapper 整理格線與固定色盤 → 人工檢查透明背景、方向及跨幀一致性 → 輸出角色動畫資產 → Phaser 顯示與移動。

這份 repo 是小型專用工具，有近期維護跡象；目前證據不足以把它與 Phaser、Colyseus 視為同等成熟的產品執行期依賴。離線工具若品質不合，可以替換而不影響產品網路架構。

## 4. 對選型的影響

人物已確定像素圖，**Phaser 仍值得保留為首要場景候選**，但這是工程建議，不是人類已選定 Phaser。Colyseus 的授權與活躍度另見比較報告；多人框架仍需驗證鎖房、切房、重連與權限，不因 MIT 便假設已符合驗收。

後續 DEC-003 已要求核心功能可獨立部署，不強制依賴商用託管影音或其他供應商 SaaS。開源框架自架仍可評估；開源核心、自架能力、Cloud 服務費與產品程式是否開源應分開判斷。

## 5. 查核方式與限制

使用官方 GitHub repo／REST API 的 metadata、releases、commits、LICENSE，以及 Phaser 官方授權頁；API 成功讀取後，額外請求遇 unauthenticated rate limit，故未繼續重試，改用官方 release、commit 與 raw 檔案核對可讀內容。未將頁面的搜尋抓取日期當提交日期。

商用說明針對查核到的本體授權，不涵蓋尚未選入的外掛、圖片、字型及所有轉依賴。正式落地時應在 lockfile 與資產清冊上核對實際版本；本輪未執行完整依賴授權掃描、安裝或展示。
