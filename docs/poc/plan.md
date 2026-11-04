# 來坐 LaiTse 分階段 POC 計畫書

- 識別碼：POC-PLAN；版本：v1.2；日期：2026-11-04。
- 狀態：T01～T13桌面核心依執行紀錄判定，完整階段未通過；v1.2補DEC-011空間規則。沿用v1.1輕量驗測，不要求完整品質驗收。
- 版本界線：GitHub母Issue仍為v1.0發布鏡像；v1.2依DEC-011同步本機PRD v0.8與計畫，不改母Issue或遠端票。
- 權威界線：產品目標依來坐 PRD v0.8、DEC-001～011；本計畫只定義技術驗證，不取代產品需求。
- 執行環境：本機單一應用伺服器、真實桌面／手機瀏覽器；本輪不部署 Cloud Run。
- 發布方式：GitHub Issues 為本計畫的發布鏡像，套用 `ready-for-agent`；標籤不表示已開始開發或已通過驗收。

## DEC-011新增驗證範圍（2026-11-04）

產品行為已確認：開放空間依人物距離接收語音廣播，會議室內成員全房接收；有門的會議室未鎖可直接進入，上鎖需密碼。先前將近距離音訊留後續的範圍已被PRD v0.8取代。既有T07/T08證據保留，只支持原人物移動/匿名房間隔離，不能推定新功能通過。

在POC-03追加下列最小閉環。**目前DEC011-A／R003、DEC011-BC／R004與T09／R005已有各自桌面核心證據，最新邊界見本文件末結果及execution-log**；不自動啟動下一票或MVP、不修改GitHub發布鏡像：

1. 距離廣播：同一開放空間中一發布者與近/遠接收者，近端真解碼/渲染、遠端新增下送0；移動跨越收聽邊界後資格切換。server依權威座標路由，偽造位置/訂閱欄位不能繞過。先確認單來源可行，多來源同時接收/混音另行設計，不將單來源證據擴張。
2. 門與密碼：場景門口/替代入口進入未鎖會議室；鎖定後測無密碼/錯誤/正確密碼及外部client/直接入房繞過。未授權者不取得房內影音/成員內容；上鎖不踢原成員的既有規則保持。
3. 會議室範圍：兩名已入房成員相距較遠仍可收聽；房外靠近門口收不到。離房/跨區域後停止舊資料，保留使用者啟用收聽與只互動選擇。

距離數值/進出邊界緩衝、音量漸變、多源來源識別與訂閱、密碼更換/重入有效期仍待設計。應依測試fixture設定並明示，不把示範參數當人類接受的商品設定。現有單一room/channel publisher與以room選relay的模型需要擴充；沿用單一本機app/WS/Opus候選，不先定案混音或新增服務。

## DEC-011接續切片草案（2026-11-04）

人類於暫停後指示「繼續」，並釐清本輪「會議室跟開放空間」。本輪已啟動DEC011-A：兩類空間的收聽規則，配發POC-03-R003；其餘B/C仍為規劃草案，未發布新票。配發不等於程式完成或run通過。沿用DEC-010短核心驗證，正式距離/多來源/密碼有效期仍未定案。

| 切片 | 完整可展示流程 | 真正前置 | 最小驗測與後續復用 |
|---|---|---|---|
| DEC011-A：開放空間距離廣播 | 伺服器回報空間類型；一位開放空間發布者、近/遠兩位接收者。啟用收聽後，人物移入/移出示範半徑時取得/停止該語音；會議室保留全房收聽規則 | T07位置權威與T08分房relay的既有可行基底；不需要先做門或主持管理 | 三真實桌面browser／合成Opus；近端實際decode/render、遠端新增audio0，移動跨界後資格交換；外部client不能自填距離或位置直接越權。保存原始下送、位置/資格切換、用法及限制；可復用接收資格策略，半徑只是明示fixture |
| DEC011-B：未鎖會議室的門與全房收聽 | 人物從開放空間經可辨識門口進入會議室，離開後回到開放空間；提供等效鍵盤/點選入口。未鎖無密碼，房內遠距者可收聽、門外近距者不可收聽 | T07位置/進出與T08成員/影音隔離；不依賴A的距離算法 | 真browser驗移動/入口操作、server ACK與成員更新、舊媒體清理；房內遠距實際播放、門外新下送0。保存門口與空間類型契約，不把只切房按鈕當場景門完成 |
| DEC011-C：會議室上鎖與密碼准入 | 有權設定鎖的控制者鎖房/解鎖；一般參與者無/錯誤密碼被擋、正確密碼入房並按會議室規則收聽；原房內成員不因上鎖被踢 | B的門口/多入口准入；另需T09的伺服器權威管理角色基線，或人類選擇將最小管理授權一併納入本切片。不得用任何人可呼叫的設定API替代 | 真browser正常入房及外部client繞過門/直接join/switch/錯誤身份測試，未通過者新增房內影音/成員內容0；場景門與直接入口共同使用server准入。密碼不出現在公開房間快照/紀錄；不是完整帳號/資安驗收 |

建議先A，再B；兩者無功能阻擋但共享檔案須依writer交接序列修改。C接在管理授權基線後，不能因A已可行就當門禁已通過。具體新票識別/發布、是否擴充T09與哪個切片先實作，待本輪範圍釐清；不改原19票的完成證據或遠端關係。每步獨立留下code/操作/短證據，最後再做開放空間→門禁→會議室的整體流程。

## Problem Statement

來坐需要真實多人共享空間、像素人物、同房語音廣播與畫面分享、現場只互動模式，以及可撤銷的主持權限。計畫建立時只有產品文件與官方資料研究；目前T01已有可執行本機基線，但仍沒有影音品質或50人容量證據。

直接開發 MVP，可能直到後期才發現瀏覽器編解碼不相容、音畫延遲不可接受、慢速觀眾拖垮全房、重連復活舊權限，或本機保存方式不符合未來單一 Cloud Run 的部署條件。單次展示成功也不足以把實驗程式當成可重用方案。

因此需要先分階段驗證最難與最有影響的技術；每次實驗同步記錄版本、條件、失敗、修正與證據，最後才能選出有依據的方案供 MVP 使用。

## Solution

以同一個最小 POC 應用逐段增加能力。先建立 Node.js 26 LTS 基線與量測，再依序驗證音訊、音畫、多人空間與權限、重連、負載與資料恢復，最後做 MVP 進場審查。每階段可包含多次實驗；失敗不刪除，後續成功以新的執行紀錄取代結論，而不是覆寫歷史。

主要驗證邊界為 **真實瀏覽器 → 本機單一應用的公開介面 → 另一個真實瀏覽器**。此完整流程邊界已由人類確認；原提議中的 Cloud Run 端點依人類後續指示改為本機端點。編解碼能力探測、解析器或狀態機單元測試只作必要診斷與防回歸，不替代端到端證據。

POC 可使用最薄的操作介面與預設場景，不提前建造正式 MVP。測試驅動器、負載產生器和手機都是測試端，不是額外產品服務；不得為了讓方案成功，偷偷加入外部影音 SaaS、Redis、資料庫或其他部署服務。

### 分階段路線與進出條件

| 階段 | 要回答的問題／最小工作 | 進入條件 | 完成證據與下一步 |
|---|---|---|---|
| POC-00：本機基線 | Node 26、候選套件鎖版、單一 server 提供前端／API／WSS；桌面與手機信任的 HTTPS；編解碼能力探測與量測方法；列出資料保存架構紅旗 | 計畫與人類決策已保存 | 可重現安裝、建置與啟動；兩個真實接收端連到同一應用；版本／授權／能力矩陣與基線紀錄完整。缺設備或未實測須明示，不寫成支援 |
| POC-01：語音閉環 | 一位主講人 → 本機 relay → 至少兩個接收端；優先 WebCodecs＋AudioWorklet，必要時比較另一 pipeline；驗證播放手勢、拒絕權限、開關麥與連續收聽 | POC-00 通過必要能力項目 | 真正擷取／傳送／播放的證據、延遲與音訊中斷量測；至少一個接收端為實體手機。必要裝置無可用路徑則停止該候選 |
| POC-02：畫面與音畫同步 | 加入螢幕分享；晚加入、聲音與畫面獨立啟停、來源停止／更換、codec/config 更新及音畫時鐘 | POC-01 路徑可用 | 語音與畫面同時接收；停止任一來源不破壞另一來源；晚加入取得可解碼起點。WebCodecs 與 Recorder／MSE 比較須用相同條件，不以錄影 Blob 能傳送當成直播通過 |
| POC-03：空間、房間與權限 | 最小 Phaser 像素角色、桌面移動／手機選房；兩房各一主講人；回饋／文字／圖案／明確彈幕、直接入房、觀看與只互動；最小展示端及主持操作 | POC-02 通過 | 真實多人可見移動與切房；媒體／互動不跨房；無權 client 無法加入／發布／接收；撤權、鎖房、移除及結束 Session 生效，房間仍存在 |
| POC-04：重連與弱網 | 斷線、晚加入、重新整理、擷取來源消失、慢接收者、前景／背景切回；先重驗身份／權限再恢復狀態與媒體 | POC-03 權威規則成立 | 不復活撤銷權限、不補播過期彈幕；慢端佇列有界且不拖垮健康端。模擬 timeout 與至少 65 分鐘本機穩定性分開記錄，不宣稱驗證 Cloud Run 真實逾時 |
| POC-05：50 人負載 | 依 2、10、25、50 人逐級測試；一房集中與兩房同時分享；另測只互動比例；分清真瀏覽器解碼與合成 relay 負載 | POC-04 正常／弱網結果可重現 | 完整紀錄 CPU、記憶體、佇列、流量、互動 p95、媒體延遲／畫質／中斷及負載端飽和狀況。50 個空 socket 不算 50 人影音驗證 |
| POC-06：重啟與資料語意 | 本機程序重啟、替換／重連與舊憑證；分類固定場景、執行期設定、角色／成員、撤權、訊息與統計應如何恢復 | POC-00 已列風險，可先完成資料盤點；整合恢復測試依 POC-04 | 提供恢復實驗與符合後續部署限制的資料方案；本機檔案／SQLite 能保存不代表 Cloud Run 可保存。若無符合需求的方案，列 No-Go 並提交決策，不擅自接受資料遺失 |
| POC-07：MVP 交接審查 | 用一套候選組合重跑關鍵流程；整理可採用、需重構、拒絕與未解方案，提出 MVP 架構與開發順序 | 前述必要階段有可讀證據；無核心阻擋被隱藏 | 形成可追溯方案交接包及技術 Go／No-Go 結論。未通過必填條件不啟動 MVP；技術 Go 不表示產品已驗收、Cloud Run 已實測或已發布 |

順序優先消除影音風險；資料盤點可及早進行，避免到最後才發現架構矛盾。只有必要依賴通過才推進相依實驗；獨立盤點可繼續。人類要求先 POC 後 MVP，因此 POC-07 前不得轉入 MVP 功能擴充。

## User Stories

1. As a product owner, I want staged POC gates, so that I can resolve technical risks before funding MVP development.
2. As a product owner, I want the existing product requirements preserved, so that experiments do not silently reduce the product scope.
3. As a product owner, I want local development and testing only, so that this phase does not require a Cloud Run deployment.
4. As a product owner, I want cloud assumptions separated from local evidence, so that I understand what remains unverified.
5. As a POC developer, I want Node.js 26 LTS as the shared baseline, so that development and later deployment use the agreed runtime.
6. As a POC developer, I want exact dependency and build versions recorded, so that another developer can reproduce an experiment.
7. As a POC developer, I want one application server, so that the experiment respects the intended deployment shape.
8. As a POC developer, I want a trusted local HTTPS setup, so that real phones can exercise protected browser APIs.
9. As a participant, I want audio playback to respect my gesture and permission choices, so that sound does not start unexpectedly.
10. As a speaker, I want to broadcast my microphone, so that room participants can hear a real live source.
11. As a speaker, I want to share my screen independently of my microphone, so that stopping one does not interrupt the other.
12. As a remote participant, I want to join an ongoing share, so that I can start listening and watching after the activity begins.
13. As a mobile participant, I want actual playback tested on my device class, so that desktop success is not mistaken for mobile support.
14. As a developer, I want codec negotiation tested across target browsers, so that incompatible clients are identified before MVP work.
15. As a participant, I want an identifiable pixel avatar, so that others can recognize my presence.
16. As a participant, I want movement and room changes synchronized, so that everyone sees the authoritative shared space.
17. As a mobile participant, I want a direct room selection path, so that participation does not depend on precise map movement.
18. As an onsite participant, I want interaction-only mode without media subscription, so that my phone does not create echo or waste bandwidth.
19. As a participant, I want mode changes to preserve my room and draft, so that I do not need to rejoin.
20. As a participant, I want reactions, chat and explicitly public bullet comments to have distinct destinations, so that private interaction intent is preserved.
21. As a host, I want room isolation enforced by the server, so that another room cannot receive unauthorized content.
22. As a host, I want publishing and receiving permissions revoked immediately for future delivery, so that hiding a player is not the only protection.
23. As a host, I want room locks to reject new unauthorized joins without ejecting existing members, so that access rules remain predictable.
24. As a host, I want ending a Session to stop its media while retaining the Room, so that an activity is not confused with the space itself.
25. As a participant, I want automatic reconnection after a disconnect, so that a temporary network interruption does not require manual re-entry.
26. As a host, I want reconnection to use current permissions, so that revoked privileges cannot return from stale client state.
27. As a participant, I want expired effects discarded on reconnect, so that old reactions are not replayed as current activity.
28. As a participant with a slow connection, I want bounded buffering and recovery, so that I do not accumulate unlimited delay or memory.
29. As a healthy participant, I want slow receivers isolated, so that one device cannot degrade the whole room.
30. As a developer, I want process restart tested separately from socket reconnection, so that lost server state is not hidden by a reconnect animation.
31. As a product owner, I want the persistence gap made explicit, so that local disk success is not mistaken for future cloud durability.
32. As a developer, I want representative load at multiple participant levels, so that I can identify where resource use grows.
33. As a reviewer, I want synthetic load distinguished from real decoding clients, so that capacity claims match the evidence.
34. As a developer, I want each failed experiment retained with its cause and next action, so that the team avoids repeating rejected approaches.
35. As an MVP developer, I want versioned contracts and regression evidence, so that I can reuse a proven solution without copying the entire prototype.
36. As an MVP developer, I want test-only controls and experimental code identified, so that they are not accidentally shipped as product features.
37. As a reviewer, I want every adopted solution linked to reproducible runs, so that a recommendation can be audited.
38. As a product owner, I want a clear technical Go or No-Go decision, so that MVP development starts only after its prerequisites are satisfied.
39. As a participant, I want keyboard and reduced-motion paths exercised, so that the shared space remains usable without its optional effects.
40. As a developer, I want cost inputs and local hardware limits recorded, so that later deployment sizing is based on evidence rather than package popularity.

## Implementation Decisions

### 已確認事項與工程候選

- 已確認：自研來坐、人物像素圖、核心不強制依賴影音 SaaS、後續單一 Cloud Run、可暖機與自動重連、Node.js 26 LTS。
- 已確認本輪 POC 只在本機開發與測試；不執行 GCP 部署、建立雲端資源或進行雲端計費實驗。
- 工程候選：React／Vite、Phaser 4、Fastify、WebSocket 插件與 ws。除了 Node 26，其餘是 POC 的比較基準，不是整套框架已獲產品確認。
- 優先音畫候選為 WebCodecs＋Web Audio／AudioWorklet＋WSS；MediaRecorder＋MSE 為有條件替代實驗，沿用相同裝置與品質標準。候選失敗時可比較同限制內方案，不自動回到外部 SaaS、P2P-only 或額外媒體服務。
- 不自己實作編解碼演算法；伺服器首輪只轉送瀏覽器壓縮資料，不轉碼、不儲存真實影音作為產品功能。

### 概念與模組邊界

沿用 PRD 詞彙：Space 是共享場域，Room 是成員、媒體與互動邊界，Session 是一次活動；Participant／Avatar 是參與身份與呈現；Broadcast 與 ScreenShare 分別描述語音與畫面發布。測試執行與參與者不混用同一個 Session 概念。

最小應用分成場景／操作介面、權威房間與活動核心、身份與權限、控制事件通道、音畫 pipeline 與 relay、觀測與故障測試支援。模組分離不等於拆成額外服務。控制與媒體可分 socket、共用同一 server；最終連線數與隔離效果以實驗決定。

對 MVP 暴露的協定以版本化行為契約描述：加入／切房、開始／結束活動、授權／撤權、回饋去重、狀態快照、媒體發布／訂閱、重連與初始化。控制事件具請求識別、結果與失敗原因；媒體具來源、世代、時間戳、序號、格式／初始化版本及可解碼起點。伺服器以連線身份綁定房間和權限，不相信 client 自填房間或角色。

實際 schema 在對應 POC 開發時產生、鎖版並連結證據；本計畫不預先把未實作欄位寫成現成 API。升版須記錄相容行為、遷移與受影響回歸案例。

### 本機環境與測試資料

- 同機桌面可先用 localhost，但手機連入區域網路時，使用實體裝置信任的開發憑證與 HTTPS／WSS；不得靠忽略安全限制的瀏覽器旗標作通過證據。
- 建置後介面與 API／WSS 由同一應用提供；開發熱更新工具只能作開發支援，正式可重現流程須能不依賴它啟動。
- 使用有使用權的像素測試角色、測試音訊／畫面與暱稱；不得把測試角色或合成音畫描述為真實產品內容。實際擷取與編解碼仍須至少有真實操作證據。
- 固定場景／房間可由版本化設定重建；動態管理、成員、撤權與歷史資料的保存需求須另分類，不能把前者可重建當成後者已耐久。
- 本機檔案或 SQLite 若用來比較恢復語意，須標示為本機實驗；不因此把它認定為未來 Cloud Run 的耐久儲存。

### 開發同步紀錄規則

每次實驗使用穩定階段 ID 與新的 run ID；每個 run 在開始前記錄假設、條件與篩選值，結束時記錄觀察、證據、結論與下一步。run ID 不回收，失敗與中止也保留。已有紀錄以追加修正說明處理，不覆寫原始觀察。

每個 run 至少包含：實際日期與操作者、目的、程式 commit 或可驗證版本、Node／依賴／codec 版本、OS／瀏覽器／裝置、server 與負載端硬體、參與者與房間數、網路條件、測量方法、原始資料位置、結果與未跑項目。無法取得的資訊明列未取得，不補造雜湊、時數或數值。

每階段結束前完成三件事：更新執行紀錄；更新該方案的採用／拒絕與限制；以同版本重新讀回證據。重大失敗、改框架、改協定或縮限支援裝置，都需寫理由與相依影響，不只留下聊天訊息。

### MVP 可用方案交接

方案以穩定識別追蹤，狀態分為待實驗、驗證中、可採用、需重構、拒絕。不得在沒有成功 run 的情況下標為可採用。

每個交接項目包含：問題與替代方案、選擇理由、適用版本／裝置／規模、公開行為契約、成功與反例、回歸案例、效能與資源、授權義務、失敗恢復、未解風險、必須移除的測試支援、需要重構的程式以及 MVP 採用前條件。

POC 程式可復用，但不得整包複製後稱為 MVP。只有交接條目有證據的契約、模組與測試可進入 MVP 候選；調整版本、網路路徑或部署環境後，重跑受影響案例。

## Testing Decisions

### 測試原則與既有基礎

目前已有T01的node:test整合測試、Playwright雙Firefox流程與Chrome實際操作證據；詳見執行紀錄。既有PRD與研究仍是後續情境依據，不代表未實作功能已通過。

好測試從使用者或外部 client 觀察收聽、觀看、房間隔離、管理效果和恢復。主要黑箱邊界維持同一個本機應用；必要單元測試集中在難以穩定從外部覆蓋的協定解析、去重、權限與媒體恢復規則，不檢查私有函式名稱或逐步照抄實作。

現用工具為node:test、Playwright、瀏覽器插件與真實Chrome／Firefox；負載與故障工具留到需要時再選。多個 BrowserContext 能驗證身份與互動，不能代替實體手機的解碼、播放手勢、背景與音訊輸出行為。

### 輕量測試方式與執行計畫（v1.1）

依2026-11-03人類指示：「POC 驗測不用太嚴謹，目標只是確認核心功能是可以達到並了解使用方式」。本節優先於v1.0各處的固定時長、樣本數、反覆重跑及品質數值要求；產品功能與隔離／撤權等核心語意維持。原工程數值保留作日後診斷參考，不作本輪POC完成的硬門檻。

每次只回答三件事：**核心流程能否跑通、如何操作／整合、有哪些已知限制**。用最薄介面完成一次可觀察的端到端示範，保存簡短步驟、結果與一張有代表性的截圖；發現核心問題再做一次最小診斷。不另建完整QA專案，也不預設跑容量、長時間、全面相容性或完整惡意輸入矩陣。

| 順序／階段 | 最小驗測方式 | 足夠的可行性證據／要學會的用法 |
|---|---|---|
| 現在／T01 | 本機啟動建置後應用，開兩個頁面，加入→雙向回應→離開→再加入 | 兩端看見對方與回應；記錄啟動、連線、發送與清理方式。HTTP/WS展示不混稱HTTPS/WSS驗證 |
| T02／POC-00 | 有實體手機時用可信HTTPS開同一應用，查看必要API並嘗試所需操作 | 知道手機如何連入、哪些API可用；沒有裝置就標未測，不用桌面視窗縮小代替 |
| POC-01 | 一端開麥，另外兩端實際聽到；試一次關麥與重新開麥 | 確認擷取→壓縮→轉送→播放閉環與必要點擊／權限操作；不以codec探測或socket有資料當收聽成功 |
| POC-02 | 分享畫面，另一端看見變動；試晚加入、停止畫面但保留語音 | 了解分享啟動／停止及接收端初始化方式；音畫各自可開關 |
| POC-03 | 像素角色移動、切到另一房；同房可互動，異房收不到；試一次撤權／只互動 | 確認空間、房間與活動邊界，了解發布／訂閱／主持操作；隔離錯誤須如實列為核心問題 |
| POC-04 | 控制一次斷線／恢復，確認最新權限下能重新操作與播放 | 了解重連、狀態／解碼初始化、需要人工再次授權的部分；發現卡住再做弱網診斷 |
| POC-05／按需要 | 先增加少量接收端觀察是否明顯變慢；有容量決策需要時才逐級測負載 | 僅報實際人數與播放情況；沒測50人就不承諾50人，不把容量完整驗收當POC每步前置 |
| POC-06 | 重啟一次程序，核對固定資料可重建、動態資料哪些丟失／恢復 | 知道保存與重建操作；不默認可丟資料，也不將本機檔案保存當CloudRun耐久證明 |
| POC-07 | 依以上閉環整理可用方法、程式入口、操作命令與未解問題 | 決定哪些核心方案可帶進MVP；不能省略尚未實現的核心功能或隱藏限制 |

本次T01操作清單（R003）：

1. 使用Node26.13.0；首次先`npm ci`、`npm run build`，之後可直接`npm start`。
2. 開兩個`http://127.0.0.1:4173`頁面，分別填`POC-A`／`POC-B`，按`Join room`。
3. 兩端都看到2人；A按`Wave`、B按`Clap`，兩端活動列表都出現回應。
4. B按`Leave`：A只剩1人；B按`Join room`後再送回應，A再次看得到。
5. 重新整理B：目前會清空本頁名稱與連線，需要重新輸入名稱加入；不是已完成自動重連。
6. 保存一張共享房間截圖及簡短結果。結果分「可行／遇到問題／未測」，必要時對應既有Pass／Fail／Inconclusive；不新增複雜測試管理流程。

**本次執行範圍：**僅T01上述核心操作。原始R002已有HTTPS/WSS雙Firefox證據，可直接參考；未變動程式時不為湊次數重跑全套。手機、影音與後續階段只制定方法，待對應實作／設備具備再執行。測試完成停止自行啟動的服務、關閉自建分頁，不動使用者既有分頁。

### 工程篩選值與量測方法

以下為v1.0保留的**診斷參考值**；依v1.1本輪不強制執行固定時長、樣本數或達成這些數字。需要效能或容量決策時再選用，不是使用者已接受的 MVP 品質或容量保證。POC-00 需保存版本化測試設定；後續改值須先記原因並重跑，不得看到失敗後只降低門檻宣稱通過。

| 項目 | 暫定工程篩選值／必要行為 | 證據與限制 |
|---|---|---|
| 真實基本播放 | 1 位主講、至少 2 位接收連續 20 分鐘；至少一台實體手機；正常條件下沒有未恢復的播放錯誤 | 開始／結束時間、接收端播放與錯誤事件、觀察片段；不把 socket 開啟當播放成功 |
| 音訊端到端延遲 | p95 ≤ 500 ms | 測試脈衝／聲音標記與接收端實際輸出；若無法可靠量測，標未驗證，不只報 server 轉送耗時 |
| 分享測試檔位 | 1280×720、目標 15 fps；端到端畫面延遲 p95 ≤ 1,000 ms；穩態實際呈現平均 ≥ 10 fps | 來源與呈現 frame 標記；需報動態畫面與靜態簡報兩種條件。這是測試檔位，不是產品解析度上限 |
| 音畫偏移 | 兩來源同時存在時 p95 絕對偏移 ≤ 150 ms | 同時產生聲光標記、以同一接收觀測時計算；網路抵達時間不能代替播放時間 |
| 網路斷線恢復 | 網路恢復後 p95 ≤ 5 秒回到可操作控制與可解碼媒體 | 各至少 20 次受控中斷，保留每次數據；需要重新操作分享授權時分開報告，不捏造自動恢復 |
| 互動 | 沿用 PRD 提議的 server 接受至接收端顯示 p95 ≤ 1 秒；同 ID 重送不重複計數 | 每個主要情境至少 100 個已接受事件，拒絕／遺失／斷線也另計，不從樣本移除 |
| 房間／權限 | 未授權與跨房的新增媒體／事件下送為 0；撤權後不復活權限 | 正常與自行構造 client 皆測。撤權前已送達內容不可追回，須區分來源時間與接收端舊緩衝 |
| 只互動模式 | 媒體訂閱與媒體 payload 下送為 0，控制通道仍可用 | 以 server 訂閱／位元組與接收端網路證據核對，不只看沒有聲音或播放器被隱藏 |
| 慢端與記憶體 | 每連線佇列與媒體年齡有預先設定的硬上限；超限後可丟棄／重同步且健康端繼續符合篩選值 | POC-00 鎖定佇列／年齡設定；分別報 server、接收端與負載端資源，不用無限排隊換取零丟失 |
| 長連線 | 本機至少 65 分鐘，加受控中斷後可恢復 | 本機結果不等於 Cloud Run 60 分鐘 request timeout 已實測 |
| 50 人 | 每級穩態至少 20 分鐘，50 人集中及分散兩房各測；完成一個不低於 65 分鐘的整合場次 | 50 是原 PRD 的實驗規模，未通過前不承諾容量。每場記錄真正編解碼人數、合成client數、角色分布與總媒體接收數 |
| 程序重啟 | 不接受 stale client 自證主講／主持權；按已記錄規則重建或誠實拒絕恢復 | 單獨檢查動態資料保存。可重新連線不等於狀態已正確恢復 |

跨裝置時間不可直接相減：沒有校時或共同觀測基準時，延遲數字不能作端到端通過證據。每項保留樣本數、分布／p50／p95／最大值與量測誤差；依v1.1輕量原則，核心閉環成功且使用方式與限制清楚後可列為對應範圍的可行候選；不再以固定重跑次數作本輪門檻，正式穩定性留待後續需要時驗證。

網路擾動使用對測試 client／測試連線有範圍限制的工具，預設包含正常 LAN、100 ms 額外 RTT、受限 2 Mbps 接收端、單端中斷與恢復；保留設定，不把軟體延遲注入當真實行動網路驗證。若另做丟包／抖動情境，記錄工具與實際作用層；不能在 WebSocket 訊息層刪封包後稱為 TCP 網路丟包。

### 瀏覽器、資料與結果狀態

桌面 Chrome／Edge／Firefox／Safari，以及實體 iPhone Safari／Android Chrome 均建立能力與實測欄位，記錄實際版本。手機發布螢幕與手機接收分開，依 PRD 不支援發布時仍須驗證接收與互動；缺裝置不得把模擬器冒充實測。

測試資料以合成／已獲授權來源為主。應用不錄製使用者影音作產品資料；為量測短暫錄製測試聲光或畫面，須明示用途、來源及刪除規則。log 不包含憑證、私人聊天全文或不必要身份資訊。

執行紀錄分開「尚未執行／執行中／完成／中止」與「Pass／Fail／Inconclusive」。階段通過需所有必填案例有有效結果、暫定篩選值符合、必要裝置有證據、限制已揭露；設備缺漏或無可靠量測為 Inconclusive，不能當 Pass。

### 停止條件與 MVP 進場

- 核心裝置沒有共同可行編解碼路徑、弱網緩衝無法有界、跨房／撤權可繞過，立即停止提升該候選為預設方案；記錄失敗後比較另一條同限制內路線。
- 無法在資料需求與單一服務限制之間提出可用恢復方案，POC-06 及最終技術 Go 保持未通過；可繼續無相依的技術盤點，不偷增服務或刪資料需求。
- 原工具操作重現同樣錯誤或證據矛盾時，依專案規則停止該操作，保存狀態；測試本身的失敗則按新的假設與新 run 受控重試，不重複碰運氣。
- MVP 進場必要條件：POC-00～06 的核心條件可重現、端到端回歸成功、採用清單與拒絕理由完整、無核心未解問題假裝結案，並完成 POC-07 技術審查。工程 Go、產品品質接受、MVP 開發開始、雲端驗證及正式發布分開記錄。
- 人類後續接受實驗結果或調整條件時，沿用既有決策紀錄保存精確範圍。不得將一般回覆或 `ready-for-agent` 標籤當成所有品質／風險都已接受。

## Out of Scope

- 本輪不開始正式 MVP 開發；不建完整管理後台、正式登入產品、正式美術系統或所有產品頁。
- POC 執行不部署 Cloud Run、不建立雲端資源、不建立外部影音服務、不做 GCP 帳單實測。
- 不開發自有 codec、標準 WebRTC SFU／TURN 底層、3D 世界、攝影機會議、錄影產品、完整地圖編輯器。
- 不因 POC 採最小介面就宣稱完整產品可用；也不將本機 SQLite／磁碟結果當作雲端耐久證據。
- 不在缺少真實裝置或負載證據時宣稱全瀏覽器支援、50 人容量、低延遲或雲端成本達標。
- 不為了越過失敗門檻改回 WorkAdventure、外部播放器或偷偷加入額外服務。

## Further Notes

已有T01～T08本機桌面核心證據，詳見執行紀錄與MVP方案交接表；無部署結果。DEC-011的新距離/門禁規則尚未實作或執行，不得填入未發生的run，候選仍依完整證據判定。

GitHub Issue 是這份 POC 計畫的發布鏡像；修改本計畫時同步 Issue，開發中的 run 與方案證據沿用專案紀錄，不另外維護競爭的需求文件或資源占用清冊。Issue 的 `ready-for-agent` 只表示規格已整理可供代理接手；階段仍逐一實作、驗證及記錄。

本機 POC 的結論限定於其版本、裝置、硬體與網路；未來若開始 Cloud Run 工作，仍需額外驗證實際入口、request timeout、實例替換、資源／流量與保存方式，不能把這次本機計畫的完成標記挪作雲端通過。

既有研究依據是框架可行性、瀏覽器音畫 pipeline、Cloud Run 平台邊界與維護／授權比較；本計畫把研究假設轉成可執行驗證，不把官方文件當作產品測試結果。

主要官方參考：[Node.js LTS](https://nodejs.org/en/about/previous-releases)、[WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)、[MediaStream Recording](https://www.w3.org/TR/mediastream-recording/)、[安全環境](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts)、[麥克風授權](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)、[Cloud Run WebSocket](https://docs.cloud.google.com/run/docs/triggering/websockets)。技術實驗開始時再核對實際版本，不盲用浮動 latest。

### DEC011-A本輪結果入口

兩類空間收聽規則已於[POC-03-R003](evidence/POC-03-R003/README.md)完成桌面合成核心驗證；示範6格含邊界、會議室9格對照，30核心/build及三Firefox通過。原始收尾trace問題/修正與未測範圍均保存。門與密碼B/C仍未實作，不將本步改判完整POC-03或商品通過；具體接續依人類指示。

### DEC011-BC本輪執行邊界（2026-11-04）

人類已明確指定會議室門/密碼POC（R004），先合併B/C的門口與密碼准入核心。鎖狀態以server啟動設定提供未鎖/上鎖兩config，這不需要先實作T09角色管理，也不建立任何人可改鎖的API；原C草案中的主持人即時設定/密碼更換仍由T09基線後驗證。門口/替代UI/初次join/switch共用server准入，錯/無密碼不取得成員或媒體，正確密碼入房後按會議室全房規則。短真browser兩config＋外部WS即可，不加長測/部署。

### DEC011-BC本輪結果入口

[R004](evidence/POC-03-R004/README.md)已完成場景門＋startup密碼准入桌面核心：未鎖直接進/出、上鎖錯誤不入與正確入房、外部client與合成語音，31核心/build及最終兩config browser通過。原始輸入失敗/座標診斷與窄修保留。原C草案的主持人即時鎖/密碼更換/角色管理仍未實作，不能因准入可行改判T09或完整POC-03。

### T09本輪結果（2026-11-04）

[R005](evidence/POC-03-R005/README.md)驗證當前房主持bootstrap claim、主講grant/revoke、remove、活動結束及DEC011-C的live lock/password/unlock核心。34核心/補充3及最終三Firefox合成音畫/正常UI+外部越權通過；原失敗與門圖不同步修正保留。無token為舊匿名技術POC；不是帳號/逐房credential/耐久Session/完整資安。T09桌面核心完成，不改判完整POC-03；手機/真人/重啟/容量/完整流程仍待。T10等後續依人類指示，不改遠端19票鏡像。

### T10本輪結果（2026-11-04）

[R006](evidence/POC-03-R006/README.md)完成三feedback/聊天/固定圖案/明確公開文字及同房主持pause/block/remove/clear、去重/限流/TTL的桌面核心；39核心/build/typecheck與三Firefox一次流程通過。依本輪人類輕量要求，未強制原票100accepted/p95品質量測，完整T10/POC-03仍Inconclusive，不把核心可行當品質通過。T11展示頁/模式/QR/草稿、裝置/耐久/容量/弱網與部署待後續；遠端票不修改。

### T11本輪結果（2026-11-04）

[R007](evidence/POC-03-R007/README.md)已驗直接room/mode連結與正常密碼gate、同socket只互動/觀看切換、草稿/音量、唯讀展示實播/公開projection及真QR像素解碼再入房。42核心/build/typecheck及三Firefox短流程通過，活動來源5窗口server/raw媒體0、9越權拒絕。首次舊test時序與selector失敗/修正保留。本輪依人類只判桌面核心可行；手機相機/真人/耐久/弱網/容量/雲/完整POC-03仍未驗。遠端票不修改，T12待人類指示。

### T12本輪結果（2026-11-04）

[POC-04-R001](evidence/POC-04-R001/README.md)桌面控制核心Pass：47核心/build/typecheck與首次三Firefox重連/切房refresh/最新權限與gate/去重/過期成功。短期process-memory proof、同tab storage、有界重試與失效明示，可沿用SOL-003/005/006/008。受控WS close非實體弱網，未驗媒體訂閱/解碼/發布恢復、8次耗盡/半開/手機/耐久/容量/Cloud Run；完整POC-04 Inconclusive，T13待人類指定，遠端票不改。

### T13本輪結果（2026-11-04）

[R002](evidence/POC-04-R002/README.md)以分段證據判桌面同頁媒體恢復核心可行：54核心/build/typecheck、third接收音畫/display與stop/source不auto已通，最後publisher-only窄驗手動新generation/clock實播成功。三次full腳本失敗與最小診斷保存，最終full未整段重跑，不能稱完整自動化通過。此次無需audio gesture，其分支未另測；原20次/p95≤5秒/真裝置/弱網/耐久/完整POC-04保持Inconclusive，門檻不降低。無依賴/server協議變更，T14待人類指示，遠端票不改。
