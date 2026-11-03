# T02窄範圍檢視

- 主代理與Luna不同writer檢視；Luna明確釋出後主代理接手。無可呼叫的code-review技能入口，本輪採實際原始碼檢視與輕量核心示範。
- 讀回發現並修正：舊socket的異步fetch回覆不能覆寫新連線觀測；canPlayType保留實際probably/maybe提示，避免冒充播放實測。
- client不請求媒體權限；能力API存在／配置探測／未知分開，例外與3秒超時是unknown。server只驗固定字段與有界內容，產生自己的connection/observation ID；8KiB能力訊息與1KiB控制分離，記憶體最多64筆，不向全房廣播。
- 11個新舊核心案例與真實Firefox可信HTTPS/WSS示範通過；另用Chrome插件按鈕實測及獨立API讀回核對。沒有剩餘阻擋本輪桌面核心範圍的問題。
- LAN SAN以預留IP驗工具，未冒充手機；手機／實際media／正式身份與保存均未測。新生憑證／profile位於ignored .scratch/t02，沒有提交私鑰或變更系統信任。沒有加入套件或服務。
- 原始OpenSSL SAN log包含上游尾端空白，保存原始輸出；提交前對來源／說明檔執行diff whitespace檢查，原始證據不改寫。

提交前將4個新檔案多餘的末尾空白行整理為單一換行；前後rstrip內容相同，沒有行為變更，不重跑核心測試。source-sha256-tested.json保存實測位元組指紋，source-sha256.json保存最後提交版指紋；差異僅上述EOF空白。
