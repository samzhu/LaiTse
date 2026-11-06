# 來坐 LaiTse

以像素人物、多房間、多人語音與畫面分享建立共同在場的共享空間。

**目前完成的是技術核心 POC，自動驗測通過；正式 MVP 尚未開發。** 兩者保留在同一儲存庫，以不同目錄隔離，逐項移轉已驗證的方案。

## 專案結構

```text
LaiTse/
├── poc/                     # 可獨立建置／操作的技術實驗 workspace
│   ├── src/                 # POC 前後端，含實驗介面
│   ├── scripts/             # 合成來源、瀏覽器驗測與故障工具
│   ├── tests/               # POC 自動測試
│   ├── public/              # AudioWorklet 與靜態資產
│   ├── db/migrations/       # POC 資料庫 migrations
│   └── compose.yaml         # POC 本機 PostgreSQL
├── apps/web/                # MVP 預留位置，目前只有範圍說明
├── docs/
│   ├── laitse-prd.md        # 唯一產品需求與 MVP 開發計畫
│   ├── poc/                 # 實驗計畫、歷史證據與技術採用交接
│   ├── mvp/                 # MVP 文件入口，未另建第二份 PRD
│   ├── research/            # 官方來源研究與限制
│   └── collaboration/      # 決策、交付與協作紀錄
├── package.json             # npm workspaces 與根操作入口
└── package-lock.json        # 單一依賴鎖檔
```

`.tools/`、`.cache/`、`.scratch/` 為repo本機工具與私有測試產物，不提交。MVP開始前不建立空的共用套件；確認可用且有實際使用者後，再決定是否抽出 `packages/`。

## 先操作技術 POC

專案固定 **Node.js 26.13.0**，版本見 [.nvmrc](.nvmrc)。已安裝本機工具時，先在repo根執行：

```sh
export PATH="$PWD/.tools/node-v26.13.0-darwin-arm64/bin:$PATH"
npm ci --cache "$PWD/.cache/npm"
npm run build
npm test
```

根指令明確轉送到POC workspace；MVP未被建立或啟動。資料庫測試以 `PG_TEST_DATABASE_URL` 啟用，未設定時相關測試會skip，不可稱為PG已驗。完整啟動、環境檔、TLS、Docker與瀏覽器步驟見 [poc/README.md](poc/README.md)。

## 保留的人工環境

目前人工入口：[http://localhost:4174/?room=studio](http://localhost:4174/?room=studio)。需保持Docker／OrbStack運作；它是本機 POC。不要因整理目錄刪除資料庫／volume，也不要把測試用假來源移入產品。實際運作狀態以最新交付紀錄為準。

## 文件入口與移轉原則

- [產品需求與 MVP 功能／開發計畫](docs/laitse-prd.md)：第11節為唯一計畫入口。
- [MVP 文件入口](docs/mvp/README.md)：說明後續整合界線；MVP尚未開發。
- [可採用方案與限制](docs/poc/mvp-handoff.md)：沿SOL-001～008；SOL-007仍是唯一資料保存清冊。
- [POC執行紀錄](docs/poc/execution-log.md)與[最終核心自動驗收](docs/poc/evidence/POC-FINAL-01-R001/README.md)：實驗通過不等於正式商品交付。
- [目錄整理依據](docs/research/poc-mvp-repository-layout.md)與[搬移／驗收紀錄](docs/poc/evidence/REPO-LAYOUT-01/README.md)。

MVP挑選已驗證的協議、狀態規則與模組，重新整理產品介面、錯誤流程與運維；不直接把整個POC或其測試來源當正式產品。POC與MVP不互相import私有src，確有共用需求時再建立明確套件邊界。

歷史證據保留原run與hash，舊程式路徑加 `poc/` 前綴對照即可。[舊根 README](docs/poc/legacy-local-poc-guide.md)封存當時指令；舊 `.scratch` launcher 不視為可長期維護入口，重用前須檢查其 import／cwd。
