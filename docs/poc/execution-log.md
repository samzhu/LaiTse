# POC 執行紀錄

- 權威計畫：[POC-PLAN v1.4](plan.md)；v1.0執行的歷史run依當時方法解讀，原始證據保留。
- 建立日期：2026-11-03；更新：2026-11-04。T06本機晚加入／同步排程核心已有證據；裝置、品質及完整階段尚未通過。
- 本表只記實際執行與證據；階段需求與篩選值以計畫書為準，不在此重訂需求。

## 最新增量（2026-11-06）

桌機Chrome/Edge合成9項核心Pass，真人真capture仍pending；http://localhost:4174/?room=studio及PG留運作供稍後人工。已驗核心13票依人類新授權結案，品質／手機等7票保留，詳本頁末POC-DESKTOP-01與[證據](evidence/POC-DESKTOP-01-R001/README.md)。下方早期「尚未執行／無保存／8人未移除」是建立時快照，不是目前狀態。

## 初期階段快照（歷史；目前以後續run及最新摘要為準）

| 階段 | 執行狀態 | 結果 | Run／證據 | 下一步 |
|---|---|---|---|---|
| POC-00 | 執行中 | Inconclusive | R002 T01 Pass；[R004 T02桌面可行](evidence/POC-00-R004/README.md) | 實體手機可信HTTPS／能力矩陣稍後測 |
| POC-01 | 執行中 | Inconclusive | R001單接收、[R002桌面雙接收可行](evidence/POC-01-R002/README.md) | 真mic／人耳／手機與跨裝置品質待補 |
| POC-02 | 核心流程已驗 | Inconclusive | R001分享；[R002晚加入/同步排程核心可行](evidence/POC-02-R002/README.md) | 手機／真人及實體品質、其他codec與必要條件待補 |
| POC-03 | 尚未執行 | 未判定 | 無 | 驗證空間／房間／權限 |
| POC-04 | 尚未執行 | 未判定 | 無 | 驗證恢復與弱網 |
| POC-05 | 尚未執行 | 未判定 | 無 | 逐級負載，保留真實解碼證據 |
| POC-06 | 尚未執行 | 未判定 | 無 | 先盤點資料語意，再驗證恢復 |
| POC-07 | 尚未執行 | 未判定 | 無 | 所有必要條件具證據後審查 |

## 每次 Run 的必要欄位

實際執行前，依階段 ID 配發 `POC-xx-Rnnn`；不預填日期或測量值，不重用 ID。

| 欄位 | 應記內容 |
|---|---|
| 識別與時間 | run ID、階段、實際開始／結束時間與時區、操作者 |
| 假設 | 要驗證的問題、採用篩選值版本、前一 run 相依、預期可觀察行為 |
| 程式與環境 | commit／可驗證來源、Node與依賴鎖版、OS／瀏覽器／codec完整設定、server及負載端硬體 |
| 拓樸 | server來源、房間／主講／接收／只互動數量、真實編解碼與合成client數、裝置與網路設定 |
| 重現方式 | 啟動及測試命令、必要資料、故障注入範圍、量測時鐘與校準／誤差 |
| 觀察 | 樣本數、原始數據／圖表／log／短片位置、p50／p95／最大值、資源與錯誤 |
| 狀態 | 執行狀態與 Pass／Fail／Inconclusive 分列；未跑項目及缺少設備 |
| 結論 | 成功／失敗原因、相容範圍、限制、下一個假設、是否停止該候選 |
| 保存讀回 | 證據已保存及可開啟的檢查、敏感資訊排除、紀錄者 |
| 方案關聯 | 對應 SOL 識別碼、回歸案例及影響 MVP 的條件 |

## 追加與修正規則

1. 開發與實驗同一工作階段內補齊紀錄，不等最後才回想。
2. 失敗、中止與無法量測皆保留；修正追加說明，不能改寫原始數據。
3. 換套件、codec、佇列門檻或網路條件時開新 run；舊成功不自動涵蓋新組合。
4. 階段結果只有在必要 run 有證據後更新；寫了計畫、裝完套件或開啟頁面都不是測試通過。
5. 本紀錄不追蹤檔案／UI所有權；資源交接沿用既有[派工紀錄](../collaboration/dispatch.md)。

## POC-00-R001／T01本機單一應用基線

- 配發日期：2026-11-03（Asia/Taipei）；操作者：Codex主代理驗收、Luna xhigh實作。
- 執行狀態：完成；結果：Inconclusive（Firefox157啟動失敗，尚無雙瀏覽器證據）。
- 假設：Node26 LTS的一個本機程序可由同一HTTPS來源提供建置頁面、API與WSS，兩個真實桌面瀏覽器可共同觀察成員及控制事件。
- 相依／範圍：T01／GitHub #2，無前票阻擋；採POC-PLAN v1.0。不含手機、媒體、容量、耐久資料或CloudRun部署；不能以本run宣告完整POC-00通過。
- 程式、起迄、環境、拓樸、重現與量測、原始證據及保存讀回見R001實際驗收結果與證據README；後續結論見R002及SOL-001／007。

### 開發中觀察（尚非驗收通過）

- Node26.13.0 arm64官方發行檔已下載，實作代理回報官方SHASUMS256校驗OK；完整命令保存在`.scratch/t01/development-log.md`，待最終保存副本。
- 先執行的整合契約因伺服器模組尚不存在而失敗（exit 1），保留red階段；沒有將此失敗當成應用功能缺陷或階段通過。
- npm預設使用者快取出現EPERM，已改用專案`.cache/npm`，未變更使用者快取權限。

### R001實際驗收結果

2026-11-03 13:18:30～13:19:20（Asia/Taipei），主代理以Node26.13.0重新npm ci、build及9案例整合測試均通過；同一HTTPS listener的頁面、health與rooms經CA驗證回200。但Firefox157在受限環境SIGABRT，一般環境亦找不到已存在的profile；預設空白profile同樣失敗。原始失敗與環境／版本／授權／命令在[evidence/POC-00-R001](evidence/POC-00-R001/README.md)。本run標Inconclusive，不能以Node客戶端的成功替代真實瀏覽器；保留反例供後續重現。

### 後續假設

Mozilla [Bug2069536](https://bugzilla.mozilla.org/show_bug.cgi?id=2069536)描述macOS27限制bare-executable存取Firefox應用資料目錄，與觀察相符；這是根因假設，尚需本機驗證。升級Firefox159的有界診斷仍失敗，停止該候選；改查官方記載的獨立應用資料目錄方式，不調整HOME或使用者安全設定。

## POC-00-R002／隔離Firefox應用資料目錄的T01驗收

- 配發日期：2026-11-03；操作者：主代理。
- 狀態：完成；結果：Pass（僅T01）；完整POC-00仍Inconclusive。
- 相依：R001保留Inconclusive；診斷已證明穩定版單瀏覽器可啟動並完成HTTPS/WSS。R002沿用Node26.13.0與Playwright1.64.1／Firefox157，僅隔離Firefox child應用資料目錄並補齊檢視修正，不採預發布版。
- 假設：在不變更HOME、既有Firefox資料或系統信任設定的條件下，兩個獨立Firefox程序可由同一正式建置應用加入房間、雙向事件內容與序號相同、離開後清理一致。
- 範圍仍為T01；完整POC-00的手機／能力矩陣尚待T02，命令、指紋、環境、起迄與證據已保存於R002證據目錄。

### R002完成與保存讀回

主代理於2026-11-03 13:29（Asia/Taipei）完成[雙瀏覽器驗收](evidence/POC-00-R002/README.md)：最終typecheck/build、全部.mjs語法檢查、9個整合測試及完整Firefox雙端流程全部exit0。兩端同源API/WSS、成員及雙向控制事件seq2～4內容相同，leave seq5清理正確；兩端safe context、沒有page/socket error。已讀回JSON並實際開啟兩張截圖確認可讀。完整環境、來源指紋、命令、起迄、拓樸、觀測、未測與SOL關聯在run證據README。

本機服務與兩端瀏覽器已停止，沒有部署。SOL-001只在此本機組合取得一次完整成功，仍驗證中；SOL-007完成資料風險盤點，尚無恢復／耐久方案。T01的7項AC工程驗收通過，不等於人類接受、完整POC-00、MVP Go或CloudRun驗證。GitHub#2本輪未修改，保持open；程式只做本機提交，未push。

## POC-00-R003／人類指定的輕量核心驗測

- 日期：2026-11-03；操作者：主代理；source：66a3fca（本輪未改程式）；狀態：完成；結果：可行／Pass（僅T01核心操作）。
- 假設：現有基線可讓兩個桌面頁面完成加入、互相看見、雙向回應、離開及手動重入；同時確認操作方式與限制。採POC-PLAN v1.1，不做固定樣本／時長／容量要求。
- 實作觀察：兩端POC-A／POC-B成員及wave/clap可見；離開後成員移除，手動重入後仍可送回應。重整會清空本頁名稱／連線，需手動加入，沒有自動恢復。
- 拓樸／方法：一個本機Node26.13.0應用，HTTP/WS loopback，同一Chrome兩個新建tab，由瀏覽器插件實際操作；不混稱獨立裝置／程序或WSS。實際時間、API回應、DOM、console及代表截圖見[R003證據](evidence/POC-00-R003/README.md)。
- 保存讀回：JSON可解析，兩端快照對得上核心觀察，截圖已實際查看。服務與自建tab已停止；不動使用者原分頁。
- 後續：按輕量方式在對應實作具備後示範手機／語音／分享／房間／重連；本輪不開發後續票、不部署。沒有為湊次數重跑R002或全套測試。SOL-001保留T01可行及用法；SOL-007仍只有盤點，完整POC-00仍待T02。

### T01-HUMAN-001／初步回饋（2026-11-03，Asia/Taipei）

- 使用者在收到本機雙分頁測試教學後原話：「看起來 OK」。
- 已收到並保存：針對當前T01核心流程與操作方式的初步確認；脈絡為加入房間、成員顯示、雙向回應、離開與手動再加入。使用者沒有逐項回報測試結果，故不追加人類已逐案例實測的宣稱。
- 界線：不擴張為手機、影音、像素人物、自動重連、完整POC或MVP接受，也不視為啟動下一票。既有工程證據仍為R002／R003；來源為本次對話。
- 主代理唯一writer已保存讀回；本次只記錄回饋，未修改程式、啟動服務或操作GitHub，紀錄資源已釋出。

## POC-00-R004／T02能力探測與HTTPS（配發）

2026-11-03（Asia/Taipei）；操作者：主代理驗收、Luna xhigh實作。執行中／Inconclusive，待實際結果。假設：桌面可信HTTPS能顯示實際API/codec配置探測結果，並透過同一WSS連線保存可核對觀測；LAN憑證可依設定產生。依人類選擇，手機這輪不實測，不預填其瀏覽器能力或宣告完整T02/POC-00通過。核心測試及操作方式足夠，不做壓力/長測。

### R004實測與本輪交付

2026-11-03：完成本輪程式及桌面部分，**桌面核心Pass／完整T02仍Inconclusive（手機稍後測）**。主代理建置／型別及新舊11個核心整合案例通過；Firefox157以正常CA驗證HTTPS/WSS完成探測、同一socket送出／server ID關聯／API讀回及wave。另用Chrome156.0.8078.80經HTTP/WS loopback實際按兩個按鈕，畫面與API報告ID吻合。未調降安全設定、未請求媒體權限或實際錄播。

結果及如何操作見[R004 README](evidence/POC-00-R004/README.md)，逐瀏覽器結果見[browser-matrix](evidence/POC-00-R004/browser-matrix.md)。Firefox本次AAC encoder設定不支援、Chrome支援；Opus/VP8設定兩端支援，但不當成影音閉環證據。手機兩列維持未知。LAN SAN只以預留測試IP192.0.2.23驗證簽發及CA鏈，未取得本機LAN IP、未連實體手機，不宣稱AC1／手機AC3／4通過。

已讀回JSON、source指紋，實際查看Firefox全頁及Chrome代表截圖；本機server及測試browser均停止。SOL-002／008已同步；不做壓力／長測、不啟動T03、不部署或修改GitHub。前置T01工程證據有效，GitHub#2仍open不阻擋人類明確指定的本輪本機實作；完整階段判定維持手機待測。

## POC-01-R001／T03語音最小閉環（配發）

2026-11-03（Asia/Taipei）；實作Luna xhigh、驗收主代理。執行中／Inconclusive，待實際結果。假設：兩個真實桌面瀏覽器能以原生Opus編碼、單一本機WSS壓縮音訊relay、解碼及AudioWorklet渲染打通音訊流程，支援手勢收聽、允許/拒絕回饋及停止。依人類選擇，本輪自動驗測使用明確合成音源，真mic試說與真人收聽稍後；不把合成管線證據當原票真mic或人耳實測，不宣告完整POC-01通過。

### POC-01-R001實際結果與保存讀回

2026-11-03：本輪程式及自動驗測完成；**合成音源管線Pass，真mic／真人收聽及完整POC-01仍Inconclusive**。兩個獨立Firefox157以正常CA驗證HTTPS/WSS完成合成getUserMedia流→AudioWorklet→原生Opus→同一本機relay→AudioDecoder→播放AudioWorklet；第三個synthetic-only profile測模擬拒絕。所有mic-attempt profile均streams.fake=true，沒有真實硬體／環境錄音或真人聽見宣稱。

成功快照為接收11packet、解碼11frame、render4,736sample、RMS約0.0458；stop後streamEnded、publisher idle，250ms無新增packet。模擬denied不廣播。這是短核心示範，不是品質／穩定性／容量數據；E2E延遲未量測，原報告null，queue只是接收端緩衝。

首輪已render但denied清理時產生未觀察的resume Promise pageerror，原失敗保留；主代理窄修即時觀察reject後重建／重跑受影響瀏覽器，三端page/socket errors皆空。13個server核心案例已通過且不受此client窄修影響，未重跑無關全量檢查。精確起迄／來源／版本／兩輪原始結果見[R001](evidence/POC-01-R001/README.md)。已實際查看兩張播放／拒絕截圖、JSON與source指紋讀回一致；public worklets與build一致。README／SOL-002／008已同步；真mic、人耳、原生權限互動／autoplay受阻、手機、弱網、長測／雲端未驗。server與Firefox皆finally停止，不啟動T04或寫GitHub；程式與紀錄一起本機commit，不push。

## POC-01-R002／T04雙接收觀測（配發）

2026-11-03（Asia/Taipei）；主代理思考/驗收，Luna xhigh實作。執行中／Inconclusive，待實際結果。假設：沿用T03原生Opus，同一個本機應用可向兩個真實桌面Firefox接收程序轉送合成音源並實際渲染，單端晚加入/退訂不影響另一端，可下載各頁觀測。依DEC-010只做短核心示範；手機、真人、真mic與E2E延遲未測，不以buffer當p95，不宣告完整T04/POC-01通過。

### POC-01-R002實際結果／T04本輪交付

2026-11-03：本輪桌面程式／合成自動驗測完成，**雙接收核心Pass，真跨裝置品質／完整T04及POC-01仍Inconclusive**。同一本機HTTPS/WSS服務、三個獨立Firefox157程序（一publisher、兩receiver），全部profile streams.fake=true，不選真mic、不錄環境音。A先收聽、B晚加入同generation並實際render；B退訂ACK後400ms binary18→18，A仍binary70→91、render60,160→79,360；B再訂閱恢復非靜音，publisher stop後兩端計數穩定。

兩端透過真正的下載按鈕取得JSON：A快照received/decoded64/64、render50,560、RMS約0.0710，B14/14、render4,352、RMS約0.0531。buffer106.67/109.33ms只是接收queue估計，不是E2E；seq gap0不是沒有掉音證明。E2E延遲null、human/physical device未收集，合成來源由測試profile另記錄。這是一次短run，未做20分/兩次獨立run/p95；依DEC-010不將其作本輪硬門檻，原票手機與品質證據仍未具備。

build/typecheck、14個新舊核心整合、script syntax及三Firefox流程皆exit0；root在執行前修正兩處smoke未定義變數，沒有runtime失敗後偽裝成功。[R002證據](evidence/POC-01-R002/README.md)含精確起迄、scope、下載原檔、快照與原始傳輸。JSON/來源hash讀回，實際查看panel PNG；README、SOL-002/008與協作文件已同步。無新依賴或server/worklet變更；服務與三browserfinally停止，不寫GitHub、不做T05/部署，程式+紀錄一起本機commit不push。

## POC-02-R001／T05站內分享與獨立啟停

- 配發日期：2026-11-03（Asia/Taipei）；操作者：主代理驗收、Luna xhigh實作。
- 執行狀態：完成；結果：桌面核心可行，完整POC-02仍Inconclusive。
- 假設：在現有音訊基底延伸畫面編碼/同一WSS relay/解碼呈現，語音與分享可獨立啟停；本輪按DEC-010短核心驗測，晚加入/同步/手機/品質門檻另測。
- 前置限制：T04桌面合成雙接收已可行，真mic/真人/手機未補證據，不宣稱已完成原品質基線。實際來源/命令/指紋/結果於執行後補入本run目錄。

### T05完成與限制

本輪VP8＋LTS1沿用同一WSS及獨立Opus路徑；18核心整合、production build/typecheck通過。最終三Firefox合成影音短流程零page/socket errors，320×180原生解碼呈現；screen stop後計數13→13且audio render26,240→55,040，模擬拒權audio續播、停mic畫面續播4→7，track ended狀態清理成功。原始失敗、未定位的第一次browser逾時、受控診斷及修正保留於[R001](evidence/POC-02-R001/README.md)。

另以兩個Chrome156頁面，前景原生chooser只選本機POC分頁，HTTP/WS loopback實際呈現1280×630／快照9.74fps；瀏覽器自己的停止分享令接收端清空，沒有改OS權限或開真mic。這是原生分頁擷取證據，不是螢幕/視窗或原生影音共存品質驗收。Firefox最終短流程ps15樣本CPU最高7.1%／RSS92,016KiB，Chrome資源未測，非容量數據。

下載JSON、DOM與截圖已保存讀回，source hash已核對；README、SOL-002/008、協作文件同步。原票T02/T03/04未補的手機/真人保持待測，晚加入/同步T06尚未開發，不宣告完整POC-02通過。無新依賴、沒有push／GitHub寫入或部署；writer釋出，server及本輪測試browser/tab清理後程式+紀錄一起本機commit。

## POC-02-R002／T06晚加入與音畫同步

- 配發日期：2026-11-03（Asia/Taipei）；實際完成：2026-11-04。結果：桌面合成核心流程可行，完整POC-02仍Inconclusive。
- 假設：同一publisher共同媒體時基＋接收audio播放時鐘可支援晚加入可解碼起點、來源世代重建與同步呈現；以同接收端合成聲光標記做短流程觀測。
- 範圍：DEC-010／人類本輪輕量要求；真mic/手機/硬體輸出及原品質門檻不預先判通過，不部署或做T07。

### T06完成與保存讀回（2026-11-04）

最終00:13:35～00:13:56（Asia/Taipei）一服務三Firefox，合成oscillator/canvas經真實Opus/VP8及可信HTTPS/WSS完成：影音已播放時B晚加入、metadata/新keyframe初始化、同publisher audio-master；generation1→2及1280×720→640×360重建、退訂再訂閱、獨立停止，最後停audio轉standalone。23核心案例、build/typecheck及最終smoke通過，零page/socket errors。client緩衝窄修後以重建與受影響browser驗證，未重跑無關檢查。

同接收端三色碼週期graph/render偏移64.77/151.71/129.35ms，audio窗口21.33ms、RAF最大50.08ms，mapping error bound null、E2E null；非人耳／螢幕或p95品質通過，151.71高於原150ms參考。未為湊兩次而另做固定長測，手機/真mic/真人與其他codec/弱網/容量/CloudRun仍未驗。

原始失敗分別保存[R002](evidence/POC-02-R002/README.md)的first/second/third-attempt；root修有界時鐘歷史、PCM/畫面緩衝配合及原生decode初始化burst容許量，保留未直接量測根因的推論界線。下載schema2 JSON、代表圖及source hash讀回，圖已查看；SOL-002/008、操作與協作紀錄同步。writer已釋出，server/Firefox finally停止；程式+紀錄一起本機commit、不push或修改GitHub，不啟動T07。

## POC-03-R001／T07像素人物與兩房移動

- 配發日期：2026-11-04（Asia/Taipei）；執行狀態：完成本輪桌面核心；完整T07／POC-03仍Inconclusive。
- 假設：Phaser穩定4.2.1與既有單一WS/server可呈現原創像素人物，兩個真實桌面瀏覽器看到server權威位置/房間同步；鍵盤/明確選房及減少動態可用。
- 範圍：DEC-010輕量，不宣稱手機實機、完整房間影音隔離/權限或完整POC-03通過；T08不在本輪。

### T07完成與保存讀回（2026-11-04）

Phaser4.2.1實際WebGL／原創16×20像素人物、server權威16×10位置、同一WS兩房同步與操作入口完成。root production build/typecheck、26核心整合與一次短雙Firefox157可信HTTPS/WSS流程通過；鍵盤移動跨端實際POST_RENDER座標吻合、兩房進出/空房、離開重入及減少動態無tween可行，page/socket errors空。實際查看代表截圖，來源/JSON讀回，證據見[POC-03-R001](evidence/POC-03-R001/README.md)。

初期測試等待已離線端／關閉socket後繼續動作導致卡住，已終止舊程序、修正測試順序/觀察端並補逾時，focused12/12後root26/26通過；保留診斷界線。新增Phaser/eventemitter3 MIT notices及111套件inventory；既存3 moderate audit未在本票處理。桌面核心Pass；實體手機、完整跨房影音隔離/正式權限及完整T07/POC-03仍Inconclusive。共享地圖公開顯示兩房人物、People here當前房名單；Studio暫不提供影音，切房清理lobby relay，Node契約不代替T08實播。無媒體權限/硬體擷取，本機程式+紀錄commit、不push/部署/T08；writer及server/browser已釋出。

## POC-03-R002／T08跨房影音與成員隔離

2026-11-04配發；進行中，待實測。假設：同一本機WS可支援兩房各一合成影音publisher及receiver；server依連線成員房間分流、切房舊訂閱停止，惡意自填room/identity/role遭拒絕。DEC-010輕量，身份仍為server建立連線身份，無帳號驗證/私密入房完成宣稱；不做T09/雲端部署。

### T08完成與保存讀回（2026-11-04）

兩固定房各自relay／server連線room權威、room-specific成員快照與控制事件、切房先清舊發布/訂閱再建立新參與完成。27核心案例、production build/typecheck及最終四Firefox157合成雙publisher雙receiver短流程通過；兩房真實Opus/VP8 decode/render、不同顏色與封包hash來源吻合，無未知或跨房封包。切房ACK後500ms舊房server audio85→85/screen21→21、receiver新下送0，需手動訂閱才播放新房。六項外部真WSS偽造欄位/非publisher binary皆拒絕，每項未授權媒體/異房事件0。原始report/圖/指紋、server計數與root獨立全trace讀回見[POC-03-R002](evidence/POC-03-R002/README.md)。

初期fixture/語法與首輪browser將合法移房成員誤分類的測試失敗已保留；root窄修script後只重跑受影響browser及語法。代表紅/綠播放器與隱藏異房地圖已實際查看，長名重疊屬POC呈現限制。無新依賴／codec變更；SOL-002/003/008、操作與協作文件同步。

本輪桌面合成隔離核心可行；server UUID仍非帳號驗證、房間開放join/switch，正式主講授權/私密准入未實作，因此完整T08/POC-03仍Inconclusive。手機/真mic/真人/品質/容量/雲端不預填通過。程式+紀錄一起本機commit，不push/GitHub/T09/部署，writer與server/browser已停止釋出。

## POC-03-R003／DEC011-A兩類空間收聽規則

2026-11-04配發；進行中，尚未判定。人類恢復並釐清本輪「會議室跟開放空間」；驗會議室全房收聽、開放空間距離過界的server路由與client清理，一個合成publisher，Node26/本機真browser輕量。暫定示範6格，不把參數當產品已確認；門/密碼/多來源/手機/真人尚未驗。

### DEC011-A完成與保存讀回（2026-11-04）

兩類空間metadata/catalogue/snapshot與UI明確化；開放空間依server權威Euclidean距離（示範6格含邊界）、會議室全房語音。receiver/publisher移動reconcile公告與binary gate，超界清decoder/timeline/worklet、保留手勢收聽意願，重入恢復。30核心/production build/typecheck通過，最終三Firefox合成短流程近端可render、遠端0bytes/移入6格播放/移出7格清buffer與300ms0新增、publisher移動、會議室9格仍播放可行，page/socket errors空。

首輪主流程通過但關閉後raw尾端各8筆接收包缺來源trace；root獨立讀回揭露，原始資料保存在[R003 first-attempt](evidence/POC-03-R003/first-attempt/)。只窄修script先停發布/等ACK與穩定後再核對，重跑受影響browser/語法成功：source127、near127/far43全部LTA1 hash匹配、cap未達；未重跑無關30測試。R003含實際位置/政策/計數、原始control/hash、兩圖及source指紋，root代表圖實際查看/JSON讀回完成。

桌面合成兩類空間核心可行，6格不是產品定案，無多人混音/音量漸變/門/密碼或正式帳號權限；手機/真人/影音共存/品質/容量/部署仍未知，完整POC-03不判通過。SOL-002/003/004/008與需求/操作/協作同步，上次DEC-011未commit文件與本步程式+紀錄一起本機commit；無新依賴，不push/遠端票/T09/門禁/部署，server/browser與writer已停止釋出。

## POC-03-R004／DEC011-BC會議室門與密碼

2026-11-04配發；進行中，未判定。假設：同一本機應用可提供場景門/鍵盤與等效入口，server設定未鎖直接進、上鎖無/錯密碼不入/正確密碼入；初次join與switch共用門禁，門外不取得會議室影音/成員。配置採啟動環境，不實作T09即時管理。沿用合成audio與短真browser，手機/真人/完整角色/密碼變更政策未驗。

### DEC011-BC完成與保存讀回（2026-11-04）

31核心/production build/typecheck通過；門與room choice/初次join/switch共用server密碼准入，無/錯密碼不分配私房member/relay，正確才入房，startup設定切未鎖/上鎖。密碼不下發metadata/trace，scrypt verifier及基本per-socket限次，無新公開管理API。

首次與補scroll後第二次未鎖browser門點擊逾時，已停止整套重跑、保存[R004](evidence/POC-03-R004/README.md)兩輪及單頁輸入診斷：DOM canvas top868.1但Phaser cached797.1，pointer錯落276而非門205。root修原生down capture前同步bounds/displayScale（destroy移除listeners），單頁實測over Zone/activations1與真入房，再恢復兩config最終流程。修正後build/typecheck及兩config各兩Firefox157真WebGL，未鎖點canvas門入/出及HTML再入；上鎖錯誤留lobby原位/0封包、正確入studio，private publisher事前持續合成語音，外部無/錯join與訂閱/偽造皆拒絕。實際AudioWorklet render未鎖2048、上鎖1792samples；stop/ACK/穩定後source33/58、visitor11/9全部hash匹配、cap未達，page/socket errors空。

root已讀回JSON/hash與代表圖，README/SOL-003/004/007/008與協作/需求同步。兩config皆本機同app依序啟動；無真mic/人耳/原生畫面/手機/完整T09角色/即時鎖房或全面資安/容量驗收，完整POC-03未通過。錯誤提交前client會清理舊影音，server原房資格保持但需手動重開本機媒體的限制已明示。無新依賴/AV底層變更，程式+紀錄本機commit、不push/遠端票/T09/部署，writer與runtime停止釋出。

## T09／POC-03-R005：主持權限與即時鎖房（2026-11-04）

人類指定T09輕量核心與用法、程式+驗測紀錄commit；已讀回#10「主持權限與 Session 控制」。在8a19ebf上加入可配置managed模式：HOST_CONTROL_TOKEN在入房後WSS claim當前房主持，與入房密碼分離/禁止重用；主講grant/revoke、remove、live meeting lock/password/unlock、活動結束均由server權威處理。無token保留匿名技術POC，管理不可用；非正式帳號。

34核心/build/typecheck及追加host切房往返3/3通過；三Firefox157最終06:06:18.637～06:06:27.376UTC合成音畫、grant/revoke/end/live lock/錯正密碼/room-password claim被拒/unlock直接再入房通過。實播13,824samples/3frames；撤權source18/4、end22/5在track ended後350ms穩定，host最終收22/5，五種外部越權+後續start/binary拒絕。這是可行性/計數，沒有payload hash、真人或品質門檻結論；移除成功以Node4001契約驗。

初全量33/34只是第三處精確snapshot漏新欄位；兩次browser分別文字strict-mode與root補的門按鈕尾綴選取失敗。其後script pass但root看圖發現門圖OPEN/metadata locked矛盾，窄修renderer每次room更新重畫顏色/標示，補三頁POST_RENDER鎖/解鎖斷言，重build與受影響browser成功。R005保留全部原始結果/圖/診斷，最終report/計數/root讀回與代表圖已保存查看。

SOL-002/003/004/007/008與README、需求狀態/計畫/票面/協作紀錄同步。沒有新依賴、codec格式或距離規則變更。bootstrap主持secret/匿名新身份/記憶體鎖與grant、限次可新socket繞過、未驗手機/真人/耐久/容量/雲部署是MVP限制；完整POC-03仍未通過。source writer交接異常已在dispatch如實記錄/核對，root最後唯一writer。server/browser停止，本機commit、不push/遠端票/T10/部署。

## T10／POC-03-R006：房內互動與公開彈幕（2026-11-04）

人類指定輕量核心與用法、程式+紀錄commit；#11「房內回應與公開留言」已讀回，基線cff55ba。加入👍讚/👂我想聽/💡這個實用、300-codepoint聊天、固定圖案與60-codepoint明確公開彈幕；聊天/圖案不自動投影。現有同一WS與T09 hostActive管理pause/block/clear/remove，server嚴格schema/room/identity、限流/去重、有界TTL與dirty狀態更新，無新依賴/媒體或Phaser修改。

root build/typecheck、完整39/39與首次三Firefox157流程06:47:10.243～06:47:29.929UTC通過。studio各22個唯一ID/集合相同，duplicate-probe各1，guest UI11accepted；lobby異房觀測0後刻意本房送1/切房/離開，前一房UI清除。外部未主持/偽造room/ID碰撞拒絕，11速率探針10接受1拒；pause仍能收新公開、block聊天仍可用、remove/clear效果不同、8秒過期可見。root讀回全部trace並看live公開圖與guest最終圖，errors/cap皆無；只驗本頁固定公開區，不做飄移或T11展示頁。

開發中typecheck欄位型別缺漏與focused queue2≠1保留在R006，補型別/各案新app/清情境舊queue後5/5；root檢視補容量拒絕保留舊ID、dirty通知、UI時鐘/acceptance、腳本async等待及負例預先監聽。source交接後無late patch，build指紋保持一致，root無需重跑全量。

SOL-003/007/008與README、需求狀態/計畫/票面/協作索引同步。50歷史/5min、20公開/8s、512 feedback/60s、2048去重/10min、10互動/s含feedback1/s皆POC初值，非商品定案。臨時participant不是真人帳號，restart清記憶體、跨重連去重未知；原票100accepted/p95未驗，完整T10品質/POC-03 Inconclusive。資源停止釋出，本機commit程式+紀錄、不push/遠端票/T11/部署。

## T11／POC-03-R007：直接入房、只互動與唯讀展示（2026-11-04）

人類指定輕量核心/用法與程式+紀錄commit，#12已讀回，基線0607576。新增room/mode深連結與獨立display入口，仍共用名字/密碼門禁；qrcode-generator2.0.4本機QR只編公開入房URL，jsqr1.4.0 dev獨立解碼。server固定降權role、media mode資格/退訂/egress守衛與self enqueue計數；client先dispose再切模式，保留同身份/房間/草稿/音量，回watch手動開始。display僅公開projection、自動video不auto audio，越權由server拒絕。

root build/typecheck、42核心與三Firefox157短流程08:04:33～08:04:45UTC成功。5個425～427ms窗口來源audio新增21～22／screen5～6frames，參與端server計數差值/raw media皆0；手動watch實際11,008samples/3frames，切換保留與不auto驗過。展示實播/公開可見、無私聊/圖案raw history，9外部唯讀負例拒絕；270pxQR實解碼→正常密碼門禁新身份。root指紋/JSON讀回及兩代表圖已查看，errors/cap皆無。[R007](evidence/POC-03-R007/README.md)保留證據與操作。

首次完整41/42為舊space共享app時序，隔離每case app後42/42，未改space模型；首次browser錯用參與頁selector逾時，保留first-attempt，只修script再通過。SOL-005/003/008及002/007、README/需求狀態/計畫/票面/協作同步，無late source patch。手機相機/真人/原生擷取/fullscreen/弱網/耐久/容量/雲與完整POC-03未驗；本輪僅桌面核心可行。server/browser/writer停止釋出，程式+紀錄本機commit，不push/遠端票/T12/部署。

## T12／POC-04-R001：控制狀態自動重連（2026-11-04）

人類「繼續下一個」接#13，輕量核心/用法及程式+紀錄commit沿用，基線133684b。已配發scope與讀回票面，server短期opaque憑證、同身份/房間/mode恢復、最新門禁revision與權限、去重/過期，client退避重試/刷新與媒體停止。Luna xhigh實作，root設計/驗收；進行中，尚未判結果。無新SaaS/依賴、T13媒體/手機/耐久/容量/雲未納入。

### T12完成與保存讀回

root production build/typecheck、完整47/47與首次三Firefox157流程08:47:28～08:47:49UTC通過。participant/host/display受控close4000後同身份控制恢復、回饋可用；切lobby後refresh仍server原房/身份、回studio正常門禁；舊grant/host不復活、host需再claim，display resume不自動screen.subscribe。live改密碼後舊錯新對；同eventId跨resume duplicate ACK且額外projection0，等待8,696ms後publicQueue/replay皆0；active Leave後refresh不auto resume。[POC-04-R001](evidence/POC-04-R001/README.md)保存命令、摘要、兩圖、source指紋/清理與手動用法。

新增5契約含remove舊proof失效/假token/1KiB、clock seam的離線10min TTL/512cap；active不因prune到期，未過期record不提前淘汰。root source檢視收斂gate revision/同房及mode不刷新、只處理自身leave、offline cancel可達、舊events清理與StrictMode retry arm；script檢視收斂新socket/ACK相關性與有界hold forwarding、當前密碼。這些是執行前修正，本輪沒有虛構failed run；首次完整/browser皆通。

保存為斷言摘要/代表圖，未保留raw身份/逐包控制trace；root實際看圖/讀回source-match，無獨立逐包重放宣稱。程序內短期bearer不是帳號/耐久；offline cancel只清本頁且server等TTL，control恢復不auto媒體，8次耗盡/半開/手機/弱網/耐久/容量/CloudRun/完整POC-04未驗。SOL-003/005/006/008及README/需求狀態/計畫/票面/協作同步，全部writer與runtime停止釋出，程式+紀錄本機commit，不push/遠端票/T13/部署。

## T13／POC-04-R002：影音解碼/接收恢復（2026-11-04）

人類指定同頁影音斷線後恢復訂閱/播放、輕量與程式+紀錄commit，基線0ade7c9；#14已讀回，R002配發。兩Luna xhigh分source/tests/README與smoke，root設計/驗收/權威紀錄/Git。原接收意圖綁room、最新快照後恢復，manual stop/interaction/switch/Leave不復活；來源/舊權限不auto，Audio手勢例外分列。實作中，未判結果；20次/p95/手機/弱網/完整POC-04及T14/雲不在本輪核心。

### T13桌面核心與分段驗收完成

production build/typecheck、完整54/54一次通過，7新恢復＋5既有timeline聚焦12/12。client保存同頁room-bound接收意圖，fresh本socket room/participation後一次訂閱；新controller/timeline取當前config/clock/keyframe，manual stop/interaction/換房/leave清意圖、refresh仍手動媒體，來源/舊權限不auto。

[R002](evidence/POC-04-R002/README.md)保留三次full腳本失敗（初次keyframe等待順序、Continue locator、最後sender同類等待順序）及停止整套後publisher-only窄驗Pass。third接收段已實證connection2 authority後audio/screen subscribe，samples0→4672／frames0→1、display3→4、audio-master同clock；手動停止再close connection3無subscribe，sender tracks ended/無auto capture/start/host。窄驗正常claim/手動新來源generation1→2/新clock，participant13568samples/2frames、display7frames。核心分段可行，不宣稱最終full腳本整段通過。

root由白名單control序列獨立讀回9～10ms authority、單次163/325/533ms觀測render（非p95/E2E）；看中斷/恢復/新來源三圖，指紋一致。這次Firefox自動恢復無需gesture，手勢分支/第二輪locator瞬間原因未獨立驗證；20次/5s門檻、手機/真人/弱網/耐久/完整POC-04仍Inconclusive。應用source未latepatch，server/relay/協定/依賴/Phaser未改。SOL-002/006/008與README/需求狀態/計畫/票面/協作同步，runtime/writer停止釋出，程式+紀錄本機commit，不push/遠端票/T14/部署。

## T14／POC-04-R003：慢端隔離（2026-11-05）

人類「繼續」接#15，維持輕量核心與程式+紀錄commit；R003配發，基線ff672f0。新增每socket send budget與client local queue界線候選，少量Node seam＋三Firefox健康/單慢接收對照及T13恢復；root設計驗收，兩Luna xhigh分程式與腳本。進行中無Pass判定；driver壓力與serverbudget分列，不將應用注入/graph本地age當TCP或E2E延遲。

## T14本輪結果（2026-11-05）

T14交付（2026-11-05）：[POC-04-R003](evidence/POC-04-R003/README.md)保存63核心/build/typecheck與最終完整三Firefox輕量流程。per-socket共享byte/callback budget、PCM/video local residence有界；慢端bounded應用hold後新連線/config/keyframe與實播，健康端hold5次/恢復後3次及ACK持續。首輪route close未到page的失敗與harness兩端4003修正保留；server policy仍1013。500ms目標實測501ms，非TCP/端到端age；手機/真背景/弱網/品質/完整POC-04仍待。README/SOL/需求狀態/計畫/票面同步，writer/runtime已停止釋出，程式+紀錄本機commit，不push/遠端票/T15/部署。

## T15啟動（2026-11-05）

人類明確指定T15輕量核心/用法＋程式紀錄commit。基線eb58084，R004/#16已讀回，完整writer/scope見dispatch。短兩房整合/受控close恢復/撤權不復活/健康房持續，65min/手機/真弱網仍未驗；root驗收與docs/Git，Luna xhigh新script，不push/T16/部署。

## T15本輪結果（2026-11-05）

T15交付（2026-11-05）：[POC-04-R004](evidence/POC-04-R004/README.md)保存63核心/build/typecheck與最終四Firefox10,069ms完整短整合。兩房合成音畫同時實播、studio本地1s deadline關線後fresh authority/config/keyframe恢復、主持不auto需重新認領；撤權tracks ended/900ms無新增，被撤者再resume無來源/權限復活。lobby12採樣持續與2ACK成功。首輪timer提前1ms斷言失敗/harness窄修保留，app/source/依賴未改。root兩圖/讀回完成，SOL/操作/需求狀態/計畫/票面同步；65min/手機/真背景/真弱網/品質/資源/耐久/完整POC04仍待。writer/runtime已停止釋出，程式+紀錄同一本機commit，不push/遠端票/T16/部署。

## T16啟動（2026-11-05）

人類明確指定少量接收端單房fanout輕量核心/用法+commit；beea0fa、POC05-R001/#17。scope見dispatch，1host合成音畫／1→3真接收／退訂隔離／全停，root驗收docs/Git/runtime、Luna xhigh新script。容量/長測/手機/雲仍未驗，不push/T17/部署。

## T16本輪結果（2026-11-05）

T16交付（2026-11-05）：[POC-05-R001](evidence/POC-05-R001/README.md)以1發布／1→3真Firefox接收完成14,877ms短fanout。三端同config/clock、3採樣實播增長；A退訂350ms無新media而B/C繼續，publisher正常停2來源/其餘streamEnded清空。build/typecheck與browser通過；既有全套62/63限流訊息逾時，單檔9/9通過但根因未定；首輪Continue點擊失敗及窄診斷保留，最終無gesture，該分支未覆蓋。source/依賴未改；root讀回/A-C實看、server30ps採樣僅診斷，SOL/操作/需求狀態/計畫/票面同步。10/25/50／20min／手機／真人／品質/完整負載端資源/完整POC05未驗；writer/runtime釋出、程式+紀錄本機commit，不push/遠端票/T17/部署。

## T17啟動（2026-11-05）

人類指定少量雙房影音/只互動混合核心+用法及程式紀錄commit；7c80a14、R002/#18。scope見dispatch，6真Firefox兩房publisher/watch/only、mode切換/零媒體隔離。Luna xhigh新script、root驗收/docs/Git/runtime；非50人/20min/完整POC05，不push/T18/部署。

## T17本輪結果（2026-11-05）

T17交付（2026-11-05）：[POC-05-R002](evidence/POC-05-R002/README.md)保存build/typecheck/63核心與首次六Firefox18,233ms短流程。每房1source/1watch/1only，兩房實播；專用only初始/活動self0且整輪raw0、回饋同房DOM0→1/異房0。studio watch→only零增量→watch不auto直到manual新config實播，lobby持續。root全hash重算source668/669→ownreceipts643/411，foreign/unknown/ambiguous0、count-byte完整；2圖實看/cleanup。app/依賴未變，SOL/操作/需求狀態/計畫/票面同步；50/20min/手機/真人/品質/全client資源/雲/完整POC05待，無Continue分支。writer/runtime釋出、程式+紀錄本機commit，不push/遠端票/T18/部署。

## T18啟動（2026-11-05）

人類指定程序重啟/資料恢復輕量核心及用法+commit；13fb00e、POC06-R001/#19。scope見dispatch，三browser/owned process實停重起/舊proof拒絕/新身份人工操作重建，動態資料/耐久缺口不得冒稱恢復。Luna xhigh新script、root設計驗收/docs/Git/runtime；無外部服務/持久化決策/T19/MVP/push/部署。

## T18最終紀錄（2026-11-05）

T18輕量評估完成：[POC-06-R001](evidence/POC-06-R001/README.md)保存build/typecheck/63核心與第三輪三Firefox12,837ms真程序重啟流程。PID58035→58041、三舊proof拒絕且無自動操作；重載正常入房得新UUID、重新claim/手動來源與訂閱可實播。feedback1→0、live密碼B失效而startup A有效，**動態資料未恢復，目前process-memory候選耐久No-Go；完整T18/POC-06及MVP Go未通過**。兩個rawWSS越權拒絕、6個server-down預期socket錯誤已核對；前兩次harness缺陷/修正保留。root獨立讀回/兩圖實看、source指紋未變、cleanup完成。SOL-007既有清冊原位更新，未新增保存方案或接受資料遺失；app/tests/依賴未改，新增重啟驗測script與操作紀錄。writer/runtime停止釋出，程式與紀錄同一本機commit；不push/遠端票/T19/MVP/部署。

## DEC-012持久化整合最終紀錄（2026-11-05）

DEC-012資料庫整合完成：[POC-06-R002](evidence/POC-06-R002/README.md)保存PostgreSQL18.6 Docker／pg8.23.1與migration、系統資訊保存及恢復用法。最終build/typecheck/63核心、真PG整合、ACK後SIGKILL、advisory backend失連停止、兩真Firefox同document/原ID/最新B門禁/chat與feedback恢復、13表同volume容器重啟筆數與指紋一致。有效proof恢復不自動復活主持／發布權，畫面TTL與archive分開；SOL007唯一清冊已原位更新。首輪health shape／fixture event count及browser環境/URL事件誤判等失敗保留、窄修後重驗。完整POC06/MVP/備份/HA/多instance/正式保留政策/雲未驗；舊R001 memory No-Go不改判。所有writer已saved/readback/STOP，root驗收，server/Firefox/Docker已停、volume保留；程式與紀錄同一本機commit，不push/遠端票/T19/部署。

## T19最終紀錄（2026-11-05）

T19／#20審查交付完成：[POC-07-R001](evidence/POC-07-R001/README.md)固定8b5fc43與同版65指紋、重新build/typecheck，沿用R002的63核心/PG恢復證據，另在PG重驗四Firefox短整合10,394ms、六Firefox混合19,021ms。root重算來源隔離/only0/authority與撤權、實看PG實播畫面；原T15 Continue逾時與私有port probe TIME_WAIT診斷保留，僅測試副本窄修，產品與原腳本不改。既有mvp-handoff原位整理SOL001～008狀態、逐階段證據、GATE001～006、測試工具移出項與MVP順序。

執行紀錄完成／完整資格Inconclusive／technicalGo=false（NoGo）：真mic至另一端真人聽見與目標實機手機加入/選房/只互動證據仍缺，首批支援範圍未確認。不是要求補50人長測/全面QA或本輪CloudRun部署；容量硬上限8、實測6明示，PG保存缺口已解，不重新要求批准資料庫。尚未開始MVP，不推定人類接受品質。source/deps未改，資料volume/test DB保留、server/browser/DB回復停止，紀錄同本機commit，不push/遠端票/部署。

## 桌機真人語音核心確認（2026-11-05）

GATE-001-DESKTOP-AUDIO／[POC-07-R002](evidence/POC-07-R002/README.md)已保存人類確認：對耳機是否聽見回答「OK」；再對主講停麥/重開及接收停聽/重開回答「兩端都測過，正常」。本輪Edge桌機兩頁真人語音核心Pass，Edge版本未回報，不以指南Chrome當實測。appshot計數僅佐證管線，不以RMS瞬間值推斷人耳或量化品質；原話/範圍分開保存。手機由人類指定先不做，仍待；完整進場NoGo/MVP未開工保持。服務繼續localhost:4173與專用PG運作，root不操作人類Edge或收音，無程式改動／新合成測試／部署。

## GitHub進度同步完成（2026-11-05）

依人類「要記得更新進度」，[母議題#1](https://github.com/samzhu/LaiTse/issues/1)及T01～T19（#2～20）已加入最新進度段，說明核心已驗／未驗、DEC-010輕量範圍、DEC-011空間門禁與DEC-012 PostgreSQL18例外；桌機Edge真人語音與兩端啟停已確認，手機仍待、technicalGo=false。保留原AC、open與labels，沒有推送程式、關票或部署。20張寫入後均讀回正文完全一致，before／expected／readback SHA256見POC-07-R002/github-progress-readback.json。後續相關POC保存後同步相關票的偏好已記入brief。

本輪只有紀錄變更；JSON解析、20張Issue精確讀回／原文與狀態保持、證據路徑及git diff檢查通過，不重跑既有程式測試。R001歷史結果不覆寫。文件writer／GitHub寫入已結束；localhost:4173及專用PG容器繼續運作供人類，未接管Edge／麥克風，未做手機或MVP。

## MVP-DESKTOP-PLAN／DEC-013（2026-11-05）

人類確認桌機MVP優先、手機後續，授權先整理功能／開發計畫並集中討論待決項。已保存並讀回PRD v0.10第6/9/11節：F01～09核心範圍、M00～06開發／輕量示範順序、D01～06待決（身份／邀請、OS／瀏覽器、容量／發布、距離／門口／視覺、活動／資料、交付／部署）。D01～03先討論，其餘到相依階段前確認；建議不當人類決策。

手機已從本版前置移除，不再以未做手機阻擋桌機規劃；T19原NoGo與未驗證據保留，未自動宣告全technicalGo。只規劃／文件，未開始MVP程式開發、未新增實測／拆票發布或部署；src/tests/deps不改，沿SOL007唯一資料清冊；manual服務不操作／不停止。後續GitHub母#1、手機#3與審查#20同步本次版本界線並讀回；驗測採文件／連結／狀態一致性，不重跑程式全測。

## POC-MA-01-R001／會議室多人語音（2026-11-06）

POC-MA-01／R001（2026-11-06）已完成會議室多音訊來源relay、逐來源decoder／AudioWorklet／時鐘與計數，lobby仍單來源；screen同時一人及同源clock保留。最終build/typecheck與四Firefox合成短流程11,063ms／媒體6,461ms完成；root重算A收B318、B收A302、C收A161/B175，未知／自送／歧義0、D影音0，A停B持續、晚加入／重連／切房／only0與單screen競爭通過，兩圖已實看。

自動結果分開：初次66pass/1PGskip原log後被覆寫，root先前讀回計數保留；第二全套65pass/1space快照時序失敗/1PGskip，space窄診斷3/3，未改空間功能／測試，不稱最終全套綠。首輪Firefox sandbox啟動中止、受控首次成功、狀態文字修正後同頁並行點擊screen.subscribe未送出失敗、腳本改循序後最終成功皆保存，不回改舊run。

真人多人聽感／Chrome/Edge跨裝置／本輪PG多人整合／真弱網／容量品質未驗；Docker不可用故memory fixture，無schema／新依賴，原8人程式門檻與舊managed主講授權仍在，不是新商品鎖房管理已完成。自有server／browser已停，未操作原4173／人類Edge／麥克風；未開始MVP／push／部署。

證據：[R001](evidence/POC-MA-01-R001/README.md)，core Pass與執行完成／完整資格／人類收聽分列；SOL-002/006/008與PRD M03採用界線已同步。

## POC-RM-01-R001／匿名管理與交接（2026-11-06）

POC-RM-01-R001（2026-11-06，基線0995141）匿名studio管理核心Pass：上鎖詢問密碼、server匿名ID唯一owner、改密碼／解鎖／手動轉交、同名越權拒絕；DEC017換房保留管理權且空房仍鎖，僅owner離線時從房內在線participant隨機接任／無候選自動解鎖，舊人重連不自動取回。私有轉交名單只給owner，display不參選；舊HOST_CONTROL_TOKEN模式保留原行為且停用新匿名命令。

build2/typecheck通過；core69pass/2個PG當時skip，root真PG串行2/2無skip，驗001→002舊鎖/verifier/revision升級保留、匿名lock/transfer ACK後讀回及restart只清匿名孤立鎖、legacy鎖保持。最終4Firefox13項10,214ms通過、兩圖已實看；另正向owner unlock可信WSS與PG清除讀回通過。root獨立核對65條狀態與7筆該run審計、71份來源指紋。初次test syntax typo、browser等待錯事件／離開ACK、historical-state helper修正及各次結果保存。

共同相依的MA01同版PG短回歸11,328ms／active6,505ms通過：A收B323、B收A306、C收A160/B172，未知／自送／歧義0、D影音0、單screen與恢復／切房／only0保留；不是重啟影音自動恢復或真人聽感驗收。自有server/browser已停、專用container還原exited，DB/volume保留；未接管人類Edge或實體麥克風、未push／部署／啟MVP。

[完整操作／證據](evidence/POC-RM-01-R001/README.md)。隨機案例只驗合法候選範圍，非統計公平分布；實體斷網偵測延遲／背景、容量／手機／雲與人類商品接受未驗。SOL003/007原位更新，唯一資料清冊不另建。


## POC-CAP-01-R001／容量研究與基線（2026-11-06，未完成）

人類先要求移除固定8人、超過8人加入／互動／影音輕量POC並commit/GitHub，再補Cloud Run 1CPU/1GiB推估與服務內可調軟限制。軟限制超額行為及免登入時的容量調整入口正在詢問；目前不先改join/resume准入。研究保存於`../research/cloud-run-capacity-1cpu-1g.md`，官方CPU/memory/concurrency/WebSocket/network資料與本地推估分開。

基線5eceea1既有dist在node:26.13.0-bookworm-slim arm64 Docker啟動，限制NanoCpus=1000000000、Memory=MemorySwap=1073741824（無額外swap），外部PostgreSQL18.6新專用DB，可信HTTPS/WSS與健康回應ok。startup-only無人13樣本不可推估容量。再以8個opaque WS client同時送32kbps名目audio＋互收、1個800kbps名目screen，約10秒：送audio3672、收25704=3672×7；送screen147、收1029=147×7，無error／提前斷線。產生器目標50fps但實際45.88fps／講者；10個active樣本process CPU平均20.97%峰27.77%、RSS峰97,112,064 bytes，event-loop delay p95各樣本之最大32.92ms（非E2E latency）。這是轉送成本基線、不是codec/browser／人耳／Cloud Run驗測，不能由此線性宣告最大人數。曾在app cgroup啟短診斷node，故不用該cgroup peak冒稱純服務記憶體。

證據`evidence/POC-CAP-01-R001/`保存原始計數、sample、摘要、產生器與baseline dist指紋。GitHub#1/#18已更新進行中，正文2/2精確讀回且原state/labels保持，receipt同資料夾。原服務／人類Edge未動；本輪app container與專用PG container已停讀回exited，DB／volume保留。研究writer已saved/readback/STOP；來源第一階段與>8browser腳本仍各唯一writer交接中，尚未全候選build／實測>8／軟限制保存／commit，不算本POC Pass。


## POC-CAP-01-R001完成（2026-11-06）

固定8人改為PG保存的可調全服務容量，初值10、輸入1..1000非承載保證；本機管理頁顯式啟用且loopback/Host/Origin限制，滿額拒新join/resume、降額不踢現有人，展示端也顯示動態容量訊息。管理UI 2→1→3→20、PG直接讀回／程序重啟20與最後restore10均通過；真正PG18.6／migration003沿SOL007，不新增第二清冊。

10Firefox corePass：10加入／10聊天、9合成Opus來源逐來源WebCodecs/AudioWorklet PCM與單VP8呈現，32,368ms／active8,254ms，無page/protocol errors、10profile全清。首次decoder8pending永久停止已修為有界local skip並恢復；新counter分開source序號缺口。早期JSON58drop、500ms窗+58，後續實看截圖333drop（received1283/decoded873/PCM795648），因此不判聽感或零丟失品質通過。非9×9真人互聽。

1CPU/1GiB Linuxarm64本機opaque relay各約10s：10人CPU平均27.94%峰34.55%、RSS70.88MiB；12人24.12%/28.30%/76.29MiB；16人26.81%/32.67%/79.97MiB。audio下送45,090／66,132／120,000、screen1,332／1,617／2,205，均等預期、無error，約50fps。PG／產生器在cgroup外，暖機/GC/歷史不同，不線性外推CloudRun最大值；高頻移動與控制寫入尖峰、長測／真網路未測。建議先10席可調，16只是伺服器此workload已測點。

最後全suite81/81真PG無skip、build/typecheck通過；保留中途80/81與server單檔11/11，窄修新容量case清理共享上限/await close後81/81，沒改production限速／放寬timeout。所有首輪失敗、修正與結果分開保存；完整操作/來源指紋/限制見[evidence/POC-CAP-01-R001/README.md](evidence/POC-CAP-01-R001/README.md)。自有服務/browser停，PG原exited恢復，DB/volume保留；未碰人類Edge／mic、不push／部署／自動MVP。


## POC-DESKTOP-01-R001完成：自動桌機核心／真人環境保留（2026-11-06）

最新人類指示「先你自動驗證就好，我真人驗證要有環境」，本輪先單機Chrome/Edge合成自動化；真人真mic／OS分享與多人跨桌機仍pending。macOS27.2／Node26.13.0，Chrome157.0.8103.38／Edge156.0.4314.58三隔離profiles、兩publisher與C晚加入，9項7,285ms通過。原生Opus decode/AudioWorklet PCM、互聽不自回送、C雙來源/VP8呈現、A停止B續送且C續播新PCM、A新世代、收聽/觀看啟停清空通過。C初始兩路PCM2496/2752、RMS非零、local drops snapshot0；不外推CAP01九路持續略包已解。首13,707ms pass的弱斷言（B received比sent）已改sent比sent＋C新PCM，兩次結果分別保留。

無產品碼改動，核20dist仍5dea2e2、未重build/全81，本輪syntax＋真Chrome/Edge流程。3contexts/profiles清，沒有操作人類分頁/真mic/OSpicker/系統權限。**保留**native Node PID53830、http://localhost:4174/?room=studio與專用PG容器給之後人工，freshDB/anonymous/unlocked/10席，結束0在線且PGready；不停止/刪資料，不碰原4173。私有runtime在.scratch/desktop01，不提交DSN或profiles。

人類另明確授權驗後可關Issue並寫核心實作避坑。已依桌機輕量範圍關13票#2/#4/#6/#8/#9/#10/#11/#12/#13/#14/#15/#18/#19，保留#1/#3/#5/#7/#16/#17/#20 open；20/20正文/狀態精確讀回、title/labels/原AC歷史保留，沒有代勾未驗值。未驗真人/手機/弱網/品質不因關票變Pass。證據[POC-DESKTOP-01-R001](evidence/POC-DESKTOP-01-R001/README.md)，附人工guide、source/保留環境/避坑與兩輪資料；紀錄和script同本機commit，不push/部署/自動MVP。

## POC-FINAL-01-R001（2026-11-06）

DEC-019改採桌機自動核心驗收：本輪build/typecheck、真PG全套84/84（0skip）、Chrome/Edge TCP故障／交接9項24,581ms、3/6/10瀏覽器對應2/5/9來源的約4秒PCM窗0decode queue drops，以及Firefox可信HTTPS晚加入／audio-master／來源重建10階段通過。真mic／OSpicker／真人多人、跨實體桌機、手機、校準同步p95／65min及CloudRun仍未驗，移後且不冒稱Pass；歷史CAP01 Firefox九路333drops保留。新增server ping10s/pong20s失聯偵測，沿close串行清理／PG管理交接；PG session lease不等於網路心跳。技術核心足以進入桌機MVP整合規劃，未自動開始MVP程式／push／部署。

[證據／用法／失敗／限制](evidence/POC-FINAL-01-R001/README.md)。人工4174／PID58824與PG保留，測試4175已停，自有proxy／contexts／profiles清理，所有writer已STOP；GitHub7票更新正文/狀態已保存讀回，20票closed（19completed／手機not_planned）；程式與紀錄納入本筆本機commit，不push／部署。
