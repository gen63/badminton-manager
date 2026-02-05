interface MemberFromSheet {
  name: string;
  rating?: number;
}

interface FetchMembersResult {
  success: boolean;
  message: string;
  members: MemberFromSheet[];
}

export async function fetchMembersFromSheets(
  url: string
): Promise<FetchMembersResult> {
  if (!url) {
    return { success: false, message: 'GAS URLが設定されていません', members: [] };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, message: `読み込みエラー (${response.status})`, members: [] };
    }

    const data = await response.json();

    if (data.status === 'error') {
      return { success: false, message: data.message || '読み込みに失敗しました', members: [] };
    }

    const members: MemberFromSheet[] = (data.members || []).filter(
      (m: MemberFromSheet) => m.name
    );

    if (members.length === 0) {
      return { success: false, message: '当日参加者が見つかりません', members: [] };
    }

    return { success: true, message: `${members.length}人を読み込みました`, members };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { success: false, message: '読み込みがタイムアウトしました', members: [] };
    }
    return {
      success: false,
      message: '読み込みに失敗しました。Wi-Fi接続を確認してください',
      members: [],
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function membersToText(members: MemberFromSheet[]): string {
  return members
    .map((m) => (m.rating != null ? `${m.name}  ${m.rating}` : m.name))
    .join('\n');
}
