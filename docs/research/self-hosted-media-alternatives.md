# 獨立產品的自架影音替代方案

查核日期：2026-11-02。項目：TECH-003-ALT。依 PRD v0.3 與最新人類要求：來坐自行開發、人物像素圖，核心服務可獨立部署，不強制依賴供應商帳號、授權伺服器或用量 API；一般可替換的 VM／網路基礎設施不在排除範圍。本檔是研究，未實作、未部署、未做裝置或容量測試；不構成方案定案。LiveKit 自架由主代理另查，見 `media-options.md`。

## 判斷

**Galene 值得作精簡自架備選；Jitsi 可行，但以會議系統為中心，整合成本較高。** 兩者都能把影音放在自己的伺服器，不必購買其託管服務。自研來坐的角色、空間、房間狀態及主持介面仍須自己開發。把 Jitsi 會議 iframe 放入頁面，只能證明會議嵌入，不能直接算完成來坐空間與權限驗收。這是依下列官方能力作的工程評估，未經實測。

| 比較 | Galene | Jitsi Meet／lib-jitsi-meet |
| --- | --- | --- |
| 核心授權 | MIT，可商用、修改、銷售，保留版權與授權聲明；不要求公開來坐原碼。[G1] | Apache-2.0，可商用及閉源產品整合；散布須附授權、保留適用聲明／NOTICE、標示修改，不授予商標權。不是要求公開來坐原碼。[J1][J2] |
| 維護證據 | 官方 CHANGES：1.2.1，2026-09-08；1.2 於 2026-09-05，含安全強化及 token 管理更新。[G2] | 官方 release：2.0.11248，2026-09-14。日期取 release HTML 的 datetime；不是容量或安全保證。[J3] |
| 獨立自架 | Go server＋自己的群組／帳號設定；官方安裝流程無供應商註冊、用量計費或授權服務步驟；含內建 TURN，也可自行配置網路。[G3][G4] | 官方 Debian／Ubuntu 自架流程；自己的域名、Prosody、Jicofo、Videobridge，無 JaaS 帳號前提。可自己設定 app_id／app_secret，不代表申請雲端 API key。[J4][J5] |
| 自研 UI | 有獨立 JS／TS client library、最小 client 範例與穩定協定；可僅取影音能力，重寫來坐 UI。[G3][G5] | lib-jitsi-meet 明確支援 custom GUI，應從自己的 deployment 載入。不要把完整會議 UI 的 iframe／React wrapper 誤當底層媒體 SDK。[J6] |
| 麥克風／分享 | 支援 audio-only 與螢幕／視窗分享；可做一位講者對同群組多人。SDK 必須分別管理麥克風與分享生命週期。[G3][G4][G5] | 自製 GUI 可建立 local tracks、加入 conference 與接收 track；實際麥克風和桌面來源的分開開始／停止仍須做來坐整合驗證。[J6] |
| 權限投入 | 中：group 可對應房間；present／observe 等角色、present／unpresent／kick／lock 協定與群組管理 API 可用。仍需來坐後端映射身份、主持授權、活動結束與重連。[G4][G6][G7] | 較高：會議身份與來坐身份、Prosody token／MUC／主持角色及媒體權限須一致。官方 token 範例允許匿名 guest 的設定，不可直接當成鎖房隔離方案。[J5] |

授權列針對已查核的主要專案，並非所有依賴／codec／圖片的完整清冊；交付所用版本仍須保留各套件原聲明。自架消除指定 SaaS 的強制綁定，不等於零成本：主機、出口頻寬、TURN 中繼、憑證、升級、安全修補、監控、備援與工程時間仍由產品負擔。此處不以官方示例負載推算來坐 50 人已達標。

## Galene 的權限界線

- 官方協定要求明確 request 才接收串流，可支援只互動模式不訂閱影音；它不會替來坐實作角色、彈幕或房間移動。[G6]
- 伺服器原碼的 `permissionsChangedAction` 會在缺少 `present` 時刪除既有 upstream connections，新的 offer 也檢查發布權限；`leaveGroup` 會清除上／下行連線。這提供「撤權真的停流」的程式證據，**尚未以惡意 client 實測**。[G8]
- `unpresent` 是目前連線權限變更，不能當作永久撤銷登入資格。移除／撤權還需同步來坐權威資料、撤銷或更新可再登入憑證，處理重用舊 token、新分頁及斷線重連。JWT 有房間 audience 與到期時間；不能只靠關播放器或等待 token 到期。[G4][G6][G8]
- HTTP 管理 API 管理群組、使用者和 token，不等於有完整的來坐主持 server API。即時協定操作、後端控制連線或必要擴充的實作投入待 POC。Galene 自訂角色的發布權限主要以 `present` 控制，若需分開「可開麥／可分享」，須確認伺服器是否能獨立強制，不能只隱藏按鈕。[G6][G7]

## Jitsi 的權限界線

官方存在 server-side AV moderation 模組，但模組存在不代表部署已開啟，也不代表來坐的單一主講者、獨立麥克風／螢幕權限、撤回及重連已滿足。需驗證 JWT 嚴格限房、禁止未授權 guest、主持權不因建房或重新入房意外提升，並確認停止發布／踢除會在媒體伺服器生效。[J5][J7]

因此 Jitsi 較適合願意維護整套會議基礎設施、並保留會議模型的路線；若選它，來坐使用 lib-jitsi-meet 的自製 UI 路線才應進入正式比較。這是工程判斷，並非 Jitsi 不能自研或必須付費。

## 簡查但不優先

| 方案 | 官方查核與不優先原因 |
| --- | --- |
| Janus | 真正可自架；核心 **GPLv3，非 AGPL**。官方另提供商業授權，但不是使用 GPL 版本的必買條件。GPL 允許商用；單純透過網路使用與散布副本有不同義務，不能說商用一律要公開整個來坐。若散布修改 server／建立衍生或連結模組，須先釐清對應原碼義務及邊界，不能保證任何整合均可閉源。基於本次要求授權簡單且獨立產品，先不優先。官方 tags 最近 v1.4.3，2026-10-12。[A1][A2][A3] |
| OpenVidu | 主 repo Apache-2.0；官方 Community 是可用的免費單節點開源部署，v3 採自訂 LiveKit distribution。PRO 是 proprietary，以 core/minute 計費，多節點彈性擴展／高可用屬 PRO；不可把整個 OpenVidu 都說成免費或都說成強制付費。Community 不代表必須買 PRO，但若核心目標是免授權服務依賴且未需其整套維運包，優先直接評估 LiveKit 自架，避免未來能力門檻。v3.9.0 release：2026-09-29。Community 安裝過程與執行期外連未逐項稽核，不宣稱已驗證完全離線。[A4][A5][A6] |

## 下一輪最低驗證

候選只需先做同一套窄 POC：自己的網域與伺服器、無供應商帳號；兩房各一講者，麥克風與分享可獨立停止；只互動者零媒體訂閱；切房斷舊流；後端撤發布／接收權後，既有連線、改造 client、舊 token、新分頁和重連均不得繞過；最後才測 50 人與 TURN 網路。這些全數未執行。未通過前不寫成正式功能或人類驗收。

## 官方來源

- [G1：Galene MIT LICENCE](https://raw.githubusercontent.com/jech/galene/master/LICENCE)
- [G2：Galene CHANGES](https://raw.githubusercontent.com/jech/galene/master/CHANGES)
- [G3：Galene 官網、功能與 client libraries](https://galene.org/)
- [G4：Galene 使用、管理與授權](https://galene.org/galene.html)
- [G5：Writing clients for Galene](https://galene.org/galene-client.html)
- [G6：Galene protocol](https://galene.org/galene-protocol.html)
- [G7：Galene administrative API](https://galene.org/galene-api.html)
- [G8：Galene 伺服器 webclient.go](https://raw.githubusercontent.com/jech/galene/master/rtpconn/webclient.go)
- [J1：Jitsi Meet LICENSE](https://raw.githubusercontent.com/jitsi/jitsi-meet/master/LICENSE)
- [J2：lib-jitsi-meet LICENSE](https://raw.githubusercontent.com/jitsi/lib-jitsi-meet/master/LICENSE)
- [J3：Jitsi 2.0.11248 release](https://github.com/jitsi/jitsi-meet/releases/tag/stable%2Fjitsi-meet_11248)
- [J4：Jitsi 自架安裝](https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-quickstart/)
- [J5：Jitsi Token Authentication](https://jitsi.github.io/handbook/docs/devops-guide/token-authentication/)
- [J6：lib-jitsi-meet custom GUI API](https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-ljm-api/)
- [J7：Jitsi AV moderation server module](https://raw.githubusercontent.com/jitsi/jitsi-meet/master/resources/prosody-plugins/mod_av_moderation_component.lua)
- [A1：Janus GPLv3 COPYING](https://raw.githubusercontent.com/meetecho/janus-gateway/master/COPYING)
- [A2：Janus 官方 FAQ：GPL／商業授權](https://janus.conf.meetecho.com/docs/FAQ.html)
- [A3：Janus 官方 tags](https://github.com/meetecho/janus-gateway/tags)
- [A4：OpenVidu LICENSE](https://raw.githubusercontent.com/OpenVidu/openvidu/master/LICENSE)
- [A5：OpenVidu Community／PRO 與能力邊界](https://openvidu.io/pricing/)
- [A6：OpenVidu releases](https://github.com/OpenVidu/openvidu/releases)

來源方法：官方文件、raw 授權與原碼、官方 release／tag HTML；未使用匿名 GitHub API。日期以查核日可見資料為準，浮動 master 連結不是版本鎖定。未跑 lint／型別／產品測試（純研究文件）；只做保存與讀回。
