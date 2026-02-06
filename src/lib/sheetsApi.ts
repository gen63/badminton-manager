import type { Match } from '../types/match';
import type { Player } from '../types/player';
import type { Session } from '../types/session';

interface SheetMatch {
  date: string;
  gym: string;
  teamA: [string, string];
  teamB: [string, string];
  scoreA: number;
  scoreB: number;
  duration: number;
}

interface SheetsPayload {
  matches: SheetMatch[];
}

function resolvePlayerName(
  playerId: string,
  players: Player[]
): string {
  return players.find((p) => p.id === playerId)?.name || '不明';
}

function formatMatchesForSheets(
  matches: Match[],
  players: Player[],
  session: Session
): SheetsPayload {
  return {
    matches: matches.map((match) => ({
      date: session.config.practiceDate,
      gym: session.config.gym || '',
      teamA: [
        resolvePlayerName(match.teamA[0], players),
        resolvePlayerName(match.teamA[1], players),
      ],
      teamB: [
        resolvePlayerName(match.teamB[0], players),
        resolvePlayerName(match.teamB[1], players),
      ],
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      duration: Math.round((match.finishedAt - match.startedAt) / 60000),
    })),
  };
}

export async function sendMatchesToSheets(
  url: string,
  matches: Match[],
  players: Player[],
  session: Session
): Promise<{ success: boolean; message: string }> {
  if (!url) {
    return { success: false, message: 'GAS URLが設定されていません' };
  }

  if (matches.length === 0) {
    return { success: false, message: '送信する試合がありません' };
  }

  const payload = formatMatchesForSheets(matches, players, session);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      mode: 'no-cors',
    });

    // no-cors ではレスポンスが opaque になるので status チェック不可
    // エラーが投げられなければ成功とみなす
    if (response.type === 'opaque') {
      return { success: true, message: `${matches.length}件の試合を送信しました` };
    }

    if (!response.ok) {
      return { success: false, message: `送信エラー (${response.status})` };
    }

    return { success: true, message: `${matches.length}件の試合を送信しました` };
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
