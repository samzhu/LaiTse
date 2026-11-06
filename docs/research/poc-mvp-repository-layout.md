# POC 與 MVP repository layout 研究

- 項目：REPO-LAYOUT-01；查核日期：2026-11-06。
- 狀態：官方文件研究與本 repo 現況推論；未修改程式、manifest、lockfile 或 Git，也未執行 build／測試。
- 範圍：用最少結構將目前可執行技術 POC 放在 `poc/`，為未開發 MVP 保留 `apps/web/`；不新增產品需求或依賴決策。

## 最小建議

**採用 `poc/` 作為現有可執行單一 npm workspace；根目錄保留 private workspace root、root forwarding scripts 和唯一 `package-lock.json`。建立 `apps/web/README.md` 作為未開發 MVP 的空間標記，現在不放 package manifest。** 只要仍只有這一個應用包，不必先抽 `packages/`，也不需要新增 Turborepo 等建置依賴。目錄名稱是本 repo 的命名決策，並非工具規定。

保留 `docs/poc/` 的計畫、執行紀錄與歷史證據原位置及原內容；搬移的是當前 POC 執行資產，例如 `src/`、`public/`、`tests/`、`scripts/`、`db/`、應用設定與 POC package manifest。`README.md` 清楚標記 `poc/` 為研究／驗證程式，`apps/web/` 暫無 MVP 實作。

## 官方文件事實

- **npm workspaces：** npm 將 workspaces 定義為由單一 top-level root 管理的本機 nested packages；root `package.json` 的 `workspaces` 列出 workspace。可用 `npm run <script> --workspace=poc`（或 `-w poc`）指定 workspace 執行 script，亦可由該 workspace 目錄執行。npm scripts 會以 script 所屬 package 目錄作工作目錄。參見 [npm Workspaces](https://docs.npmjs.com/cli/using-npm/workspaces/) 與 [npm scripts 的工作目錄](https://docs.npmjs.com/cli/v11/using-npm/scripts/#working-directory-for-scripts)。
- **lockfile：** `package-lock.json` 記錄 root package 與以相對路徑列出的其他 packages；workspaces 由 root 設定管理。故 root 執行安裝可用一份 lockfile 描述 root 與 `poc` workspace；保留單一 root lockfile 是本 repo 的簡化選擇，不是所有 npm 專案都必須採用的唯一方式。參見 [npm package-lock 格式](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/)。root 的 `private: true` 可讓 npm 拒絕發布此 package，避免誤發 root workspace。參見 [npm package.json `private`／`workspaces`](https://docs.npmjs.com/cli/configuring-npm/package-json/#private)。
- **Vite 路徑：** Vite `root` 預設為 `process.cwd()`，代表含 `index.html` 的專案根；`publicDir` 預設為 `public`，路徑可相對於 project root，檔案在開發時以網站 `/` 路徑提供，build 時原樣複製到輸出目錄。`build.outDir` 也相對於 project root。Vite 建議讓 TypeScript 自動按檔案尋找最近的 `tsconfig`，多專案才用 references，而非全域硬指定一個 tsconfig。參見 [Vite shared options](https://vite.dev/config/shared-options)、[Vite build options](https://vite.dev/config/build-options)、[Vite public 目錄](https://vite.dev/guide/assets/#the-public-directory)。
- **TypeScript 多專案：** Project references 可切分 TypeScript 專案並透過 `tsc -b` 建置依賴；被參照的專案需開啟 `composite`，且 `declaration` 必須開啟。官方也建議 solution config 使用空 `files` 並參照各 leaf project。參見 [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)。
- **Git 移動與歷史：** Git 不在資料模型中記錄「這是 rename」；`git mv` 是移動並更新 index 的便利命令，和一般移動後 `git add`／`git rm` 的效果相同。Diff 依內容相似度偵測 rename；`git log --follow -- <path>` 可沿單一檔案新路徑查看改名之前的歷史，但不適用多路徑，且非線性歷史有限制。參見 [Git Book: Moving Files](https://git-scm.com/book/en/v2/Git-Basics-Recording-Changes-to-the-Repository#moving-files)、[git-mv](https://git-scm.com/docs/git-mv)、[git-diff rename detection](https://git-scm.com/docs/git-diff#Documentation/git-diff.txt--Mltngt)、[git-log `--follow`](https://git-scm.com/docs/git-log#Documentation/git-log.txt---follow)。

## 對本 repo 的推論與搬移檢查點

1. 根 `package.json` 設 `private: true`、`workspaces: ["poc"]`；POC 依賴和原 scripts 留在 `poc/package.json`。根 scripts 做明確轉送，例如 `npm run build --workspace=poc`、`npm run typecheck --workspace=poc`，讓舊入口仍由 root 使用。npm 的 workspace 功能本身不替專案決定 forwarding 名稱或命令。
2. 本 repo 現有 `vite.config.ts` 的 `outDir: "dist/client"`、`tsconfig.server.json` 的 `rootDir: "src/server"`／`outDir: "dist/server"`，以及 `public/` 預設位置，都是相對目前 POC 根目錄。若這些檔案同移至 `poc/`，且命令經 npm workspace 執行，應讓輸出、靜態資產和相對 TS 設定落在 `poc/`。實作後仍須核對明確傳入的 Vite `root`、`--config`、`process.cwd()`、Docker build context／volume、`.env` 路徑及所有直接 `node scripts/...` 呼叫；這些工作目錄與容器路徑不是 npm workspace 自動改寫的。
3. 目前已有 `tsconfig.json` 空 solution 與 app/server references，另外以兩次 `tsc -p tsconfig.app.json`、`tsc -p tsconfig.server.json` 做 typecheck；兩個 leaf configs 尚未設 `composite`／`declaration`。因此搬目錄時保留同資料夾內的相對設定即可，別只因新增 `poc/` 就改成 `tsc -b` 或擴大 TypeScript 專案邊界。若日後確實需要建置圖，再按官方 references 前提另行改造。
4. Vite `public/` 中的檔案會對應網站根路徑；程式應引用 `/asset-name`，不是 `/public/asset-name`。`apps/web/README.md` 僅註明預留與未實作，不建立空 workspace package，以免 npm 安裝／build 流程錯把 MVP 當成已開始。
5. Git 的 rename 是依內容推斷。較易審閱的作法是先完成純搬移並檢查 rename summary，再做必要路徑修正；大型改寫與移動可分開提交，以保留內容相似度。這是根據 Git rename 偵測機制得出的協作建議，不是 Git 強制規則。歷史 `docs/poc/evidence/` 不搬、不重寫，舊報告內路徑可作當時 run 的證據；另在新 README 或交付紀錄補上現行路徑對照。

以上只支持目前授權的邊界整理，並不表示 MVP 已實作或形成新產品決策。移動後應由程式負責人依範圍執行 build、typecheck、既有測試與短流程讀回，再更新路徑說明；本研究未替代這些驗收。
