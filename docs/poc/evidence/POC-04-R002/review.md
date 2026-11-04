# T13方案與驗收檢視

本步延伸T12控制恢復，不保存或重用舊capture/decoder/queue。user receive intent和controller實況分開：dispose/close不能當手動stop，只有正常UI stop/interaction/明確切房/Leave才清意圖；意圖綁room，新的session.resumed後仍等本socket room.snapshot及participation.self才恢復允許channel。不得把舊房意圖移到server已切換的新房，或把audio意圖加給readonly display。

既有relay subscribe已有當前codec/config與keyframe gate，預設不改server/封包/依賴，需具體缺陷才擴寫。receiver-only恢復通常同publisher generation/clock，但新controller/timeline初始化、config/keyframe與render須可關聯；sender手動重新發布才要新世代/時基。

root讀到startListening await resumePromise的pending風險，已送owner：不能只顯示suspended後沿用resumeListening/startListening互相呼叫，會在listenerActive=false時遞迴。正常手勢須恢復同context並只完成一次initializer，dispose/token guard擋晚回callback。[Web Audio編輯草案：resume](https://webaudio.github.io/web-audio-api/#dom-audiocontext-resume)為手勢/狀態判斷來源；不強制autoplay設定。

以上為執行前設計，尚未runtime通過。

## 驗收邊界補充

本輪只做少量同頁恢復，整頁reload仍須手動媒體啟動；這是已向人類說明的POC範圍，不將未持久化意圖假稱功能。需確認恢復觸發不改T11「interaction→watch不auto」與T12門禁/主持/發布權失效。新subscribe要在本次新socket participation.self後，而非只見到舊room或任一session.resumed。

單次時間使用觀測者同一時計量route release→control可操作→實render，分列gesture，不能把跨clock的absolute時間或source編碼timestamp當端到端延遲。無20次/p95/5s通過宣稱；門檻留存不調低。

## 實作中檢視（非runtime結果）

root要求restoreFor(display)強制清audio intent，不只依父頁目前沒有AudioPanel。audio startup已讀到owner改為worklet setup與resume promise分離，subscription可先建立、suspended明示手勢；同context initializer只跑一次且token/decoderRequestId防晚回，避免pending→continue遞迴與舊設定callback。恢復後實際samples仍須browser驗，不因source檢視先判通過。

## 首輪browser診斷

首次在初始播放前等待host screen.keyframeRequest逾時。保存first-attempt script/report/log；讀回participant與display先subscribe，host之後start，relay只在已有publisher後新subscribe才request keyframe，初次發布自身已產首keyframe，不保證另送請求。source/54核心/build無異常，root只調script先開publisher再讓participant加入接收，形成確實late-join request；再驗受影響短browser，不重跑無關全套。

第二輪已初始實播（5632samples/1frame，display5frames），receiver新connection均auto subscribe與二進位流量，後續Continue locator點擊逾時；second-attempt保留script/report/中斷圖/log。root另發現waitForActualAudio第五參數宣告timeoutMs，呼叫卻傳reconnect物件（初始傳null），窄修參數契約。對瞬間suspended按鈕加有界正常click與失敗後真state讀回：若按鈕已自然消失且ready才繼續等實samples，不force click/改autoplay；仍suspended則失敗保留state/圖。這是受控診斷，非先判app成功。

第三輪已實證receiver/display重連後實播、manual stop不重訂閱、sender tracks ended且無auto capture/start/host；最後sender手動重開同樣在participant重新subscribe前就等keyframeRequest，重現腳本同類順序錯誤，已停止整套重跑並保存third-attempt（含完整control白名單及圖）。只將等待移到participant subscribe之後，新增測試scope=publisher的窄診斷，不重做已證明receiver循環。另把control timing由poll看到時刻修成原control.atMs，third資料可由已保存trace獨立重算，不會誤把subscribe算在權威快照前。

## 最終root判定

應用source與交接build指紋未變，54完整/typecheck/build成功；只有script窄修。third-attempt已證明新connection fresh authority→一次訂閱→當前config/clock＋新AudioWorklet/VP8實render，manual stop新連線0 subscribe及sender不auto均成立。最後同類腳本keyframe等待失敗後停止整套重跑，publisher-only最小診斷通過新generation2/clock/實播，分段核心Pass；最終full script僅syntax，完整組合/品質Inconclusive。不可改寫third overall failed為passed。

root獨立讀回sequence、clock/config、render前後及stop/source counts，實際看中斷/恢復/新來源展示三圖，cleanup證明server/browser停止。此次audio自動恢復；手勢分支未單獨實測，第二輪瞬間locator原因未確認。保留所有失敗與source-script版本，不因輕量省略重要限制或宣稱p95/真人。

SOL-002/006/008及README/需求/計畫/票面/協作同步；server/relay/時基module/互動/Phaser/manifest未改，無新依賴。兩agent已saved/readback/STOP，root完成文件/本機commit後釋出；不push/遠端票/T14/部署。

root另更新既有T12 browser smoke的display no-auto舊預期為T13同頁video重新subscribe一次，避免留下明知過時的測試；此為control-only expectation，實render證據仍R002 third。既有R001歷史不改，舊smoke只syntax不重跑完整T12流程。
