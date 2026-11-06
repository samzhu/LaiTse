# 工作階段 checkpoint

**狀態：POC-RM-01真PG＋Firefox匿名管理核心Pass，DEC017換房保留已驗，PG多人短回歸通過；MVP未啟動，2026-11-06。最新事項見文末。**

- 人類原話「開始」並指定implement；按當時唯一無阻擋前沿執行T01。Luna xhigh實作，主代理思考、獨立檢視、最終完整檢查及紀錄；未切到其他票或MVP。
- 產物：Node26.13.0／React/Vite／Fastify單一應用，production頁面／API／WSS，真實房間成員／有界合成控制，README、鎖版、TLS與瀏覽器腳本、版本授權inventory。
- R001：完成／Inconclusive；CLI與9測試通過，Firefox157受macOS27應用資料權限影響啟動失敗。失敗、診斷中未採alpha組合與官方來源均保留。
- R002：完成／Pass（僅T01）；全部腳本語法、typecheck/build、9整合案例及兩個真實Firefox157程序的HTTPS/WSS流程通過。私有MOZ_APP_DATA／MOZ_LOCAL_APP_DATA與NSS profile，不改HOME或系統信任。兩端成員及雙向事件seq2～4相同、leave seq5清理正確，零page/socket error；兩張PNG已開啟核對可讀。
- 證據：`docs/poc/evidence/POC-00-R001/`與`POC-00-R002/`；R002 source-sha256.json保存實測來源逐檔指紋。execution-log、SOL-001／007、brief／dispatch／delivery-index及票索引已同步。
- 界線：完整POC-00仍Inconclusive（T02手機可信HTTPS／能力矩陣未測），媒體／像素人物／弱網／容量／重啟／耐久／雲端皆未驗證。一次完整成功不足列穩定可採用，SOL-001／007仍驗證中。3項moderate依賴audit節點及目前不觸及公告路徑的判讀見R001 review.md，未宣稱零漏洞。
- Git：按implement作目前main分支本機提交，未push；GitHub母#1與#2～#20均未修改，本輪#2仍open。後續工程條件允許準備T02／T03，但未啟動，原生tracker阻擋仍待後續交付流程處理。
- 資源：實作與診斷代理明確停止寫入並交接；主代理已停止本輪server及兩個測試browser。僅保留ignored本機工具／套件／憑證／profile供重現；沒有使用者共享UI占用。
- 原先未追蹤的AGENTS.md、.agents/、.scratch/既有內容保留，不做清理或強制加入Git。tdd/code-review Skill入口不可用，已如實採手動red-green及獨立程式檢視，未聲稱呼叫技能。

## 最新接續：輕量測試計畫與R003

依人類新指示DEC-010，POC不要求完整QA／固定時長／樣本數／湊次數重跑。已更新既有POC-PLAN為v1.1（本機，GitHub母票仍v1.0），明列各階段最小示範、使用方式及限制。R003實際用Chrome插件雙tab測加入、雙向wave/clap、離開、手動再加入成功；重整需重新輸入名稱加入。程式仍66a3fca，HTTP/WS展示，WSS沿用R002，沒有重新跑全套。證據在docs/poc/evidence/POC-00-R003/，服務及自建tab已停止；本輪文件已保存未提交／未push，完整POC-00仍待手機項目。

- 人類最新回饋（T01-HUMAN-001，2026-11-03）：「看起來 OK」。已保存於execution-log，記為目前T01核心流程／教學的初步確認，未宣稱使用者逐案例實測；沒有啟動下一票。

## T02開工

人類明確指定繼續T02，維持輕量；選擇先完成程式與桌面驗測，手機稍後再測。已讀回GitHub#3「手機瀏覽器能力與可信HTTPS」，T01工程前置已具備；tracker#2仍open但不阻擋本輪明確授權。Luna xhigh寫入精確程式範圍，主代理負責思考與驗收／紀錄。R004已配發，尚無本輪通過結論；不啟動T03。

## T02本輪交付／R004

- 人類指定先程式與桌面、手機稍後；本輪已完成且維持輕量。新能力探測面板、WSS capability.report→server觀測ID／連線ID→GET讀回，最多64筆記憶體報告；沒有實際媒體擷取或播放，也沒有新依賴。
- 主代理檢視修正：異步讀回加socket identity guard、canPlayType保留maybe/probably提示。建置／型別、11個新舊核心整合、腳本語法、CA鏈／SAN與Firefox可信HTTPS/WSS核心示範通過；另用Chrome插件HTTP/WS實際操作，畫面與API報告吻合。source指紋及截圖已讀回／查看。
- 證據：docs/poc/evidence/POC-00-R004/，browser-matrix分列Firefox157、Chrome156.0.8078.80與兩列手機未知。Firefox本次AAC encoder配置不支援、Chrome支援；Opus/VP8配置探測支援不是實際影音通過。
- 手機仍未測；SAN測試IP192.0.2.23為文件保留值，非本機LAN。README提供真實IP、手機CA安裝／信任與兩按鈕使用方式；不變更系統／使用者信任、不對外開放。完整T02原手機條件及POC-00仍Inconclusive。
- SOL-002／008已補復用與限制。代理明確停止寫入釋出，主代理已停止server／Firefox／新建Chrome tab；未改使用者原tab、未啟動T03、不部署／寫GitHub。按本輪Git紀錄作本機提交，無push；原既有AGENTS/.agents/.scratch內容保留。

## T03開工

2026-11-03：人類明確指定T03（#4即時語音最小閉環）、輕量驗測、最後程式與紀錄一起commit；另指定真人收聽稍後，本輪只程式與自動驗測。派工已記T03唯一writer，主代理思考/驗收，Luna xhigh寫程式。POC-01-R001已配發；沒有實測成功宣稱，T04未啟動，手機T02仍待測。

## T03交付／POC-01-R001

人類指定T03、輕量、程式+紀錄commit，並選真人收聽稍後。本輪程式與合成自動驗測完成：兩個獨立Firefox透過可信HTTPS/WSS完成Opus管線至非靜音worklet輸出，第三個synthetic-only profile測denied。所有mic-attempt profile streams.fake=true，無硬體mic／環境錄音或TLS略過。

build/typecheck、13新舊核心整合、smoke及worklet語法通過；快照接收11、解碼11、render4,736、RMS約0.0458，stop後無新增packet，denied不廣播，最終零page/socket error。首輪resume Promise清理失敗已窄修並重跑受影響browser，反例保留。JSON／source指紋及播放／拒絕PNG已讀回及實際查看，SOL-002／008、README用法同步。真mic／人耳／autoplay受阻／E2E延遲／手機／長測未驗，完整POC-01仍Inconclusive；T04未啟動。writer已交接，兩輪server與Firefoxfinally停止，無GitHub／部署／新依賴。按指示本機commit不push；原AGENTS/.agents/.scratch內容保留，.scratch/t03工具／profile不提交。

## T04開工

2026-11-03：人類明確指定T04（#5跨裝置音訊品質基線）、輕量、最後程式+紀錄一起commit。先前手機與真人稍後安排維持；這輪先桌面三Firefox合成一講者雙接收及可下載觀測，不宣稱真跨裝置品質或E2E延遲。原票已讀回，T02/03工程部分可延續，未測前置結果不改寫。R002已配發，root持有docs/Git、Luna xhigh持有派定程式；T05未啟動。

## T04本輪交付／POC-01-R002

人類指定T04、輕量、程式與紀錄一起commit；先前手機/真mic/真人稍後安排維持。本輪一講者兩個桌面Firefox接收的合成管線與可下載觀測完成，並非原票實體手機/真跨裝置品質通過。A先收、B晚加入／退訂／再訂閱，A持續非靜音render，publisher stop兩端計數穩定；三端零page/socket error。

build/typecheck、14核心整合、script syntax與一次三Firefox可信HTTPS/WSS示範通過；root在跑前修正smoke兩處變數名稱。真下載原JSON：A64/64 packet/frame、render50,560/RMS約0.0710；B14/14、render4,352/RMS約0.0531。buffer106.67/109.33ms僅本地queue估計，seq gap0不是無掉音；E2E null，人耳/physical device不收集，來源由測試profile明列fake。沒有20分/湊兩次或p95結論，完整T04/POC-01仍Inconclusive。

docs/poc/evidence/POC-01-R002含實際下載、各phase/ACK/transport/起迄與source hash，JSON已讀回、panel圖已實際看，README與SOL-002/008同步。沒有改server/worklet／manifest/lock或新增依賴，手機T02與真人T03保持待測。代理writer已釋出，server與三Firefoxfinally停止；最後本機commit、不push/寫GitHub/T05/部署；原AGENTS/.agents/.scratch保留，.scratch/t04已ignore。

## WORKFLOW-STEPWISE／技能思維更新（2026-11-03）

人類要求將「將這個小步小步驗證 再合併到最後的商品精神」納入指定product-collaboration-workflow。主代理唯一writer已更新該skill主文與既有references/implementation.md：以最終使用情境切最小可操作步驟，POC先釐清可行／用法／限制，每步將可延續成果接回共同基底，程式與紀錄依既有提交約定維持同版本，商品整合再核對完整流程與必要品質。

未寫死LaiTse/Node/CloudRun/特定代理平台；小改可直接實作，正式交付採相符驗收，缺裝置/模擬結果界線及授權仍保留。已實際讀回兩檔與前後差異，quick_validate.py回報Skill is valid，相對參考連結存在；人工情境檢視涵蓋小修、輕量POC、缺裝置部分交付及已授權商品整合。純文字修改，沒有跑應用測試或啟動服務，亦未作獨立代理行為實測。已保存、writer釋出；後續人類明確要求「先將 skill 更新與協作紀錄 commit」，本次提交完整技能四檔（含既有參考文件，避免斷鏈）及四份協作紀錄。格式/連結及git diff空白檢查通過；不push、不啟動T05。

## T05啟動（2026-11-03）

完成skill commit 21470c6後人類指示「繼續」，依目前進度接續#6「站內畫面分享」。本輪沿用輕量驗測、程式與紀錄一起commit；T04僅桌面合成核心可行，未將手機/真人品質前置改成通過。先驗證同一應用畫面轉送與音訊獨立啟停；T06晚加入/同步及雲部署不在範圍。範圍包已記dispatch，root獨占docs/Git與驗收，Luna xhigh負責程式。

### T05完成（2026-11-03）

代理已停止writer，root接手窄修／驗收。實作主文README、screen controller/panel/relay、同socket分流與共有1.5MiB待送上限、獨立來源啟停及capture ended/readyState清理；無新依賴。前置review修canvas mount、資源早綁定與queue一致性，實測修測試close碼預期、未觸達的synthetic ended訊號、stop前後基準競態；第一次browser逾時未定位，未據此改產品queue，所有失敗保存。

最終18核心整合與build/typecheck通過，三Firefox可信HTTPS/WSS短合成影音流程零page/socket errors；真下載320×180／9.67fps，screen stop/deny audio持續、audio stop screen持續。另Chrome156兩頁前景原生分頁捕捉→同一本機HTTP/WS→1280×630畫面／9.74fps快照、原生停止617影格後清空；未開真mic/桌面/視窗/OS權限。原生初次背景Invalid state已改前景操作成功，data:fixture遭安全政策阻擋未繞過。

R001 JSON/圖/hash讀回且代表圖實際查看，README／執行紀錄／SOL-002/008及brief/交付索引同步。真mic/真人/手機與晚加入/同步/品質/容量仍未驗，完整POC-02 Inconclusive。writer與本輪server/Firefox/Chrome tabs已釋出；本機commit程式及紀錄，不push/GitHub/T06/部署。

## T06啟動（2026-11-03）

人類明確指定「繼續做T06，驗測維持輕量，確認晚加入與音畫同步的核心功能可行及使用方式，完成後把程式和驗測紀錄一起commit」。#7原票已讀回；root負責設計/驗收/文件/Git、Luna xhigh負責派定程式。R002已配發；不套用原固定兩次/p95/長測硬門檻，也不預先宣稱品質或完整POC-02通過。手機/真人先前待測維持，T07不在本輪。

### T06完成（2026-11-04）

Luna已明確釋出writer，root接手驗收及窄修。23核心案例通過，client緩衝修正後production build/typecheck與最終21秒三Firefox流程通過；晚加入同clockId/audio-master1280×720、換generation/640×360、退訂再入、停screen留audio/停audio轉standalone可行。無新依賴／外部服務或手機/真mic/真人結果。

R002保留三個失敗版本：先有換來源render0，時鐘歷史修正未單獨解決；獨立模型確認4幀不足以配合500ms PCM，改16幀；另late-join明確被2筆decoder門檻退訂，改有界8筆後完整流程成功。32筆clock history避免未來樣本遮蔽due樣本，5個clock回歸通過；沒有將所有根因推論說成已直接量到。

原始下載schema2含同clock/master、5個pulse、待呈現5/16frame。三個同端marker64.77/151.71/129.35ms，actual21.33ms窗口／RAF最大50.08ms、mappingErrorBound null；高於150ms的一筆未略過、不宣稱p95/實體品質。JSON/hash已讀回、代表圖實際查看，README／SOL／execution-log／brief/交付索引同步。server與隔離Firefox finally關閉、writer釋出；程式與紀錄本機commit，不push/寫GitHub/T07/部署。原AGENTS/.scratch未追蹤內容保留。

## T07啟動（2026-11-04）

人類明確指定像素人物/兩房移動、輕量核心可行及使用方式，程式+紀錄一起commit。#8原票與#9邊界已讀回：T07是空間/控制，跨房影音與成員隔離完整驗證留T08；真手機沿用稍後安排。root負責設計/驗收/文件/Git，Luna xhigh負責派定程式及manifest唯一writer；R001已配發，未做MVP/部署/推送。

### T07完成（2026-11-04）

人類指定的像素人物/兩房移動桌面核心已實作與輕量驗證，26核心/build及雙Firefox實際WebGL流程通過。R001原始JSON/圖/來源hash已讀回，主代理查看代表圖；初期測試卡住缺陷與逾時修正已記錄。SOL-004/008、README/brief/交付索引同步。未新增人類接受或發布宣稱，實體手機/完整跨房影音仍待後續；本機commit程式+紀錄、不push/T08/部署，測試服務/browser與writer停止釋出。

## T08啟動（2026-11-04）

人類指定「繼續做T08，驗測維持輕量，確認跨房影音隔離的核心功能可行及使用方式，完成後把程式和驗測紀錄一起commit」。#9房間媒體與成員隔離已讀回；Luna xhigh負責派定程式，root負責設計/驗收/紀錄/Git。沿用合成真browser本機驗測，不補造手機/真人/帳號驗證證據，不做T09/部署/push。

### T08完成（2026-11-04）

本輪合成桌面跨房影音/成員隔離核心可行：27核心/build、四Firefox雙房真編解碼/render及hash、切房舊房0新增/明確新訂閱、六外部惡意WSS拒絕通過。早期測試fixture與首輪browser誤分類合法移房者失敗均保存，root只窄修script後重跑受影響項。R002 JSON/圖/來源hash與獨立trace讀回，SOL-002/003/008及操作/交付索引同步。帳號/私密准入/主持角色未實作，手機/真人/品質仍待補，完整T08/POC-03未通過。writer已明確釋出，server/browser停止，本機commit程式+紀錄、不push/T09/部署。

## DEC-011需求更新（2026-11-04）

人類提出像素人物近距離廣播與可鎖/密碼門禁，釐清原話「應該定義空間 會議室就是進來的人都可以收到, 如果是開放空間則是用距離判斷」。精確納入兩類空間、未鎖無密碼直接入房/上鎖需密碼；不納入已定數值、音量漸變、多源混音或距離自動顯示畫面。DEC-011原話/界線、PRD/handoff v0.8、POC-PLAN v1.2補驗證閉環、票面差異及SOL影響已保存讀回。T08成功只限既有匿名分房隔離，無距離/門/密碼通過宣稱。本輪純文件，未改程式、跑媒體測試、部署、GitHub寫入或啟動T09；文件writer交付後釋出。

### 人類要求暫停（2026-11-04）

原話「分析完先暫停 稍後再繼續」。本輪需求分析與文件同步完成後暫停，不開發、不啟動新的POC/服務/browser、不改遠端票。DEC-011已確認：開放空間距離收聽、會議室全房收聽、門未鎖直接進/上鎖密碼；參數/多來源/密碼有效期待後續設計。需求文件本輪已保存且未commit；T08最後commit仍d83433b。恢復時先讀本節/DEC-011/PRD v0.8/POC-PLAN v1.2，再依人類指示整理補充POC與票面，不自動直接接T09。

### 恢復接續規劃（2026-11-04）

人類原話「繼續」，已恢復DEC-011脈絡並詢問本輪要補拆票/順序、直接距離POC或先門禁POC；目前先完成可獨立進行的補充切片草案。A距離、B未鎖門/會議室全房、C密碼准入；A/B沿用T07/T08且互無業務阻擋，C需B及server管理授權，不能以未受保護設定API略過。草案已保存於既有POC計畫/票索引；未配新T編號/改遠端票/動程式或啟動服務。上次10份需求文件加本輪草案仍未commit，T08 HEAD d83433b保持。

### DEC011-A啟動（2026-11-04）

釐清本輪範圍時人類答「會議室跟開放空間」。承接為兩類空間收聽規則POC：會議室全房、開放空間依距離，沿用輕量本機方式；門/密碼為後續。Luna xhigh實作、root檢視與runtime驗收，示範暫用6格單來源（非產品距離定案）。POC-03-R003配發；未開始門禁/T09或遠端票寫入。上次未commit的需求文件與本步可追溯保存，沿用程式/紀錄本機commit慣例，不push。

### DEC011-A完成（2026-11-04）

人類本輪「會議室跟開放空間」的兩類收聽規則POC完成：30核心/build/typecheck、三Firefox合成近/遠/6格邊界/超界清理/發布者移動及meeting9格播放成功。首輪關閉後尾端各8接收封包缺來源trace，root保存原始資料後窄修script先stop/ACK/穩定再audit，最終127 source/127 near/43 far全指紋匹配；R003含原始資料/圖/來源hash與獨立讀回。代表圖已查看，SOL/README/需求及計畫同步。

Luna已明確停止writer交接，root窄修/驗收結束，server/browser停止。6格非產品定案，門/密碼/多人/手機/真人/完整POC-03仍待補；本輪把先前未commit的DEC-011需求文件與程式/紀錄一起本機commit，不push/GitHub/T09/門禁/部署。恢復下一步依人類指示，B未鎖門/C密碼門禁仍草案。

## DEC011-BC會議室門與密碼啟動（2026-11-04）

人類原話「繼續做會議室門與密碼的POC，驗測維持輕量，確認未上鎖可直接進入、上鎖需正確密碼才能進入，完成後把程式和驗測紀錄一起commit」。R004配發，root設計/驗收/紀錄，Luna xhigh寫派定程式。此輪將B/C核心合併為可操作門與server密碼准入；鎖狀態由server啟動設定切換，不新增無保護管理API，不代表T09主持角色/即時鎖房完成。維持本機/合成媒體/輕量，無推送/部署/遠端票寫入。

### DEC011-BC完成（2026-11-04）

本輪門/密碼核心完成：31核心/build，最終未鎖/上鎖兩config各兩Firefox157真門進出/錯密碼拒絕/正確入房與合成Opus render、外部WS門禁通過。首次及補scroll仍未命中的兩輪已保存後停止全流程，單頁診斷證實React排版71px位移/Phaser cached bounds舊座標；root同步down前bounds/scale後，命中Zone與真switch成功，再恢復兩config皆pass。R004原始JSON/圖/指紋/獨立hash讀回已保存，代表圖實際查看。

Luna停止writer交接，root窄修/驗收結束；server/browser已停止。startup密碼不是T09即時主持/角色/帳號，5次每連線每分鐘非完整防暴力；client錯誤提交可能需手動重啟原影音。手機/真人/原生畫面/完整POC-03仍待。README/需求狀態/計畫/SOL及交付索引同步，程式+紀錄一起本機commit，不push/遠端票/T09/部署。下一步依人類指示。

## T09啟動（2026-11-04）

人類要求「繼續做T09，驗測維持輕量，確認主持人權限與即時鎖房的核心功能可行及使用方式，完成後把程式和驗測紀錄一起commit」。已讀回GitHub #10「主持權限與 Session 控制」，在8a19ebf門/密碼基線上接當前房主持claim、發布grant/revoke、remove、live lock/unlock/password與活動結束。R005配發，Luna xhigh實作/root設計驗收與紀錄/Git，完整範圍在dispatch。管理secret不等同入房密碼，沒有client自填角色；無token配置保留舊匿名POC並禁止管理，不能當正式權限模式。無真帳號/耐久狀態，移除對新匿名連線的限制必須交接；不部署/push/遠端票寫入/後續票。

### T09桌面核心交付（2026-11-04）

R005完成：34核心/build/typecheck及host切房往返補充3；三Firefox157合成音畫grant/revoke/end/live lock/錯正密碼/credential分離/unlock直接再入房成功，五外部越權+發布重放拒絕。原33/34是snapshot精確預期，兩個browser selector失敗各已保存；之後script pass但root看圖發現門圖OPEN/locked不一致，窄修renderer動態重畫、補三頁POST_RENDER鎖/解鎖斷言後重build/browser通過。source22/5與host收22/5，停止後350ms穩定；未宣稱payload hash/真人品質。R005原圖/JSON/log/獨立讀回與使用步驟保存。

主持token=process bootstrap、無帳號/耐久Session/永久封鎖；無token是舊匿名POC，非正式授權。remove成功Node4001，瀏覽器未另點移除；手機/真人/容量/弱網/完整階段待補。source交接後late patch已記dispatch，root核對build時序/測試未覆寫；現唯一writer停止後釋出。README/PRD/handoff狀態/計畫/票面/SOL/索引同步，程式+紀錄本機commit、不push/遠端票/T10/部署，server/browser停止。

## T10啟動（2026-11-04）

人類要求T10房內互動/彈幕輕量核心與用法、程式+紀錄commit。已讀回#11「房內回應與公開留言」，基線cff55ba；R006配發，Luna xhigh實作/root設計驗收與文件/Git。三種正式feedback、聊天與固定圖案、明確公開彈幕、server去重/限流/有界TTL及T09主持pause/block/clear/remove，同房隔離；不提前做T11展示route。原票100樣本/p95量測本輪未強制，未測不填通過，不變更遠端票/不部署/push。派工完整範圍見dispatch，source需明確停止writer後才交root。

### T10桌面核心交付（2026-11-04）

R006完成；root build/typecheck、完整39/39與首次三Firefox157流程通過。三正式feedback/chat/sticker/明確公開、T09主持pause/block/remove/clear、去重/限流/8秒TTL與異房隔離可行；兩studio各22唯一ID/集合相同、guest普通UI11ACK、duplicate-probe各1、lobby隔離觀測0後自送1/刻意切房/離開，trace68/72/19未截斷。root讀回report/IDs/room並看live公開面板與guest最終畫面。

開發中typecheck漏action欄位與queue2≠1失敗log保存，修正為每test新app/清情境舊queue後focused5/5。root檢視容量拒絕/expiry dirty通知/UI時鐘anchor與acceptance狀態/腳本等待及預先掛負例；source交接後hash保持一致，root無source窄修或額外全量重跑。

只有頁內固定文字公開區，無T11展示頁/模式/QR/保留草稿/飄移動畫。原#11 100accepted/p95品質未驗，完整T10/POC-03 Inconclusive；臨時participant/dedup與全部狀態process-memory，手機/真人/弱網/容量/耐久/部署未知。README/需求狀態/計畫/票面/SOL/索引同步，server/browser停止，本輪writer停止並釋出。本機commit程式+紀錄，不push/遠端票/T11/部署，下一項依人類指示。

## T11啟動（2026-11-04）

人類指定「繼續做T11，驗測維持輕量，確認直接入房、只互動模式與展示端的核心功能可行及使用方式，完成後把程式和驗測紀錄一起commit」。#12「參與模式與唯讀展示頁」已讀回，基線0607576、R007配發。Luna xhigh寫派定程式，root設計/驗收/紀錄/Git；完整scope見dispatch。深連結/QR走同門禁、server權威participant模式切換及只互動零訂閱/bytes，display獨立降權且無私聊/主持/修改內容；草稿/音量保留、watch不自動播放。加入pinned本機QR產生/獨立解碼依賴，manifest唯一writerLuna。驗測少量Node與三Firefox持續合成來源、實際QR像素解碼；手機相機/真人/完整階段不預填，無部署/push/遠端票/T12。

### T11驗收中間狀態（2026-11-04）

source/tests/依賴/README已由T11-IMPL明確saved/readback/STOP全部交root，無late patch；build inputs存R007/build-source-sha256.json。root production build/typecheck通過，首次完整41/42唯一既有space.integration共用app/非同步close造成出生位置期待差異，原log/診斷保留；root僅將該測試改beforeEach/afterEach獨立app、不改移動規則或原斷言，重驗42/42通過（core-integration-confirmed.log）。依賴inventory113個、declared license未知0，兩新QR package版本/來源/notice已讀回。

T11-SMOKE／Luna xhigh仍唯一寫scripts/participation-smoke.mjs與.scratch/t11/smoke-authoring（原作者明確釋出未建立script才重派）。尚未交接、未啟browser/runtime，不推定已驗。root runner為/private/tmp/laitse-t11-accept.py：--browser-only啟單一HTTPS4173、私有隨機HOST_CONTROL_TOKEN+MEETING_ROOM_PASSWORD及同值PARTICIPATION_TEST_*，三Firefox script後finally停止；尚待script STOP後執行。node pinned .tools26.13.0、repo cache、既有.scratch/t01/tls CA/cert/key。R007 manual guide/review仍待browser結果，原始QR metadata／inventory與測試證據已保存。只做本機commit，不push/遠端票/部署/T12；AGENTS.md/.scratch其他未追蹤項不可stage。

## T11最終checkpoint（2026-11-04）

R007桌面核心驗收完成：42核心/build/typecheck與三Firefox成功，直接正常gate/只互動server+raw0/同身份房間草稿音量/觀看手動/唯讀實播公開/真QR像素解碼再入房可行；9外部越權拒絕。root已獨立讀回與實際看圖。首輪舊space共享app時序與browser selector失敗保留，最小修正後通過。SOL-005/003/008與002/007及需求/計畫/票面/README/協作同步。

所有agent已saved/readback/STOP交接，root唯一writer；server/Firefox已停止，cleanup讀回4173無listener/自有profile無process。預先未追蹤AGENTS.md與.scratch/保留不stage，程式+R007紀錄同一本機commit；不push/T12/遠端票/部署。手機相機/真人/耐久/品質與完整POC-03仍待，下一步由人類指定。

## T12啟動checkpoint（2026-11-04）

人類明確「繼續下一個」，範圍T12 #13（已讀回R001票面），不接T13。基線133684b，既有AGENTS/.scratch未追蹤保留。完整writer/設計/驗收/停止條件已記dispatch；T12-IMPL／Luna xhigh已啟動且唯一寫source/tests/script/README/checks，root獨占權威docs/Git/runtime。.gitignore補本輪scratch，無manifest/lock更動。等待明確source saved/readback/STOP才可root改動或build；root設計/驗收，未先宣稱通過/部署。

## T12最終checkpoint（2026-11-04）

基線133684b；人類「繼續下一個」已完成T12控制核心。source與兩位Luna分別明確STOP交接後root build/typecheck/完整47與首次三Firefox21秒流程通過；原身份/房間/最新gate與權限/去重8,696ms過期/active Leave成功。root已實際看兩圖、核對去識別摘要與build指紋，沒有raw逐包重放證據宣稱。R001/README/SOL-003/005/006/008、需求狀態/計畫/票面/協作索引已同步。

root為最後唯一writer，server/Firefox/profiles已停止清理，cleanup讀回4173無listener、自有profile無process。程式與驗測紀錄同一本機commit，既有AGENTS.md/.scratch保留未stage，不push/遠端票/T13/部署。媒體恢復、實體弱網/半開、手機、耐久/容量/完整POC-04仍待。下一票須人類指示，不自行接續。

## T13啟動checkpoint（2026-11-04）

人類要求T13輕量核心/用法、程式+紀錄commit，基線0ade7c9、R002票面/host已保存。完整writer與設計scope在dispatch，T13-IMPL／T13-SMOKE兩Luna xhigh已啟動；root獨占docs/Git/runtime，不搶source/script writer。source預設client+新tests，server/manifest/lock/Phaser/互動唯讀；不改捕捉權限語意/不auto發布。待saved/readback/STOP才能rootbuild/接管，尚未runtime。AGENTS/.scratch原有未追蹤保留不stage。

## T13最終checkpoint（2026-11-04）

人類T13輕量core/用法+程式紀錄commit已完成分段驗收，基線0ade7c9，R002。54核心/typecheck/build一次通過，交接source指紋未變；third接收恢復實播/stop不復活/sender無auto已證明，最後publisher-only正常claim與generation2/新clock實播通過。3次full腳本失敗與窄修保留，停止整套後不重做receiver，最終full僅syntax未整段再跑。root seq/config/clock/render讀回/3圖實看完成。

兩Luna都STOP釋出，root完成SOL/需求/計畫/票面/README/協作同步，server/Firefox/profile已清理，4173無listener。程式+紀錄同一本機commit，既有AGENTS/.scratch未stage，不push/遠端票/T14/部署；gesture/手機/真人/20次p95/弱網/耐久/完整POC-04待補。下一項仍由人類指定。

## T14啟動checkpoint（2026-11-05）

人類接續T14輕量/用法+commit；ff672f0基線，R003/#15已讀回。完整scope/writer/界線在dispatch，T14-IMPL與T14-SMOKE兩Luna xhigh已啟動；root獨占docs/Git/runtime。舊queue上限沿用，新增local residency/sendcallback age為候選，不補造POC00既定設定。driver只單頁應用hold不是TCP弱網，真手機/背景/品質/完整POC-04待補；source/tests STOP後才rootbuild，未驗收。AGENTS/.scratch既有未追蹤保留不stage。

## T14最終紀錄

T14交付（2026-11-05）：[POC-04-R003](../poc/evidence/POC-04-R003/README.md)保存63核心/build/typecheck與最終完整三Firefox輕量流程。per-socket共享byte/callback budget、PCM/video local residence有界；慢端bounded應用hold後新連線/config/keyframe與實播，健康端hold5次/恢復後3次及ACK持續。首輪route close未到page的失敗與harness兩端4003修正保留；server policy仍1013。500ms目標實測501ms，非TCP/端到端age；手機/真背景/弱網/品質/完整POC-04仍待。README/SOL/需求狀態/計畫/票面同步，writer/runtime已停止釋出，程式+紀錄本機commit，不push/遠端票/T15/部署。

## T15啟動（2026-11-05）

人類明確指定T15輕量核心/用法＋程式紀錄commit。基線eb58084，R004/#16已讀回，完整writer/scope見dispatch。短兩房整合/受控close恢復/撤權不復活/健康房持續，65min/手機/真弱網仍未驗；root驗收與docs/Git，Luna xhigh新script，不push/T16/部署。

## T15最終紀錄

T15交付（2026-11-05）：[POC-04-R004](../poc/evidence/POC-04-R004/README.md)保存63核心/build/typecheck與最終四Firefox10,069ms完整短整合。兩房合成音畫同時實播、studio本地1s deadline關線後fresh authority/config/keyframe恢復、主持不auto需重新認領；撤權tracks ended/900ms無新增，被撤者再resume無來源/權限復活。lobby12採樣持續與2ACK成功。首輪timer提前1ms斷言失敗/harness窄修保留，app/source/依賴未改。root兩圖/讀回完成，SOL/操作/需求狀態/計畫/票面同步；65min/手機/真背景/真弱網/品質/資源/耐久/完整POC04仍待。writer/runtime已停止釋出，程式+紀錄同一本機commit，不push/遠端票/T16/部署。

## T16啟動（2026-11-05）

人類明確指定少量接收端單房fanout輕量核心/用法+commit；beea0fa、POC05-R001/#17。scope見dispatch，1host合成音畫／1→3真接收／退訂隔離／全停，root驗收docs/Git/runtime、Luna xhigh新script。容量/長測/手機/雲仍未驗，不push/T17/部署。

## T16最終紀錄

T16交付（2026-11-05）：[POC-05-R001](../poc/evidence/POC-05-R001/README.md)以1發布／1→3真Firefox接收完成14,877ms短fanout。三端同config/clock、3採樣實播增長；A退訂350ms無新media而B/C繼續，publisher正常停2來源/其餘streamEnded清空。build/typecheck與browser通過；既有全套62/63限流訊息逾時，單檔9/9通過但根因未定；首輪Continue點擊失敗及窄診斷保留，最終無gesture，該分支未覆蓋。source/依賴未改；root讀回/A-C實看、server30ps採樣僅診斷，SOL/操作/需求狀態/計畫/票面同步。10/25/50／20min／手機／真人／品質/完整負載端資源/完整POC05未驗；writer/runtime釋出、程式+紀錄本機commit，不push/遠端票/T17/部署。

## T17啟動（2026-11-05）

人類指定少量雙房影音/只互動混合核心+用法及程式紀錄commit；7c80a14、R002/#18。scope見dispatch，6真Firefox兩房publisher/watch/only、mode切換/零媒體隔離。Luna xhigh新script、root驗收/docs/Git/runtime；非50人/20min/完整POC05，不push/T18/部署。

## T17最終紀錄

T17交付（2026-11-05）：[POC-05-R002](../poc/evidence/POC-05-R002/README.md)保存build/typecheck/63核心與首次六Firefox18,233ms短流程。每房1source/1watch/1only，兩房實播；專用only初始/活動self0且整輪raw0、回饋同房DOM0→1/異房0。studio watch→only零增量→watch不auto直到manual新config實播，lobby持續。root全hash重算source668/669→ownreceipts643/411，foreign/unknown/ambiguous0、count-byte完整；2圖實看/cleanup。app/依賴未變，SOL/操作/需求狀態/計畫/票面同步；50/20min/手機/真人/品質/全client資源/雲/完整POC05待，無Continue分支。writer/runtime釋出、程式+紀錄本機commit，不push/遠端票/T18/部署。

## T18啟動（2026-11-05）

人類指定程序重啟/資料恢復輕量核心及用法+commit；13fb00e、POC06-R001/#19。scope見dispatch，三browser/owned process實停重起/舊proof拒絕/新身份人工操作重建，動態資料/耐久缺口不得冒稱恢復。Luna xhigh新script、root設計驗收/docs/Git/runtime；無外部服務/持久化決策/T19/MVP/push/部署。

## T18最終紀錄（2026-11-05）

T18輕量評估完成：[POC-06-R001](../poc/evidence/POC-06-R001/README.md)保存build/typecheck/63核心與第三輪三Firefox12,837ms真程序重啟流程。PID58035→58041、三舊proof拒絕且無自動操作；重載正常入房得新UUID、重新claim/手動來源與訂閱可實播。feedback1→0、live密碼B失效而startup A有效，**動態資料未恢復，目前process-memory候選耐久No-Go；完整T18/POC-06及MVP Go未通過**。兩個rawWSS越權拒絕、6個server-down預期socket錯誤已核對；前兩次harness缺陷/修正保留。root獨立讀回/兩圖實看、source指紋未變、cleanup完成。SOL-007既有清冊原位更新，未新增保存方案或接受資料遺失；app/tests/依賴未改，新增重啟驗測script與操作紀錄。writer/runtime停止釋出，程式與紀錄同一本機commit；不push/遠端票/T19/MVP/部署。

## DEC-012 已保存（2026-11-05）

人類允許「可使用 **PostgreSQL 18 來儲存系統資訊**」。root已記錄精確原話／範圍／未確認事項，PRD及handoff v0.9、brief、POC plan與SOL-007交接同步。資料庫為DEC004例外，其餘單一app/本機POC限制維持；新整合未啟動，T18既有證據未變。本輪純文件，diff/讀回檢查，不啟服務或跑全套；尚未commit，writer已釋出。

DEC-012範圍補充已保存並讀回（2026-11-05）：人類原話「都可以儲存」，涵蓋前述房間／管理設定、身份／Session、聊天、回饋與統計系統資訊。需求／plan／SOL007交接同步；未將儲存許可擴張為永久保留、無條件恢復權限或影音錄製。純文件檢查，未啟動程式／新run，尚未commit；文件writer釋出。

## DEC-012持久化整合啟動（2026-11-05）

人類要求回頭把必要資料設計入DB、開發可Docker，並已啟動Docker。13fb00e後T18完成基線7b07341；既有7份未commit決策文件保留累積。完整scope在dispatch；PG-IMPL Luna xhigh已啟動唯一寫source/新DBtests/compose/manifest/README，root唯一docs/Git/runtime與驗收。POC06-R002建立，Docker29.8.2已可連；不預填新run通過，不覆寫R001。source STOP後root接管測試。無部署/push/T19。

### PG整合中間狀態

Docker18.6實體容器laitse-poc06-r002-db、volume laitse-poc06-r002-data與三獨立DB已建立，loopback55433，secrets只ignored private scratch。R002 environment/database-runtime保存版本digest與initdb readiness診斷；devcompose port55432，config靜態通過。PG-BROWSER已saved/readback/STOP，root接管scripts/database-restart-browser.mjs，修action點號白名單並exactNode26.13 syntax通過；作者handoff已複製R002。PG-IMPL仍唯一source/manifest/compose writer，尚未build或app runtime。root runner /private/tmp/laitse-pg-accept.py 支援--checks/--pg/--browser，PG測試URL隔離DB，browser每次新DB保留前次，不含secret輸出。待source STOP再rootreview/build/63/PG/browser，未先判Pass。

## DEC-012持久化整合最終紀錄（2026-11-05）

DEC-012資料庫整合完成：[POC-06-R002](../poc/evidence/POC-06-R002/README.md)保存PostgreSQL18.6 Docker／pg8.23.1與migration、系統資訊保存及恢復用法。最終build/typecheck/63核心、真PG整合、ACK後SIGKILL、advisory backend失連停止、兩真Firefox同document/原ID/最新B門禁/chat與feedback恢復、13表同volume容器重啟筆數與指紋一致。有效proof恢復不自動復活主持／發布權，畫面TTL與archive分開；SOL007唯一清冊已原位更新。首輪health shape／fixture event count及browser環境/URL事件誤判等失敗保留、窄修後重驗。完整POC06/MVP/備份/HA/多instance/正式保留政策/雲未驗；舊R001 memory No-Go不改判。所有writer已saved/readback/STOP，root驗收，server/Firefox/Docker已停、volume保留；程式與紀錄同一本機commit，不push/遠端票/T19/部署。

R002最終讀回補充：build inputs44份與最終source/tests/config65份指紋已核對；PG/runtime/browser/容器讀回及artifact掃描保存，127個已安裝package declared license未知0。所有程式與紀錄已準備同一本機commit，既有AGENTS/.scratch不stage；Docker與四port皆無listener，兩named volumes保留，無其他服務變更。root為最後唯一writer，提交後停止本輪修改。

## T19最終紀錄（2026-11-05）

T19／#20審查交付完成：[POC-07-R001](../poc/evidence/POC-07-R001/README.md)固定8b5fc43與同版65指紋、重新build/typecheck，沿用R002的63核心/PG恢復證據，另在PG重驗四Firefox短整合10,394ms、六Firefox混合19,021ms。root重算來源隔離/only0/authority與撤權、實看PG實播畫面；原T15 Continue逾時與私有port probe TIME_WAIT診斷保留，僅測試副本窄修，產品與原腳本不改。既有mvp-handoff原位整理SOL001～008狀態、逐階段證據、GATE001～006、測試工具移出項與MVP順序。

執行紀錄完成／完整資格Inconclusive／technicalGo=false（NoGo）：真mic至另一端真人聽見與目標實機手機加入/選房/只互動證據仍缺，首批支援範圍未確認。不是要求補50人長測/全面QA或本輪CloudRun部署；容量硬上限8、實測6明示，PG保存缺口已解，不重新要求批准資料庫。尚未開始MVP，不推定人類接受品質。source/deps未改，資料volume/test DB保留、server/browser/DB回復停止，紀錄同本機commit，不push/遠端票/部署。

T19保存／讀回已完成：65原候選hash一致、55主要連結存在、JSON與secret掃描通過。root核對媒體來源703/703→watch673/439、only0、authority/撤權/健康房；實看PG實播畫面。無產品程式/原腳本/依賴更動，僅紀錄與測試副本；全套63/PG恢復沿同版既有證據未重跑。資源已釋出，保留DB/volume，待本輪同筆commit，不自動接續MVP。

## GATE-001桌機真人收聽交接（2026-11-05）

人類改為「在桌機就好」，手機仍待。root已啟動PG專用container及新manual DB，app只綁127.0.0.1:4173、HTTP/WS loopback；未鎖studio/未開主持fixture，無密碼輸入、無fake media。POC07-R002 runtime/readiness/guide已保存讀回，health postgresql/room unlocked/unmanaged/HTML200機器檢查通過；真人聽見/停止/重開尚未回報，不改T19 NoGo。

服務明確留給人類操作：exec session3388，app PID見R002/runtime.json，原test PG初始exited現running。root在桌機測試期間不操作人類分頁、麥克風或音量；收到結果後再記實測範圍及按指示清理，volume/資料不刪。程式/憑證/網路設定未改，文件尚未commit；無手機/部署/推送/MVP。

## 桌機真人語音核心確認（2026-11-05）

GATE-001-DESKTOP-AUDIO／[POC-07-R002](../poc/evidence/POC-07-R002/README.md)已保存人類確認：對耳機是否聽見回答「OK」；再對主講停麥/重開及接收停聽/重開回答「兩端都測過，正常」。本輪Edge桌機兩頁真人語音核心Pass，Edge版本未回報，不以指南Chrome當實測。appshot計數僅佐證管線，不以RMS瞬間值推斷人耳或量化品質；原話/範圍分開保存。手機由人類指定先不做，仍待；完整進場NoGo/MVP未開工保持。服務繼續localhost:4173與專用PG運作，root不操作人類Edge或收音，無程式改動／新合成測試／部署。

## GitHub進度同步完成（2026-11-05）

依人類「要記得更新進度」，[母議題#1](https://github.com/samzhu/LaiTse/issues/1)及T01～T19（#2～20）已加入最新進度段，說明核心已驗／未驗、DEC-010輕量範圍、DEC-011空間門禁與DEC-012 PostgreSQL18例外；桌機Edge真人語音與兩端啟停已確認，手機仍待、technicalGo=false。保留原AC、open與labels，沒有推送程式、關票或部署。20張寫入後均讀回正文完全一致，before／expected／readback SHA256見POC-07-R002/github-progress-readback.json。後續相關POC保存後同步相關票的偏好已記入brief。

本輪只有紀錄變更；JSON解析、20張Issue精確讀回／原文與狀態保持、證據路徑及git diff檢查通過，不重跑既有程式測試。R001歷史結果不覆寫。文件writer／GitHub寫入已結束；localhost:4173及專用PG容器繼續運作供人類，未接管Edge／麥克風，未做手機或MVP。

## MVP-DESKTOP-PLAN／DEC-013（2026-11-05）

人類確認桌機MVP優先、手機後續，授權先整理功能／開發計畫並集中討論待決項。已保存並讀回PRD v0.10第6/9/11節：F01～09核心範圍、M00～06開發／輕量示範順序、D01～06待決（身份／邀請、OS／瀏覽器、容量／發布、距離／門口／視覺、活動／資料、交付／部署）。D01～03先討論，其餘到相依階段前確認；建議不當人類決策。

手機已從本版前置移除，不再以未做手機阻擋桌機規劃；T19原NoGo與未驗證據保留，未自動宣告全technicalGo。只規劃／文件，未開始MVP程式開發、未新增實測／拆票發布或部署；src/tests/deps不改，沿SOL007唯一資料清冊；manual服務不操作／不停止。後續GitHub母#1、手機#3與審查#20同步本次版本界線並讀回；驗測採文件／連結／狀態一致性，不重跑程式全測。

MVP-DESKTOP-PLAN交付已保存／讀回（2026-11-05）：PRD v0.10第11節為唯一計畫入口，DEC-013精確原話／範圍已同步；GitHub母#1／手機#3／審查#20更新並3/3正文精確讀回、原正文／AC／open／labels保留，憑據POC07-R002/mvp-scope-progress-readback.json。計畫F/M/D識別、單一第11節、4份主要文件本機連結及diff檢查通過；純規劃未跑新程式／瀏覽器測試。無產品／依賴修改，未開始MVP或部署／push；本機commit紀錄，writer結束，既有manual服務與人類Edge未操作／未停止。下一步集中討論D01～03，建議不當已確認。

## DEC-014／MVP規劃調整（2026-11-05）

免登入／任意暱稱即產生人物入場、人人可選會議室上鎖已確認；「連線先不鎖上線」按不設固定產品人數上限解讀並明示。PRD v0.11第6/11節、decisions、brief與handoff已保存／讀回；D01已收斂，D03不鎖人數／並發發布仍待，D07解鎖／改密碼與其餘主持歸屬待討論。原POC8人限制仍在／實測6人，移除列M05，未改程式或宣稱無限容量。無正式帳號前置，仍保留server匿名成員識別／房密／隔離；本輪只規劃未開發、未操作manual服務或人類Edge。

DEC-015：人類另明確確認上鎖詢問密碼、現任管理者可改密碼／轉交、離線隨機交在線房內人、無人自動解鎖。已讀回PRD v0.11；D07鎖房管理收斂，其他活動主持權仍待，未實作。

DEC-014／015本輪交付完成（2026-11-05）：PRD v0.11與既有MVP計畫已同步免登入、任意暱稱產生人物、人人鎖房；上鎖詢問密碼、現任管理者可更改／解鎖／轉交、離線隨機房內在線成員接任、無人自動解鎖。精確人類原話在decisions；D01已定、D03產品人數上限不設（原話「上線」按上限解讀）、D07鎖房部分已定，其他活動主持／並發發布／桌機環境仍待決。GitHub#1/#10/#20已保存且3/3正文精確讀回、原正文/AC/open/labels保持，憑據POC07-R002/anonymous-mvp-progress-readback.json。文件ID／主要連結／JSON／diff檢查通過；未跑新程式測試、無src/deps變更、8人程式限制未移除，未開發MVP或push／部署。writer結束，既有manual服務與Edge未操作／未停止，紀錄同本機commit。

DEC-016：會議室人人可同時自行開麥、同時一畫面已確認。原話在decisions，PRD v0.12更新M03／D03／多人驗收與POC-MA-01；server現況仍單音訊publisher、尚未開發／驗測，新要求不沿用單講者證據宣稱可用。開放區多人、治理與分享交接仍待；本輪不操作既有服務或Edge。

DEC-016交付讀回（2026-11-05）：人類原話、會議室人人自行同時開麥／同時單人畫面已保存PRD v0.12及decisions；M03/D03／驗收與POC-MA-01增量流程已同步。Github#1/#4/#10/#20保存後4/4正文精確讀回，原正文／AC／open／labels保留，憑據POC07-R002/multi-speaker-progress-readback.json。主要本機文件連結、單一計畫／版本／新增範圍與JSON／diff檢查通過；只規劃無新測試或src/deps更動，單音訊publisher尚未改造。紀錄同本機commit、不push／部署；writer結束、既有manual服務及人類Edge未操作／未停止。

## POC-MA-01交付（2026-11-06）

POC-MA-01／R001（2026-11-06）已完成會議室多音訊來源relay、逐來源decoder／AudioWorklet／時鐘與計數，lobby仍單來源；screen同時一人及同源clock保留。最終build/typecheck與四Firefox合成短流程11,063ms／媒體6,461ms完成；root重算A收B318、B收A302、C收A161/B175，未知／自送／歧義0、D影音0，A停B持續、晚加入／重連／切房／only0與單screen競爭通過，兩圖已實看。

自動結果分開：初次66pass/1PGskip原log後被覆寫，root先前讀回計數保留；第二全套65pass/1space快照時序失敗/1PGskip，space窄診斷3/3，未改空間功能／測試，不稱最終全套綠。首輪Firefox sandbox啟動中止、受控首次成功、狀態文字修正後同頁並行點擊screen.subscribe未送出失敗、腳本改循序後最終成功皆保存，不回改舊run。

真人多人聽感／Chrome/Edge跨裝置／本輪PG多人整合／真弱網／容量品質未驗；Docker不可用故memory fixture，無schema／新依賴，原8人程式門檻與舊managed主講授權仍在，不是新商品鎖房管理已完成。自有server／browser已停，未操作原4173／人類Edge／麥克風；未開始MVP／push／部署。

來源／結果已保存並讀回：`docs/poc/evidence/POC-MA-01-R001/README.md`、root-readback/source-sha256/verdict/cleanup及各輪報告；Github#1/#4/#10/#20更新與正文讀回待本輪最後執行，按明確授權程式＋紀錄同本機commit。不自動啟動下一個POC或MVP。

POC-MA-01-R001最終保存／讀回（2026-11-06）：程式／操作／verdict、32份選取證據及source64指紋保存，root重算所有接收封包來源與quiet／跨房窗口、實看兩張最終圖。最終短流程11,063ms／active6,461ms通過；全套第二跑space時序失敗與單檔3/3、首次log覆寫只保留讀回計數、三輪browser歷史與最終confirm分開，不稱全綠或真人通過。Github#1/#4/#10/#20已保存並4/4精確讀回、原AC/open/labels保持。JSON／64hash／122主要本機連結／diff／secret模式掃描通過，全部自有server/browser已停且讀回確認，未操作人類資源或資料volume。root唯一writer結束，程式＋紀錄同本機commit，不push／部署／自動接MVP；真人多人、PG模式、目標跨裝置／容量等保留未驗。

## POC-RM-01-R001交付（2026-11-06）

POC-RM-01-R001（2026-11-06，基線0995141）匿名studio管理核心Pass：上鎖詢問密碼、server匿名ID唯一owner、改密碼／解鎖／手動轉交、同名越權拒絕；DEC017換房保留管理權且空房仍鎖，僅owner離線時從房內在線participant隨機接任／無候選自動解鎖，舊人重連不自動取回。私有轉交名單只給owner，display不參選；舊HOST_CONTROL_TOKEN模式保留原行為且停用新匿名命令。

build2/typecheck通過；core69pass/2個PG當時skip，root真PG串行2/2無skip，驗001→002舊鎖/verifier/revision升級保留、匿名lock/transfer ACK後讀回及restart只清匿名孤立鎖、legacy鎖保持。最終4Firefox13項10,214ms通過、兩圖已實看；另正向owner unlock可信WSS與PG清除讀回通過。root獨立核對65條狀態與7筆該run審計、71份來源指紋。初次test syntax typo、browser等待錯事件／離開ACK、historical-state helper修正及各次結果保存。

共同相依的MA01同版PG短回歸11,328ms／active6,505ms通過：A收B323、B收A306、C收A160/B172，未知／自送／歧義0、D影音0、單screen與恢復／切房／only0保留；不是重啟影音自動恢復或真人聽感驗收。自有server/browser已停、專用container還原exited，DB/volume保留；未接管人類Edge或實體麥克風、未push／部署／啟MVP。

source/test/migration/script唯一writer已saved/readback/STOP交回root，root驗收與資料庫讀回保存。GitHub#1/#4/#10/#19/#20本輪同步最新差異並讀回；程式與紀錄按明確授權同本機commit，不提交既有AGENTS或私人scratch。證據`docs/poc/evidence/POC-RM-01-R001/`，不自動啟動下一項。

POC-RM-01-R001最後交付讀回（2026-11-06）：build／core69、真PG2、Firefox13項10,214ms及PG多人影音短回歸均通過；root源碼／候選資格／65條私有狀態／7筆審計／71hash／正向解鎖DB／兩張畫面核對已完成。首syntax及harness事件／ACK失敗、前次成功與最新狀態加嚴後的成功均保存，不聲稱人類接受、統計公平、容量或部署。source8檔交回後未改，root僅修script觀測；新schema migration與SOL007清冊已同步。Github#1/#4/#10/#19/#20已保存並5/5精確讀回、原AC/open/labels保留；JSON／71hash／124主要本機連結／diff／secret模式掃描通過。自有app/browser停且讀回、專用container回exited、DB/volume保留，未接管人類資源。root writer結束，程式＋紀錄按授權同本機commit，不push／部署／自動接下一項。


## POC-CAP-01進行中（2026-11-06）
人類要求移除固定8人、>8加入／互動／影音輕量驗測並commit/GitHub，補充Cloud Run 1CPU/1GiB推估、服務內可調軟限制。軟限制是阻擋新加入或只警告，以及設定操作權限待人類回覆；不可從未回覆猜政策。派工見dispatch：cloud_capacity_research只寫研究文件；cap_browser只寫scripts/capacity-smoke.mjs；cap_implementation第一階段只移除client8active來源與將deferred close budget獨立256，未授權先改准入政策。root唯一docs/Git/服務操作者。
基線5eceea1，tracked原先乾淨；AGENTS.md與原.scratch不可提交。Docker已可用，專用PG container原exited本輪啟動，新cap01 DB及私密DSN存.scratch/cap01/runtime-private.json(0600)。已用cached node26.13.0-bookworm-slim/arm64限1CPU/1GiB/no-swap啟原候選，外部PG，可信HTTPS健康回應ok；13個空載sample，尚無參與者，不能推算容量。私有launcher/metrics及summary在.scratch/cap01。app container laitse-cap01-app 已停止保留，PG仍開等後續測試，結束須還原exited不刪DB/volume。未Cloud Run部署／GitHub寫入／commit，尚未完成>8人驗測。

CAP補充：原候選8個opaque WS全員語音互收＋一路畫面約10秒，3672送audio/25704收、147送screen/1029收符合無self-return，0error；CPU mean20.97% max27.77%、process RSS max97,112,064B。每講者實際45.88fps低於target50，非browser/codec/Cloud容量保證；短測期間曾在app cgroup啟診斷node，因此不採cgroup peak當純服務用量。選取原始資料/summary/dist指紋已存POC-CAP-01-R001。GitHub#1/#18已更新「進行中」2/2正文精確讀回、state/labels原樣，receipt同資料夾。app與專用PG container均已停止讀回exited，保留DB/volume。產品決策與>8browser尚待，未commit。

CAP第一階段來源已交回root：移除receiver8active gate、close budget獨立256；新增receiver3測root再跑3/3，log與3檔指紋存evidence/implementation；sourceagent另回報PCM4/4/typecheck。研究已交回root並讀回。所有新項未commit，join8 gate仍在、>8browser尚未執行；不可對外說移除8人POC已Pass。等待async兩問：超額是拒新join或只警告、設定是localPOC管理或任何已加入者。回答後補DEC/範圍與PG設定實作，啟本輪fixture重建候選後才runCAP腳本，驗設定保存/重啟/調整、>8media與限1CPU/1GiB量測，再完整docs/GitHub進度與同commit交付。


### CAP續作現況／交接用（2026-11-06）
人類最新回「繼續」，root已告知依前述推薦採滿額拒新加入／不踢現有人及本機管理頁，作可回復POC假設（非逐題確認），DEC018原話與區別已保存；PRD v0.14、plan、README、SOL007資料清冊、AI handoff為進行中更新，最終須改為實際結果。cap_implementation第二階段唯一writer持src/server app/space/persistence/index、新capacity.ts、003_capacity_settings.sql、server/postgres/capacity tests與窄room-management.postgres migration期望；原第一階段已交回root。agent已回報typecheck過、capacity5/5初過，build/窄tests仍進行，root尚未接回／操作候選。其log在.scratch/cap01/implementation/phase2。cap_browser已saved/readback/STOP交回scripts/capacity-smoke.mjs(917行)，root可改／run但尚未執行。
API/選擇器已定：GET/poc/capacity；GET/POST/api/poc/capacity，body {softLimit}，回 {softLimit,currentMembers,persistence,persisted}；data-testid capacity-limit / capacity-save / capacity-current-members / capacity-limit-output / capacity-save-status。localCapacityAdmin option預設false，index LOCAL_CAPACITY_ADMIN=1且HOSTloopback；所有管理路由檢真正remoteAddress+Host、POST同Origin/JSON，無登入或房間owner全域權。計數含display，分頁各一席。
root獨占服務／DB／browser／docs／Git／Github，已準備.scratch/cap01/start-local.mjs（HTTP loopback ephemeral+PG+localCapacityAdmin:true，runtime-local.json），及admin-smoke.mjs（實際Firefox表單set2→join2/第三拒→降1保留2並wave→升3可入→跨Origin/Host拒→非法值拒→set20，預期截圖/report）。勿在source/build交接前run。run-tests.mjs將私密testDSN只傳子程序，Node --test --test-concurrency=1全部tests，log full-tests.log；PG專用container目前已啟且ready，結束還原exited不刪DB。
root舊8人baseline另修driver時序後約49.99fps再跑pass，音訊4000送/28000收、screen147/1029，CPUmean21.99%max27%、RSS97,882,112B；首次因未等container ready握手失敗保留。clocked-baseline已保存正式evidence，仍舊5eceea1 dist非新候選。新的.scratch/cap01/relay-probe.mjs可用PROBE_USERS/PROBE_OUTPUT/PROBE_DURATION_MS(預設10s)，固定https localhost44173，opaque全員32kbps/50fps+單screen800kbps，emit一次wave，驗實收=實送*(N-1)。summarize-probe.py <stem> <serverlog-stem>只取active時間窗計CPU/RSS等。
後續root順序：接source saved/STOP與build→真PG全套一次→啟start-local via tty，自有adminFirefox(run需窄提升避免已知sandbox SIGABRT，PLAYWRIGHT_BROWSERS_PATH=repo.tools/playwright-browsers)→PG讀回20與migration003→CtrlC停own tty並重啟讀回20→停host→Docker start laitse-cap01-app(原已存在stopped，1CPU/1GiB/no-swap/bind44173/Node26.13.0 Linuxarm64，讀mounted新dist與同PG，admin預設off)等health ready→CAP01_BASE_URL=https://localhost:44173/ CERTUTIL_BIN=/opt/homebrew/bin/certutil repoNode scripts/capacity-smoke.mjs(可信NSS10Firefox、9mic/1receiver+singleScreen，非9x9互聽)→10/12/16 opaque各10s逐級量測，維持cap20，必要時停增量→保存讀回實看截圖→停Docker、host本機API restore10並PG讀回→全部own服務停、PG還原exited。
最後依實測選暫定容量建議(default10非Cloudmax)，root更新verdict/README/研究附錄/各權威交接狀態、Github#1/#4/#17/#18/#19/#20前綴精確保存讀回，原AC/state/labels不變。所有tracked變更與新evidence程式紀錄同commit，不push/部署/自動MVP。保留既有untracked AGENTS.md與原.scratch；明確stage檔，不git add .。本輪尚未commit/新候選browser未測，舊Github只#1/#18進行中。

CAP實測更新：source第二階段STOP後root窄修DisplayApp room_full顯示動態message並build通過；PG-enabled21檔81/81無skip，log/evidence full-tests-before-backpressure.log。host HTTP本機admin Firefox第一次temp profile不存在，改工作區persistent profile；第二次Node fetch忽略自訂Host，導致測試預期403而回200，root原生http.request確認實送Host=attacker.invalid才回403，該修改只是harness。第三次8項admin flow pass、實看PNG，PG直接讀member_soft_limit20/migrations001-003/PG18.6；CtrlC停PID49238再重啟49386，GET20/0在線、舊listener不可達，皆保存readback。host兩次均已停。
Docker新候選啟用後10Firefox join10/interaction10/九音源開始pass，但九音源接收皆在decodeQueue8時永久endStream而無PCM；真缺陷不可標Pass，failure PNG已實看，report無page/protocol errors。10Firefox finally全清，Docker已停，attempt01與log保留evidence/browser-attempt01。root已委派backpressure窄修，agent已saved/readback並回報3receiver+4PCM/typecheck/build過，尚待最後明確STOP後root接回；新策略仍8pending/500msPCM，忙時略過新packet並獨立decodeQueueDroppedPackets，source保持active、drain後繼續，receivedPackets包含有效local skip、sequence cursor亦更新。root已擴harness解析per-source/aggregate drops、500ms窗drop增量及failure rows。PG仍running原專用container，不刪DB。接回後重跑最終fullsuite81及10Firefox（原browser輸出已搬attempt01，不覆寫）；後續10/12/16 opaque量測、restore default10、清理、docs/Github/commit仍未完成。


POC-CAP-01-R001最終交付讀回（2026-11-06）：全服務固定8人改PG保存可調容量，default10、輸入1..1000不承諾容量；本機顯式受限管理頁、降額不踢人／滿額拒join/resume、PG保存/rollback503與restart20/0在線/最後restore10皆有證據。10Firefox join/互動各10、9合成Opus逐來源解碼/PCM與單VP8呈現核心Pass（32,368ms，active8,254ms）；local drops早期58、500ms窗+58、稍後截圖333，品質／真人多人未Pass，不把略包說僅啟動或網路遺失。decoder保留8pending/PCM500ms但busy skip後可恢復，不再永久終止。
受限Docker1CPU/1GiB、外置PG/產生器，10/12/16 opaque全員音訊互送+單screen各約10s均數量吻合0error，CPUmean27.94/24.12/26.81%、RSSpeak70.88/76.29/79.97MiB；僅工作負載已測點，非CloudRun最大值／16完整browser品質。最後完整81/81 PG案例啟用無skip、build/typecheck通過；歷史81→80/81與單檔11/11及test fixture清理後81分開保存，不改production限速／timeout。root核93source/20dist指紋（browser後僅測試清理檔改動）、203主要本機連結、JSON、99檔私密DSN/password/key掃描無命中；管理與兩媒體截圖已實看。
GitHub#1/#4/#17/#18/#19/#20已保存並6/6精確讀回、原AC/open/labels保留，PRD v0.14／DEC018、SOL002/007/008、研究/操作/交接同步。root唯一writer結束；source與browser agents皆STOP，自有3個host PTY及10Firefox全停、app與專用PG container exited且PID0，HTTP/WSS以正確CA檢查ECONNREFUSED；DB/volume保留，OrbStack共享環境不關。程式紀錄依授權同本機commit，不push／部署／自動MVP；既有AGENTS.md與原scratch不提交。正式雲端管理權／目標桌機品質／高頻控制PG負載／實際雲容量待後續。


## POC-DESKTOP-01-R001進行中（2026-11-06）
人類要求桌機真人多人/真分享輕量驗測、啟服務教方法、完成紀錄commit/Github；先選「同一台桌機Chrome＋Edge單機雙端，真人多人稍後」，又授權驗後關已確認核心issues並寫避免踩坑說明；最新改「先你自動驗證就好，我真人驗證要有環境」。root已承接先自動合成音畫、留真人環境，非人工Pass。
root已新建.scratch/desktop01/runtime-private.json 0600（沿專用PG container laitse-poc06-r002-db，原exited→啟動，新獨立DB不刪舊），核20dist指紋仍候選5dea2e2，沒重build或重跑全81。獨立native host Node服務已detached啟動PID53830，http://localhost:4174/?room=studio；localCapacityAdmin已開（真loopback），GET健康PGready、10席/0人、studio unlocked/anonymous。服務stdout .scratch/desktop01/service.log，啟停程式start.mjs、公開runtime.json。此服務與PG**要留運作給稍後人工測試**，不停止，不碰原4173/人類ChromeEdge/mic。不是Cloud Run或1CPU/1GiB容量測試。
desktop_av_script（Luna xhigh）唯一writer scripts/desktop-av-smoke.mjs與其scratch/harness，不操作browser/build/server/Git；其他檔root獨占。腳本要隔離Chrome/Edge實際exe，A/B互聽+兩source、C晚加入收兩source/單screen、逐來源啟停/重開/stopreceive/resume，記原生codec/PCM與drop，synthetic injection，不取真人mic/OSpicker。待saved/readback/STOP root才run。readiness/manual-guide/evidence README已保存（目前in progress），人類不用現在操作；安裝版本macOS27.2、Chrome157.0.8103.38、Edge156.0.4314.58。
root之後按auto結果逐票核對可關已確認核心issues並寫操作/實作/坑/未驗，手機/真人品質/真弱網等不冒稱完成，原嚴AC不亂勾。提交只本輪紀錄/.gitignore/testscript，不包含既有untrackedAGENTS與scratch、不push/部署/自動MVP。


POC-DESKTOP-01-R001最終讀回（2026-11-06）：人類最新要求先auto並留真人環境，精確原話/單機選項/關票授權存VERIFY-DESKTOP-01-SCOPE human-scope.json。Chrome157/Edge156(macOS27.2)三隔離profiles合成9項7,285ms corePass；root核互聽不自回送/C兩唯一來源native codec與PCM/RMS、A停B sent126→129且C對B PCM37376→40448、A新gen4→6、收聽/分享啟停清空與2張圖。初期及重收snapshot drops0，不清除CAP01九路333drop未驗品質；不是真mic/OSpicker/真人/跨實體裝置。首13,707ms pass的弱sent/received比較已改為同欄位+新PCM，兩次資料分開。
沒有產品碼更動，原20dist指紋仍5dea2e2，本輪syntax/真ChromeEdge流程不重跑全81或build；舊81不能說本輪重跑。3contexts全關、workspace profiles清。**持續保留**native Node PID53830＋http://localhost:4174/?room=studio及PG container laitse-poc06-r002-db(fresh DB)給稍後人工，10席/0在線/PGready/unlocked/anonymous，runtime私有在.scratch/desktop01；root沒有操作原4173/人類UI/mic，沒有系統信任/權限修改、不刪DB/volume。之後停環境前核對runtime.command/PID，不憑舊數字kill。
依人類明確新授權，已在每票寫核心/怎麼做/坑/證據/未驗，關#2/#4/#6/#8/#9/#10/#11/#12/#13/#14/#15/#18/#19(completed)，保留#1/#3/#5/#7/#16/#17/#20 open。20票正文/狀態精確讀回，title/labels/原AC歷史保留、不代勾未驗，不建新票。README匿名DB seed、Meeting room多人限制、artifact/人類guide與SOL002/006/008及現行GATE已同步。此結案不是正式商品／真人品質／所有OS支持或MVP開工接受；本輪紀錄+testscript同本機commit，不push/部署/自動MVP。source/script writer已STOP，root文檔/Git完結後釋出，保留服務維持人工交接用途。

桌機交付最後檢查：44個source/script指紋、188主要本機連結、所有JSON解析、私密DSN/password/private-key掃描0命中、node --check及diff檢查通過。Github13closed/7open、20/20正文/狀態/labels/title/原body讀回。人工驗證pending，服務4174與PG保持healthy/0在線/10席，非cleanup遺漏；人工guide在本run。root所有文件與唯一testscript同本機commit，原AGENTS.md/.scratch不納入，沒有產品碼變更、不push/部署。


## POC-FINAL-01-R001進行中／DEC019（2026-11-06）
最新人類「繼續，把所有issue驗測完畢」，已答「先改為自動驗測為驗收標準」；root已記DEC019，驗收以桌機輕量可重現auto核心，真人/OSpicker/實體手機不當本輪前置且明列後續，不能假裝實機Pass。原strict p95/65min等作歷史，不為自動綠放寬資源邊界/忽略失敗；不自動MVP/部署/push。open仍#1/#3/#5/#7/#16/#17/#20尚未本輪改state。可用手機自動化通道檢查xcrun devicectl/simctl均不存在、adb不在PATH，沒有實體手機auto證據。
三位Luna xhigh按dispatch末唯一writer：final_liveness持app.ts、新connection-liveness.ts及2test檔，補真正WS ping/pong失聯（原sessionHeartbeat只PG proof lease），prod預計10s/20s，createApp test seam connectionLivenessForTest:{pingIntervalMs,pongTimeoutMs}；root network fixture用250/1500ms。final_network_script持network-recovery-smoke.mjs與local-tcp-fault-proxy.mjs，A本機rawTCP黑洞/延遲/限速只對自己proxy生效，B/C直連，驗owner失聯handover/健康PCM/互動/恢復proof原ID但不自動還owner；鎖後resume可能需要passworddialog已提醒。final_capacity_script持desktop-capacity-smoke.mjs，Chrome/Edge實際exe隔離profiles，3→6→10人逐級，每級N-1合成音源+末Edge接收及screen，3～5秒窗口實際PCM/drop/queues。agents只source/script檢查，source agent獨占build，其他不run browser/server/Git。root未接回任何本輪writer，未run新候選。
root保留人工4174/PID53830+PG laitse-poc06-r002-db，不碰user UI/mic。另新專用DB laitse_final01_<timestamp>，.scratch/final01/runtime-private.json mode0600（有testDatabaseUrl到laitse_poc_test），不列印DSN/不刪資料。已準備.scratch/final01/start.mjs，用compiled createApp PG匿名/容量admin，固定4175loopback；FINAL01_FAST_LIVENESS=1 seam250/1500，FINAL01_TLS=1改可信localCA cert HTTPS，預設HTTP。**待source STOP/build後才run**。runtime.json公開PID/URL/liveness mode，私有app可tty CtrlC停，原4174絕對不作故障注入。
#7同步可重用既有scripts/t06-smoke.mjs（root唯讀，單source marker/同publisher clock、原生codec/PCM對canvas RAF；有mappingErrorBound=null所以不可稱human E2E/p95），需先停private HTTP4175、以同DB TLS4175/prod liveness啟，再T06_BASE_URL=https://localhost:4175 PATHpinned CERTUTIL_BIN=/opt/homebrew/bin/certutil T06_OUTPUT_DIR=.scratch/t06/final01執行可信Firefox（窄提升權限、profiles清）；不會停原4174。該舊script rawcontrols只記memory，report匯出types/generation/clockId而非proof；正式證據仍需secret掃描。可能有舊harness時序問題，保留失敗後只窄診斷，不改產品來過測。可依實際需要run，未執行。
交接後root：一次PG-enabled全suite/新unit/build讀回→privateHTTP4175fast liveness跑network script→停privateapp換prod defaults跑ChromeEdge容量3/6/10串行→privateTLS4175跑T06聲光clock核心（如果可用）→stop私有app/proxy/browser，PG因人工4174留著→依DEC019自動證據結案剩票、手機3以deferred/not_planned明說沒實機Pass，#20/#1桌機auto核心Go但不全面商品Go；整理自動核心與後續人工/手機/CloudRun驗收清單於既有PRD/handoff，不造第二PRD。原4174可在0在線/明確ownPID/command確認後滾動重啟到新backend以保留最新人工環境，若有人在場則不擅自中斷。紀錄/程式同commit、Github正文/state/labels讀回，原AGENTS/scratch排除。

## POC-FINAL-01-R001收尾

DEC-019改採桌機自動核心驗收：本輪build/typecheck、真PG全套84/84（0skip）、Chrome/Edge TCP故障／交接9項24,581ms、3/6/10瀏覽器對應2/5/9來源的約4秒PCM窗0decode queue drops，以及Firefox可信HTTPS晚加入／audio-master／來源重建10階段通過。真mic／OSpicker／真人多人、跨實體桌機、手機、校準同步p95／65min及CloudRun仍未驗，移後且不冒稱Pass；歷史CAP01 Firefox九路333drops保留。新增server ping10s/pong20s失聯偵測，沿close串行清理／PG管理交接；PG session lease不等於網路心跳。技術核心足以進入桌機MVP整合規劃，未自動開始MVP程式／push／部署。

[證據／用法／失敗／限制](../poc/evidence/POC-FINAL-01-R001/README.md)。人工4174／PID58824與PG保留，測試4175已停，自有proxy／contexts／profiles清理，所有writer已STOP；GitHub7票更新正文/狀態已保存讀回，20票closed（19completed／手機not_planned）；程式與紀錄納入本筆本機commit，不push／部署。

## REPO-LAYOUT-01整理中（2026-11-06）

人類確認技術POC不等於產品，授權同repo分poc/與apps/web/，僅整理不開MVP。DEC020／dispatch scope已保存。研究Luna xhigh已STOP，官方依據 docs/research/poc-mvp-repository-layout.md；code writer layout_implementation獨占poc/、rootpackage/lock/.gitignore及apps/web README，移動src/scripts/tests/public/db/config/compose/.env.example，根node_modules/tools/scratch/dist不動。root持有其餘docs與README，舊README完整原文已封存docs/poc/legacy-local-poc-guide.md（加歷史前言），新根README及docs/mvp索引完成初稿，待code交付核對。

manual4174/PID58824（讀回0人/10席）與PG仍留運作，不碰人類UI或原4173。root準備.scratch/layout01/run-tests.mjs從root npm test帶PG_TEST_DATABASE_URL（讀final01私密cfg、不得印DSN），以及start.mjs引用poc/dist/server/app.js啟私有4175沿final01獨立DB；尚未執行。後續待code writer STOP，驗lock/npm ci、build/typecheck、84全suite、3browser（desktop-capacity-smoke只接受獨立HTTP非4174），其餘歷史證據不重寫；人工launcher之後僅0人且確認PID才可換poc/dist路徑。root獨占Git/GitHub結案補路徑說明與commit，不push/MVP/部署。原untrackedAGENTS.md與.scratch不stage。

## REPO-LAYOUT-01交付（2026-11-06）

REPO-LAYOUT-01已將技術核心POC收進`poc/`，root為單lock npm workspace協調入口；`apps/web/`只有預留README，**正式MVP未開發**。根`npm run build`／`npm test`／`npm start`仍操作POC，產物在`poc/dist`。原工具/scratch/node_modules、秘密檔與PG/volume不搬刪，歷史evidence與原hash不改；舊程式路徑前加`poc/`對照，舊README封存legacy-local-poc-guide。官方依據支持最小workspace，未新增Turborepo／空共用套件／第二份PRD或資料清冊。

Node26.13乾淨安裝成功（初次離線誤用預設cache失敗保留，改repo既有.cache/npm成功）、root workspace build/typecheck、PG全suite84/84且0skip、31腳本語法及純helper/library import不改cwd通過。從/private/tmp啟動三個隔離Chrome/Edge profiles，2路Opus PCM＋單VP8與逐源停止通過（19,644ms，觀測窗4,014ms）；79檔純搬移、30檔路徑調整，170registry lock entries及所有依賴exact版本不變。root修純TCP library不應chdir，app static root改依模組位置解析避免cwd。人工4174在0人後換poc/dist，PID62270／PGready／0人10席，原4173不碰；私有4175及測試profiles已停／清理。

[證據／mapping／失敗與限制](../poc/evidence/REPO-LAYOUT-01/README.md)。研究與實作writer皆STOP，root完成檢視與純library窄修；root唯一writer提交程式與紀錄。GitHub母#1/#20補目錄與POC非產品說明、保留closed原理由，不新建MVP票、不push／部署或自動開MVP；原untrackedAGENTS/.scratch不納入。

## 人工導覽／停止服務（2026-11-06，最新）

人類要求「先不開服務, 教我如何手動測試 我先看一下功能跟操作」。root已確認自有4174/PID62270並SIGTERM，runtime回寫stopped／HTTP不可連線，本輪未啟動新服務。既有PG容器／資料／volume未變動，不停止其他服務或碰人類UI。手動功能導覽已保存poc/MANUAL-TESTING.md並連到根／POC README；先人物/房間/互動/門禁，再影音與交接，另列未執行的暫存啟動指令與PG保存差異。新啟動必須依人類之後的明確指示，不能沿上文「保留運作」自動重開。未跑測試／build／browser、未修改產品碼，僅指南與停止狀態。
