# POC 至 MVP 方案交接表

- 權威計畫：[POC-PLAN v1.1](plan.md)；實際證據：[執行紀錄](execution-log.md)。
- 建立日期：2026-11-03；狀態：T01本機基線已有證據，SOL-001／007驗證中；**目前仍無完整階段證據可列穩定可採用**。
- 本表記錄技術方案結論與復用界線，不取代 PRD、不另建派工／資源占用總表。

## 候選方案

| ID | 方案責任 | 狀態 | 必要證據 | MVP 移轉條件 |
|---|---|---|---|---|
| SOL-001 | Node26／單一本機應用與工具鏈 | 驗證中（T01 Pass） | R001反例／R002成功；完整POC-00待T02 | 可重現建置、版本與授權鎖定；後續雲端仍待驗證 |
| SOL-002 | 音訊／畫面編碼、轉送與播放 | 驗證中（桌面晚加入與同步排程核心可行） | POC-01／02／04／05 | codec／裝置／規模符合，初始化、晚加入、背壓及恢復有證據 |
| SOL-003 | 權威 Room／Session／事件與權限 | 驗證中（T08連線房間隔離核心，帳號/角色待補） | POC-03／04／06 | 跨房、撤權、去重及重啟語意正確，無client自證權限 |
| SOL-004 | Phaser 像素角色與操作橋接 | 驗證中（T07桌面核心／T08異房隱藏） | POC-03／05 | 多人同步、手機替代入口與減少動態效果可用 |
| SOL-005 | 只互動／觀看／展示的狀態與媒體訂閱 | 待實驗 | POC-02／03／04 | 零媒體訂閱、切換保留草稿及房間、展示無管理權 |
| SOL-006 | 重連、時基、快照與解碼恢復 | 待實驗 | POC-04／06 | 依最新權限恢復、不播過期資料、不恢復過期主講權 |
| SOL-007 | 資料分類、保存與程序重啟恢復 | 驗證中（盤點完成） | T01／R002盤點；恢復待POC-06 | 本機結果與後續部署耐久性分清，未解限制不能默認忽略 |
| SOL-008 | 可重現測試、量測與回歸資產 | 驗證中（桌面核心資產） | 全階段／POC-07 | 清楚區分真實與合成負載；測試工具不混入產品流程 |

## 每個方案的交接內容

方案狀態可為「待實驗／驗證中／可採用／需重構／拒絕」。升級為可採用之前，追加以下內容並連結成功與反例 run；未實作時不要預填具體 API。

- 問題、替代方案、採用／拒絕原因與決策日期。
- 已驗證版本、裝置、codec、網路、規模與品質範圍。
- 對外契約、錯誤、狀態轉移、授權及相容性／遷移規則。
- 可復用程式／schema／測試的實際證據位置與來源版本。
- 必須重構的部分，以及必須移除的故障注入／偵錯控制。
- 正常、惡意、弱網、斷線與重啟案例，還有回歸命令與原始結果。
- 資源量測、成本輸入、授權與資產權利、限制及採用前條件。
- 暫時無解、只在本機成立或尚未測試的部分；不以「可採用」掩蓋必要限制。

## MVP 進場審查

目前判定：**尚未審查，不能視為 Go。**

POC-07 需逐項核對：必要階段通過、可採用項目具可重現證據、核心 No-Go 已解決、產品條件沒有偷減、回歸可執行、資料方案符合決策、殘餘風險與待決事項已揭露。工程 Go、使用者接受與正式開發／部署分別記錄。

T01已有本機程式與真實瀏覽器功能驗收；以下結論不能擴張為影音／耐久／MVP證據。

## SOL-001／T01交接（2026-11-03）

- 候選：Node26.13.0、TypeScript7.0.2、React19.3.1、Vite8.3.5、Fastify5.12.8、@fastify/static10.1.8、@fastify/websocket11.3.6、ws8.22.1；實際直接／轉依賴版本與宣告授權見[R002 inventory](evidence/POC-00-R002/dependency-inventory.json)。不是全MIT宣告；MPL2.0僅在建置工具盤點中，正式散布仍須按產物檢查授權與通知。
- 證據：R001保留Firefox/macOS27失敗；[R002](evidence/POC-00-R002/README.md)採同穩定工具，加每個Firefox child隔離應用資料目錄，正常CA驗證下兩端HTTPS/WSS成功。無HOME／使用者profile／系統信任變更；未採alpha測試工具。
- 可復用：README重現步驟、package-lock、src/server/app.ts的createApp、本機TLS工具、整合及兩端browser腳本、版本／授權inventory。來源逐檔hash及觀測界線在R002。固定API為/api/health、/api/rooms與/ws；協議join→snapshot，server序號事件，非法origin拒絕、非法控制close1008、過大frame1009。僅lobby一房及合成wave/clap，沒有正式身份授權。
- 條件（依DEC-010更新）：T01桌面核心可行及使用方式已確認；不再因固定重跑次數阻擋POC，完整SOL-001仍需對應未測範圍；T02手機／能力矩陣、其後媒體與CloudRun相容仍未測。3項moderate依賴稽核節點及目前未觸及路徑判讀見R001 review.md；改glob／static設定或上MVP前重查修補相容性。
- MVP前須重構／移除：固定測試房間、合成控制與可見debug活動、以連線代身份；補正式Room／Session／授權、恢復、背壓品質與部署資料方案。不把本機CA或測試profile移入產品部署。

## SOL-007／T01資料風險交接（2026-11-03）

| 類別 | 現有來源／保存 | 復原與未解風險 |
|---|---|---|
| 固定場景／測試房間 | app.ts中lobby常數、原始碼及build | 可從同source重建；未實作動態場景／管理設定 |
| 啟動設定 | HOST／PORT／TLS_CERT_FILE／TLS_KEY_FILE環境值；本機證書在ignored scratch | 設定可重設，憑證私鑰不可提交；未建立產品密鑰與輪替方案 |
| 連線成員與顯示名稱 | process-memory、server新UUID | 離線移除該成員；重連無身份恢復，沒有權限或session保證 |
| 序號／控制事件 | server process序號，page最近20筆 | server重啟序號重設；頁面歷史不耐久；無跨instance協調、歷史／統計持久保存 |
| POC證據 | 經選擇的JSON/log/PNG持久檔案 | 只供開發追溯，不是產品即時資料或CloudRun保存設計 |

盤點通過並不代表恢復成功。沒有引入DB／Redis／VM／額外服務；尚無符合單一CloudRun下耐久資料語意的實測方案，POC-06仍必要。固定可重建與執行期可遺失不能混為人類接受資料遺失。資源／成本／媒體延遲／重啟恢復未測，不預填推估值。

## DEC-010後的輕量交接補充

[R003](evidence/POC-00-R003/README.md)已用Chrome雙頁實際示範加入、雙向回應、離開及手動重入，並記錄重整需重新加入。依人類新指示，方案評估聚焦「做得到／怎麼用／限制」，不以固定長測或反覆重跑為前置。SOL-001的T01桌面基線是可行候選，可延續作後續POC基底；完整手機與媒體範圍尚待實作。SOL-007的耐久／恢復仍未驗證，不因測試簡化而宣稱可保存資料。前文run的嚴格判定與數值作歷史／診斷參考，未抹除原結果。

## T02／R004補充：SOL-002、SOL-008（2026-11-03）

- SOL-002：新增src/client/capabilities.ts與能力面板；WebCodecs固定配置、Recorder/MSE MIME與canPlayType提示均有實際桌面報告。[矩陣](evidence/POC-00-R004/browser-matrix.md)顯示本次Firefox的AAC編碼設定不支援，Chrome支援；Opus/VP8為兩端設定探測可行候選。未執行真實擷取、編解碼或播放，沒有據此定案媒體pipeline；手機仍未知。
- SOL-008：可復用scripts/t02-smoke.mjs、tests/capabilities.integration.test.mjs、server能力schema與同一socket觀測ACK／GET讀回、SAN可選LANIP的本機TLS工具；README含桌面兩按鈕操作與未來手機信任CA步驟。核心示範與原始JSON/PNG/JPG見R004，無新依賴、無憑證略過、未變更系統信任。
- 觀測契約：加入後送capability.report，server產生observationId／connectionId並關聯room/member；GET /api/observations/:id讀回。內容是client自報且經固定schema驗證，server沒有獨立驗codec。frame限8KiB，普通控制仍1KiB，最多64筆process-memory，無授權／耐久／跨instance設計；MVP需按身份與保存需求重新處理此測試入口。
- 復用界線：本輪先程式＋桌面，實體手機明確待測；LAN證書例子192.0.2.23只驗SAN，不是實機LAN。完成手機同流程後再更新支援矩陣；不以瀏覽器模擬／UA字串代替實體裝置。未移轉CA私鑰或測試profile至產品。

## T03／POC-01-R001：SOL-002、SOL-008（2026-11-03）

- SOL-002：固定原生Opus48kHz mono32kbps／20ms；兩個真實Firefox完成合成getUserMedia→capture worklet→AudioEncoder→同一WSS→server opaque relay→AudioDecoder→playback worklet的非靜音輸出、stop與模擬denied。這是管線可行候選，真mic／人耳、手機、多接收者、跨瀏覽器及品質／E2E延遲未驗，不把T02配置探測當媒體實作證據。
- 可復用入口：src/client/audio.ts（AudioController）／AudioPanel.tsx、public兩個worklet、src/server/audio-relay.ts與app接點、scripts/t03-smoke.mjs、tests/audio.integration.test.mjs；使用／證據見[R001](evidence/POC-01-R001/README.md)。無新套件或外部服務。
- 契約：已加入socket明確audio.subscribe/unsubscribe、audio.start取得server generation、audio.stop釋出；24-byte LTA1 header（generation/seq/timestamp/duration）加至多4KiB raw Opus，只送顯式訂閱者、不回送publisher、不儲存媒體。單房單publisher不是正式Room/Session授權。接收PCM queue24,000sample（500ms）、送／收WS64KiB界線未做弱網品質驗證。
- 清理／錯誤：拒絕、裝置缺少、codec與安全內容不符有可見訊息；stop釋放tracks、encoder及播放資源，generation/epoch丟棄舊資料。首輪denied的resume Promise清理錯誤已修正，反例保留，受影響瀏覽器重跑成功。
- SOL-008：render sample/RMS來自worklet實際輸出，不是實體喇叭／人耳或端到端延遲。來源與模擬allow/deny設定均記錄，不錄真實聲音、不略過TLS／改系統信任；MVP前仍需權限、多房、重連、codec協商／時鐘／品質，整理POC計數與測試profile，不能整包當MVP。

## T04／POC-01-R002：SOL-002、SOL-008（2026-11-03）

- SOL-002：沿用原生Opus，不變更server/worklet或增加依賴。一publisher→兩個真實桌面Firefox接收程序的合成流實際解碼/render可行；B晚加入／退訂／再訂閱，A持續render，publisher stop兩端無新packet。這不是實體手機、真mic、人耳或跨裝置品質；完整POC-01仍未通過。版本及原始證據見[R002](evidence/POC-01-R002/README.md)。
- SOL-008：AudioController.getObservation()與AudioPanel下載按鈕可供各端保存schema1 JSON，含fixed codec、有限UA/platform、世代、計數、buffer估計與未知。publisher計數是controller lifetime；receiver累計跨listening session內世代；seq缺口屬packetGapGeneration且不算首包前歷史；buffer與RMS是最新本地worklet觀測。所有scope寫進JSON，generation非持久run/session ID。
- 新回歸：scripts/t04-smoke.mjs（3獨立Firefox、正常CA、全部fake media、真下載檔、訂閱ACK／視窗計數與panel screenshot）；tests/audio.integration.test.mjs新增兩訂閱者相同bytes／隔離退訂／再訂閱目前generation案例。14核心整合及一次瀏覽器示範通過；沒有為湊次數重跑。
- 不可擴張：receiverBufferMs不是E2E延遲，packetGapCount不是實際擷取/編解碼/喇叭中斷，render RMS不是人耳聽見；endToEndLatencyMs仍null，來源/實體裝置/人耳由一般應用不自判。手機/真人／品質留待補測，原長測/p95僅依DEC-010作日後品質參考。
- MVP前：此本地JSON是診斷工具，不是產品統計／耐久記錄或跨程序身份；仍需正式Room/Session/授權、多房、重連與品質決策，不能整包視為可採用。實際使用與未驗範圍均保留，測試profile／CA不進產品。

## T05／POC-02-R001：SOL-002、SOL-008（2026-11-03）

- SOL-002：可延續`screen.ts`、`ScreenPanel.tsx`、`screen-relay.ts`的VP8/canvas及同一WS LTS1分流；LTA1 Opus規格不變。各來源獨立啟停，track ended及readyState防護、拒權、斷線清理；24B header與512KiB影格上限，整條WS總待送1.5MiB，文字1KiB/能力8KiB維持。此總佇列門檻與T01/03的64KiB不同，不能將舊品質結論直接繼承。
- 最終三Firefox合成影音／雙接收可行，另兩Chrome原生分頁擷取1280×630與瀏覽器停止清空可行，兩種拓樸／傳輸／音源分開記錄。[R001](evidence/POC-02-R001/README.md)含原始失敗、修正及未定位第一次browser逾時；只是一個本機候選可行，不是長時間或跨裝置品質通過。
- SOL-008：`scripts/t05-smoke.mjs`、少量screen整合契約、實際下載的schema1觀測、尺寸/render窗口fps/queue與nullable JS heap可復用。設定target、track回報與實際呈現分開；server ps外部量測不混入browser heap，沒有E2E latency值或品質承諾。
- MVP使用前補晚加入與keyframe初始化、時鐘/音畫同步、來源更換、多房／權限、重連／弱網與必要裝置品質；重整偵錯欄位/測試注入、固定codec及總佇列策略。一般使用需接收者先觀看、發布頁前景點擊正常來源選擇器；本步對晚加入明確拒絕。

## T06／POC-02-R002：SOL-002、SOL-008（2026-11-04）

- SOL-002：晚加入取目前config/generation/clockId，server向publisher節流要求keyframe，逐訂閱者擋住起始delta；更換來源以stop/new generation重建VP8尺寸/decoder並清除舊frame，非無縫切換。1280×720→640×360及再開480×270已實測，其他codec切換/Recorder-MSE未驗。
- 共同時間戳採publisher頁performance時基；音訊worklet context anchor近似映射，server clockId區分來源；AudioWorklet真實PCM播放位置映射接收端時基，`MediaTimeline`保留32筆有界樣本，選已到時且新鮮的樣本；不同publisher、過期/停止時不假同步，無外插/漂移預測。client/server需配套版本，並未建立正式協議版本協商。
- 緩衝候選：現有PCM500ms；decoded video最多16幀，decoder pending最多8筆，總WS1.5MiB／VP8每packet512KiB不變。前兩輪換來源有decoded卻render0、第三輪晚加入被2筆decode門檻退訂；修正及policy模型/原始反例保存在[R002](evidence/POC-02-R002/README.md)。門檻仍需依MVP裝置/尺寸/網路實測，不是容量或穩定性保證。
- 最終一服務三Firefox合成閉環可行；同接收端3個聲光週期64.77/151.71/129.35ms只是graph/render觀測，mapping誤差未校準，不宣稱原150ms品質或p95通過。只有軟體pipeline，硬體輸入/喇叭/螢幕/真人/手機/跨裝置時鐘待測，完整POC-02 Inconclusive。
- SOL-008：可延續`media-timeline.ts`的純時基/選幀seam與5個clock回歸、late-join gating契約、`t06-smoke.mjs`色碼marker/世代/重新訂閱及schema2下載。實際窗口/取樣條件與null mappingErrorBound/E2E均保留，不把排程差當實測偏移。測試注入只在script；正式商品需整理診斷欄位、固定codec/房間及同步/背壓/恢復策略。SOL-006的恢復仍由後續POC驗證，時基部分可參考本輪候選。

## T07／POC-03-R001：SOL-004、SOL-008（2026-11-04）

- SOL-004候選：Phaser4.2.1／MIT、原創程式像素材質、SpacePanel與pixel-space renderer adapter；現有WS加server權威space model／snapshot／move／room.switch，兩房各16×10、最多8人、24move/sec上限，非容量驗收。兩真Firefox實際WebGL與跨端物件位置吻合；鍵盤focus、明確房按鈕、減少動態可行，手機仍待測。獨立renderer與space model可供MVP重用，非直接整包商品化。
- SOL-008：可沿用tests/space.integration.test.mjs、scripts/t07-smoke.mjs、POST_RENDER診斷及[證據](evidence/POC-03-R001/README.md)。26核心/build通過；初期測試等待離線端等缺陷修正並補逾時。render資料是軟體物件座標，不是裝置效能/觸控/網路品質證據。
- 單一連線身份及room權威、切房先unmount影音／server清理舊relay可參考；此步Studio只做空間，拒絕影音。共享地圖含兩房人物，People here僅當前房間，不構成私密成員權限；正式角色、可見性及跨房影音須T08/後續設計驗證。
- MVP前重整：固定房間/出生點、process-memory身份與位置、公開snapshot策略、debug與POC英文操作；補商品美術、碰撞/門口等產品需求、持久化/恢復、必要裝置與無障礙、資源卸載/版本升級。Phaser.AUTO實測WebGL，Canvas未測且v4deprecated；不假設其他裝置相容。保留MIT notices及精確lock，新增依賴不綁SaaS，inventory非完整授權/弱點稽核。

## T08／POC-03-R002：SOL-002、SOL-003、SOL-008（2026-11-04）

- SOL-002：原生Opus/LTA1、VP8/LTS1及controller不變；server以固定room→audio/screen relay map隔離publisher/subscribers。同一socket，generation是room-local、可能相同，clockId／封包hash才能分辨來源；不能把generation當全域來源ID。四Firefox雙房合成decode/render與hash吻合，證據見[R002](evidence/POC-03-R002/README.md)，非真mic/人耳/裝置品質。
- SOL-003：server建立connection/participant UUID、只依connection.currentRoomId分流，media訊息不接受client自填room/identity/role；peer callback捕捉來源room並再檢目前成員，binary必須擁有該room/channel publisher。切房disconnect舊relay、更新room、register新relay，subscription不搬移；前端pending先dispose、ACK後新timeline/decoder，需明確重新收聽/觀看。500ms舊房0新增、六外部探針拒絕已驗。
- T07共享地圖的全空間人物可見策略由T08收斂：目錄仍可見、room.snapshot／events及space.players只含本房，異房membersVisible=false。不要以空players宣稱房間為空。此策略可供MVP空間bridge參考，正式可見性需依產品/授權定義。
- 復用界線：開放匿名join/switch與server UUID不等於帳號認證或私密房間ACL；每channel單publisher ownership非主持人授權主講角色，audio/screen仍能由不同成員佔用。正式身份/Session/角色/撤權/恢復、觀測API授權仍待後續，完整T08/POC-03未通過。固定房與process-memory不改變SOL-007耐久風險。
- SOL-008：可沿用room-isolation.integration契約、t08-smoke的四真browser/兩合成來源、SHA256來源比對、切房ACK前後window、外部WSS拒絕與trace無截斷檢查；27核心/build及最終browser通過，早期fixture失敗和root窄修保存。/api/media-diagnostics僅聚合有界計數，代表排入WS不是對端已收；MVP需關閉或限制診斷。原t07-smoke全空間可見預期屬歷史，不作現行回歸入口。長名字標籤重疊仍需整理，沒有新增依賴。

## DEC-011新需求對既有候選的影響（2026-11-04；尚未實作）

- SOL-002/003：開放空間接收資格改依server權威人物距離；會議室仍依入房成員全房接收。T08固定每room一組relay僅證明房間隔離，不能直接當距離路由/多個附近來源或混音證據；來源識別/有界訂閱需補POC。
- SOL-003/004：場景增加會議室門/鎖/密碼准入，合法入房才取得影音/成員資格，移動與直接入口一致。T07按鈕切房不是可穿越門，T08開放匿名join/switch不是密碼門禁。鎖與聲音邊界分開，未鎖會議室也不向房外洩漏影音。
- SOL-008：補近/遠跨界、無/錯/正確密碼、直接入房繞過、房內遠距仍可聽/房外近門不可聽的短真browser外部證據。依DEC-010維持輕量，沒有新run結果；計畫與票面差異見POC-PLAN v1.2/ticket-breakdown。
- 已確認產品方向與未定參數分開；距離、邊界緩衝/音量、多源、密碼重入有效期及正式身份設計待補。既有code/evidence/commit保留，不因需求擴充改判歷史實驗或宣稱MVP可採用。

## DEC011-A／POC-03-R003：兩類空間收聽候選（2026-11-04）

- SOL-002/003：server SPACE_ROOMS回報kind/audioPolicy/audioRadiusGridUnits，保留lobby/studio wire ID但顯示Open area/Meeting room。isRecipientEligible callback只讀server connection→participant→space位置，開放區距離平方<=半徑平方、會議室只核同區成員；公告與binary均受資格控制。每room/channel仍單publisher、每page一WS，無新服務/依賴。
- AudioRelay為每訂閱者保存已公告generation，成功移動後reconcile；超界audio.streamEnded reason out_of_range，初始遠端audio.unavailable無source config，入界重送現行stream。重複subscribe可重取metadata，普通移動不重複公告。client沿用decoderRequestId/epoch與worklet.clear丟舊PCM，意願仍開啟；同generation可重新初始化。不是只client靜音。
- SOL-004：Phaser位置/方向按鈕與room入口沿用，UI顯示類型與暫定6格；既有Room字樣/API容器仍可含OpenArea，MVP需統一領域命名而非將開放區當會議室。可見門口/密碼尚未實作，不能把room按鈕稱為門。
- SOL-008：[R003](evidence/POC-03-R003/README.md)新3個Node外部契約與三Firefox合成audio流程可沿用；30核心/build、近/遠邊界、publisher移動、meeting9格及真render通過。首次關閉尾端8包來源trace不完整已保留，root窄修先stop/ACK/穩定再audit；最終127 sent/127 near/43 far全hash匹配且cap未達，無人耳/E2E品質承諾。
- MVP前：6格只是示範、斜向體感/邊界抖動/多源與混音/音量/必要裝置/跨區移動需依需求驗證；screen仍原手動zone訂閱，本輪沒測新距離與影音同步共存。帳號/角色/門禁/恢復/耐久未補，不能視為完整商品。舊smoke名稱/政策屬歷史，當前回歸入口space-policy-smoke。
