# DEC011-BC／POC-03-R004：會議室門與密碼

2026-11-04；**本機桌面門／密碼准入核心可行**。本輪依人類要求輕量驗測：未鎖直接進、上鎖需正確密碼，程式與紀錄一起commit。Luna xhigh實作，主代理設計／檢視／瀏覽器驗收及修正場景輸入座標。未部署／push／改GitHub或啟動T09。

## 使用方式

1. 依repo README的Node26與可信HTTPS/WSS方式啟動本機服務。`MEETING_ROOM_PASSWORD`未設定或空字串為未鎖；非空為上鎖。改設定需重啟server並重新整理頁面；沒有公開切鎖API或即時主持管理。
2. Join Open area，在兩區之間點可見場景門；也可聚焦地圖按Enter，或按門的HTML替代入口。這是點門傳送式入口，尚未做走到門口自動跨越、尋路或碰撞。
3. 未鎖直接入Meeting room。上鎖先顯示密碼輸入；錯誤時留在原空間、清掉輸入並可重試，正確密碼才取得房內成員資格。入房不替其他人解鎖，公開`isLocked`仍為true。
4. 入房後按「開始收聽」，發布者按「開始麥克風」。本次自動驗測僅使用明示合成oscillator；一般手動操作會走正常麥克風權限，不代表真硬體流程已在本輪驗過。點門退出不需密碼，再入房須再次驗證。

打開密碼對話框保留目前影音；實際送出切房請求前會先停止舊影音，避免舊來源進入新區。若送出錯誤密碼，server原成員/位置/relay資格保持，但client已清理的影音須手動重新啟動。這是明示POC限制。

回歸入口：服務運行中，Node26.13執行`node scripts/room-access-smoke.mjs`，以`ROOM_ACCESS_EXPECT_LOCKED=0`或`1`對應服務設定；上鎖模式另由`ROOM_ACCESS_TEST_PASSWORD`提供相同測試值。產物在ignored `.scratch/room-access/{unlocked,locked}/`。密碼不放URL、不下發公開metadata、不存trace；script移除Firefox子程序中的密碼環境值。本輪runtime密碼由runner臨時生成，未提交。

## 實際結果

| 項目 | 結果／證據 |
|---|---|
| production build/typecheck、完整Node核心 | **31/31通過**；pointer修正後另兩次build/typecheck通過。新Node契約驗初次join、switch的未鎖/無密碼/錯/正確、重試/限次、偽造鎖/身份/角色、拒絕後原room/relay與公開資料不含secret。命令/UTC起迄/exit見[checks.json](checks.json) |
| 未鎖模式 | [unlocked/report.json](unlocked/report.json)，04:27:31.038～04:27:36.410 UTC（台北12:27）；兩獨立Firefox157／實際WebGL，真canvas門點擊入房/退出，HTML門再入，沒有密碼對話框 |
| 上鎖模式 | [locked/report.json](locked/report.json)，04:27:36.858～04:27:42.904 UTC；兩獨立Firefox157／實際WebGL。publisher正確密碼入房後先持續發布，visitor場景點門、錯密碼被拒，仍lobby(2,2)、看不到studio成員、輸入清空、raw audio0；正確密碼後到studio(5,2)，isLocked仍true |
| 門外外部client | 在private音訊publisher已發出封包時，無/錯密碼join被拒；主動audio.subscribe/screen.subscribe及binary publish均`media_not_joined`，連續觀測音訊/畫面/其他binary、房內快照/事件/媒體控制皆0。偽造isLocked/role/participantId即使帶正確密碼也被schema拒絕；直接switch繞過另由Node契約覆蓋 |
| 入房後實播 | 未鎖receive/decode3/3、AudioWorklet render2,048samples／RMS0.0958；上鎖correct入房後3/3、render1,792／RMS0.0890。這是當下軟體快照，非真人聽見或品質門檻 |
| 停止／來源讀回 | 明確stop、等待audio.stopped/streamEnded及300ms計數穩定後audit再關閉。未鎖source33／visitor11、上鎖58／9，root獨立讀回所有保存LTA1 hash均匹配、未匹配0、trace cap未達，見[independent-readback.json](independent-readback.json) |

同一build、同一本機app依序啟動兩種設定，沒有同時兩個服務或外部SaaS。Node HTTPS/WS顯式信任本機CA，Firefox各自NSS profile信任同CA；沒有略過TLS或改系統信任。page/socket errors皆空，正確/錯誤輸入值不在report；三張最終圖分別為未鎖入房播放、上鎖拒絕及正確入房播放。主代理已實際查看拒絕對話框、入房門圖與播放代表圖，畫面可讀；原POC長名字重疊未做商品視覺驗收。

## 場景門失敗、診斷與修正

初輪未鎖smoke點門後等入房逾時，visitor沒有送出room.switch；[first-attempt-unlocked/](first-attempt-unlocked/)保留report/checks/log/script與root初始假設。原raw mouse操作沒先把canvas捲入可見範圍；root補scroll與bbox紀錄後，[第二輪](second-attempt-unlocked/)仍失敗。相同錯誤重現後已停止整套重跑，改為單頁輸入診斷，沒有反覆碰運氣。

[修正前診斷](input-diagnostic-before-fix/report.json)實測：React加入/名單排版後canvas文件座標top=868.1，Phaser仍快取top=797.1；點在可見scene(520,205)，Phaser記成(520,276.09)，input enabled但over=[]、door activations0。installed Phaser4.2.1原碼確認transformY使用cached canvasBounds與displayScale，Zone本身38×82正確。

root窄修renderer：在原生pointer/mouse/touch down的capture階段同步bounds與displayScale，再交Phaser命中；destroy時移除listeners。保留有界POST_RENDER輸入診斷。[修正後單頁](input-diagnostic-after-fix/report.json)觀測pointer(520,204.26)、over=[Zone]、activations1，實際room.switch與studio ACK。先有新證據確認修正，再恢復兩config完整流程，最終皆通過。舊31個server核心不受client座標修正影響，未重跑無關全量；修正後build/typecheck與真browser已驗。

## 邊界與MVP交接

- server將門、room選擇、初次join與switch收斂為同一准入檢查；驗密碼在member/space/relay變更前，同步scrypt避免await後入房競態。既有room/audibility/media guard不改，拒絕不是只藏UI。
- 啟動設定經salted scrypt產生verifier，等長timingSafeEqual比較；密碼不進公開快照/URL/應用持久紀錄。同步scrypt會占event loop，5次/同連線/60秒是基本示範限制；新socket可重置budget，非完整抗暴力破解/資安或容量驗收。
- 沒有帳號驗證、主持角色/即時鎖房、密碼即時更換/邀請到期/重啟恢復或管理UI；合法知道密碼者仍是匿名participant，進房資格不等於主持權。共享密碼不做個別撤權。
- browser只實播合成語音，沒有本輪原生分享/VP8播放、真mic、真人收聽、手機/touch實機、弱網/長測/容量/CloudRun。Node有拒絕screen.subscribe與未入房screen binary，不能當有活動VP8來源的實播隔離證據。地圖Enter入口有程式、HTML入口已browser操作，未另跑完整鍵盤/螢幕閱讀器驗收。
- 沒有新依賴或影音relay/controller/worklet改動。SOL-003/004/007/008、README、需求狀態及協作文件已同步，JSON/來源hash讀回、server/browser停止，程式+紀錄本機commit不push。完整POC-03與MVP尚未通過。
