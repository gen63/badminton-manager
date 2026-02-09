interface MemberFromSheet {
  name: string;
  rating?: number;
  gender?: 'M' | 'F';
}

interface FetchMembersResult {
  success: boolean;
  message: string;
  members: MemberFromSheet[];
}

interface AttemptResult extends FetchMembersResult {
  retryable: boolean;
}

async function attemptFetch(url: string): Promise<AttemptResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      const retryable = response.status >= 500;
      return {
        success: false,
        message: response.status >= 500
          ? 'サーバーエラーが発生しました。しばらく待ってから再度お試しください'
          : `読み込みエラー (${response.status})`,
        members: [],
        retryable,
      };
    }

    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        success: false,
        message: 'GASの応答を解析できません。GASの再デプロイをお試しください',
        members: [],
        retryable: true,
      };
    }

    const obj = data as Record<string, unknown>;

    if (obj.status === 'error') {
      return {
        success: false,
        message: (obj.message as string) || '読み込みに失敗しました',
        members: [],
        retryable: false,
      };
    }

    const members: MemberFromSheet[] = (
      (obj.members as MemberFromSheet[]) || []
    ).filter((m: MemberFromSheet) => m.name);

    if (members.length === 0) {
      return { success: false, message: '当日参加者が見つかりません', members: [], retryable: false };
    }

    return { success: true, message: `${members.length}人を読み込みました`, members, retryable: false };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return {
        success: false,
        message: '読み込みがタイムアウトしました。しばらく待ってから再度お試しください',
        members: [],
        retryable: true,
      };
    }
    if (error instanceof TypeError) {
      return {
        success: false,
        message: 'ネットワークエラーが発生しました。接続を確認してください',
        members: [],
        retryable: true,
      };
    }
    return {
      success: false,
      message: '読み込みに失敗しました',
      members: [],
      retryable: false,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchMembersFromSheets(
  url: string,
  onRetry?: () => void
): Promise<FetchMembersResult> {
  if (!url) {
    return { success: false, message: 'GAS URLが設定されていません', members: [] };
  }

  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await attemptFetch(url);
    if (result.success || !result.retryable || attempt === MAX_ATTEMPTS) {
      return { success: result.success, message: result.message, members: result.members };
    }
    onRetry?.();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { success: false, message: '読み込みに失敗しました', members: [] };
}

export function membersToText(members: MemberFromSheet[]): string {
  return members
    .map((m) => {
      const parts = [m.name];
      if (m.gender) parts.push(m.gender);
      if (m.rating != null) parts.push(String(m.rating));
      return parts.join('  ');
    })
    .join('\n');
}
