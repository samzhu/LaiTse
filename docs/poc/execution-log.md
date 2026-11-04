# POC 執行紀錄

- 權威計畫：[POC-PLAN v1.1](plan.md)；v1.0執行的歷史run依當時方法解讀，原始證據保留。
- 建立日期：2026-11-03；更新：2026-11-04。T06本機晚加入／同步排程核心已有證據；裝置、品質及完整階段尚未通過。
- 本表只記實際執行與證據；階段需求與篩選值以計畫書為準，不在此重訂需求。

## 階段現況

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
