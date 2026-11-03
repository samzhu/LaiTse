# POC-00-R004／T02能力探測與可信HTTPS

執行狀態：**完成（本輪授權的程式及桌面部分）**。結果：**桌面核心可行／Pass；實體手機未測／Inconclusive**。T02原票的手機條件與完整POC-00尚未通過，不因使用者選擇稍後測而取消。

## 做到什麼、如何操作

1. Node26.13.0下先`npm run build`，再`npm start`，開http://127.0.0.1:4173。
2. 填名稱、按Join room，往下找到「瀏覽器能力檢查」。
3. 按「探測此瀏覽器」：看API存在、WebCodecs設定、MediaRecorder／MSE與播放提示；不會開啟麥克風、相機或螢幕權限。
4. 按「送出觀測」：出現「已由伺服器存檔並讀回」，附觀測ID、該socket的server連線ID、房間／成員。伺服器只保存client自報值並綁定實際連線，未自行驗證codec。
5. 真實手機稍後依README的LAN IP憑證及CA安裝指南操作。只傳CA公開憑證，不傳私鑰；本輪沒有更動系統／使用者信任設定。

## 本輪實際證據

- 日期：2026-11-03（Asia/Taipei）。操作者：主代理驗收、Luna xhigh實作；同一本機應用依序以HTTPS和HTTP啟動，每次只有一個server，完成後停止。
- Firefox157／macOS27.2：正常CA驗證的HTTPS/WSS，實際加入、探測、送出、讀回並再送wave成功；零page/socket error。原始版本、起迄、報告與傳輸見capability-evidence.json；全頁PNG已由主代理實際開啟檢視。
- Chrome156.0.8078.80／macOS27.2：瀏覽器插件實際操作loopback HTTP/WS，探測與觀測讀回成功；chrome-view.json為可見DOM，chrome-observation.json為獨立API讀回，ID與畫面對應。loopback屬安全內容，不代表此輪有驗Chrome的TLS信任。代表截圖chrome-capabilities.jpg已實際查看。
- 建置含型別檢查通過；新舊核心整合11/11通過；腳本語法、CA鏈驗證及SAN輸出通過（checks.json及對應log）。沒有壓力、長時間或完整QA測試。
- 憑證SAN包含localhost、127.0.0.1、::1、192.0.2.23。最後一項是預留文件／測試IP，**不是這台電腦的LAN IP、不是手機連線證據**。真實LAN IP這輪未取得，不對外開放服務。
- 實測來源逐檔hash見source-sha256.json，套件與Node版本沿用T01鎖版，沒有新增依賴。最終程式版本見本輪Git提交；文檔補齊不改動行為；提交前4個新檔案只整理EOF空白，實測位元組指紋另留source-sha256-tested.json。

[能力矩陣](browser-matrix.md)／browser-matrix.json分列桌面實際結果與手機未知。Firefox對本次AAC編碼設定回不支援、Chrome回支援；兩端Opus及VP8設定探測支援，不能推論實際擷取／編解碼／播放已可用。

## 範圍與限制

手機Safari／Android Chrome、LAN實際連線、麥克風／畫面擷取、實際音畫編解碼／播放仍未測。沒有CloudRun部署或額外執行期服務。原票AC1與手機版AC3／4未具證據，故不宣告完整T02通過。

API為GET /api/observations/:id，無正式身份授權；最多64筆、只在本機程序記憶體，重啟清空。只有該發送socket收到ACK，不向全房廣播報告；控制frame仍1KiB，能力frame另限8KiB。這是POC觀測入口，不是MVP資料保存方案。

## 桌面HTTPS重現

標準流程見README：`npm run tls:dev`後用TLS_CERT_FILE與TLS_KEY_FILE啟動同一npm start；另一終端執行`node scripts/t02-smoke.mjs`（Node26.13及certutil在PATH），會用隔離Firefox信任CA並執行核心步驟。本次實測使用獨立.scratch/t02/tls，故額外設定T02_CA_CERT指向其local-ca.pem；完整命令見development-log.md與checks.json。

所有JSON已讀回可解析，畫面與報告相符；只保存測試名稱及有限UA/platform，未提交私鑰、信任db或profile。服務、Firefox與新建Chrome測試頁均已停止／關閉，原使用者分頁未操作。手機準備好後再補一次相同操作即可。
