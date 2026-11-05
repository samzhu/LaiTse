# POC-06-R002：PostgreSQL 18 系統資訊持久化

2026-11-05；基線7b07341；人類DEC-012：「可使用 PostgreSQL 18 來儲存系統資訊」「都可以儲存」「回去調整 把需要儲存的都設計到資料庫, 開發期間可以用 docker」，並已啟動Docker。

**本機資料保存與恢復核心可行。** PostgreSQL候選已補上原記憶體方案的資料缺口，可接續MVP方案交接；R001的memory No-Go保留，完整POC-06／商品Go未宣告通過。沒有雲部署或新增影音服務。

## 改了什麼

- `db/migrations/001_system_persistence.sql`：12張領域表與schema_migrations。唯一資料分類與每類恢復語意沿用 [SOL-007清冊](../../mvp-handoff.md)，不另建第二份資料盤點。
- `src/server/persistence.ts`／serial executor與現有app：PG存取、transaction migration、門禁／身份／Session／位置／模式、互動archive與dedup、管理授撤權及活動歷史、業務累計與能力觀測。密碼只存salt/verifier、proof只存SHA256 digest。
- 控制操作有界序列化，先commit再送ACK/broadcast；DB錯誤或持有單writer lock的連線失效，丟棄stage並停止app。DB mode不悄悄回memory；未設DATABASE_URL的舊模式供隔離／歷史測試相容，health如實標示。
- `compose.yaml`／`.env.example`：官方PostgreSQL18.6-bookworm、loopback55432、TCP healthcheck、named volume；主機上仍跑單一Node app。首次seed後，保存的密碼／管理模式優先；漏設主持token不能降級成無管理模式。
- `tests/postgres.integration.test.mjs`／`scripts/database-restart-browser.mjs`與本目錄窄診斷：保存與恢復證據。pg8.23.1為runtime dependency，127個已安裝package的declared license未知0（非完整法務稽核）。client/shared協議與影音格式未改。

## 實際驗測

Node26.13.0、Firefox157.0、Docker29.8.2、PostgreSQL18.6/aarch64同一台本機。環境／image digest在environment.json、database-runtime.json。

| 檢查 | 結果／證據 |
|---|---|
| production build／typecheck | 最終通過；checks.json、build-152133.log |
| 既有核心 | 最終63/63，core-integration-152142.log；首輪62/63的memory health shape相容錯誤保留並修正 |
| 真PG整合 | 1個整合scenario通過（未skip）；postgres-integration-151804.log。驗門禁B、身份/位置/mode、歷史/去重/累計/觀測、管理設定、expired/revoked、defaultdeny、同DB第二app拒絕、transaction trigger故障不發成功、DB啟動不可達拒絕 |
| ACK後硬中止 | PID10026收到資料成功回覆後SIGKILL；新PID10027同proof/原ID/B門禁/chat/feedback仍在，重送不重複計數。終止該獨立DB的advisory backend後app自行停機，crash-lock-report.json |
| 真瀏覽器閉環 | 最終兩Firefox、同原頁面與proof、PID10761→10764真SIGTERM重啟，最新B密碼仍需驗證；sameID、同chat interaction ID、feedback1→1，主持沒有自動claim，手動claim/pause/unpause可用。desktop/report.json與root-readback.json |
| PostgreSQL容器重啟 | app已停止後，重啟專用DB容器；13張表逐表筆數及row fingerprints一致，包含2筆互動archive。container-restart-readback.json；不是備份還原／主機替換 |
| Docker Compose | 實際config檢查、up --wait healthy與SQL18.6讀回，最後down未加-v；cleanup.json保留volume資訊 |

瀏覽器report的7,497ms是腳本自身觀測區間，不是復原p95或完整CLI耗時。2個隔離Firefox另加2條短raw WSS門禁probe：startup A拒絕、live B接受。原document UUID與performance.timeOrigin皆相同；frame URL事件1→2是history.replaceState，不能當reload。4筆socket errors全部在舊app退出至新app啟動間，page／collection／cleanup errors為0。此次沒有開影音來源或測真人收聽，不把資料測試當影音品質證據。

root另以per-connection摘要、PID、同document、DOM ID及直接SQL核對資料，實看恢復畫面：兩成員、鎖門、一筆已遮文字聊天、like1、主持尚未認領與未開影音狀態可讀。SQL只保留識別碼／種類／長度／計數，不保留聊天全文或token。

## 怎麼在本機開發

使用repository pinned Node26.13.0，先準備環境：

```sh
cp .env.example .env
# 編輯 .env：POSTGRES_PASSWORD 與 DATABASE_URL 的密碼需一致；更換 sample HOST_CONTROL_TOKEN。
docker compose up -d --wait postgres
npm run build
npm start
```

`.env`已ignored，勿把真密碼寫進提交或命令歷史。第一次app啟動就會seed管理模式，sample預設為managed；之後相同enabled/disabled模式必須一致，token值可以輪替。room啟動密碼只在首次seed，後續從DB讀取live設定，不能靠改env覆寫房間密碼。`docker compose down`會停止並移除容器／網路，**保留volume**；刪volume等於刪資料，不屬一般重啟操作。

手動驗：加入會議室→認領主持→設定密碼B、送聊天與回饋→只重啟Node app→原頁面以最新B密碼重新驗證→原身份與未過期互動仍在→主持重新認領；麥克風與畫面來源依既有規則手動開啟。

PG整合測試只接受專用DB `laitse_poc_test`，每次建立隨機schema並只清該schema；先自行建立此測試DB，再以程序環境提供PG_TEST_DATABASE_URL執行 `npm run test:persistence`。不能指向一般開發DB。

重做browser時，用新的空白測試DB，提供PG_BROWSER_DATABASE_URL、PG_BROWSER_HOST_TOKEN、PG_BROWSER_STARTUP_PASSWORD(A)、PG_BROWSER_LIVE_PASSWORD(B)與本機TLS檔環境，執行 `node scripts/database-restart-browser.mjs`。它自行管理app的4173程序，勿先佔用該port；輸出只在ignored `.scratch/postgres/acceptance`。需Firefox、certutil與既有可信CA，未修改系統trust。每次測試獨立DB是為保留前次結果，不是靠刪資料隱藏失敗。

## 失敗與修正

- 開發中靜態review／typecheck／14項focused memory檢查由作者完成；兩作者saved/readback/STOP後root接管。handoff指紋與兩份authoring紀錄保留；root後續窄修另列review.md。
- root首輪完整核心多了memory health欄位造成唯一失敗；恢復舊模式契約後最終63/63。PG首輪test期待studio活動>=4，但fixture實際只有2join+1reaction，改精確3後整段通過，未改app湊數。
- first-browser-attempt：受限程序環境啟Firefox即SIGABRT，尚未起app；最小無密碼launch同樣失敗，改正常本機程序權限後可啟。second-browser-attempt：原身份已恢復，因frame URL事件誤判reload中止；改document身份／timeOrigin驗法後第三次完整通過，原script/report/圖保留。
- Docker initdb unix readiness曾提早成功，createdb趕上暫存server正常shutdown；讀回狀態後只對final TCP server建立DB。compose改TCP healthcheck避免此race。

## 可延續與未驗界線

保存歷史與即時畫面TTL分開；clear公開queue不刪history，remove tombstone避免內容在恢復時重現。archive目前沒有自動清理／正式保存期限，也沒有新增歷史查詢商品UI。active Session是每分鐘刷新的10分鐘lease，正常斷線後10分鐘；長時間離線／過期不保證恢復。有效proof不是正式帳號認證，host/publisher歷史不等於有效權限。

目前單active app＋PG advisory lock，未做多instance同步。每次控制操作仍保存當前狀態，少量POC可行不代表寫入容量已驗。影音、傳輸queue/decoder與傳輸診斷計數不存DB；本機尚未送出的草稿／播放選擇也未新增上傳介面。正式帳號／ACL、備份還原、保存清理、HA／主機替換、雲端託管／CloudRun、容量長測與完整階段仍待。

server/Firefox已停止；Compose測試容器已down、專用DB容器已stop，兩個named volumes保留，未停止其他服務。程式與驗測紀錄同一本機commit；既有AGENTS.md/.scratch其他未追蹤檔不納入，未push／改遠端票／開始T19或MVP。

官方參考（2026-11-05查核）：[PostgreSQL Docker image](https://hub.docker.com/_/postgres)、[node-postgres transactions](https://node-postgres.com/features/transactions)、[PostgreSQL18 advisory locking](https://www.postgresql.org/docs/18/explicit-locking.html)。本輪僅按這些契約實作本機候選，非雲端產品支援承諾。
