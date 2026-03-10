import type { Match } from '../types/match';
import type { Player } from '../types/player';
import type { Session } from '../types/session';
import type { AccountingRecord } from '../types/accounting';

interface SheetMatch {
  datetime: string;
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

const POST_TIMEOUT = 15000;
const MAX_POST_ATTEMPTS = 2;
const RETRY_DELAY = 1000;

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
      datetime: datetime,
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

function classifyError(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { message: '送信がタイムアウトしました。再試行します...', retryable: true };
  }
  if (error instanceof TypeError) {
    return {
      message: navigator.onLine
        ? 'ネットワークエラーが発生しました。GAS URLが無効か期限切れの可能性があります'
        : 'オフラインです。インターネット接続を確認してください',
      retryable: navigator.onLine,
    };
  }
  return { message: '送信に失敗しました', retryable: false };
}

async function postWithRetry(
  url: string,
  body: string,
  successMessage: string
): Promise<{ success: boolean; message: string }> {
  for (let attempt = 1; attempt <= MAX_POST_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), POST_TIMEOUT);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body,
        signal: controller.signal,
        mode: 'no-cors',
      });

      // no-cors ではレスポンスが opaque になるので status チェック不可
      // エラーが投げられなければ成功とみなす
      if (response.type === 'opaque') {
        return { success: true, message: successMessage };
      }

      if (!response.ok) {
        const retryable = response.status >= 500 && attempt < MAX_POST_ATTEMPTS;
        if (retryable) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
          continue;
        }
        return { success: false, message: `送信エラー (${response.status})` };
      }

      return { success: true, message: successMessage };
    } catch (error) {
      const classified = classifyError(error);
      if (classified.retryable && attempt < MAX_POST_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        continue;
      }
      // 最終試行での失敗メッセージはリトライ表示を除去
      return {
        success: false,
        message: classified.message.replace('再試行します...', '再度お試しください'),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return { success: false, message: '送信に失敗しました。しばらく待ってから再度お試しください' };
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
  return postWithRetry(url, JSON.stringify(payload), `${matches.length}件の試合を送信しました`);
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

  return postWithRetry(url, JSON.stringify(payload), '会計データを送信しました');
}

// GAS URLの接続テスト
export async function testGasConnection(
  url: string
): Promise<{ success: boolean; message: string }> {
  if (!url) {
    return { success: false, message: 'URLが設定されていません' };
  }

  if (!url.startsWith('https://script.google.com/')) {
    return { success: false, message: 'GAS URLの形式が正しくありません' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { success: false, message: 'アクセス権限がありません。GASのデプロイ設定を確認してください' };
      }
      if (response.status >= 500) {
        return { success: false, message: 'GASサーバーエラーです。しばらく待ってから再度お試しください' };
      }
      return { success: false, message: `接続エラー (${response.status})` };
    }

    const text = await response.text();

    // HTMLが返ってくる場合はGASが無効（期限切れ・削除済み）
    if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) {
      return { success: false, message: 'GAS URLが無効です。GASを再デプロイしてURLを更新してください' };
    }

    // JSONレスポンスをチェック
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      if (data.status === 'error') {
        return { success: false, message: (data.message as string) || 'GASからエラーが返されました' };
      }
      return { success: true, message: '接続成功' };
    } catch {
      // JSONでなくても接続自体は成功
      return { success: true, message: '接続成功（レスポンス形式が想定外ですが接続は正常です）' };
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { success: false, message: '接続がタイムアウトしました' };
    }
    if (error instanceof TypeError) {
      return {
        success: false,
        message: navigator.onLine
          ? 'GAS URLに接続できません。URLが期限切れの可能性があります。GASを再デプロイしてURLを更新してください'
          : 'オフラインです。インターネット接続を確認してください',
      };
    }
    return { success: false, message: '接続テストに失敗しました' };
  } finally {
    clearTimeout(timeoutId);
  }
}
