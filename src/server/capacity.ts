import { isIP } from "node:net";

export const DEFAULT_MEMBER_SOFT_LIMIT = 10;
export const MIN_MEMBER_SOFT_LIMIT = 1;
export const MAX_MEMBER_SOFT_LIMIT = 1_000;

export function parseMemberSoftLimit(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= MIN_MEMBER_SOFT_LIMIT && value <= MAX_MEMBER_SOFT_LIMIT
    ? value
    : null;
}

function isLoopbackIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const firstOctet = Number(address.split(".", 1)[0]);
  return firstOctet === 127;
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().split("%", 1)[0]!;
  if (normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) return isLoopbackIpv4(normalized.slice("::ffff:".length));
  return isLoopbackIpv4(normalized);
}

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host || host !== host.trim()) return false;
  try {
    const url = new URL(`http://${host}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return false;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
    return hostname === "localhost" || isLoopbackAddress(hostname);
  } catch {
    return false;
  }
}

export const LOCAL_CAPACITY_ADMIN_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LaiTse 本機容量設定</title>
  <style>
    :root { color-scheme: light; font: 16px/1.5 system-ui, sans-serif; color: #26352c; background: #f3f5f0; }
    body { margin: 0; padding: 32px 16px; }
    main { max-width: 560px; margin: 0 auto; padding: 28px; border: 1px solid #dce3dc; border-radius: 16px; background: #fff; box-shadow: 0 16px 48px #26352c12; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { color: #5f6d63; }
    form { display: flex; align-items: end; flex-wrap: wrap; gap: 12px; margin: 24px 0; }
    label { display: grid; gap: 6px; font-weight: 650; }
    input { width: 150px; min-height: 42px; box-sizing: border-box; padding: 8px 10px; border: 1px solid #bac7bd; border-radius: 8px; font: inherit; }
    button { min-height: 42px; padding: 8px 16px; border: 0; border-radius: 8px; color: #fff; background: #276145; font: inherit; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: .6; cursor: wait; }
    dl { display: grid; grid-template-columns: 1fr auto; gap: 10px 16px; padding: 16px; border-radius: 10px; background: #f4f7f3; }
    dt { color: #5f6d63; } dd { margin: 0; font-variant-numeric: tabular-nums; font-weight: 700; }
    [role=status] { min-height: 1.5em; }
    .note { font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <h1>本機服務容量</h1>
    <p>調整全服務目前可加入的成員上限。降低上限不會踢出現有人，會暫停新加入；重連也需等待或提高上限。</p>
    <form data-testid="capacity-form">
      <label for="capacity-limit">成員上限（1–1000）</label>
      <input id="capacity-limit" data-testid="capacity-limit" name="limit" type="number" min="1" max="1000" step="1" required>
      <button data-testid="capacity-save" type="submit">保存設定</button>
    </form>
    <dl>
      <dt>全服務已加入連線（含展示端；同一人多分頁各算一席）</dt>
      <dd data-testid="capacity-current-members">讀取中</dd>
      <dt>目前成員上限</dt>
      <dd data-testid="capacity-limit-output">讀取中</dd>
    </dl>
    <p data-testid="capacity-save-status" role="status" aria-live="polite">讀取設定中…</p>
    <p class="note">技術設定範圍不代表已驗證該人數的容量。記憶體模式的調整只保留到程序重啟。</p>
  </main>
  <script>
    const form = document.querySelector('[data-testid="capacity-form"]');
    const input = document.querySelector('[data-testid="capacity-limit"]');
    const current = document.querySelector('[data-testid="capacity-current-members"]');
    const limitOutput = document.querySelector('[data-testid="capacity-limit-output"]');
    const status = document.querySelector('[data-testid="capacity-save-status"]');
    const saveButton = document.querySelector('[data-testid="capacity-save"]');

    async function refresh() {
      const response = await fetch('/api/poc/capacity', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('無法讀取目前容量設定。');
      const setting = await response.json();
      input.value = String(setting.softLimit);
      current.textContent = String(setting.currentMembers);
      limitOutput.textContent = String(setting.softLimit);
      status.textContent = setting.persistence === 'postgresql' && setting.persisted
        ? '設定已由 PostgreSQL 保存。'
        : '目前為記憶體模式；設定重啟後不保留。';
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      saveButton.disabled = true;
      status.textContent = '保存中…';
      try {
        const response = await fetch('/api/poc/capacity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ softLimit: Number(input.value) }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || '設定未保存。');
        await refresh();
        status.textContent = result.persisted ? '已保存至 PostgreSQL。' : '已套用；記憶體模式重啟後不保留。';
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : '設定未保存。';
      } finally {
        saveButton.disabled = false;
      }
    });

    refresh().catch((error) => { status.textContent = error.message; });
  </script>
</body>
</html>`;
