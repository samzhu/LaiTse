# POC-04-R003：T14 慢速接收者隔離

2026-11-05；基線 ff672f0；本機 #15 輕量核心驗證。結論：**本輪核心可行，完整 T14／POC-04 品質驗收仍為 Inconclusive**。程式與紀錄同一本機 commit，不 push、不部署、不接 T15。

## 實作與結果

| 項目 | 證據／結果 |
|---|---|
| 每 socket 共用 send budget | control/audio/video 共用 1.5 MiB 檢查；pending callback 1,000 ms 候選 deadline，只關慢端 1013。5 個 deterministic seam 反例檢查通過，並非真 TCP 壓力 |
| 接收佇列 | 音訊 pending decode 8 時自關 4003；PCM 24,000 samples、拒絕巨大單 batch、graph residence 500 ms；decoded video 16、local residence 500 ms。4 個 VM/helper 契約通過 |
| build／核心 | Node 26.13.0 production build/typecheck、完整 63/63 通過；build.log、core-integration.log、checks.json |
| 三個真 Firefox 157 | 主講合成 Opus＋VP8、一健康／一慢接收者；最終完整短流程通過，desktop/slow-receiver-report.json |
| 健康端 | hold 期間 5 次採樣從 33,664→55,168 實播 samples、7→13 frames；feedback ACK 同時成功；慢端恢復後 3 次從 124,544→140,928、33→38 繼續增長；只有原 connection 1 |
| 慢端 | driver 暫存最高 17,171 bytes／33 messages，目標 oldest age 500 ms、實測 timer 501 ms 後丟棄；0 replay／0 retained payload。新 connection 2 先取權威狀態，再訂閱／新 metadata、keyframe 解碼；新 controller 0→39,744 samples／0→10 frames |
| server 觀測 | 恢復後 self inspect：pending callbacks 0、pending high water 5,827 bytes、raw ws high water 5,831 bytes。此正常流量未打到 server cap；壓力政策依獨立 seam 驗證 |
| root 驗收 | root-readback.json；已實看健康／恢復兩張 PNG；來源 fingerprint 與 build 相符，cleanup.json 記服務／自有 profiles 已停止 |

## 擾動與失敗紀錄

測試只在慢端 Playwright WebSocketRoute server→browser 應用層 hold，driver 自限 256 KiB／128 messages／500 ms，不重播舊資料。501 ms 是 JS timer 實際觀測，不能說從未超過 500 ms。這不是 TCP 限速、丟包或 server ws 真背壓。

首輪兩端初播／健康持續成功，但僅關 serverRoute(1013) 後 page 未收到預期 close，等待新連線逾時。first-attempt 保存當時 script、報告、log、失敗圖。root 實看慢端仍 Connected／舊畫面，最小修正 test harness 明確關 browser-route 與 server-route，採 4003；第二輪完整短流程通過。應用 source 未改，不重跑已通過的 build／63 核心。server 自身 policy 仍是 1013。開發初始 10 測試 log 亦保留；刪除鏡像 predicate／測試後有意義 focused 最終 9/9。

## 操作方式與復用

1. 使用 repo pinned Node 26.13.0，依根 README 啟動可信本機 HTTPS/WSS；設定 HOST_CONTROL_TOKEN 與 MEETING_ROOM_PASSWORD，server 不由 smoke 啟停。
2. 設 SLOW_RECEIVER_TEST_HOST_TOKEN／SLOW_RECEIVER_TEST_ROOM_PASSWORD 與 server 一致，執行 `node scripts/slow-receiver-smoke.mjs`；可設 `HEADLESS=0` 看三頁，輸出預設 `.scratch/t14/acceptance`。需要 Firefox、certutil、本機 CA；不改系統信任、不略過 TLS。
3. 可手動開主持／兩接收頁，正常入會議室、授予主講並開音畫、接收者啟動收聽／觀看，觀察播放計數。自動腳本的合成來源與 bounded hold 僅測試使用；不要把全機離線當單頁慢端測試。
4. 聚焦契約：`node --test tests/transport-budget.test.mjs tests/playback-queue.test.mjs`。MVP 可參考 budget、local residency、T13 fresh-metadata 恢復；測試注入不進商品流程。

## 界線與待補

1,000／500 ms 是本輪工程候選，POC-00 無可核對的既定 age 值，不是產品品質承諾。send callback 不含 OS/TCP 或對端收妥；video performance clock、PCM graph clock 是本地居留，均非來源／網路／端到端 age；graph 凍結不反映真背景 wall time。

未誘發真 CPU decoder saturation；VP8 pending guard 仍停止觀看、需手動重啟，不能宣稱所有壓力自動恢復。未做實體弱網、頻寬／丟包、手機／真背景切回、真人收聽、資源全面量測、20 次／p95／延遲品質、耐久／容量／Cloud Run。主持合成來源持續一次、不重新自動捕捉。無新依賴、正式帳號或商品參數定案，PRD v0.8 不變。

最終 stage whitespace 檢查移除新測試檔末尾一個空白行；application source 與 build 指紋相同，final-source-sha256 記錄測試純格式差異，不影響已執行63項語意。
