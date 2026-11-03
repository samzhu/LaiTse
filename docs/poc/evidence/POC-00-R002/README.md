# POC-00-R002／T01 雙瀏覽器驗收

執行狀態：**完成**；結果：**Pass（僅T01）**。完整POC-00仍為Inconclusive，手機可信HTTPS／能力矩陣屬T02；MVP尚未Go。

- 實測UTC起迄：2026-11-03T05:29:26.249115+00:00 ～ 2026-11-03T05:29:33.112264+00:00；本地為2026-11-03 13:29（Asia/Taipei），精確時間見checks.json。
- 操作者：Codex主代理驗收；Luna xhigh實作及有界環境診斷。
- 假設／相依：保留R001的Firefox啟動反例，採Mozilla已記載的程序限定應用資料目錄；不更改HOME、既有profile或系統信任。
- 環境：macOS27.2／arm64／Apple M1 Max／64GiB，Node26.13.0／npm11.20.0，Playwright1.64.1／Firefox157.0 revision1555。版本、授權與環境完整保存於host.json、dependency-inventory.json、browser-evidence.json；Node archive及授權沿用R001 runtime-verification.json／node-license.txt。未採用診斷中失敗的Playwright alpha。
- 拓樸：一個本機Fastify程序，建置頁面／API／WSS共用localhost:4173；同主機兩個獨立Firefox程序與profile，以headless模式真實渲染頁面並操作。沒有Node模擬端混充瀏覽器、沒有媒體client、沒有網路模擬或CloudRun部署；PID與命令見topology.json。
- 來源：source-sha256.json逐檔保存程式、測試、manifest及lock雜湊；正式提交在本輪Git紀錄。該指紋不包含其後補齊的說明文件，避免循環hash。

| T01 AC | 結果與可核對證據 |
|---|---|
| 1／工具鏈、版本、授權、重現 | Pass；R001 install.log證明lock重新安裝，R002 build.log與109套件inventory，README完整操作；三項moderate audit節點及未觸及路徑判讀保留於R001 review.md，不宣稱零漏洞 |
| 2／同應用production頁面、API、WSS | Pass；server.log、topology.json，兩端API ready，同源wss://localhost:4173/ws，正常TLS驗證；建置非Vite dev server |
| 3／雙瀏覽器實際共享狀態 | Pass；client-1.png／client-2.png及browser-evidence.json：Ada、Grace；加入seq2、wave seq3、clap seq4兩端結構化內容相同，離開seq5後只剩Ada |
| 4／觀測基線與界線 | Pass；checks、host、topology及browser evidence，兩端secureContext=true、零pageErrors／socketErrors；不以能力探測宣稱影音支援 |
| 5／資料盤點與部署風險 | Pass（僅盤點）；README、SOL-007。固定房間可重建，連線成員／序號／事件均非耐久，沒有程序恢復證據 |
| 6／run、證據與SOL交接 | Pass；execution-log、SOL-001／007已更新；R001原始失敗仍保留，完整階段未宣告通過 |
| 7／本機範圍 | Pass；無雲端資源、外部執行期服務或部署；驗收finally停止自行啟動server，關閉兩個測試browser |

重現順序：README的固定Node安裝 → npm ci → npm run build → npm run tls:dev → 以TLS_CERT_FILE/TLS_KEY_FILE啟動同一npm start → npm run test:integration、npm run test:e2e及npm run licenses。測試會為每一端建立獨立NSS信任與MOZ_APP_DATA／MOZ_LOCAL_APP_DATA；macOS需要正常本機terminal環境，不能把受限自動化sandbox啟動失敗誤判成WSS失敗。

量測：9個整合案例通過，兩個真實Firefox端、各一條WSS，兩端3個共享事件完整比對，1次leave清理；這些是功能斷言，非容量、延遲分布或影音品質量測。時鐘為同一主機UTC牆鐘，事件順序以server序號為準，未作跨機時鐘校準。

保存讀回：主代理已解析JSON、確認檢查exit0，並實際開啟兩張PNG確認成員及活動可讀。只保存合成Ada／Grace資料；不提交私鑰、CA信任db或完整browser profile。

限制／後續：單一瀏覽器引擎、同機loopback、一次完整成功run；未做手機、音畫、弱網、長時間、容量、身份授權、重啟恢復、雲端及耐久方案。POC計畫要求候選至少兩次獨立重跑才列穩定可採用，因此SOL-001仍驗證中；不為升級標籤而重複全量測試。UI的wave/clap是T01合成控制操作，不代表PRD完整回應、像素人物或MVP功能已完成。
