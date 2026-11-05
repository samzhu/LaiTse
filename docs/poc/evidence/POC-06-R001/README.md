# POC-06-R001：T18 程序重啟與資料恢復語意

2026-11-05；基線 `13fb00e`；票 #19。遵循人類指定的本機、輕量核心與使用方式驗測，程式與紀錄同一本機 commit。

**操作重建可行；動態資料沒有恢復，目前 process-memory 方案的耐久恢復判定 No-Go。完整 T18／POC-06 未通過，MVP Go 未成立。** 本輪評估已完成，不把新 Session 的成功當作舊資料恢復，也未替人類接受資料遺失或加入持久化服務。

## 實測與結果

新增 `scripts/process-restart-smoke.mjs`，自行擁有本機應用子程序；不增加公開 restart API，不改 app、tests、依賴或資料保存方式。Node v26.13.0／Firefox157／同一 M1 Max 本機、trusted HTTPS/WSS，三個隔離瀏覽器：主持合成音畫、實際解碼接收者、已授權再撤權者；另有兩條短 raw WSS 越權探測連線。來源為 oscillator／canvas，非實體麥克風或桌面擷取。

最後完整流程於 12:16:05～12:16:18（台北）執行，12,837ms。原程序 PID58035 在音畫活動中 SIGTERM 正常退出，再以相同啟動設定產生 PID58041；不是路由斷線模擬。第二程序最後 SIGTERM 是清理，不是另一次情境重啟。

| 檢查 | 觀察與判定 |
|---|---|
| 固定房間與啟動設定 | lobby／studio 重建、studio 鎖定、主持控制啟用；這是 source/config 重建 |
| 舊三個 Session | 都嘗試 resume 並收到 `resume_invalid`；該連線沒有自動 join、claim、發布或訂閱 |
| 新身份與權限 | 明確重載頁面，正常 Join room 取得三個新 UUID；首位入房只見自己、未認領主持且禁止發布 |
| 門禁差異 | 重啟前 live 密碼 B 失效（`room_password_incorrect`），原啟動密碼 A 可入房；不是保留了 B |
| 回饋資料 | 重啟前送出一筆、有 ACK/event 與 DOM 計數1；重入後0，沒有恢復 |
| 撤權與越權 | 新身份沒有舊授權；偽造 host role 得 `invalid_join`，普通參與者 audio/screen start 得 `publish_not_authorized`。這是 default-deny，非持久撤權名單 |
| 手動重新使用 | 主持用啟動 token 重新認領，再手動開新來源；接收者手動收聽／觀看，可再次實播 |
| 真正解碼／呈現 | 重啟前音訊38016→56448→75904 samples、影像10→16→21 frames；手動恢復後32064→51520→70976、8→14→19，兩段皆增長 |
| 來源身份 | 原 tracks ended；新 audio/screen 共用新 clock，與舊 clock 不同。generation 前後都是1，不能當耐久識別 |

6 筆 socket errors 全在舊程序退出後、新程序啟動前，屬受控 server-down；page／collection／cleanup errors 為0，無未預期錯誤。流程時間只作診斷，不是恢復 p95／品質承諾。

## 檢查與證據

- production build／typecheck 通過；既有核心整合 **63/63** 通過一次，之後 app/tests/manifest/lock 指紋未變；最終腳本以 pinned Node 語法檢查並完成上述整段瀏覽器流程。
- [desktop/report.json](desktop/report.json) 保留完整操作、連線摘要、PID、UUID、clock、採樣；`status: passed` 僅指腳本操作驗測，`fullT18Pass: false` 與 `NO_GO_DURABILITY_UNRESOLVED` 另列。
- [root-readback.json](root-readback.json) 是 root 獨立重算與兩張實際看圖記錄；[review.md](review.md) 是設計與失敗修正。[checks.json](checks.json)、build/core logs、前後 source 指紋可追溯。
- first-attempt 保留 feedback 更新取錯訊息的 timeout；second-attempt 保留 probe nested 欄位讀錯的斷言失敗。只改 harness；第三輪完整通過，前兩輪沒有被覆蓋。
- [cleanup.json](cleanup.json)：兩個自有 child exit0、T18 Firefox 已停、4173 無 listener；未停止其他服務。作者已 STOP 交接，root 完成驗收與文件後釋出。

## 怎麼使用

1. 用 pinned Node26.13.0 執行 `npm run build`；準備既有本機 TLS／CA、Firefox、certutil，4173 保持空閒，不要先開另一個 server。
2. 在程序環境提供三個相異值：`RESTART_TEST_HOST_TOKEN`（32～256 bytes）、`RESTART_TEST_ROOM_PASSWORD`（A）、`RESTART_TEST_LIVE_PASSWORD`（B），以及 `TLS_CERT_FILE`、`TLS_KEY_FILE`。憑證／密碼不放 URL、命令歷史或提交檔。
3. 執行 `node scripts/process-restart-smoke.mjs`；預設輸出 `.scratch/t18/acceptance/run-*`。可設 `HEADLESS=0` 看頁面；其他選項見 repository README T18。腳本只停止自己建立的 child，不會接管既有程序。
4. 真人手動操作時，程序重啟後看到 Session 不可恢復，重載頁面並重新加入，使用**啟動設定的密碼**；主持重新認領，來源與收聽／觀看各按正常按鈕重開。這條路徑產生新身份，原回饋／live 密碼不會因此回來。

## MVP 移轉與未驗範圍

資料分類只維護既有 [SOL-007 權威清冊](../../mvp-handoff.md)，未另建競爭清冊。可復用的是重啟驗證方法、舊 proof 拒絕與新身份手動重建操作；不能將記憶體 store 當耐久方案。聊天室歷史、去重、統計等記憶體性質來自 source 盤點，本輪**沒有送聊天驗其遺失**；無正式帳號／耐久身份／ACL 恢復。

必要資料的保存來源與還原語意仍須產品／架構決策。未加入 DB、Redis、disk snapshot 或外部服務，未放寬單一 Cloud Run 條件。No-Go 針對目前只有程序記憶體的候選，不代表所有可能架構都不可行。平台界線見 [platform-boundary.md](platform-boundary.md)；本輪沒有部署或測 Cloud Run。

手機、真人聽感、實體來源、真弱網、強殺／崩潰／主機替換、多 instance、長測／容量／p95 與完整商品恢復未驗。未開始 T19／MVP、未 push 或改遠端票。
