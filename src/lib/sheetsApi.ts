import type { Match } from '../types/match';
import type { Player } from '../types/player';
import type { Session } from '../types/session';
import type { AccountingRecord } from '../types/accounting';

interface SheetMatch {
  matchId: string;
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
  // シングルスでは teamA[1] / teamB[1] が空文字。プレースホルダで埋めず空欄のまま送る
  if (!playerId) return '';
  return players.find((p) => p.id === playerId)?.name || '未設定';
}

function formatMatchesForSheets(
  matches: Match[],
  players: Player[],
  session: Session
): SheetsPayload {
  // 練習開始日時をフォーマット (YYYY/MM/DD HH:MM)
  const practiceDate = new Date(session.config.practiceStartTime);
  const year = practiceDate.getFullYear();
  const month = String(practiceDate.getMonth() + 1).padStart(2, '0');
  const day = String(practiceDate.getDate()).padStart(2, '0');
  const hour = String(practiceDate.getHours()).padStart(2, '0');
  const minute = String(practiceDate.getMinutes()).padStart(2, '0');
  const datetime = `${year}/${month}/${day} ${hour}:${minute}`;

  return {
    matches: matches.map((match) => ({
      matchId: match.id,
      date: datetime,
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

// 会計データをSheetsに送信
export async function sendAccountingToSheets(
  url: string,
  record: AccountingRecord
): Promise<{ success: boolean; message: string }> {
  if (!url) {
    return { success: false, message: 'GAS URLが設定されていません' };
  }

  // recordをそのまま送信（timestamp, id以外のすべてのフィールド）
  const payload = {
    timestamp: record.timestamp,
    date: record.date,
    gym: record.gym,
    practiceType: record.practiceType,
    maleCount: record.maleCount,
    maleFee: record.maleFee,
    femaleCount: record.femaleCount,
    femaleFee: record.femaleFee,
    exemptCount: record.exemptCount,
    participantCount: record.participantCount,
    matchCount: record.matchCount,
    members: record.members,
    incomeTotal: record.incomeTotal,
    gymCost: record.gymCost,
    shuttlePrice: record.shuttlePrice,
    shuttleCount: record.shuttleCount,
    expenseTotal: record.expenseTotal,
    otherDescription: record.otherDescription,
    otherAmount: record.otherAmount,
    finalTotal: record.finalTotal,
  };

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

    if (response.type === 'opaque') {
      return { success: true, message: '会計データを送信しました' };
    }

    if (!response.ok) {
      return { success: false, message: `送信エラー (${response.status})` };
    }

    return { success: true, message: '会計データを送信しました' };
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
