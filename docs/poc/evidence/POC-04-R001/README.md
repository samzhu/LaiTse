# POC-04-R001：T12控制通道自動重連

日期2026-11-04；基線133684b；[#13 控制通道自動重連](https://github.com/samzhu/LaiTse/issues/13)。人類「繼續下一個」，沿用輕量核心/用法與程式+紀錄本機commit。桌面控制核心Pass；build/typecheck、47核心與首次三Firefox短流程通過，影音/弱網/完整POC-04保持Inconclusive。

## 本步要驗證

- 可信HTTPS下意外socket中斷，頁面清舊狀態並退避重試，以server核發短期憑證恢復控制。刷新可從同tab sessionStorage恢復；URL/QR不帶憑證。
- server辨識token後選自己記錄的member/room/role/mode並重送權威快照，從最新狀態判權限；不接受client自填舊主持/主講權。房門設定有新revision時，重新要求當前密碼，憑證不代替新准入。
- 已接受eventId重送一次只ACK不重複計數；過期publicQueue不補播。client不自動重送未確認mutation。
- 媒體先停止，恢復控制不自動開mic/分享/訂閱或宣稱解碼恢復；這部分留T13。展示初次加入仍沿用T11，resume只恢復控制。

## 計畫與限制

少量Node邊界契約與可信HTTPS真Firefox短流程：直接中斷/恢復圖、reload原身份/房間快照、最新權限、正常密碼gate、原eventId去重與實際8秒TTL。受控瀏覽器socket close證明應用的斷線恢復流程，不能當實體網路/弱網/Cloud Run timeout測試。保留首次失敗/診斷與窄修，完成後補實際數據/手動步驟。

resume store為有界process-memory POC，不是正式帳號或跨程序耐久；token是私有bearer，僅同tab storage及WSS，不進log/report/截圖/Git。server restart/過期/移除會失效；無自動匿名fallback繞過門禁。主持/發布權沿既有close撤銷，恢復需重新claim/grant。不部署、不push/遠端票/T13。

## 實際結果與證據

2026-11-04 08:47:28～08:47:49 UTC，Node26.13.0／Firefox157／可信HTTPS/WSS、同一本機app、三隔離profile。無mic/分享來源，沒有媒體恢復或播放品質宣稱。

| 判定 | 範圍 | 證據 |
|---|---|---|
| Pass | production build/typecheck、完整47/47（新增5） | build.log、core-integration.log、checks.json |
| Pass | participant/host/display受控中斷後同身份恢復；participant恢復後正式回饋可用 | desktop/control-reconnect-report.json、control-reconnect-smoke.log |
| Pass | 切lobby再刷新恢復原server身份/房間；切回studio仍正常門禁 | 同上，新的socket/ACK後快照斷言 |
| Pass | 舊發布grant/host不自動恢復，host需正常操作重新claim；display重連不auto screen.subscribe | browser斷言及5聚焦server契約 |
| Pass | live改密碼後舊密碼拒絕、新密碼恢復同身份 | browser正常dialog；Node同房switch/mode不更新receipt反例 |
| Pass | 同eventId跨resume只duplicate ACK、額外projection0；等待8,696ms後publicQueue0/replay0 | report probes；Node另驗真8秒TTL |
| Pass | active leave後停止retry、refresh不auto resume；remove舊proof拒絕、假token/超界拒絕 | browser及focused5/5 |
| Fail | 最終檢查無失敗 | 本輪build/完整Node/browser皆首次通過 |
| Inconclusive | 媒體訂閱/解碼/發布恢復、實體弱網/半開連線、手機、耐久、容量/長測、Cloud Run、完整POC-04 | 本輪未驗；後續票處理 |

[摘要report](desktop/control-reconnect-report.json)、[命令/結果](checks.json)、[中斷圖](desktop/participant-reconnecting.png)、[恢復圖](desktop/participant-recovered.png)、[root讀回](root-readback.json)、[清理](cleanup.json)、[source指紋](build-source-sha256.json)。5聚焦與typecheck/語法紀錄在implementation-checks，script作者紀錄見smoke-authoring.md（作者未跑browser，root結果見此頁）。root已實際看圖：中斷顯示Reconnecting/可Cancel、舊成員/事件清空；恢復顯示3成員、MANAGED與媒體尚未啟動。人物長名稱重疊屬既有POC視覺限制，本輪不改美術。

本輪保留的是通過的腳本斷言、去識別摘要及代表圖，不保留raw控制/身份/token逐包trace；237個runtime摘要在斷言時有界核對。root核對source/build指紋、report、實際畫面；不宣稱能從保存檔重放每個封包。沒有憑證形狀字串、私鑰或profile進Git，page/socket/collection/cleanup errors皆空，cap未達。腳本成功結尾已將測試密碼還原；root的runner finally停止服務，4173無listener/自有profile無process。

10分鐘閒置TTL/512cap由可注入clock的store seam驗邊界，非等待10分鐘真browser。自動8次耗盡/手動retry、storage被禁止/新tab、程序重啟、實體斷網與媒體均未做本輪browser實測。永久帳號/跨程序/跨instance耐久不因本步完成。

## 手動使用方式

1. 依repo README用Node26.13.0啟動可信HTTPS單一app。可設不同的HOST_CONTROL_TOKEN／MEETING_ROOM_PASSWORD以驗管理/門禁，勿將秘密加入URL。
2. 參與頁`/?room=studio&mode=watch`填名字及正常密碼入房。同一分頁刷新，應自動恢復控制；切Open area後再刷新，應回Open area。新不同房間深連結走正常join，不用舊token擅改房間。
3. 用另一個主持頁授予主講後，參與頁刷新；原grant不復活。主持頁刷新亦回普通MANAGED，需重新輸入主持憑證claim。本步不會自動開mic/分享/收聽/觀看。
4. 主持頁更新會議室密碼，既有成員先保留；參與頁刷新時應要求新密碼，舊密碼失敗、正確才恢復。不同房切換與模式不能偷偷刷新舊receipt。
5. 意外close時狀態顯示重連，可按Cancel recovery停止本頁重試。正常已入房按Leave會撤銷自己的server proof；離線取消僅清本頁，server離線record仍等10分鐘TTL。再次刷新不應自動加入。
6. 展示入口`/?view=display&room=studio`首次正常入房仍沿T11自動看畫面；刷新/重連只恢復唯讀控制，觀看需再手動開始，不當作T13已驗。

受控中斷/去重/TTL的重現用`node scripts/control-reconnect-smoke.mjs`（先依README啟動測試用HTTPS server）；設定RECONNECT_TEST_HOST_TOKEN及RECONNECT_TEST_ROOM_PASSWORD與server一致，可選RECONNECT_BASE_URL／RECONNECT_CA_CERT／RECONNECT_OUTPUT_DIR、HEADLESS=0。script不啟停server，成功會恢復起始測試密碼；若中途失敗，重啟測試server還原啟動設定。本輪root使用臨時私有憑證與獨占runner並在finally停server，不修改系統CA，不用瀏覽器忽略TLS。程式、紀錄與交接同一本機commit，不push/遠端票/T13/部署。

終端log僅去除行尾空白與空白EOF，檢查內容/結果未改。過期指公開展示queue/不重播，不是抹去既有有界聊天歷史。
