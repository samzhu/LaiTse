# POC 拆票提案

- 識別碼：POC-TICKETS；日期：2026-11-03；狀態：**19票已確認、發布並完成獨立讀回驗收；T01本機工程驗收完成，R001／R002已留證**。
- 來源：[POC-PLAN v1.0](plan.md)、[GitHub母Issue #1](https://github.com/samzhu/LaiTse/issues/1)；已讀取完整Issue並核對與本機計畫一致，留言為空。
- 人類確認：2026-11-03原話「OK」，精確涵蓋前輪T01～T19粒度、交付及阻擋；見DEC-009。此確認不代表POC開發或產品品質驗收。
- 發布證據：[T編號映射](ticket-publication.json)、[主代理獨立驗收](ticket-verification.json)。19張皆open、ready-for-agent，19個原生子票關聯及21條原生blocked_by均已核對。
- 本頁是拆分索引，不是第二份產品需求或執行紀錄；逐票草稿的功能與門檻沿用POC計畫。
- 已有母Issue、ready-for-agent慣例；已依本次核准每票發布為其子Issue，建立實際阻擋關係，不修改母Issue的正文、標題或狀態。
- 唯一運行環境仍為本機單一應用與Node26；不部署CloudRun、不開始MVP；T01已有程式與雙瀏覽器驗收，後續票未啟動。

## DEC-011票面差異（2026-11-04）

既有19票為先前核准/發布版本，非PRD v0.8完整覆蓋。新增開放空間距離廣播、場景門/鎖/密碼准入與會議室全房收聽，需按[POC-PLAN v1.2](plan.md)補充拆票/調整相依。T07人物/位置與T08分房relay可作基底；T09原鎖房/角色不等於已包含密碼門禁，也不包含距離音訊。具體新票編號與實作順序尚未核定，本輪不建立或修改GitHub票、不自動開始下一票；既有票完成證據不回寫成新增需求已通過。

## 接續規劃草案（2026-11-04）

本次「繼續」先恢復DEC-011補充規劃。建議三個可獨立驗證的切片：A距離廣播、B未鎖門口/會議室全房收聽、C密碼門禁。A/B皆沿用T07/T08基底、互不形成業務阻擋；C依賴B及server管理授權（T09或另行納入的最小授權）。相同檔案仍序列writer，不能把共用檔案誤寫成產品相依。詳細範圍/最小驗測見[POC-PLAN接續切片](plan.md#dec-011接續切片草案2026-11-04)。

這些是草案標籤DEC011-A/B/C，尚未配發新的T編號、寫GitHub或開始開發。需先確定實作範圍，再補正式票/相依；不將「繼續」解讀為新增所有切片與改動既有遠端票的授權。

## 拆分原則

每票完成一條可展示或可核對的完整流程，包含所需契約、server、操作介面、外部測試和本票實驗紀錄；不按前端／後端／測試工具橫切。既有專案無產品程式，因此不先造無意義的重構票。

T01是共用可執行基線；T02與T03可分支。T01／T02共同完成POC-00，T03先驗證桌面音訊所需的最小能力，T04必須等待兩個分支。POC-03依母計畫在音畫通過後才進入，因此T07被T06阻擋，這是階段門檻而非人物功能必須依賴影音程式。T09與T10可在T08的身份／房間授權基線後分支。T18在重連／弱網基線後與負載分支獨立；不被負載數據不必要地阻擋。

「Issue完成」與「候選通過」分開：票可交付有證據的Fail／Inconclusive，但不可因此繼續相依的實作或把整個階段標Pass。下一位代理在開票前檢查阻擋票狀態及必要階段的通過證據。T19可審查No-Go並停止MVP，不要求捏造成功。

## 編號拆分

1. **T01：本機單一應用貫通**（POC-00）
   - **Blocked by：**無（已發布、尚未開始）。
   - **What it delivers：**兩個真實瀏覽器經 Node26 的同一應用加入測試房間、交換事件並取得可重現的執行證據。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/01-local-application.md)

2. **T02：手機 HTTPS 與能力矩陣**（POC-00）
   - **Blocked by：**T01。
   - **What it delivers：**手機以可信 HTTPS 連入本機應用，顯示並保存實際擷取／編解碼／播放能力。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/02-mobile-capabilities.md)

3. **T03：真實麥克風語音閉環**（POC-01）
   - **Blocked by：**T01。
   - **What it delivers：**一位主講人經本機 relay，讓另一真實桌面瀏覽器聽見語音，包含手勢、拒權與開關。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/03-live-audio.md)

4. **T04：多人與手機語音品質**（POC-01）
   - **Blocked by：**T02、T03。
   - **What it delivers：**至少兩位接收者含實體手機連續收聽20分鐘，提供跨瀏覽器及可靠延遲量測。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/04-audio-quality.md)

5. **T05：站內分享與獨立啟停**（POC-02）
   - **Blocked by：**T04。
   - **What it delivers：**真實分享畫面經同一應用呈現，與語音共存且兩來源能獨立停止。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/05-screen-share.md)

6. **T06：音畫同步與晚加入**（POC-02）
   - **Blocked by：**T05。
   - **What it delivers：**中途加入可從正確初始化／關鍵幀播放，來源更換與音畫偏移可量測。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/06-av-late-join.md)

7. **T07：像素人物與兩房移動**（POC-03）
   - **Blocked by：**T06。
   - **What it delivers：**兩個真實client同步人物移動與進出房間，提供手機選房、鍵盤與減少動態路徑。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/07-avatar-rooms.md)

8. **T08：兩房影音隔離**（POC-03）
   - **Blocked by：**T07。
   - **What it delivers：**兩房各一講者，只有同房授權者可收聽觀看，切房停止舊流，惡意client無法越權。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/08-room-media-isolation.md)

9. **T09：主持管理與活動結束**（POC-03）
   - **Blocked by：**T08。
   - **What it delivers：**主持人可授權／撤權、移除與鎖房；結束Session停止媒體且保留Room。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/09-host-controls.md)

10. **T10：房內互動與彈幕**（POC-03）
   - **Blocked by：**T08。
   - **What it delivers：**三反應、文字、圖案與明確彈幕送達同房；驗證去重、限流、過期與展示管理。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/10-room-interactions.md)

11. **T11：直接入房、只互動與展示**（POC-03）
   - **Blocked by：**T10。
   - **What it delivers：**QR／深連結直接入房；模式切換保留房間草稿，零媒體訂閱；唯讀展示呈現分享與反應。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/11-participation-modes.md)

12. **T12：控制狀態自動重連**（POC-04）
   - **Blocked by：**T09、T11。
   - **What it delivers：**斷線／重整後重驗身份與權限、同步房間，避免重複事件與過期彈幕。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/12-control-reconnect.md)

13. **T13：影音解碼重連恢復**（POC-04）
   - **Blocked by：**T12。
   - **What it delivers：**恢復有效訂閱、初始化與播放時基，不復活撤銷發布權或假裝來源仍在分享。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/13-media-reconnect.md)

14. **T14：弱網與慢觀眾隔離**（POC-04）
   - **Blocked by：**T13。
   - **What it delivers：**受控慢端有界緩衝並可重同步，健康接收端繼續播放，手機背景切回有實測。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/14-slow-receivers.md)

15. **T15：65分鐘整合穩定性**（POC-04）
   - **Blocked by：**T14。
   - **What it delivers：**長場次搭配模擬timeout、重連、撤權與兩房回歸，保存完整本機觀測。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/15-long-session.md)

16. **T16：單房逐級影音負載**（POC-05）
   - **Blocked by：**T15。
   - **What it delivers：**2／10／25／50人逐級實際fan-out，量測server與負載端、區分真實解碼及合成client。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/16-single-room-load.md)

17. **T17：雙房與只互動混合負載**（POC-05）
   - **Blocked by：**T16。
   - **What it delivers：**兩房同時分享、50人混合模式，驗證隔離、健康端品質及流量／資源。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/17-multi-room-load.md)

18. **T18：程序重啟與資料恢復**（POC-06）
   - **Blocked by：**T15。
   - **What it delivers：**用真實client驗證重啟後的身份、房間與權限；提出恢復方案或有證據的No-Go。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/18-process-recovery.md)

19. **T19：方案交接與MVP進場審查**（POC-07）
   - **Blocked by：**T17、T18。
   - **What it delivers：**同一候選全流程回歸，交付可採用／需重構／拒絕清單與技術Go／No-Go；不直接開始MVP。
   - [核准前票稿存檔](../../.scratch/laitse-poc/issues/19-mvp-gate.md)

## GitHub發布映射

| TID | Issue | 原生Blocked by |
|---|---|---|
| T01 | [#2](https://github.com/samzhu/LaiTse/issues/2) | 無 |
| T02 | [#3](https://github.com/samzhu/LaiTse/issues/3) | #2 |
| T03 | [#4](https://github.com/samzhu/LaiTse/issues/4) | #2 |
| T04 | [#5](https://github.com/samzhu/LaiTse/issues/5) | #3、#4 |
| T05 | [#6](https://github.com/samzhu/LaiTse/issues/6) | #5 |
| T06 | [#7](https://github.com/samzhu/LaiTse/issues/7) | #6 |
| T07 | [#8](https://github.com/samzhu/LaiTse/issues/8) | #7 |
| T08 | [#9](https://github.com/samzhu/LaiTse/issues/9) | #8 |
| T09 | [#10](https://github.com/samzhu/LaiTse/issues/10) | #9 |
| T10 | [#11](https://github.com/samzhu/LaiTse/issues/11) | #9 |
| T11 | [#12](https://github.com/samzhu/LaiTse/issues/12) | #11 |
| T12 | [#13](https://github.com/samzhu/LaiTse/issues/13) | #10、#12 |
| T13 | [#14](https://github.com/samzhu/LaiTse/issues/14) | #13 |
| T14 | [#15](https://github.com/samzhu/LaiTse/issues/15) | #14 |
| T15 | [#16](https://github.com/samzhu/LaiTse/issues/16) | #15 |
| T16 | [#17](https://github.com/samzhu/LaiTse/issues/17) | #16 |
| T17 | [#18](https://github.com/samzhu/LaiTse/issues/18) | #17 |
| T18 | [#19](https://github.com/samzhu/LaiTse/issues/19) | #16 |
| T19 | [#20](https://github.com/samzhu/LaiTse/issues/20) | #18、#19 |

## 紀錄與發布規則

- 每票至少更新相關run與SOL條目；沒有實驗不得預填日期、雜湊、量測值或成功。工程篩選值沿用計畫，非人類已接受的品質承諾。
- DAG只表示工作相依，不等於資源鎖或自動授權並行。同一共用檔案、manifest、lockfile、執行紀錄及方案表仍遵守既有唯一writer派工；不新增第二份資源清冊。
- 人類已依DEC-009確認粒度與阻擋，已按相依順序發布；若出現具體新差異才重新檢視，不重問同一確認。
- 已把T編號映射到實際Issue ID並套ready-for-agent，原生阻擋及子票關係皆已建立；母Issue正文／標題／狀態／留言未改。
- 核准前票稿保留原始草稿標記供追溯；現行發布狀態以本索引、映射與GitHub票為準。19張／132項AC已逐段獨立讀回；無循環或多餘直接阻擋。前沿為[T01／#2](https://github.com/samzhu/LaiTse/issues/2)，T01已完成本機工程驗收，見execution-log；GitHub#2仍open，本輪沒有push或修改tracker。

### 本輪範圍釐清

人類答覆「會議室跟開放空間」後，先以DEC011-A穩定工作ID進行兩類空間/距離收聽規則POC（R003），沿用本機輕量實作/驗測與commit慣例；不改既有T01～T19編號或遠端票。B/C仍為後續門禁草案。實際結果依execution-log，這不是重新發布完整拆票。

DEC011-A本輪桌面核心已交付於POC-03-R003（見execution-log），未另配T編號/發布遠端票。距離示範6格非商品決策，B/C門禁仍為後續草案。

DEC011-BC已依人類新指示啟動門/密碼核心POC（R004）：server啟動設定切未鎖/上鎖，門與所有實際join/switch入口同一gate；不實作T09即時管理、不發新遠端票。原C草案對角色/即時管理的依賴保持，但不阻擋本輪純准入驗證。

DEC011-BC門/密碼准入核心已於R004交付（startup設定鎖，31核心/兩config browser），未配新T號/改遠端票。B的點門與C的密碼准入核心有證據；行走穿門、C中即時管理/密碼更新與T09角色仍待後續，不改原票完成狀態。

T09本機桌面核心已於[POC-03-R005](evidence/POC-03-R005/README.md)交付：主持claim/主講grant-revoke/remove/end及即時門鎖/密碼更新，34核心+3補充/三Firefox核心通過。DEC011-C的即時管理已有本機證據，正式帳號/逐房管理secret/耐久狀態仍待；不將原票/完整POC-03自動標為全通過。#10遠端狀態未修改、未push，下一項依人類指示。

T10房內互動/公開留言桌面核心已於[POC-03-R006](evidence/POC-03-R006/README.md)保存：39核心/build及三Firefox三feedback/chat/sticker/明確公開、pause/block/remove/clear/TTL/去重/限流/異房隔離成功。原#11至少100accepted/p95品質未驗（本輪人類指定輕量核心），完整票面/POC-03 Inconclusive；不改遠端狀態、不push、不自動啟動T11。
