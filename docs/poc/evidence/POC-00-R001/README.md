# POC-00-R001／T01 首組基線

執行狀態：完成；結果：**Inconclusive**（Firefox 157無法啟動，缺兩端瀏覽器證據）。此結果保留，修正組合另開R002。不代表完整POC-00或MVP進場。

- 實測起迄：2026-11-03 13:18:30～13:19:20（Asia/Taipei）；精確UTC起迄見checks.json及browser-attempt JSON。
- 操作者：Codex主代理；程式實作：Luna xhigh。
- 環境：macOS27.2／arm64／Apple M1 Max／64GiB；Node26.13.0、npm11.20.0；lock版本及109個已安裝套件／授權見dependency-inventory.json，無未知宣告授權。這是套件metadata盤點，不是法律審查；包含建置工具的MPL-2.0依賴，不能概括成全MIT。
- 拓樸：同機loopback、一個Fastify程序（驗證時PID85177）監聽127.0.0.1:4173，提供建置頁面/API/WSS；Firefox實際啟動失敗，所以真實瀏覽器接收端數為0。無媒體或負載端。
- 程式版本：基底366933a；未提交的實作代理交接版本，未於第一次build前保存完整source指紋，不能以基底commit重現新程式。R002將保存完整指紋及正式提交。

| 項目 | 結果／證據 |
|---|---|
| 官方Node archive校驗 | Pass；runtime-verification.json，node-license.txt |
| lock重新安裝 | Pass；install.log；發現3個moderate audit節點，判讀見review.md／audit.json |
| typecheck／production build | Pass；build.log |
| 整合測試 | Pass；integration.log，9/9，Node WebSocket客戶端 |
| HTTPS頁面與API | Pass；https-smoke.json，驗證CA而非略過憑證 |
| 實際瀏覽器A | Fail啟動；browser-attempt-01-failed.json：受限環境SIGABRT |
| 實際瀏覽器B | Fail啟動；browser-attempt-02-failed.json：一般執行環境找不到profile |
| 兩端收看同一成員／事件 | Inconclusive；瀏覽器未成功啟動，無截圖，不以Node結果代替 |

重現：README的Node下載／npm ci／build／tls:dev與test:e2e命令。原Playwright1.64.1／Firefox157 revision1555組合在本機環境啟動失敗；後續需使用R002的修正測試工具組合。

觀測：單機UTC牆鐘作事件時間與log起迄，server單調遞增序號作事件次序；本run沒有收集端到端延遲樣本或p50/p95，不把測試耗時當影音延遲。

未測：手機、編解碼／影音、跨機、弱網、長時間、容量、身份授權、重啟恢復、雲端部署與耐久資料。固定／動態資料盤點見README；SOL-001及SOL-007僅部分證據，尚非可採用。所有JSON／log已讀回；不保存CA私鑰或瀏覽器profile到交付目錄。
