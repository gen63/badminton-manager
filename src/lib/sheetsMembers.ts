interface MemberFromSheet {
  name: string;
  rating?: number;
  gender?: 'M' | 'F';
}

interface RawMemberFromSheet {
  name: string;
  rating?: number;
  gender?: string;
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

    // HTMLが返ってくる場合はGASが無効（期限切れ・削除済み）
    if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) {
      return {
        success: false,
        message: 'GAS URLが無効です。GASを再デプロイしてURLを更新してください',
        members: [],
        retryable: false,
      };
    }

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

    const rawMembers = (obj.members as RawMemberFromSheet[]) || [];
    
    // 性別を正規化（'男' → 'M', '女' → 'F'）
    const members: MemberFromSheet[] = rawMembers
      .filter((m: RawMemberFromSheet) => m.name)
      .map((m: RawMemberFromSheet) => {
        let gender: 'M' | 'F' | undefined;
        if (m.gender) {
          const g = String(m.gender).toUpperCase();
          if (g === 'M' || m.gender === '男') {
            gender = 'M';
          } else if (g === 'F' || m.gender === '女') {
            gender = 'F';
          }
        }
        return {
          name: m.name,
          rating: m.rating,
          gender,
        };
      });

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
        message: navigator.onLine
          ? 'ネットワークエラーが発生しました。GAS URLが期限切れの可能性があります'
          : 'オフラインです。インターネット接続を確認してください',
        members: [],
        retryable: navigator.onLine,
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
      if (m.gender) {
        const g = String(m.gender);
        const isMale = g === 'M' || g === 'm' || g === '男';
        parts.push(isMale ? '男' : '女');
      }
      parts.push(String(m.rating ?? 0));
      return parts.join('  ');
    })
    .join('\n');
}
