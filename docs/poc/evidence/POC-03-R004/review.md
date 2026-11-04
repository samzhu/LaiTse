# DEC011-BC／會議室門與密碼設計檢視

本輪人類明確要求門/未鎖直接入/上鎖正確密碼、輕量POC與程式+紀錄commit。B/C核心合併：鎖狀態由server啟動設定決定，無公開未受保護管理API；T09主持人即時鎖房/角色授權仍後續。外部join/switch與場景門/其他UI入口共用server gate，拒絕前不得分配會議室member/relay或洩漏內容，已在原空間者狀態保留。

需有真實場景門圖物件與可操作入口，Phaser原本input:false須正確啟用pointer且禁全域keyboard、callback取最新React狀態；等效HTML/鍵盤維持可操作。無需全圖尋路或3D碰撞。每次新入房皆驗證，返回開放區不需密碼；同一原房內刷新不等同新入房。失敗可重試，成功才ACK成員資格。

密碼只經暫存input/WSS送server，不在URL、public snapshot、browser bundle、logs、report保存。驗證/嘗試限流屬基本POC，非帳號或完整抗暴力破解；不同socket可繞過單連線budget的限制須明列。設定重啟變更，沒有即時密碼更換/撤權承諾。

Node26官方API核對：[scrypt](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)、[timingSafeEqual](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b)。採salted verifier及等長byte比較；同步scrypt會阻塞event loop、非容量結論，非同步則必須防await後身份/房間/close競態。timingSafeEqual不保證整段程式時間安全，不作全面資安已驗宣稱。

root runtime計畫：同build分別啟動未鎖/上鎖兩config（密碼在runner記憶體臨時生成，不輸出），真browser門操作與錯/正確重試，加外部WS繞過/下送0；Node契約補不該跨房的audio/screen bytes。驗測強度短流程即可。實際結果/來源指紋待交接追加。

## 最終人工檢視與驗收（2026-11-04）

主代理讀回server gate、嚴格欄位檢查、salted verifier、重試限制、client對話框與切房清理順序；驗證拒絕在membership/position/relay變更之前。啟動鎖設定不冒充主持人管理。31/31 Node核心測試及兩種設定的真Firefox流程通過；locked合成音訊實際收到/解碼3/3、AudioWorklet render1,792samples。獨立來源hash讀回無未匹配封包，最終page/socket error皆空。

初兩次canvas門失敗保留；第二次相同錯誤後停止整套重跑，以單頁診斷確認Phaser快取canvas bounds過時。原碼檢視確認Zone hit area有效，transformY使用cached top；root在原生down capture同步bounds/displayScale並在destroy解除listener。修正後單頁命中Zone且實際切房，再通過最終未鎖/上鎖兩流程。已查看錯密碼modal、門命中圖與最終音訊播放圖。修正後build/typecheck通過，沒有為純client座標改動重跑無關server全量。

沒有新依賴，既有影音relay/controller/worklet與manifest/lockfile另以Git baseline逐檔位元核對。密碼沒有寫入證據或公開資料；單連線限次可被新socket繞過、同步scrypt阻塞、切房嘗試會先停止本地影音等限制皆已記錄。未驗真mic/真人收聽、活動VP8實播、手機、長測、完整資安或部署。程式與證據交付範圍止於DEC011-BC，不啟動後續POC。
