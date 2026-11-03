# T01程式檢視紀錄

執行者：主代理；日期：2026-11-03。環境無可呼叫的tdd/code-review Skill工具，採手動red-green與獨立程式檢視，不宣稱已呼叫該技能。

## 初步檢視（代理仍為程式唯一writer）

1. `scripts/e2e.mjs`區塊內join helper遮蔽path.join，會在截圖時呼叫錯誤函式；已回報代理窄修正。
2. 驗收需雙向控制事件、兩端相同序號及內容、離開成員清理，不能只驗證一段相同文字；已要求補強測試。
3. Leave後快速Join時，舊socket.close callback可能清空新連線狀態；已要求按socket identity隔離回呼及新連線狀態。
4. 整合測試標題提到名稱長度但只有非法房間案例；已要求補真實名稱長度拒絕案例。

以上待代理保存及主代理最終讀回，尚未視為已解決。最終檢視與測試結果將追加於本檔。

5. `scripts/e2e.mjs` NSS參數的模板字串引號不匹配，TypeScript檢查未涵蓋.mjs；已要求修正並執行所有.mjs的node --check。
6. README資料分類將成員離線與全域序號清除混為一談；已要求精確區分離線移除成員與程序重啟清除全域狀態。

## 主代理接手後

- 初步1～6項已逐一讀回：helper改名、雙向wave/clap與結構化序號內容比對、leave清理、舊close identity guard、名稱長度案例、mjs語法及README資料語意均已修正。
- 補上舊socket的open/message/error identity guard，避免離開後的排隊回呼影響新連線；server忽略已進入closing的socket後續控制訊息。
- 瀏覽器client建立改為序列，確保第一端失敗時不會留下Promise.all中尚在建立的第二端。
- 最終npm ci成功；9個整合案例通過；typecheck/build成功。瀏覽器啟動尚遇環境問題，沒有把Node測試當成瀏覽器驗收。

## 依賴稽核判讀（2026-11-03）

`audit.json`保留npm audit原始結果：3個moderate節點，來源為glob取消後仍遍歷與minimatch不可信pattern放大，經@fastify/static傳遞。

依官方[glob advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)與[minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)，加上已安裝`@fastify/static/index.js:149–195`讀回：本應用固定`wildcard: true`，glob呼叫位於另一個wildcard:false分支，沒有收取客戶端glob pattern或配置AbortSignal。這是目前本機POC組合未觸及公告路徑的程式判讀，**不代表依賴無漏洞或正式上線安全核准**。本輪不執行audit fix --force降級Fastify插件；MVP或改wildcard／glob用途之前須重新處理／驗證相容修補。

## 最終結論

R002使用原穩定版Playwright與Firefox，配合Mozilla已記載的child應用資料目錄隔離後，全部.mjs語法、typecheck/build、9案例整合與完整雙Firefox流程通過；source指紋、截圖及傳輸資料已讀回。沒有剩餘阻擋T01的程式檢視事項；依賴公告與後續產品授權／耐久／手機／媒體等界線已記錄，不能解讀為生產環境安全或相容性核准。主代理已實際開啟兩張截圖，確認雙端成員、事件可讀。

提交前diff whitespace檢查：應用、腳本、需求與紀錄皆通過；官方Node LICENSE原文及OpenSSL原始certificate輸出各有一個上游空白格式警示，保留原始證據不改寫，另以排除這兩份原始檔的diff --check核對exit0。
