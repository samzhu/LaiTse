# REPO-LAYOUT-01：隔離技術POC與MVP產品目錄

- 日期：2026-11-06；baseline `91b886d`；沿DEC-020人類「OK好 先整理一下 參考最佳實踐」。
- 範圍：目錄、npm入口與文件整理，不是MVP開發、不新增產品功能、服務或資料分類。
- 官方依據：[研究與引用](../../../research/poc-mvp-repository-layout.md)。npm workspaces提供既有nested package管理與package cwd；不新增Turborepo、第二個lockfile或空的共用套件。目錄名稱是本repo選擇，不是工具強制。

## 目錄與歷史路徑

| 原repo根路徑 | 新位置／語意 |
|---|---|
| src、public、tests、scripts、db | poc/下同名目錄；仍是技術實驗，不是產品 |
| index.html、vite.config.ts、tsconfig*.json | poc/；Vite前端與server輸出為poc/dist |
| compose.yaml、.env.example | poc/；Docker為POC本機資料庫 |
| 舊POC package.json | poc/package.json；root只協調workspace |
| package-lock.json | 保留repo根，單lock管理；不升既有依賴版本 |
| 根README長篇實驗指南 | docs/poc/legacy-local-poc-guide.md，保留原文加歷史前言 |
| docs/poc與既有evidence | 原位保留，舊run／原hash不重寫 |
| .tools、.cache、.scratch、node_modules | repo根本機工具與產物，不提交／不搬刪 |
| apps/web | MVP預留README，無package、src或產品程式 |
| docs/mvp | 只做既有PRD11／SOL表的索引，無第二份需求清冊 |

根npm指令維持操作POC，必須在README明確說明；MVP未被自動建置／啟動。新MVP會從已驗方案逐項採用，不讓產品import `poc/src` 私有模組，也不將合成來源／診斷控制直接搬入產品。

## 路徑與操作注意

POC檔案資產／source／build／DB migration應以POC package root解析；共用工具、scratch與lock應以repository root解析。`npm --workspace=poc`執行時cwd為poc，不能再假設所有process.cwd都等於repo根；直接node腳本也應定位正確，不能誤讀整理前留下的root dist。

不要移動或刪除個人.env、私有runtime、DB/volume與歷史憑證。根.env與poc/.env是不同檔案；正式啟動使用位置見poc/README，現有秘密檔不由搬移程式自動複製或曝光。舊scratch launcher中hardcode的root/dist路徑是當時工具，重用前需調整；本輪僅維護人工入口和隔離驗收launcher。

所有舊證據內的`src/...`等路徑保持當時語意，以本頁mapping找現行檔案，不更新原檔指紋。Git依內容偵測rename，沿新路徑用`git log --follow -- poc/src/server/app.ts`追查；移動不等於清除歷史。

## 驗收方法

1. 以Node26.13從root讀workspace、單lockfile安裝／建置／typecheck，確認新產物確實在poc/dist；原root dist不得作新驗收來源。
2. 從root npm test帶PG_TEST_DATABASE_URL串行跑原有核心與真PG，驗相對imports／migration及npm forwarding；秘密值不印出或保存進evidence。
3. 私有4175啟動poc/dist的新PG app，用3個隔離Chrome/Edge profiles短驗2路Opus decode/PCM與單VP8、逐來源停止；只做目錄變更需要的代表流程，不重跑全部歷史負載／真人／手機／雲。
4. 讀回manual4174 ready；只有0在線且確認自有PID才能換launcher到poc/dist。其餘browser/proxy/private server停止，PG和人工入口保留。
5. 核對原檔hash與新位置、Git rename detection、既有evidence未修改、單lockfile、MVP只有README、文件連結與秘密掃描。

驗收結果、失敗與修正、GitHub同步及資源狀態於本頁末補實際證據；上述方法不是預先宣稱已通過。

## 實際結果與保存讀回

Node26.13乾淨安裝成功（初次離線誤用預設cache失敗保留，改repo既有.cache/npm成功）、root workspace build/typecheck、PG全suite84/84且0skip、31腳本語法及純helper/library import不改cwd通過。從/private/tmp啟動三個隔離Chrome/Edge profiles，2路Opus PCM＋單VP8與逐源停止通過（19,644ms，觀測窗4,014ms）；79檔純搬移、30檔路徑調整，170registry lock entries及所有依賴exact版本不變。root修純TCP library不應chdir，app static root改依模組位置解析避免cwd。人工4174在0人後換poc/dist，PID62270／PGready／0人10席，原4173不碰；私有4175及測試profiles已停／清理。

[Build／typecheck](build.log)、[84真PG測試](full-tests.log)、[安裝成功](install-cache.log)、[初次缺cache紀錄](install.log)、[browser report](browser/report.json)、[搬移逐檔hash](move-readback.json)、[人工runtime](retained-runtime.json)。Log副本僅去行尾空白，原始private scratch保留。root已查看browser分享截圖，呈現合成綠色畫布，非真實螢幕擷取。

依賴盤點入口`npm run licenses`也由root實際執行，正確讀POC manifest與root lock，127個本機安裝registry套件（跨平台未安裝的lock entries不當作本機套件）。這是搬移路徑檢查，未重新評估框架成熟度或商用條款。

原repo根dist刻意保留作歷史本機產物，但驗收及保留人工服務都明確使用poc/dist；舊scratch啟動器多為歷史工具，未全面維護或重跑。沒有重跑所有舊smoke、真人／手機／CloudRun／品質長測；本輪不新增相關Pass，也不抹除FINAL01／CAP01的限制。

原始根README本文已逐字保存於封存指南；現行README與poc/README分開導航／操作，MVP docs只是PRD11／SOL索引。GitHub#1/#20只補說明與新路徑，原closed/reason/title/labels保留；[正文保存讀回](github-progress-readback.json)。程式與本紀錄同筆本機commit，沒有push、MVP開發或部署。

補充入口驗收：root `npm start`在獨立4176／memory／匿名fixture實際啟動，讀回health、rooms與built HTML（HTTP200），見[npm-start-readback](npm-start-readback.json)；隨後主動停止，4175/4176均確認不可連線。這項不替代PG測試或瀏覽器實際呈現證據。

Git staging讀回：109個預期搬移全被辨識為rename，見[rename明細](git-rename-readback.json)；原untracked AGENTS.md與scratch未納入。source指紋讀回一致，來源鏈可從新路徑追查，commit後再核對`git log --follow`。
