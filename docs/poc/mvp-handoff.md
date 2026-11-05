# POC 至 MVP 方案交接表

- 權威計畫：[POC-PLAN v1.1](plan.md)；實際證據：[執行紀錄](execution-log.md)。
- 建立日期：2026-11-03；2026-11-05更新：T01～T17桌面核心已有證據，T18操作重建可行；SOL-007目前記憶體方案需重構／耐久No-Go。**目前仍無完整階段證據可列穩定可採用**。
- 本表記錄技術方案結論與復用界線，不取代 PRD、不另建派工／資源占用總表。

## 候選方案

| ID | 方案責任 | 狀態 | 必要證據 | MVP 移轉條件 |
|---|---|---|---|---|
| SOL-001 | Node26／單一本機應用與工具鏈 | 驗證中（T01 Pass） | R001反例／R002成功；完整POC-00待T02 | 可重現建置、版本與授權鎖定；後續雲端仍待驗證 |
| SOL-002 | 音訊／畫面編碼、轉送與播放 | 驗證中（桌面晚加入與同步排程核心可行） | POC-01／02／04／05 | codec／裝置／規模符合，初始化、晚加入、背壓及恢復有證據 |
| SOL-003 | 權威 Room／Session／事件與權限 | 驗證中（T09臨時主持/主講及即時門禁核心，正式帳號/耐久待補） | POC-03／04／06 | 跨房、撤權、去重及重啟語意正確，無client自證權限 |
| SOL-004 | Phaser 像素角色與操作橋接 | 驗證中（T07桌面核心／T08異房隱藏） | POC-03／05 | 多人同步、手機替代入口與減少動態效果可用 |
| SOL-005 | 只互動／觀看／展示的狀態與媒體訂閱 | 驗證中（T11桌面核心可行） | POC-02／03／04 | 零媒體訂閱、切換保留草稿及房間、展示無管理權 |
| SOL-006 | 重連、時基、快照與解碼恢復 | 驗證中（T12控制＋T13桌面接收恢復核心可行，品質/耐久待補） | POC-04／06 | 依最新權限恢復、不播過期資料、不恢復過期主講權 |
| SOL-007 | 資料分類、保存與程序重啟恢復 | 需重構（T18操作重建可行；目前動態保存No-Go） | T01盤點；POC-06-R001實停重啟／資料遺失 | 必要資料耐久來源與還原未解，完整POC-06及商品Go未通過 |
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

## SOL-007／資料風險交接清冊（T01建立，T18於2026-11-05更新）

沿用本表作唯一資料分類清冊；[POC-06-R001](evidence/POC-06-R001/README.md)提供實測，不另建第二份盤點。

| 類別 | 現有來源／保存 | 復原與未解風險 |
|---|---|---|
| 固定場景／房間 | SPACE_ROOMS、原始碼與build的lobby／studio | T18同source實重啟重建；非動態場景耐久保存 |
| 啟動設定／密鑰 | HOST／PORT／TLS、HOST_CONTROL_TOKEN、MEETING_ROOM_PASSWORD環境；ignored本機TLS檔 | T18同設定重新提供A與token；不是由舊process回復。私鑰/token不提交，產品密鑰管理仍待 |
| 執行期門禁／主持控制 | process-memory gate revision、密碼hash、host claim、publisher grants | T18 live密碼B遺失，startup A可用；主持需重新claim，defaultdeny非持久撤權名單。需決定哪些設定必須耐久 |
| 成員／位置／臨時Session | process-memory server UUID、session store/opaque proof、模式與位置 | T12/13同程序短期resume可行；T18舊三proof resume_invalid，手動重入是新UUID/出生位置，首位只有自己。非帳號/耐久身份/ACL |
| 互動回饋／歷史／去重 | InteractionStore process-memory，bounded TTL/queue/dedup | T18一筆回饋DOM1→0已實測；聊天／彈幕／去重未做重啟測試，僅source可知無耐久來源。短期TTL不能自動等同人類接受任意重啟丟失 |
| 媒體來源／訂閱／時基 | process-memory relay/controller/queue，page捕捉tracks與接收意圖 | T18來源停止、不auto復活；新身份手動開來源/訂閱可實播，新clock、generation可重設1。非保存媒體或持續Session |
| 序號／統計／觀測 | process-memory server counters與有限page診斷 | T18首位新房snapshot lastSeq1；其他統計未逐項測，source顯示無耐久保存／跨instance協調，不當產品歷史統計 |
| POC證據 | 經選擇JSON/log/PNG開發檔案 | 持久供開發追溯，不是產品資料儲存或CloudRun耐久方案 |

**操作重建可行，必要動態資料尚無還原來源；目前process-memory候選耐久No-Go，完整T18／POC-06未通過。** 沒有加入DB／Redis／VM／disk snapshot或額外服務，沒有替人類接受資料遺失。固定可重建不等於執行期資料已保存。後續需決定必要保存項目與符合部署條件的耐久來源；No-Go限目前候選，不宣稱所有單一CloudRun架構不可能。平台依官方文件的界線見R001/platform-boundary，本輪只有本機實測。帳號／正式身份不存在，不能用bootstrap token替代。

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

## DEC011-BC／POC-03-R004：場景門與密碼准入（2026-11-04）

- SOL-003：`room-access.ts` per-app policy，啟動MEETING_ROOM_PASSWORD空/非空對應未鎖/鎖；native salted scrypt verifier/定長比較，join/switch在任何member/space/relay變更前共用authorizeEntry，錯/無密碼可同socket重試、不改原房資格，額外鎖/角色/身份欄位不能越權。每新entry再驗，isLocked維持true；不是公開切鎖API或正式帳號/主持權。
- SOL-004：Phaser場景Zone門、pointer/touch設定（keyboard false）、focus map Enter及HTML替代門，React最新callback ref避免舊狀態；此步是點門傳送，不是行走穿門/尋路。root實測修React排版後Phaser bounds快取71px偏移：down capture同步current bounds/displayScale、destroy清listeners，有界POST_RENDER doorInput診斷可保留作回歸。未鎖與上鎖真canvas操作皆驗。
- SOL-007：鎖/密碼由每次server啟動環境提供，不寫產品儲存；room/成員/嘗試budget仍process memory。換密碼需restart且中斷當前狀態，不等於已驗恢復或接受資料遺失；角色/即時鎖房/邀請與有效期仍T09/後續。同步scrypt及per-connection budget非生產抗濫用/容量方案，新連線可繞限次需重構。
- SOL-008：[R004](evidence/POC-03-R004/README.md)保留兩次門點擊失敗、before/after輸入診斷、最終兩config/可信CA/外部WS拒絕、private音源已活動時0下送、入房後實際render/全raw hash讀回與31核心/build。密碼frame只留hasPassword不留內容，runtime測試key不保存；browser只語音，screen拒絕是Node gate契約非活動VP8實播。
- client密碼送出前仍有序dispose舊影音再switch；錯誤時server原房/relay不變，但local已停影音須手動重開，MVP改善失敗入房體驗前不能移除順序而讓舊幀打到新房。更完整角色/安全與a11y/touch/手機/真mic/恢復/容量都待補。無新套件、影音relay/controller/worklet不改，不把本步當完整私密會議商品驗收。

## T09／POC-03-R005：SOL-002／003／004／007／008（2026-11-04）

- SOL-003：`host-control.ts`配置shared bootstrap token、SHA256定長digest比對/單連線claim限次，房內WSS claim、hostActive不接受client自證；current-room target/strict schema，grant與host資格於成功切房失效、close清grant。live meeting password/unlock共用原join/switch gate，public只送鎖態/模式；管理token不可兼作room password。remove先解除member/space/relay再4001 close；新匿名連線不是同一帳號封鎖。end只停止發布/清主講grant、保留Room/member/lock，無耐久Session歷史。
- SOL-002：relay新增stopPublishing(connectionId, reason)，撤權/結束保留訂閱與peer、清publisher、廣播streamEnded並通知source停止tracks/encoder；app對managed未授權start/binary都拒絕。三Firefox合成實播與350ms停止窗口通過，非真mic/display/品質；原codec與距離規則保留。
- SOL-004/007：HostPanel正常claim/grant/revoke/lock/password/unlock/end可操作；密碼/host input提交清空、room切換清空，catalogue即時更新。root視覺驗收發現Phaser門圖只初始化，已窄修更新現有graphics/text而保留命中區。MVP需整理匿名模式/管理credential、角色展示/帳號、診斷UI與視覺長名字重疊。
- SOL-008：[R005](evidence/POC-03-R005/README.md)保存34核心/補充3、短三Firefox、五外部越權、stop計數/track ended、失敗與動態門圖修正/最終代表圖。可復用`host-control.integration.test.mjs`及`host-control-smoke.mjs`；此輪計數不做payload hash。沒有新依賴/手機/真人/長測/容量/雲證據，完整POC-03/MVP仍需整合驗證。

## T10／POC-03-R006：SOL-003／007／008（2026-11-04）

- SOL-003：`interactions.ts`按Room保留history/publicQueue/feedback，sender+eventId索引跨房，原樣重送只ACK、不同payload/room拒絕；未過期ID不為容量靜默淘汰，滿2048拒新至TTL到期。新`interaction.submit`獨立2KiB，舊control1KiB/影音界線不變；server從connection推導room/participant，管理沿T09同房hostActive。prune dirty通知避免其他room活動偷清過期而漏更新，snapshot/state與event都有room guard。
- SOL-007：history50/5min、public20/8s、feedback60s/512及dedup10min/2048為bounded process-memory fixture；統計次數/臨時participant數分開，非真人身份。pause只停展示、block只禁新公開，remove同步歷史+queue、clear僅公開queue。重啟清空，換匿名身份不承接去重；MVP須設計耐久/帳號/大量負載與保留政策。
- SOL-008：[R006](evidence/POC-03-R006/README.md)首次root39核心/build及三Firefox普通UI/外部probe通過，studio22 IDs相同無重送/異房，11速率10接受1拒；原開發型別/fixture失敗與修正保存。可復用`interactions.integration.test.mjs`及`interaction-smoke.mjs`，含Unicode長度、bounded cache、實際TTL與正常畫面。
- 可用呈現：InteractionPanel分聊天/固定圖案/明確公開區，常態區分pause/acceptance，serverNow+monotonic elapsed只估期限，非E2E校準。SOL-005的獨立display/模式/QR/保留草稿仍T11，未因公開區可見就宣稱完成。未跑100accepted/p95、手機/真人/弱網/容量/雲或完整POC-03；沒有新依賴/影音或Phaser改動。

## T11／POC-03-R007：SOL-005／003／008／002／007（2026-11-04）

- SOL-005：`entry.ts`解析room/mode/view，未知mode預設watch、未知room不靜默轉房；`qr.ts`/JoinQr使用本機qrcode-generator2.0.4生成公開participant URL，display不帶入QR，password/host token不進URL。DisplayApp獨立readonly頁、ScreenPanel readOnly自動video不auto audio、PublicInteractionView只用權威publicQueue/feedback；不從recent events復活pause/remove/expired文字。以jsqr1.4.0 dev真pixel解碼並重新正常gate入studio，非手機相機證據。
- SOL-003：join可選participant/display與watch/interaction，預設保持舊契約；role在socket固定，mode不重join。display只允許訂閱/退訂/inspect，server拒發布/修改/主持claim即便token正確；display互動transport projection history空、不轉發chat/sticker事件。不是帳號認證或耐久ACL，不能將一般房內聊天叫作點對點私訊。
- SOL-002：mode interaction先本地停止來源/接收、server強制stop/unsubscribe並每次binary守衛；同connection generation保留。self inspect回累積enqueue bytes/frames/subscribed，明示非對端receipt。watch不auto來源或訂閱，AudioController音量gain連到播放管線，草稿/音量保留僅同頁。codec/封包/距離規則未換。
- SOL-008：[R007](evidence/POC-03-R007/README.md)含42核心/build/typecheck、三Firefox合成來源5個活動窗口server0/raw0、11,008samples/3frames手動watch、9外部唯讀負例與真QR；root讀回/兩圖/失敗與窄修保存。復用participation.integration與participation-smoke；舊space測試改每案新app以隔離清理時序，原assertions保留。
- SOL-007／整合限制：process-memory/匿名身份及原T09 bootstrap授權不等於商品帳號，mode/draft不跨刷新。QR origin需可達/可信LAN才能手機掃，localhost只同機；展示POC診斷UI待商品整合。113項依賴declared license皆已知，兩新套件精確鎖版/notice/readback保存，非完整法務/安全稽核。手機/人耳/原生擷取/fullscreen/弱網/耐久/容量/CloudRun/完整POC-03未驗，T12不自動開工。

## T12／POC-04-R001：SOL-003／005／006／008（2026-11-04）

- SOL-006：`control-resume.ts`以256-bit opaque proof綁server原member/room/role/mode，離線10min TTL、512cap、active不prune/不搶active socket；legacy join相容，可選resumable:true。resume只帶token/可選當前密碼，回session.resumed+權威快照，不收自證room/role/權限；沒有valid proof就明示重入，不auto匿名fallback。store界線由clock seam驗，非耐久/帳號或多instance恢復。
- SOL-003：room-access revision在live lock/password改變時遞增，session receipt只於成功新准入更新，mode/同房switch不刷新；新gate要求當前密碼。close沿T09撤host/grant，resume按當下普通權限；remove/active leave使proof失效。穩定memberId延續既有InteractionStore eventId去重，snapshot prune掉公開過期項，不重播未確認mutation或legacy events。
- SOL-005：`control-reconnect.ts`同tab sessionStorage+同頁memory fallback，role分key、URL不含token，新的不同房link走正常join；成功switch更新公開room URL。participant/display close先清權限/內容/media，有限退避8次/取消與手動retry；unmount不當explicit leave。回復控制不auto任何媒體，display初次T11 autoWatch保留、resume需手動觀看。草稿/音量跨disconnect或refresh不在本輪保留承諾。
- SOL-008：[R001](evidence/POC-04-R001/README.md)含47核心/build、三Firefox正常UI+受控transport close/refresh/門禁/去重TTL、兩代表圖/摘要/指紋/cleanup，首次通過。可沿用control-reconnect.integration與control-reconnect-smoke，source及script執行前root修正紀錄保留。摘要無原始token/身份/逐包trace，非獨立封包重放資產；無新依賴或codec/Phaser改動。
- 整合限制：offline cancel只清本頁、server離線record等TTL；process restart清store，需手動正常join，不能當CloudRun耐久已驗。新tab/token被清除不是舊身份。controller disposal與no-auto有source/控制斷言，沒有活動影音來源/解碼恢復證據；T13/弱網半開/手機/容量/長測/正式認證/完整POC-04仍待。可接續控制候選方案，不能整包當可交付商品。

## T13／POC-04-R002：SOL-002／006／008（2026-11-04）

- SOL-006：`MediaRecoveryIntent`僅同頁room-bound audio/screen意圖，不存token/socket/publish權；新session.resumed後仍等本socket room.snapshot+participation.self一致才套用。controller dispose不當作user stop；manual stop/interaction/明確換房/Leave/恢復到不同房清意圖，display只video。full reload不保存媒體意圖。App保存同頁音量，不自動捕捉來源或重建主持/grant。
- SOL-002：AudioPanel/ScreenPanel新建controller/timeline及訂閱，AudioController以當前stream config/generation/clock初始化decoder；worklet準備與resume promise分離，suspended提供Continue不遞迴/不掛住、不改autoplay政策。Screen沿既有relay keyframe gate，新時鐘/尺寸重建；sender持續時generation/clock可相同，不能要求每次receiver重連都換source。sender斷線tracks結束，需正常權限與手動來源，新的generation/clock才能再次實播。
- SOL-008：[R002](evidence/POC-04-R002/README.md)含54核心/build、third接收段actual4672samples/VP8及display、manual stop不重訂閱、sender不auto；最後publisher-only窄驗generation2/新clock/實播通過。原3 full腳本失敗/窄修保留，最終full未再整段跑；core以分段證據判定。root-readback從保留的connection白名單control/seq/clock/config與render數據核對，3圖實際看過，不只以WS open算播放。
- 復用限制：測試用合成oscillator/canvas，Node payload為fixture，非真mic/畫面/人耳/手機證據；此次Firefox自動播放，gesture分支仍待實測。單次route-release觀測非校準E2E/p95，原20次/≤5s不改判。T14弱網/慢端、長測、耐久/CloudRun/完整POC-04仍待；server/relay/時基module/互動/Phaser/依賴未變，不把POC診斷與test route/provider帶入商品。

## T14／POC-04-R003：SOL-002／006／008（2026-11-05）

- SOL-002：per-socket transport-budget 共用 control/audio/video byte cap，pending callback age1000ms只關慢端1013；不是OS/TCP/receipt。PCM拒超大batch、graph residence500ms，video helper local performance residence500ms關過期frame。age為候選；graph凍結非wall background age，VP8 decode飽和仍停看/手動重啟。
- SOL-006：audio pending8自關4003沿T12/13重建；三Firefox以單接收test route4003驗fresh authority/config/keyframe/實播，主講來源不重捕。恢復共享原publisher generation/clock為正確，不虛造新source。未測真CPU飽和自恢復或所有壓力情境。
- SOL-008：[R003](evidence/POC-04-R003/README.md)含63核心/build、9個新seam、最終完整短browser、兩圖/讀回/cleanup；首輪只關serverRoute失敗及兩端close窄修保留。driver bounded256KiB/128msgs/500ms，實測501ms後丟棄0replay；健康5+3實播觀測/ACK，慢端新controller實播成功。測試注入不進商品，正常browser流量不當server真背壓證據。
- 復用限制：無依賴/codec/來源格式變更；真弱網/手機背景/人耳/資源全面量測/20次p95/耐久/容量/完整POC-04/CloudRun仍待，不能整包當MVP。

## T15／POC-04-R004：SOL-002／003／006／008（2026-11-05）

- SOL-002／003：同一現有app四真Firefox、兩房獨立合成Opus/VP8實播；各房stream clock／canvas色碼與健康持續可核對，非完整payload hash audit。T09主持grant/revoke接T13/14；撤權清來源與streamEnded、900ms無新binary/接收計數不增/RMS0/空畫面，其他房不被停止。現有app與codec/依賴未改。
- SOL-006：studio receiver模擬deadline1秒close雙端4003後新authority seq2/4/6→subscribe9/12、fresh config/keyframe及實播。host resume失claim，正常重新認領後撤權；被撤者再resume最新publishAllowed=false、700ms無auto start/binary/host claim且capture次數不增。process-memory proof與同頁意圖仍不是耐久/正式身份，沒有CloudRun timeout或實例替換證據。
- SOL-008：新增`integrated-session-smoke.mjs`，可信隔離CA/四browser/有界白名單trace、兩圖與手動用法；[R004](evidence/POC-04-R004/README.md)保存build/63核心/最終10,069ms短流程、健康12採樣/兩ACK、首輪timer -1ms失敗與root截止確認窄修、source fingerprint/readback/cleanup。未新增重複單元測試，整合腳本本身驗跨步閉環。
- 採用前限制：只有短桌面核心可行，65min/手機背景/真人/真弱網/p95/全資源/容量/耐久/CloudRun/完整POC04待補。optional hold入口只已syntax/閱讀，長分支未執行，不可預先當耐久工具已驗。測試來源/route與診斷須在MVP整理，不能整包複製稱商品。

## T16／POC-05-R001：SOL-002／008（2026-11-05）

- SOL-002：現有studio relay/Opus/VP8/每socket budget無改；單來源實際編碼1→3真Firefox decode/render可行、late join freshconfig/keyframe沿用，A退訂另兩者持續，publisher stop各streamEnded/清空；各來源只開一次。這是1發布＋3接收、非4個負載發布者，也非空WS容量。
- SOL-008：新增`single-room-fanout-smoke.mjs`，固定小拓樸/正常UI/3×400ms採樣、媒體bytes分離control、self downlink/transport與本地queue、350ms quiet/兩端持續、live圖。R001保存最終14,877ms完整短流程、source指紋、root核對/A-C實看/cleanup/少量server ps。全套62/63限流訊息逾時＋孤立server9/9結果均保留，根因未定；first-attempt Continue逾時後補診斷，最終無該按鈕，手勢分支未覆蓋。未改app/tests/依賴，不增加鏡像單測。
- 效能適用範圍：AppleM1Max64GiB共享主機；ps30採樣server RSS104064–117008KiB/CPU lifetimeavg0–47.6%，非各級穩態、全browser資源/飽和或容量曲線。raw bytes含應用media header、不同端累計起點不同；不能直接聲稱精準倍數/bitrate/E2E/p95。
- 採用前：未驗10/25/50/20min、真mic/display/人耳/手機/跨瀏覽器/品質/完整client資源/耐久/雲；POC05完整Inconclusive。固定3端不是產品上限；MVP須整理合成注入／診斷／硬編碼與測試資產，先沿契約參考，不整包當商品。

## T17／POC-05-R002：SOL-002／005／008（2026-11-05）

- SOL-002：既有兩房relay/Opus/VP8無改，每房單source/單實解碼receiver；6真Firefox小混合可行。root重算668/669 source messages→643/411 own receipt、foreign/unknown/ambiguous0，SHA保存無原始media；hash count/bytes與raw counter各方向完整。來源ACK/trackended/quiet後audit，未把晚加入/gate/mode少收當丟包品質。
- SOL-005：2專用interaction-only在source前切mode，初始/active self訂閱false/downlink0，整輪raw0；每房各feedback ACK、sameeventId且watch DOM計數0→1，foreign整輪trace同ID0。studio watch切only後已有歷史累計但delta0，回watch不auto，正常手動新metadata/實播恢復，lobby持續。沿T11原語意，不改正式身份/權限或需求。
- SOL-008：`two-room-mixed-smoke.mjs`支持固定6隔離profile、正常UI、3×400ms採樣、bounded8192 media hashes/每client方向、self/queue、350ms quiet。R002含63/build/首次18,233ms短流程/2圖/root hash與mode/UI讀回/cleanup/37個serverps；執行前ID語意/expectedgate/trace completeness/ACK修正保留。沒有runtime失敗或重跑；T16歷史逾時不抹除。
- 適用限制：M1Max64GiB共享主機；server RSS104224–122176KiB、CPU lifetimeavg0–37.6%含startup，不是全client負載或穩態容量。未驗50人/20min/手機/真人/Continue/真弱網/p95/品質/完整負載端資源/耐久/雲，完整POC05仍Inconclusive。固定小拓樸/生成來源/診斷須在MVP整理，不整包搬作商品。

## T18／POC-06-R001：SOL-003／006／007／008（2026-11-05）

- SOL-003／006：三舊proof拒絕、不自動匿名加入／重認領／發布／訂閱；重載正常門禁後新UUID、主持人工claim、fresh來源clock與實播可操作。這是程序死亡後新Session，不是T12同程序resume；defaultdeny與偽造角色／未授權發布拒絕不等於持久ACL。
- SOL-007：上方既有清冊已原位更新；feedback1→0與B失效/A有效是實測缺口。必要資料來源未定，仍No-Go／POC06未過，不能直接移轉記憶體store為商品保存方案。
- SOL-008：可復用scripts/process-restart-smoke.mjs的owned child真SIGTERM／同config新PID、三真Firefox與兩短WSS probes。build/typecheck/63核心與第三輪完整短browser通過；前兩輪harness失敗與窄修保留，root獨立讀回/兩圖實看與cleanup/指紋見R001。未驗崩潰/強殺、主機替換、手機/真人/弱網、耐久品質或CloudRun；未啟T19/MVP或部署。
