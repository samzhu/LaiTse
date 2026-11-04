# POC-03-R007：T11直接入房、只互動與唯讀展示

日期2026-11-04；基線0607576；[#12 參與模式與唯讀展示頁](https://github.com/samzhu/LaiTse/issues/12)。人類要求輕量確認核心可行及用法，完成程式+紀錄本機commit。桌面核心可行；production build/typecheck、42核心測試及三Firefox短流程通過。完整POC-03未判通過。

## 操作與驗收邊界

- 直接連結指定room與watch/interaction模式，參與者仍輸入名字、按正常join並通過現有密碼閘。QR只含公開join URL，不含房間密碼或主持憑證。display使用獨立降權入口，同樣通過門禁。
- 只互動不訂閱/接收媒體、不捕捉/發布，仍能使用允許的房內控制。mode切換保留同socket/participant/room、未送草稿及本機音量，切watch不自動開聲/訂閱，使用者再按開始。
- 展示端呈現分享canvas、來源狀態、正式反應/公開彈幕與加入QR；server不給它私聊/圖案歷史，不讓它claim主持或發布/修改內容。這不是帳號或永久角色系統。
- 持續合成音畫來源下，以mode ACK後server真實relay訂閱、自己累積WS enqueue bytes差值、raw browser binary三者驗0；空房/只隱藏播放器不當證據。展示端需實際VP8 render，QR從真canvas pixel由jsQR獨立解碼後再正常入房。

QR runtime採qrcode-generator2.0.4 MIT（[官方授權](https://github.com/kazuhikoarase/qrcode-generator/blob/master/LICENSE)），dev decoder採jsqr1.4.0 Apache-2.0（[官方metadata](https://github.com/cozmo/jsQR/blob/master/package.json)）；本機bundled、精確版本，無QR外部服務。來源registry資料見qr-package-readback.json。

QR目前以該頁origin建立：localhost QR只適合同電腦瀏覽器；稍後手機需能到達且已信任TLS的LAN位址。此輪桌面像素decode不冒充手機相機掃碼/手機影音實測。未跑100品質、長測、弱網恢復、真人、容量、CloudRun或完整POC-03。具體用法與原始結果如下；不push/改遠端票/部署/T12。

## 手動操作方式

1. 沿用repo README的Node26.13.0／可信HTTPS啟動方法，設定HOST_CONTROL_TOKEN與MEETING_ROOM_PASSWORD為不同私有值。測試網址以下以https://localhost:4173為例。
2. 主講頁開`/?room=studio&mode=watch`，輸入名字、按Join room並填正確密碼，透過T09主持面板認領後手動開始麥克風/分享畫面。測試自己控制瀏覽器原生擷取權限；自動驗測則用合成來源替代。
3. 參與頁開`/?room=studio&mode=interaction`，正常填名字及密碼入房。「參與模式」應顯示只互動；回饋/聊天可用，影音區隱藏且訂閱關閉。按「更新我的媒體狀態」讀伺服器自己的訂閱/bytes。
4. 按「觀看＋互動」後，仍要手動按開始收聽/開始觀看分享才有媒體。拉音量到例如37%，在聊天與公開彈幕輸入未送文字，再按「只互動」：媒體停止，房間/participant不變、草稿仍在。再切觀看，確認音量與草稿仍在，不應自動開聲或訂閱。
5. bytes/frames是同一連線存續期間累計；曾觀看後切只互動，歷史數字不會歸零。應比較兩次inspect的差值維持0、兩種subscribed=false，並以真實持續來源/raw接收佐證。控制訊息本身仍會下送，不是整條WebSocket的所有bytes為0。
6. 展示頁開`/?view=display&room=studio`，按「加入唯讀展示」並通過相同密碼閘。分享畫面自動觀看，聲音不自動播放；正式回饋/公開彈幕同步，但一般聊天/圖案不送到此身份。主持pause/remove等更新仍須遵守。
7. 展示頁的「掃描加入」QR與下方連結只含公開房間/只互動模式。點該連結或掃描後，應回一般參與者頁並正常填名字/密碼。手機實掃須稍後在可到達的可信LAN位址操作；目前localhost只在同電腦有效。

mode只限制媒體，原本合法的移動/明確切房控制仍可使用；mode toggle本身不會替你換房。草稿/音量保留只涵蓋同頁模式切換，未實作跨刷新或跨新身份的耐久恢復。未知房間不因深連結取得新房或權限，URL與QR也不授予主持能力。

## 實際驗收結果

2026-11-04 08:04:33～08:04:45 UTC，Node26.13.0／Firefox157／本機可信HTTPS，同一app、三個隔離profile。主持持續合成Opus與VP8；參與者直接進studio只互動、切觀看手動播放、切只互動、再觀看不自動開媒體；展示端獨立密碼門禁、自動看分享但不播音。

- 5個425～427ms窗口同時有source audio新增21～22frames、screen新增5～6frames；參與者訂閱false、server enqueue bytes/frames差值0、raw LTA1/LTS1新增0。包含切換ACK後及QR新入房，不以來源停止當0證據。
- 手動觀看實際AudioWorklet渲染11,008samples與3個320×180畫面；切模式同room/participant、草稿及37%音量保留。這不是真人聽見或音量主觀品質驗收。
- 展示實際render、正式回饋與明確公開文字可見；原始WS未收到測試私聊/圖案history或事件，音訊binary0；9個外部發布/內容/主持claim（含正確token）/模式升權探針全部display_read_only。
- 從270×270真canvas像素由jsQR解碼為`https://localhost:4173/?room=studio&mode=interaction`；重新導覽為新participant，仍須名字/密碼。QR不含view、密碼或主持憑證。
- page/socket/collection/cleanup errors皆空、trace cap未達。root獨立讀回JSON、source指紋及實際查看兩張代表圖；圖中文字均為合成測試fixture。

[原始report](desktop/report.json)、[root讀回](root-readback.json)、[展示圖](desktop/display-live.png)、[參與互動圖](desktop/participant-interaction.png)、[命令/結果](checks.json)、[build/typecheck](build.log)、[42核心](core-integration-confirmed.log)、[browser log](participation-smoke.log)、[清理讀回](cleanup.json)。implementation-checks保留開發檢查，dependency-inventory/qr-installed-readback保留依賴授權來源。

首次完整Node41/42為既有space測試共享app清理時序，保留原log/first-core-diagnosis，改每case新app後42/42；不改space應用模型遷就測試。首次browser已通核心但等待錯用的public-stage選取器逾時，first-attempt保留原script/report/log/圖；只修為display-public-queue後上述短流程通過，無應用或依賴改動。沒有重跑已通過的全套。

重現：先按README啟動可信HTTPS managed server（HOST_CONTROL_TOKEN與MEETING_ROOM_PASSWORD不同），再以同值設定PARTICIPATION_TEST_HOST_TOKEN／PARTICIPATION_TEST_ROOM_PASSWORD，用pinned Node執行`node scripts/participation-smoke.mjs`。可設PARTICIPATION_BASE_URL／PARTICIPATION_CA_CERT／PARTICIPATION_OUTPUT_DIR；測試只在自己的隔離Firefox profile匯入CA，不更動系統信任。密碼/token不寫進URL、report或Git，profiles/私鑰未納入證據。此次server/browser已停止，4173無listener。

本步只驗桌面合成核心。未驗手機相機掃碼、真mic/原生擷取/人耳、fullscreen API、弱網/重連/重啟、耐久身份、容量或Cloud Run；mode保留僅同頁，不跨刷新。展示頁沿用POC診斷區，正式商品視覺與帳號權限仍需MVP整合。本機成功不代表完整票面/階段或商品驗收。

保存的終端log僅移除行尾空白與空白EOF以符合Git格式檢查，測試輸出/結果未改。
