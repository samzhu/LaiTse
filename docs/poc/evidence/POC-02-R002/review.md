# T06設計與驗收紀錄

範圍依人類最新輕量要求：晚加入可解碼、來源世代/解析度重建、音訊主時鐘驅動影格呈現，短流程理解可行與使用方式。原票固定兩次與p95/品質門檻僅歷史參考，不捏造真人/手機或完整品質通過。

設計檢視重點：不同來源不可各自把timestamp歸零再當同時刻；server clockId區分publisher、generation區分來源；晚加入metadata/關鍵幀以有界方式取得，舊delta不得解碼；播放worklet真實PCM playhead/世代與接收共同時基用來排程畫面，過期/停止/不同publisher不假同步；所有丟棄或已渲染VideoFrame釋放。

計時依據：[Web Audio getOutputTimestamp](https://webaudio.github.io/web-audio-api/#dom-audiocontext-getoutputtimestamp)、[WebCodecs](https://www.w3.org/TR/webcodecs/)。輸出clock mapping與擷取時間不可混用；共同聲光標記只量同一接收端graph/render的軟體觀測，實體輸入/喇叭/螢幕/真人與cross-device時鐘未校準保持未知。

實際結果於程式交接與驗測後追加。

## 執行前窄範圍檢視（2026-11-04）

Luna明確釋出writer後root接手。實作中檢視已修：uncertainty硬編數字改為未校準null，worklet回報實際窗口長度；舊/空PCM stats不能刷新master，future output映射需等待，時鐘/世代/epoch隔離；marker暗底與顏色門檻及source週期邊界。

Root執行前修兩處script：晚加入在音訊ready及audio-master模式後重新取快照，避免拿早於音訊初始化的狀態斷言；先保存marker原始資料再斷言配對數，確保失敗可診斷。同步更新既有t05-smoke的screen schema2/lateJoin metadata斷言，其他歷史腳本未重跑；不把舊run結果擴張到新時鐘行為。

## 首輪觀察與窄修

首輪build、22核心案例、語法通過；三Firefox晚加入可解碼且audio-master，三個同接收端色碼聲光配對108.55/122.35/129.27ms，並非p95/實體輸出結果。來源更換時A可640×360，B收到140/解碼139卻呈現0、丟棄135；原始report/checks/log/圖與相關來源hash保存first-attempt。

程式檢視確認一個飢餓機制：只保留最新audio master，而outputTimestamp可能把該graph樣本映射至未來；每21ms新樣本覆蓋尚未到時的舊樣本，畫面永遠等待。這是符合runtime現象的根因推論，首輪未保留完整映射歷史故不宣稱已直接量到lead值。修為有界32筆歷史，優先選已到輸出時刻且新鮮的最新樣本，無到時樣本才等待最早未來樣本；保留失效/epoch/來源隔離，無時鐘外插。新增future更新不遮蔽due樣本及新收到舊輸出時間仍失效的回歸，5個timeline案例通過。

另marker觀測略過取樣開始時已在途的半個閃光，只記真正觀測到的後續轉換；failure保存增加audio快照。不改已保存的首輪數值。

## 第二輪與緩衝條件

時鐘歷史修正後23核心案例及build通過，但同一換來源位置B仍無呈現（A正常），停止原流程重跑；第二輪全部原始資料另存second-attempt。根因未因單一假設修正就宣稱成立。

獨立程式盤點發現畫面已解碼佇列僅4幀（15fps約267ms），音訊PCM佇列可500ms，再加device-output lead；持續丟最老畫面會讓所有尚待音訊追上的影格永久被淘汰。單獨deterministic model以固定500ms音訊落後證明：4幀150tick無一次可選影格，16幀可持續選取；這只是policy診斷，不作瀏覽器或效能證據。調整有界畫面保留16幀，與既有500ms PCM及500ms future mapping上限配合；不改品質門檻、不無限緩衝。failure audio快照新增實際queuedSamples/overflow，後續需以新build驗證。

## 第三輪的不同失敗

16幀新build在晚加入即退訂，failure快照明示「解碼器佇列超過2影格」，received5/decoded0；A正常，B仍有audio及實測queued21,824sample。這次是明確的原生keyframe初始化burst與舊decodeQueueSize>=2拒收策略，不是前兩次來源切換的「已解碼但無呈現」，因此未混稱同一根因。資料保存third-attempt；把解碼提交另設上限8（與已解碼保留16區分），超限仍停止/清理，不無限排隊。

## 最終讀回（2026-11-04）

有界16幀保留＋decoder8筆容許量的新build完整短流程成功，三個Firefox零page/socket errors。最終下載實際有5幀等待（舊4幀無法容納），晚加入、generation1→2及1280×720→640×360重建、退訂再加入與獨立停止可行；停止audio後mode切standalone。沒有把此成功反推每項首輪根因皆已直接量到，也不抹去先前失敗。

三個聲光偏移64.77/151.71/129.35ms為未校準graph/render觀測；其中一筆高於原150ms參考，未宣告p95或物理品質通過。actual worklet window21.33ms／RAF最大50.08ms，mapping error null。短窗口render fps與要求檔位分列，不拿瞬間排程差當實測偏移。

23核心案例已通過；後續只調client緩衝及觀測，重新build/typecheck/browser驗受影響流程，未再跑無關全量檢查。最後來源、script、worklet與下載JSON讀回；來源更換代表圖已實際查看，沒有阻擋本輪桌面核心交付的剩餘已知問題。原裝置/品質/恢復限制仍需另階段驗證。
