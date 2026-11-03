# POC-01-R002／T04雙接收輕量觀測

執行狀態：**本輪桌面程式與自動驗測完成**。結果：**合成音源雙接收核心可行／Pass；真實跨裝置品質與完整T04／POC-01仍Inconclusive**。

依先前手機、真mic／真人稍後補測的安排，本輪不使用真實裝置或環境聲。DEC-010採短核心示範；沒有做20分鐘／兩次獨立長測或宣稱達成p95，這些原工程數值保留作之後需要時的品質參考，不作本輪輕量示範的硬門檻。

## 怎麼使用

1. Node26.13.0下`npm run build`、`npm start`，開三頁http://127.0.0.1:4173並Join room；跨裝置另依README設可信HTTPS／LAN。
2. 一頁作主講，另兩頁作接收。接收頁各按「開始收聽」，主講頁按「開始麥克風」並允許權限。
3. 確認兩端播放樣本增加、RMS有值；真人聽見仍需自己的耳機／喇叭確認，計數不能替代人耳。
4. 播放時各接收頁按「下載音訊觀測」，保存實際JSON。可試第二頁停止收聽，確認第一頁持續，再讓第二頁開始收聽。
5. 主講停止麥克風，兩端不再接收新音訊；測完停止服務。

## 本次做了什麼

2026-11-03（Asia/Taipei），Luna xhigh實作、主代理獨立檢視／驗收。macOS27.2／Apple M1 Max／64GiB／Node26.13.0／npm11.20.0／Firefox157.0／Playwright1.64.1。只有一個本機Fastify服務，三個獨立Firefox程序（同機，不是三台裝置），經正常CA驗證HTTPS/WSS；不修改系統信任／HOME或使用者profile。所有profile streams.fake=true，主講的allow僅為profile內模擬，沒有硬體mic、環境錄音或TLS略過。

| 核心操作 | 本次結果 |
|---|---|
| A先收聽、主講開始 | A原生Opus解碼並實際AudioWorklet渲染非靜音樣本 |
| B晚加入正在播的stream | B取得相同server generation 1，兩端都實際render |
| A/B各按下載音訊觀測 | 真正的瀏覽器Blob下載成功，JSON可解析並含版本／codec／generation／計數scope與未知欄位 |
| B停止收聽 | 等server audio.unsubscribed ACK後，B binary計數18→18（400ms）；A binary70→91，render60,160→79,360，持續接收與渲染 |
| B再次開始收聽 | 仍取得目前generation，重新收到新packet並非靜音render |
| 主講停止 | 等兩端streamEnded後，400ms內A/B的socket binary與頁面packet計數均維持不變 |

下載時的觀測快照（兩端按鈕不是原子同步取樣）：

| 接收端 | received／decoded | rendered sample | RMS | queue／buffer估計 | packet gap |
|---|---|---|---|---|---|
| A | 64／64 | 50,560 | 約0.0710 | 5,120／106.67ms | 0（generation1） |
| B | 14／14 | 4,352 | 約0.0531 | 5,248／109.33ms | 0（generation1） |

兩個buffer數字只代表瞬間接收端待播樣本，不是端到端音訊延遲；gap0也不代表沒有擷取／解碼／實體播放中斷。端到端延遲為null，真人、physical device與發布源種類由一般應用不推定；合成來源由測試profile紀錄另證明。

## 證據與重現

- audio-evidence.json：精確起迄、版本、拓樸、每個階段快照、server ACK／generation、transport與錯誤。兩端最終零page/socket errors。
- observations/receiver-a-observation.json、receiver-b-observation.json：從實際「下載音訊觀測」按鈕得到的原始檔，不是測試自行造出的JSON。
- receiver-a-audio-panel.png：主代理已實際開啟查看的播放／下載介面。截圖與下載時點不同，持續stream的packet計數可自然不同。
- checks.json及log：production build／typecheck、14個新舊核心整合、smoke語法與一次三Firefox核心示範皆exit0。雙receiver契約案例驗byte相同、退訂隔離、再訂閱目前generation。
- source-sha256.json：最後實測程式、腳本、tests與manifest逐檔指紋；套件／codec未改版，無新依賴。最終本機版本見Git提交。
- development-log.md為實作交接，review.md記root在正式跑前發現並修正的兩處測試變數名稱；本次沒有runtime失敗後偽裝成功。

重現：依README先啟動同一個可信HTTPS/WSS server，另一終端執行`node scripts/t04-smoke.mjs`，使用Node26.13與certutil；結果在ignored .scratch/t04/desktop-smoke。三個profile全部是合成來源，沒有採用真實mic。一般手動三頁流程與手機CA指南也在README。

## 界線與交接

本次只是一個短run中的晚加入／退訂／再加入，不充作兩次獨立run。手機、真mic／真人、真實跨裝置、原生權限／播放被阻擋、20分鐘穩定性、codec跨瀏覽器品質、p95延遲、弱網／重連／容量與CloudRun均未測；不宣告原票手機或品質AC通過。原票T02/T03尚未補測的前置證據維持原狀，不因本輪明確接續實作而改成已驗。

觀測schema把publisher頁面累計、receiver listening session累計、單generation seq缺口、瞬間buffer/RMS分開；generation只在同一server process內有意義，沒有持久run/session ID。這不是MVP統計或耐久儲存方案。

所有JSON與指紋已讀回，PNG已實際查看；只保存合成名稱／有限browser資訊，不含私鑰、profile或音訊檔。server與三個Firefox在finally停止／關閉，不動使用者原分頁；SOL-002／008、README及執行紀錄已同步。程式與驗測紀錄一起本機commit，不push，不啟動T05或部署。
