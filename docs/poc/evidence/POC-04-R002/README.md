# POC-04-R002：T13影音重連接收與播放恢復

日期2026-11-04；基線0ade7c9；[#14 媒體解碼與發布權恢復](https://github.com/samzhu/LaiTse/issues/14)。人類指定輕量核心/用法與程式+紀錄commit，桌面合成核心可行，以接收恢復與發布重開的分段證據判定；完整POC-04/品質仍Inconclusive。

本步釐清同頁意外斷線後，原本手動開啟的audio/screen接收可否在最新room/role/mode快照確認後重新訂閱並真正render。接收controller/timeline需新建，relay供目前config/clock與新keyframe；發布者沒斷線時generation/clock可以相同，不把數字變化當唯一恢復證據。

手動stop、interaction模式、明確切房/Leave清意圖，不能自動重開；完整refresh仍控制恢復後手動開始媒體。本步不自動取得mic/分享/舊主持發布權；來源已ended或使用者停止不得假裝重啟。AudioContext若需手勢，分記訂閱/等待/正常continue後實播，不用allow autoplay偏好繞過。

計畫：少量Node契約與三隔離可信Firefox，持續合成Opus/VP8來源→viewer/display正常UI開媒體→受控WS close4000→恢復控制/重新初始化→真AudioWorklet samples/VP8 frames正增；再驗manual stop不恢復與sender需重新claim/手動來源。保存短timings/config/keyframe/clock/新controller計數、白名單control summaries與代表圖，不保留秘密/原始媒體。root最後build/全Node一次、browser與讀回，失敗保留/窄診斷，無反覆品質長測。

原票20次/p95≤5秒/真實跨裝置矩陣仍品質待測，不因本輪輕量降低門檻或聲稱穩定。無真mic/人耳/原生畫面/手機/實體弱網/65分鐘/CloudRun/跨程序耐久或完整POC-04證據；不push/遠端票/T14/部署。操作步驟與實際結果完成後補入。

## 實際結果

Node26.13.0、Firefox157、同一個本機可信HTTPS/WSS app、三隔離profile。source交接後production build/typecheck與完整54/54一次通過；focused12/12為7新增恢復＋5既有timeline。Node中的媒體封包是協定fixture；以下瀏覽器才用原生WebCodecs/AudioWorklet合成音畫實播。

| 判定 | 本次範圍 | 證據 |
|---|---|---|
| Pass | build/typecheck、54核心 | build.log、core-integration.log、implementation-checks |
| Pass | participant新connection2，fresh authority後各subscribe一次、Opus samples0→4,672／VP8 frames0→1；同publisher generation1/clock，screen用audio-master | third-attempt/desktop/media-recovery-report.json中已通過接收段；root-readback.json |
| Pass | display新connection2，fresh authority後video訂閱，frames3→4且持續實播；無audio | 同上及代表圖 |
| Pass | 手動停止兩channel後再close，新connection3無任何audio/screen subscribe | third-attempt白名單control |
| Pass | sender close後舊tracks ended、getUserMedia/getDisplayMedia/start新增0、host/grant不復活 | third-attempt及publisher-desktop |
| Pass | 正常claim＋手動開來源，generation1→2、新clock，participant13,568samples/2frames，display7frames | publisher-desktop/media-recovery-report.json，scope=publisher-only |
| Fail | 三次完整腳本執行分別在兩處keyframeRequest等待順序、一次Continue locator失敗 | first-attempt、second-attempt、third-attempt原結果完整保留 |
| Inconclusive | 最終組合腳本整段再跑、20次/p95≤5秒、手機/真人/實體弱網/耐久/完整POC-04 | 未執行；核心以分段證據判定，不把後段失敗抹成整套通過 |

root已從保留的control sequence獨立核對：participant authority seq6→screen subscribe9/stream11、audio subscribe12/stream14；display authority6→screen subscribe11/stream13，並讀回新controller的render baseline/after，三channel同來源clock。觀測者由route release至authority約9～10ms，至音訊/participant畫面/display畫面正增分別163/325/533ms；這是單次本機poll觀測，非校準端到端延遲、p95或5秒門檻通過。第三次原report控制時間用poll看到時刻，root以原control.atMs重算；最終script已修正時間欄位來源。

Firefox這次自動播放恢復，未點Continue；需手勢分支只有程式處理/型別檢視，沒有另外強制阻擋autoplay來測。第二輪Continue locator失敗的瞬間狀態未獨立重現，不能宣稱該分支實測通過。script已加有界正常click與真state讀回，不force click/設定autoplay allow；仍需實際samples正增才算播放。

[接收/發送root讀回](root-readback.json)、[完整命令歷程](checks.json)、[發布窄驗通過](publisher-desktop/media-recovery-report.json)、[接收段原始report](third-attempt/desktop/media-recovery-report.json)、[中斷圖](third-attempt/desktop/participant-media-reconnecting.png)、[恢復圖](third-attempt/desktop/participant-media-recovered.png)、[新來源展示圖](publisher-desktop/display-manual-restart.png)。root已實際看這三張圖，來源0/來源1與新尺寸640×360可讀；音訊圖有實際sample/RMS，非人耳證據。build指紋一致，server/relay/codec線格式/Phaser/依賴未改。

## 失敗與窄診斷

1. 首次先訂閱後開publisher，不保證另送keyframeRequest；等待該控制逾時。只改script先開publisher、再晚加入participant。
2. 第二次初始實播成功，重連Continue locator點擊失敗。root發現waitForActualAudio第五參數宣告timeout卻傳reconnect物件，修參數及有界手勢/state讀回，未改app。
3. 第三次接收恢復/手動stop/sender無auto均通，最後sender手動重開仍在participant subscribe前等同類keyframeRequest。依協作規則停止整套重跑，只移等待順序並加入publisher-only範圍，單獨驗該步成功；已通的receiver循環未再重做。最終full腳本僅語法檢查，未宣稱整段最後一次通過。

腳本source快照與各輪log/report/圖保留，無無限重試。root另將report輸出最後再mask已知secret，避免偵測到敏感值時仍原樣寫入；本輪JSON掃描未見43字元bearer形狀字串，沒有私鑰/profile或媒體payload進Git。所有輪page/socket/collection/cleanup errors空，失敗欄位如上；array cap未達。server/Firefox已停止，cleanup.json讀回4173無listener及自有profile無process。

## 使用方式

1. 依repo README以Node26.13.0啟動可信HTTPS app；用不同HOST_CONTROL_TOKEN／MEETING_ROOM_PASSWORD驗managed模式與房門，URL不帶秘密。
2. 主講頁正常入studio並claim、手動開始麥克風/分享；參與頁入同房、手動開始收聽/觀看。展示頁`/?view=display&room=studio`首次正常video auto-watch。
3. 同一頁意外WS close後，T12先恢復身份/房間/權限，T13等新room/participation快照才恢復原本channel；應看到實際播放/畫面回來。若顯示暫停，正常按「繼續收聽」；這一輪Firefox未需要此手勢，其他瀏覽器待測。
4. 手動停止影音後再中斷，不應重訂閱。切只互動、明確換房、Leave都清意圖；回watch需手動開始。整頁refresh只恢復控制，媒體也需手動開始。此POC不持久化媒體意圖。
5. 若斷的是主講頁，舊來源關閉，不能auto重開。主講者須重新claim/獲grant，按正常開始並依瀏覽器再選來源；接收者仍在有效訂閱時可接新stream/config/clock/keyframe。不能把已ended分享當仍在分享。
6. 自動重現需先啟動自己的測試HTTPS server，再設MEDIA_RECOVERY_TEST_HOST_TOKEN／MEDIA_RECOVERY_TEST_ROOM_PASSWORD與server相同，執行`node scripts/media-recovery-smoke.mjs`。可選MEDIA_RECOVERY_BASE_URL／MEDIA_RECOVERY_CA_CERT／MEDIA_RECOVERY_OUTPUT_DIR與HEADLESS=0；`MEDIA_RECOVERY_TEST_SCOPE=publisher`只做初始播放＋發布端斷線/手動重開窄驗。本輪通過的是此窄驗＋第三輪已通接收段；預設full最終未整段重跑。script啟停自己Firefox、清私有profile；server啟停由操作者負責。

不部署/不push/不改遠端票/T14。完整手機/真人/弱網/長測/品質與Cloud Run可行性不因本步改判。

保存終端log僅移除行尾空白與空白EOF，原錯誤/結果未改。另更新既有T12 smoke的display預期為T13同頁video恢復一次，兩script語法通過；未額外重跑T12整套。
