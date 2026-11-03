# POC-02-R002／T06晚加入與音畫同步

**桌面合成來源的核心流程可行。** 最終短流程通過；完整POC-02與裝置品質仍Inconclusive。沒有以幾個軟體樣本宣告原150ms／p95品質門檻通過，也沒有把先前手機／真mic／真人待測改成已驗。

## 如何使用

1. 使用Node26.13.0，`npm run build`、`npm start`，開啟 http://127.0.0.1:4173 ，各頁填名稱並 Join room。跨裝置另依README的可信HTTPS指南。
2. 在**同一發布頁**分別按「開始麥克風」及「開始分享畫面」，授權／選擇測試來源。原生分享需要發布頁在前景。
3. 另一頁可在影音已播放後加入，按「開始收聽」與「開始觀看分享」。音訊需點擊手勢；畫面取得目前設定、等待新關鍵影格後顯示。
4. 同一發布者的音訊與畫面會顯示「同發布者音訊播放時鐘」。沒有可用音訊、已停音訊或不同發布者，會回到獨立畫面模式，不能據此宣稱跨來源同步。
5. 按「更換分享來源」會停止舊畫面、清空並選新來源，可能短暫空白；取消選擇不保留舊分享。音訊持續。也可停止觀看後再加入正在進行的分享。
6. 影音播放時按「下載畫面觀測」，保存schema2的世代、時鐘、播放／呈現計數、排程差與實際緩衝。排程差不是人耳／人眼偏移。

真mic／真人手動收聽尚未由本run驗證。自動流程需先啟動可信HTTPS/WSS服務，再執行 `node scripts/t06-smoke.mjs`（Node26.13、certutil）。來源僅在測試腳本內注入，不是產品假分享入口。

## 實際執行

2026-11-04 00:13:35～00:13:56（Asia/Taipei；JSON為UTC），Node26.13.0、npm11.20.0、macOS27.2 arm64、Playwright1.64.1／Firefox157；一個本機Fastify應用、三個獨立Firefox程序。只有測試profile匯入本機CA，正常驗證HTTPS/WSS，無忽略憑證／系統信任或HOME調整。沒有真實裝置、手機或CloudRun。

測試以AudioContext oscillator→MediaStreamDestination及色碼canvas，經真正Opus/VP8編碼、同一WSS relay、原生解碼與AudioWorklet/canvas輸出。來源共用音訊context的脈衝週期，來源擷取／時鐘映射誤差未校準。

| 核心操作 | 實際結果 |
|---|---|
| 播放中晚加入B | 取得generation1與相同publisher clockId；1280×720解碼呈現，audio-master，快照17個render frame、10.89fps短窗口 |
| 聲光標記 | 同一接收端3個完整色碼週期，raw graph/render偏移64.77、151.71、129.35ms；映射誤差上限null |
| 更換來源 | generation1→2，1280×720→640×360；舊畫面清空，新設定重建；audio持續，快照14.42fps |
| 退訂再觀看 | 取得目前generation2、新keyframe，640×360／audio-master；audio持續 |
| 分享停止／再開 | 先清空且audio持續；再開generation3、480×270 |
| 停止音訊 | 畫面render4→7，轉standalone；沒有延用已失效音訊時鐘 |
| 真正按下載 | schema2 JSON已保存；當時audio-master、5個pulse事件、待呈現5幀／最大16幀 |

fps是短窗口本機render觀測，不是完整穩態／品質門檻。聲光事件由播放worklet實際PCM RMS窗口與接收canvas像素轉換配對，使用同接收端performance時基；不是比較兩個送出的timestamp冒充實測。實際audio窗口21.33ms，marker RAF最大間隔50.08ms；這些是取樣條件，**不是誤差上限**。其中一筆151.71ms高於原150ms參考值，沒有據此通過品質驗收。端到端延遲、硬體喇叭／螢幕／真人與跨裝置校準均未知。

## 檔案、修正與界線

- `sync-evidence.json`、`observations/receiver-b-screen.json`：最終原始流程、共同marker、下載原檔。`receiver-b-*.png`為真實解碼畫面的代表圖；已實際開啟來源更換截圖查看。
- `checks.json`與log：23核心案例通過；client緩衝窄修後重新production build/typecheck及短browser流程通過，零page/socket errors。歷史t05-smoke只更新schema/metadata斷言並做語法檢查，沒有重跑舊整段流程。
- `first-attempt/`、`second-attempt/`、`third-attempt/`保存失敗、診斷與相應來源hash；`review.md`記根因判斷界線；`buffer-budget-diagnostic.json`是policy模型，**不是**瀏覽器效能證據。
- 修正包括：保留有界32筆播放時鐘樣本、避免未來樣本遮蔽已到時樣本；已解碼影格16幀保留配合500ms PCM及輸出時鐘等待；原生decoder最多8筆待處理，避免keyframe初始化burst被2筆門檻退訂。超限仍清理，不無限緩衝。
- VP8/Opus固定配置，解析度/世代更新已驗；其他codec動態切換、Recorder/MSE比較未做。可解碼起點由新keyframe取得，不保存媒體歷史；時鐘與世代只在目前程序/連線內有意義，client/server須使用配套版本。
- 本run未重測原生Chrome chooser；T05的原生分頁擷取證據保留其當時版本範圍。沒有容量、長測、弱網／重連或正式權限／耐久資料驗證。

JSON與source hash已讀回；程式、README、SOL-002/008、執行及協作紀錄同步。服務與三個Firefox均finally停止，writer已交接釋出。程式與驗測一起本機commit，不push、不啟動T07。
