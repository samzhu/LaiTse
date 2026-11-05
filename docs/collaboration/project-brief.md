# 專案 brief

**狀態：DEC-012 PostgreSQL18本機持久化／恢復核心已驗（POC-06-R002）；完整階段與MVP未通過。2026-11-05 更新。**

- 產品目標：以角色、多房間、站內廣播／分享與即時回應建立共同在場的共享空間。
- 主要使用者：主辦／主持人、主講人、現場與遠端參與者；應用不限企業。
- 目前工作範圍：19票已發布並讀回；本機POC至T17有桌面核心與用法證據；T18/R001已驗舊memory缺口；DEC012/R002補PostgreSQL18保存與程序／容器重啟恢復核心。完整階段／手機／真人／品質仍依執行紀錄判定，尚未啟動MVP或部署。
- 目前技術與相關路徑：自研，不採用 WorkAdventure；人物像素圖。已有 Git 儲存庫與需求文件，T01程式基線已建置及本機雙瀏覽器驗收；核心功能須可獨立部署、不強制綁供應商 SaaS；應用與影音轉送維持單一 Cloud Run，DEC-012另允許 PostgreSQL 18 儲存系統資訊；Node.js 26 LTS已指定為專案標準，React/Vite/Fastify/ws在T01作本機候選驗證，影音已有本機候選，耐久儲存選用 PostgreSQL 18，本機整合／恢復核心已驗，部署／備份／保留待設計。POC僅本機開發測試、不部署CloudRun；後續部署目標維持。原交接的「尚無 repo」為歷史狀態。
- 拆票索引：`docs/poc/ticket-breakdown.md`、`ticket-publication.json`及`ticket-verification.json`；T01～T17核心與T18操作重建／資料缺口見execution-log，GitHub子票本輪未改、仍open且未push，不能將本機交付混稱發布。
- POC權威入口：`docs/poc/plan.md`；執行紀錄 `docs/poc/execution-log.md`；MVP可用方案 `docs/poc/mvp-handoff.md`；Issue為計畫發布鏡像，不建平行PRD；發布入口 https://github.com/samzhu/LaiTse/issues/1 。
- 權威需求／決策來源：`docs/laitse-prd.md` v0.9、`docs/laitse-ai-handoff.md`，並以最新人類指示優先。研究見 `docs/research/technology-landscape.md` 及 `media-options.md`；研究建議不等於已確認決策；人類決策見 `decisions.md` DEC-001／DEC-002／DEC-003／DEC-004／DEC-005／DEC-006／DEC-007／DEC-008／DEC-009；本輪比較 `docs/research/framework-maturity-popularity.md`、`protocol-support-comparison.md`；前輪整合入口 `docs/research/single-cloud-run-framework-assessment.md`，瀏覽器專題 `docs/research/browser-media-pipeline.md`；平台研究 `docs/research/cloud-run-media-feasibility.md`，影音替代見 `docs/research/self-hosted-media-alternatives.md`；補充研究見 `docs/research/pixel-phaser-assessment.md` 與 `framework-maintenance-licenses.md`。
- 穩定項目 ID：TECH-001／TECH-001-MEDIA 為初輪研究；TECH-002／TECH-002-LICENSE 為維護與授權查核；TECH-003／TECH-003-ALT 為獨立部署影音研究；TECH-004／TECH-004-RUN 為單一 Cloud Run 研究；TECH-005／TECH-005-CODEC 為整合框架與瀏覽器影音研究；TECH-006／TECH-006-PROTOCOL 為成熟度及協議比較；DEC-001／DEC-002／DEC-003／DEC-004／DEC-005／DEC-006／DEC-007／DEC-008／DEC-009 為人類決策；後續項目沿用既有 ID，退役不重用。未為 PRD 功能補造人類確認 ID。
- 委派偏好（2026-11-03人類指示）：大量爬蟲／程式開發等耗token工作可交給Luna xhigh；主代理負責思考、範圍與驗收。本輪依此以gpt-6-luna／xhigh實作及診斷，主代理獨占紀錄並負責檢視／瀏覽器驗收；雙方writer均已交接。
- 可用工具／能力與限制：Markdown／GitHub CLI及本機瀏覽器工具；桌面Firefox可信HTTPS/WSS與合成影音原生編解碼已驗，T05另有Chrome原生分頁擷取。無手機/真人品質、容量或CloudRun證據；本輪server/Firefox已停止，沒有共用UI留用。

- 最新驗測方式（DEC-010）：人類要求POC不用過嚴，只確認核心可行及了解使用方式。POC-PLAN v1.1已補階段最小示範與T01操作步驟；R003由瀏覽器插件實際測核心流程可行。沒有改程式、部署或啟動後續票；新建tab及服務均已停止。

- 本輪T02：人類明確接續「手機瀏覽器能力與可信HTTPS」（#3），維持DEC-010；並選擇「先完成程式與桌面驗測，手機稍後再測」。主代理驗收/紀錄、Luna xhigh實作；手機真實結果維持未知，不以模擬器代替。

- T02交付：能力畫面、同一socket觀測ID／API讀回、LANIP SAN憑證及操作指南完成。Firefox可信HTTPS/WSS與Chrome loopback HTTP/WS實測核心可行；手機仍未知，完整POC-00未通過。證據R004及桌面矩陣已讀回，服務／測試browser停止；未啟動T03或部署。

- 本輪T03（#4即時語音最小閉環）：人類明確指定接續、驗測維持輕量，完成程式與紀錄一起commit。另選擇「先完成程式與自動驗測，真人收聽稍後」。主代理負責思考/驗收、Luna xhigh實作；真實麥克風與真人聽見不預先判定，T04/手機/雲部署不在本輪。

- T03交付：Opus捕捉／WSS轉送／解碼／AudioWorklet渲染與開始／停止／拒絕狀態完成。13核心案例及合成Firefox管線通過；保留首輪Promise清理失敗與修正。POC-01-R001、SOL-002／008已保存，真mic／人耳／E2E延遲待測，完整POC-01未通過；不啟動T04。程式與紀錄一起本機commit，未push／部署，測試資源停止。

- 本輪T04（#5跨裝置音訊品質基線）：人類指定繼續、輕量驗測、程式與紀錄一起commit。沿用先前手機/真人稍後安排，先補桌面合成一講者雙接收及可下載觀測；真跨裝置/品質p95保持未驗，不做固定長測或湊次數，T05未啟動。

- T04交付：桌面合成一講者雙接收、B晚加入/退訂/再加入與A持續render，stop及真下載JSON可行；14核心案例及三Firefox可信HTTPS/WSS一次示範通過。R002已保存讀回／截圖查看，SOL-002/008與README同步。手機/真人/E2E品質仍未知，原長測數值僅日後參考；本機commit程式+紀錄、不push，測試資源停止，不啟動T05。

- WORKFLOW-STEPWISE（2026-11-03）：依人類要求，專案內product-collaboration-workflow技能已納入小步核心驗證→累積程式/用法/證據→已授權商品整合的思維；主文及implementation參考已保存讀回，格式/連結檢查通過。只改協作技能與紀錄，沒有啟動T05或改產品需求；後續依人類明確指示將完整技能及協作紀錄納入同一筆本機commit，不push。

- T05交付（#6）：繼續指示接續站內分享，Luna xhigh實作、root檢視與驗收。VP8同一WS relay＋獨立Opus可行，18核心／build及最終三Firefox合成短流程通過；另Chrome前景原生分頁選擇、1280×630呈現與瀏覽器停止清空成功。R001保留失敗／診斷／修正／觀測與source hash，SOL-002/008及操作文件同步。T02/03/04手機/真人未補、完整POC-02 Inconclusive；不啟動T06/部署。程式與紀錄一起本機commit，不push；服務/browser與writer釋出。

- 本輪T06（#7）：人類明確指定晚加入/同步核心可行及用法、輕量驗測、程式+紀錄commit；root負責思考/驗收、Luna xhigh實作。先以共同publisher時基與接收播放主時鐘驗晚加入/世代重建/同端marker；不做T07、部署或推送，原手機/真人待測不變。

- T06交付（2026-11-04）：共同publisher時基/接收音訊主時鐘選幀、晚加入keyframe gate、來源generation/尺寸重建與重新觀看可行；23核心、build/typecheck及最終三Firefox合成短流程通過。R002保存三輪失敗/診斷/修正及最終觀測，聲光64.77/151.71/129.35ms為未校準graph/render值，未宣稱原品質門檻通過；手機/真人與完整POC-02待補。SOL-002/008、操作與協作紀錄同步，本機commit程式+紀錄、不push/T07/部署；writer/服務/browser釋出。

- 本輪T07（#8）：人類指定桌面像素人物/位置同步/兩房操作、輕量驗測及程式+紀錄commit。Phaser4.2.1候選、單一現有WS/server；切房先停止舊媒體，第二房此步只驗空間入口，跨房影音留T08。手機稍後，T08不啟動。

- T07交付：26核心/build、雙Firefox真WebGL像素人物/兩房移動/離開重入/減少動態通過，POC-03-R001與SOL-004/008已保存讀回。手機、完整房間影音/權限與完整POC-03仍待測；本機commit程式+紀錄，不push/T08/部署，writer/server/browser已釋出。

- 本輪T08（#9）：兩房各有發布/接收、切房清理、server拒絕偽造room/identity及成員事件隔離；輕量本機合成影音驗測與程式+紀錄commit。帳號驗證/私密入房與後續主持權限不預填通過，T09不啟動。

- T08交付：27核心/build及四Firefox合成雙房影音、切房舊房0新增/手動新訂閱、六外部client拒絕通過；R002與SOL-002/003/008已讀回、代表圖已查看，首輪測試fixture失敗保留。server連線身份不等帳號/私密准入，完整T08/POC-03待補；本機commit程式+紀錄、不push/T09/部署，writer/server/browser釋出。

- DEC-011：人類確認開放空間依人物距離收聽、會議室所有成員收聽；會議室有門，未鎖直接入房，上鎖需密碼。PRD/handoff v0.8、POC-PLAN v1.2與票面差異已保存；距離/多源/密碼有效期待設計。T08不是新規則完成證據，本輪僅同步需求，未改程式/新run/遠端票或啟動T09。

- 人類2026-11-04要求「分析完先暫停 稍後再繼續」：DEC-011分析/文件同步後暫停，未改程式、未開始新POC或T09；本輪文件尚未commit，既有T08 commit d83433b不變。

- 恢復（2026-11-04）：人類「繼續」後先恢復DEC-011補充POC規劃，plan/ticket-breakdown已列A距離/B未鎖門與會議室/C密碼門禁草案與相依；本輪實作範圍正在釐清，未動程式/新票/服務，需求與草案尚未commit。

- 本輪DEC011-A：人類範圍答覆「會議室跟開放空間」，開始兩類空間收聽規則POC，會議室全房/開放距離；單來源與暫定示範6格，非商品參數定案。R003配發，Luna實作/root驗收；門與密碼另一步，T09/遠端票不啟動。

- DEC011-A交付：30核心/build、三Firefox合成距離路由/6格邊界/超界清理/發布者移動/會議室9格播放可行，R003保存首輪收尾來源trace缺尾與root窄修，最終完整hash讀回通過。6格示範非產品設定，無新依賴，門/密碼/多人/手機/真人未補；程式+歷次未commit需求+紀錄本機commit，不push/下一項，資源釋出。

- 本輪DEC011-BC：人類指定會議室門與密碼、未鎖直接進/上鎖正確密碼、輕量及程式+紀錄commit。R004配發；server啟動設定切鎖、場景門/其他入口共用准入，不新增開放管理API，T09角色/即時管理仍後續。Luna實作/root驗收，不push/部署。

- DEC011-BC交付：31核心/build、未鎖/上鎖兩config各兩Firefox真門操作/密碼拒絕與正確入房/合成音訊成功，R004保存兩輪點擊失敗與root定位71px cached bounds窄修/最終證據。startup設定控鎖，沒有公開管理API，T09/帳號/即時密碼更新/手機/真人未補；SOL/需求/操作同步、本機commit不push，writer與runtime釋出。

- 本輪T09（#10）：人類明確要求主持權限/即時鎖房核心與用法、輕量驗測及程式+紀錄commit。R005配發，Luna xhigh負責範圍程式，root設計/檢視/驗收與文件/Git。配置HOST_CONTROL_TOKEN的managed模式分離主持憑證與入房密碼，主講grant/revoke、remove、live lock/unlock及活動結束以server權威處理；無token舊匿名POC非正式權限。驗測與實作尚未交付，不啟動下一票/部署/push。

- T09交付：34核心/build/typecheck、host切房往返補充3及三Firefox157合成grant/revoke/end/live lock/錯正密碼/unlock直接再入房成功；五外部越權拒絕。R005保存snapshot預期失敗、兩個selector失敗，以及root看圖發現門圖OPEN與locked矛盾/窄修後三頁門圖同步；最終track ended/350ms穩定、獨立讀回/代表圖可讀。bootstrap token和匿名身份不是正式帳號，狀態仍process-memory；SOL/使用方式/需求/計畫同步，本機commit程式+紀錄，不push/T10/部署，writer/runtime釋出。

- 本輪T10（#11）：人類指定房內互動/彈幕核心可行與用法、輕量及程式+紀錄commit。R006配發，三feedback/聊天/固定圖案/明確公開彈幕、去重/限流/有界過期/撤下與T09主持展示控制，Luna xhigh實作/root驗收。舊wave/clap/heart保留歷史協議，不冒充正式feedback；100樣本/p95品質、手機、T11與部署不在本輪。

- T10交付：39核心/build/typecheck及三Firefox同房/異房正常UI與外部probe一次通過。正式三feedback、聊天/圖案與明確公開分流、T09主持pause/block/remove/clear、過期/去重/限流可行；R006保留開發型別/fixture失敗與修正，root完整trace讀回兩studio各22唯一ID/集合相同、異房0，live public圖與最終guest圖已查看。100accepted/p95未驗，完整T10/POC-03 Inconclusive，未做T11展示/模式/QR/飄移動畫/手機/真人/耐久。README/SOL/需求/計畫/票面同步，本機commit程式+紀錄、不push/部署，writer/runtime釋出。

- 本輪T11（#12）：人類指定直接入房/只互動/展示端輕量核心與用法、程式+紀錄commit。R007配發，Luna xhigh實作/root驗收。深連結/實際QR指向正常room gate，server mode/role+媒體訂閱/bytes與rawtrace驗只互動0，展示端readonly/無私聊、實際分享與公開反應；draft/volume保留及watch手動啟動。小型QR依賴本機bundled，不用外部服務；不做T12/手機/真人/部署/push。

- T11交付：R007保存42核心/build/typecheck與三Firefox直接門禁/模式切換/草稿音量/唯讀實播公開/QR實解碼再入房。5活動音畫窗口server+raw0、9外部越權拒絕，root讀回/看圖完成；原test時序與selector失敗保留並窄修。SOL/README/需求狀態/計畫/票面同步。手機/真人/耐久/品質/完整POC-03仍待，資源停止釋出，程式+紀錄本機commit、不push/T12/部署。

- 本輪T12（#13）：人類「繼續下一個」，沿用輕量與程式+紀錄commit；R001/POC-04配發，server短期憑證+最新門禁/權限重驗、client意外斷線/刷新控制恢復。root設計/驗收，Luna xhigh實作；不做T13媒體恢復/部署/push。

- T12交付：POC-04-R001保存47核心/build/typecheck與首次三Firefox受控close/refresh/切房server原房與身份、最新gate與權限、去重/8,696ms過期不補。兩圖/摘要/指紋已root實際看圖與讀回；不保留raw控制/token trace。短期憑證只程序內，offline cancel等server TTL，影音/弱網/手機/耐久/完整POC-04仍待。SOL/README/需求狀態/計畫/票面同步，程式+紀錄本機commit，runtime/writer停止釋出，不push/T13/部署。

- 本輪T13（#14）：人類指定影音重連恢復訂閱/播放輕量核心與用法、程式+紀錄commit。POC-04-R002配發，同頁receiver意圖/最新快照/新config-keyframe-timebase；不auto發布或復活舊權限，手勢例外分列。Luna xhigh程式/腳本、root設計驗收，無T14/部署/push。

- T13交付：R002保存54核心/build與同頁receiver/display恢復、manual stop不訂閱、sender來源/權限不auto；third已通接收段＋publisher-only新世代手動重開實播，root seq/config/clock/render讀回與3圖已看。三次full腳本失敗/修正保留，停止整套後窄驗，最終full未整段重跑。此次Firefox自動音訊，手勢分支/手機/真人/20次p95/弱網/完整POC-04待補。SOL/README/需求/計畫/票面同步，程式+紀錄本機commit，runtime/writer停止釋出，不push/T14/部署。

- 本輪T14：人類「繼續」，R003/#15配發，慢端單連線壓力/有界queue與T13重同步、健康端實播對照；Luna xhigh程式/腳本、root設計驗收，輕量及程式+紀錄commit，無T15/部署/push。

## T14最終紀錄

T14交付（2026-11-05）：[POC-04-R003](../poc/evidence/POC-04-R003/README.md)保存63核心/build/typecheck與最終完整三Firefox輕量流程。per-socket共享byte/callback budget、PCM/video local residence有界；慢端bounded應用hold後新連線/config/keyframe與實播，健康端hold5次/恢復後3次及ACK持續。首輪route close未到page的失敗與harness兩端4003修正保留；server policy仍1013。500ms目標實測501ms，非TCP/端到端age；手機/真背景/弱網/品質/完整POC-04仍待。README/SOL/需求狀態/計畫/票面同步，writer/runtime已停止釋出，程式+紀錄本機commit，不push/遠端票/T15/部署。

## T15最終紀錄

T15交付（2026-11-05）：[POC-04-R004](../poc/evidence/POC-04-R004/README.md)保存63核心/build/typecheck與最終四Firefox10,069ms完整短整合。兩房合成音畫同時實播、studio本地1s deadline關線後fresh authority/config/keyframe恢復、主持不auto需重新認領；撤權tracks ended/900ms無新增，被撤者再resume無來源/權限復活。lobby12採樣持續與2ACK成功。首輪timer提前1ms斷言失敗/harness窄修保留，app/source/依賴未改。root兩圖/讀回完成，SOL/操作/需求狀態/計畫/票面同步；65min/手機/真背景/真弱網/品質/資源/耐久/完整POC04仍待。writer/runtime已停止釋出，程式+紀錄同一本機commit，不push/遠端票/T16/部署。

## T16最終紀錄

T16交付（2026-11-05）：[POC-05-R001](../poc/evidence/POC-05-R001/README.md)以1發布／1→3真Firefox接收完成14,877ms短fanout。三端同config/clock、3採樣實播增長；A退訂350ms無新media而B/C繼續，publisher正常停2來源/其餘streamEnded清空。build/typecheck與browser通過；既有全套62/63限流訊息逾時，單檔9/9通過但根因未定；首輪Continue點擊失敗及窄診斷保留，最終無gesture，該分支未覆蓋。source/依賴未改；root讀回/A-C實看、server30ps採樣僅診斷，SOL/操作/需求狀態/計畫/票面同步。10/25/50／20min／手機／真人／品質/完整負載端資源/完整POC05未驗；writer/runtime釋出、程式+紀錄本機commit，不push/遠端票/T17/部署。

## T17最終紀錄

T17交付（2026-11-05）：[POC-05-R002](../poc/evidence/POC-05-R002/README.md)保存build/typecheck/63核心與首次六Firefox18,233ms短流程。每房1source/1watch/1only，兩房實播；專用only初始/活動self0且整輪raw0、回饋同房DOM0→1/異房0。studio watch→only零增量→watch不auto直到manual新config實播，lobby持續。root全hash重算source668/669→ownreceipts643/411，foreign/unknown/ambiguous0、count-byte完整；2圖實看/cleanup。app/依賴未變，SOL/操作/需求狀態/計畫/票面同步；50/20min/手機/真人/品質/全client資源/雲/完整POC05待，無Continue分支。writer/runtime釋出、程式+紀錄本機commit，不push/遠端票/T18/部署。

## T18最終紀錄（2026-11-05）

T18輕量評估完成：[POC-06-R001](../poc/evidence/POC-06-R001/README.md)保存build/typecheck/63核心與第三輪三Firefox12,837ms真程序重啟流程。PID58035→58041、三舊proof拒絕且無自動操作；重載正常入房得新UUID、重新claim/手動來源與訂閱可實播。feedback1→0、live密碼B失效而startup A有效，**動態資料未恢復，目前process-memory候選耐久No-Go；完整T18/POC-06及MVP Go未通過**。兩個rawWSS越權拒絕、6個server-down預期socket錯誤已核對；前兩次harness缺陷/修正保留。root獨立讀回/兩圖實看、source指紋未變、cleanup完成。SOL-007既有清冊原位更新，未新增保存方案或接受資料遺失；app/tests/依賴未改，新增重啟驗測script與操作紀錄。writer/runtime停止釋出，程式與紀錄同一本機commit；不push/遠端票/T19/MVP/部署。

DEC-012（2026-11-05）：已確認 PostgreSQL 18 可儲存系統資訊，資料庫為原部署限制例外。已同步需求與交接，尚未實作；T18原候選的耐久No-Go仍成立，需補新的整合證據。

DEC-012範圍補充（2026-11-05）：人類確認「都可以儲存」，房間設定、身份／Session、聊天、回饋與統計皆可保存；不再等待類別保存許可。期限與權限恢復語意留待設計，無影音錄製擴張。

## DEC-012持久化整合最終紀錄（2026-11-05）

DEC-012資料庫整合完成：[POC-06-R002](../poc/evidence/POC-06-R002/README.md)保存PostgreSQL18.6 Docker／pg8.23.1與migration、系統資訊保存及恢復用法。最終build/typecheck/63核心、真PG整合、ACK後SIGKILL、advisory backend失連停止、兩真Firefox同document/原ID/最新B門禁/chat與feedback恢復、13表同volume容器重啟筆數與指紋一致。有效proof恢復不自動復活主持／發布權，畫面TTL與archive分開；SOL007唯一清冊已原位更新。首輪health shape／fixture event count及browser環境/URL事件誤判等失敗保留、窄修後重驗。完整POC06/MVP/備份/HA/多instance/正式保留政策/雲未驗；舊R001 memory No-Go不改判。所有writer已saved/readback/STOP，root驗收，server/Firefox/Docker已停、volume保留；程式與紀錄同一本機commit，不push/遠端票/T19/部署。
