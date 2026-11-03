# POC-01-R001／T03輕量語音驗測

執行狀態：**本輪程式與自動驗測完成**。結果：**合成音源管線可行／Pass；真實麥克風、真人收聽與完整POC-01仍Inconclusive**。依人類選擇，真人收聽稍後補，不改寫原票真mic條件為合成音源。

## 如何使用

1. 用Node26.13.0執行`npm run build`與`npm start`，開兩個http://127.0.0.1:4173頁面並各自Join room。loopback可先操作；跨裝置仍需要README中的可信HTTPS。
2. 接收頁往下找到「即時語音」，按「開始收聽」。這個手勢啟動AudioContext，再訂閱音訊。
3. 主講頁按「開始麥克風」，允許瀏覽器權限後說話；另一頁應從自己的耳機／喇叭播放。拒絕權限會顯示沒有發布音訊。建議用耳機，避免同機收音回授。
4. 主講按「停止麥克風」停止新的音訊；接收按「停止收聽」取消訂閱並釋放播放資源。
5. 本次自動測試不是上述真人步驟的證據；真人試說與收聽仍待使用者方便時操作。

## 本輪實測

2026-11-03（Asia/Taipei）；Luna xhigh實作、主代理獨立檢視／驗收。環境為macOS27.2、Apple M1 Max、64GiB、Node26.13.0、npm11.20.0、Firefox157.0／Playwright1.64.1，沒有新增依賴。

- 一個本機Fastify程序提供production頁面、API、WSS與AudioWorklet腳本；兩個獨立Firefox程序分別發布與接收，第三個隔離程序測模擬拒絕。各自使用獨立NSS信任本機CA及MOZ_APP_DATA／MOZ_LOCAL_APP_DATA，不變更HOME、系統信任或使用者profile。
- 所有可能呼叫getUserMedia的profile均設定media.navigator.streams.fake=true，來源為Firefox合成測試音；permissions.default.microphone=1/2分別模擬允許／拒絕。沒有選真實硬體、錄環境聲或保存音訊檔，也沒有忽略TLS錯誤。
- 主講getUserMedia合成流→AudioWorklet的20ms PCM→原生AudioEncoder Opus→同一已加入房間WSS→server只轉送壓縮binary→接收AudioDecoder→AudioWorklet輸出至AudioContext.destination。不是只看socket開啟或單獨decode數字。
- 成功快照：收到11個packet、解碼11個frame、實際渲染4,736個sample、RMS約0.0458，queue4,864個sample、overflow0；原始數值見audio-evidence.json。這是單次短示範，不是音質、穩定性或容量數據。後續最終transport計數可比快照高，因為取樣至stop前仍在傳送。
- stop後streamEnded、publisher idle，接收端250ms觀察沒有新增packet。模擬拒絕時publisher state=denied、可見「目前沒有發布音訊」，零binary送出；三端page/socket errors皆空。
- 13個新舊核心整合案例通過，包含opaque bytes不變、只發給顯式訂閱者、非publisher拒絕及stop，並保留T01/T02行為。型別／建置與smoke語法通過。沒有長測、壓力或全瀏覽器矩陣。

### 首次失敗與修正

第一次已出現非靜音渲染、stop及denied回饋，但拒絕權限後關閉AudioContext，使尚未await的resume promise產生「Closed before resume completed」pageerror，故該嘗試失敗。原始attempt-01-audio-evidence.json、attempt-01-smoke.log、checks-attempt01.json及來源指紋保留。主代理修正為立即觀察resume的reject，正常允許路徑仍await原promise，沒有隱藏其他錯誤；重建及重跑受影響瀏覽器流程後成功。

checks.json／checks-attempt02.json為修正後build與smoke；13個server核心案例在checks-attempt01.json／core-integration.log，因修正僅client Promise清理而未無故重跑未受影響的server測試。source-sha256.json為最終實測來源，source-sha256-attempt01.json保留反例來源。精確起迄、版本、三端傳輸與設定在原始JSON／log；兩張截圖已由主代理實際開啟確認播放計數及拒絕訊息可讀。

## 觀測與尚未測的部分

- renderRms與sample計數來自播放AudioWorklet真正寫入輸出的PCM。這不代表真人耳朵已聽見，也不確認實際喇叭音量／音質。
- queue樣本只表示接收端待播緩衝；若換算queue/sampleRate也只是本地緩衝估計。端到端延遲沒有可靠量測，報告明列null；未偽造p50/p95或套用延遲門檻。
- 真實麥克風發話／人耳收聽、瀏覽器原生權限對話的真人操作、播放被政策阻擋、跨裝置、手機、多接收者品質、弱網、長時間、重連／主持權限與CloudRun均未測。原票AC1／真人播放與完整POC-01仍未具備證據，沒有啟動T04。
- Opus固定48kHz mono32kbps／20ms；原始Opus封包不含Ogg description，server沒有解碼／轉碼／留存媒體。這是單房單publisher的實驗契約，不是正式授權／多房／MVP協定。

## 重現與資源

README包含一般使用與`node scripts/t03-smoke.mjs`自動示範；先依其TLS步驟啟動同一HTTPS server，Node26.13與certutil在PATH，預設CA路徑.scratch/t01/tls。自動腳本只用合成音源，結果放ignored .scratch/t03。source指紋與原始資料已保存讀回，沒有提交私鑰或browser profile。

兩次測試的server及所有測試Firefox均在finally停止／關閉；沒有操作使用者原分頁、部署雲端或寫GitHub。SOL-002／008已更新，最後程式及驗測紀錄一併本機commit，不push。
