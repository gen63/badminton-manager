// Discord 上限。本文と合わせて超えないよう本文を末尾切り詰めする
const DISCORD_CONTENT_LIMIT = 2000;
const REQUEST_TIMEOUT_MS = 10000;

export interface BugReportMeta {
  currentUser: string | null;
  sessionId: string | null;
  gym: string | null;
}

function buildContent(text: string, meta: BugReportMeta): string {
  const footerLines = [
    '',
    '---',
    `👤 ユーザー: ${meta.currentUser ?? '(未ログイン)'}`,
    `🗂 セッション: ${meta.gym ?? '(なし)'} (${meta.sessionId ?? '-'})`,
    `🕒 ${new Date().toISOString()}`,
    `🖥 ${navigator.userAgent}`,
    `📐 ${window.innerWidth}×${window.innerHeight}`,
  ];
  const header = '🐛 **バグ報告**\n\n';
  const footer = '\n' + footerLines.join('\n');

  const budgetForBody = DISCORD_CONTENT_LIMIT - header.length - footer.length;
  let body = text;
  if (body.length > budgetForBody) {
    body = body.slice(0, Math.max(0, budgetForBody - 3)) + '...';
  }
  return header + body + footer;
}

export async function sendBugReportToDiscord(
  webhookUrl: string,
  text: string,
  meta: BugReportMeta
): Promise<{ success: boolean; message: string }> {
  if (!webhookUrl) {
    return { success: false, message: 'Discord Webhook URLが設定されていません' };
  }

  const content = buildContent(text, meta);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, message: `送信エラー (${response.status})` };
    }

    return { success: true, message: 'バグ報告を送信しました' };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { success: false, message: '送信がタイムアウトしました' };
    }
    return {
      success: false,
      message: '送信に失敗しました。Wi-Fi接続を確認してください',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
