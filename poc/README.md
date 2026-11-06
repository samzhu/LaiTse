# LaiTse 技術核心 POC

這是研究與驗證用的應用，包含實驗介面、合成來源與診斷工具；正式MVP尚未開發。產品需求沿[PRD第11節](../docs/laitse-prd.md#11-桌機-mvp-功能範圍與開發計畫)，採用方式與限制沿[SOL交接表](../docs/poc/mvp-handoff.md)。

## 從repo根目錄操作

使用[固定Node26.13.0](../.nvmrc)，安裝一次，只有repo根有lockfile：

```sh
npm ci --cache "$PWD/.cache/npm"
npm run build
npm test
npm start
```

- `build`／`typecheck`：轉送到本workspace；產物為`poc/dist/client`與`poc/dist/server`。
- `test`：串行執行Node測試；未提供`PG_TEST_DATABASE_URL`時PG案例明確skip，不能稱已驗PG。
- `start`：啟動POC，讀repo根的`.env`（若有），預設loopback4173。使用中的4173/4174服務請勿另起同port程序。
- `tls:dev`／`licenses`：沿用repo根工具、scratch與單一lockfile；預設輸出屬歷史工具入口，新run應指定新的輸出目錄以免覆寫。

也可以在repo根用`npm run build --workspace=poc`，或`cd poc`後執行package指令。

## 本機設定與資料庫

`poc/.env.example`為舊POC設定範本。全新環境才複製到repo根`.env`並填入本機密碼；既有秘密檔不要覆寫、提交或公開。`npm start`明確讀`../.env`，**不會自動讀`poc/.env`**；這是POC相容設定，未來MVP未建立、也未共用它。

範本的`HOST_CONTROL_TOKEN`會啟用舊managed-host模式。若要匿名暱稱／人人可開麥的會議室示範，請在全新專用資料庫首次啟動前將`HOST_CONTROL_TOKEN`及`MEETING_ROOM_PASSWORD`留空。DB已保存的模式／門禁優先於啟動seed，不能清空env就轉模式；勿刪volume解決，請改用獨立測試DB。

在repo根啟動範本資料庫：

```sh
docker compose --env-file .env -f poc/compose.yaml up -d postgres
```

PG自動測試另設`PG_TEST_DATABASE_URL`指向專用測試DB（本機慣例`laitse_poc_test`），不可指向正在使用的POC／產品資料庫。真PG完整測試與匿名範例方法見[驗收紀錄](../docs/poc/evidence/REPO-LAYOUT-01/README.md)。

## 腳本與歷史紀錄

可由不同cwd直接呼叫`node /絕對路徑/LaiTse/poc/scripts/<script>.mjs`；CLI明確切到repo cwd以相容既有相對env路徑，純路徑helper與TCP proxy library在import時不改cwd。工具／Playwright cache／觀測留repo根`.tools/`與`.scratch/`，app source／dist／migrations取本workspace，不能使用整理前留下的根`dist`當新版。

[歷史證據](../docs/poc/evidence/)保留原run與hash，舊`src/`等程式路徑對照`poc/src/`；[封存指南](../docs/poc/legacy-local-poc-guide.md)保留當時指令，不是現行入口。舊scratch launcher重用前需檢查import與cwd，本輪只更新保留給人工的4174 launcher。
