import type { Player } from '../types/player';
import { resolveStayStart } from './stayStart';

export interface GamesStats {
  max: number;
  min: number;
  median: number;
}

/** 試合数の max / min / median。空配列は null。 */
export function computeGamesStats(players: ReadonlyArray<Pick<Player, 'gamesPlayed'>>): GamesStats | null {
  if (players.length === 0) return null;
  const sorted = players.map((p) => p.gamesPlayed).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { max: sorted[sorted.length - 1], min: sorted[0], median };
}

/** 中央値の表示（整数はそのまま、小数は1桁）。 */
export function formatMedian(median: number): string {
  return Number.isInteger(median) ? String(median) : median.toFixed(1);
}

export interface StayInfo {
  /** 会費・名簿が両方完了しているか（未完了は滞在0扱い） */
  complete: boolean;
  /** 滞在分（下限なし、0 以上） */
  minutes: number;
  /** 最長滞在者を100%とした割合（整数%）。最大滞在が0なら null */
  percent: number | null;
  /** 管理者が「みなし開始時刻」(`stayStartOverrideAt`) を設定しているなら true（未設定は undefined） */
  overridden?: boolean;
}

export interface StayStats {
  maxMinutes: number;
  byId: Map<string, StayInfo>;
}

/** 滞在時間モードのアルゴリズム（resolveStayStart）と同じ起点で各人の滞在分と割合を求める。 */
export function computeStayStats(
  players: ReadonlyArray<Player>,
  practiceStartTime: number,
  now: number,
  /** 練習終了日時。指定（> 0）があれば、それ以降は滞在をカウントしない。省略/0 は打ち止めなし */
  practiceEndTime?: number,
): StayStats {
  const effectiveNow = practiceEndTime && practiceEndTime > 0 ? Math.min(now, practiceEndTime) : now;
  const raw = players.map((p) => {
    const complete = p.operationStatus?.payment === true && p.operationStatus?.roster === true;
    const start = resolveStayStart(p, practiceStartTime, effectiveNow);
    return {
      id: p.id,
      complete,
      minutes: Math.max(0, (effectiveNow - start) / 60000),
      overridden: p.stayStartOverrideAt !== undefined,
    };
  });
  const maxMinutes = raw.reduce((m, r) => Math.max(m, r.minutes), 0);
  const byId = new Map<string, StayInfo>();
  for (const r of raw) {
    byId.set(r.id, {
      complete: r.complete,
      minutes: r.minutes,
      percent: maxMinutes > 0 ? Math.round((r.minutes / maxMinutes) * 100) : null,
      ...(r.overridden ? { overridden: true } : {}),
    });
  }
  return { maxMinutes, byId };
}

/** 分 → `H:MM`（例: 83 → 1:23） */
export function formatStayMinutes(minutes: number): string {
  const total = Math.floor(minutes);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export type ExpectedGamesMode = 'count' | 'stay';

export interface ExpectedGames {
  /** 期待試合数。算出できない（未完了・滞在合計0・人数0）は null */
  expected: number | null;
  /** 実績 − 期待値。expected が null なら null */
  diff: number | null;
}

/**
 * 各人の「期待試合数」と実績との差。
 * - count（回数平均モード）: 全員の試合数合計 / 人数（全員同じ）。
 * - stay（滞在時間モード）: 会費・名簿完了者だけで按分。期待値_i = 完了者の試合数合計 × 滞在分_i / 完了者の滞在分合計。
 *   未完了者と、滞在合計が0のときは null。
 */
export function computeExpectedGames(
  players: ReadonlyArray<Pick<Player, 'id' | 'gamesPlayed'>>,
  mode: ExpectedGamesMode,
  stayById: ReadonlyMap<string, StayInfo>,
): Map<string, ExpectedGames> {
  const result = new Map<string, ExpectedGames>();
  const make = (p: Pick<Player, 'gamesPlayed'>, expected: number | null): ExpectedGames => ({
    expected,
    diff: expected === null ? null : p.gamesPlayed - expected,
  });

  if (mode === 'count') {
    const total = players.reduce((s, p) => s + p.gamesPlayed, 0);
    const avg = players.length > 0 ? total / players.length : null;
    for (const p of players) result.set(p.id, make(p, avg));
    return result;
  }

  const done = players.filter((p) => stayById.get(p.id)?.complete === true);
  const totalGames = done.reduce((s, p) => s + p.gamesPlayed, 0);
  const totalMinutes = done.reduce((s, p) => s + (stayById.get(p.id)?.minutes ?? 0), 0);
  for (const p of players) {
    const info = stayById.get(p.id);
    const expected =
      info?.complete === true && totalMinutes > 0 ? (totalGames * info.minutes) / totalMinutes : null;
    result.set(p.id, make(p, expected));
  }
  return result;
}

/** 期待試合数の表示（小数1桁） */
export function formatExpected(expected: number): string {
  return expected.toFixed(1);
}

/** 差の表示（符号付き小数1桁。丸めて 0.0 になるものは `±0`） */
export function formatDiff(diff: number): string {
  const r = Math.round(diff * 10) / 10;
  if (r === 0) return '±0';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}`;
}

/**
 * 期待との差の注意度（管理者向けの色分け）。表示と同じ小数1桁に丸めて判定する。
 * - normal: −1.5 より大きい（普通の揺らぎ。説明不要）
 * - watch: −1.5〜−2.4（やや少ない。様子を見る）
 * - alert: −2.5 以下（明らかに少ない。声かけ・調整）
 */
export type ExpectedDiffTone = 'normal' | 'watch' | 'alert';

export function expectedDiffTone(diff: number): ExpectedDiffTone {
  const r = Math.round(diff * 10) / 10;
  if (r <= -2.5) return 'alert';
  if (r <= -1.5) return 'watch';
  return 'normal';
}

/**
 * 経過表示を打ち切る分数。実データ（20人3コート）の最大待ちが空き11試合≒25分で、
 * 通常の配置で 30 分を超える待ちはほぼ出ない（超えるのは休憩・離席など配置外の理由）。
 * それ以上の細かい値は判断に使わないので `30分+` にまとめる。
 */
export const SINCE_LAST_GAME_CAP_MINUTES = 30;

/**
 * 「試合から時間が経った順」用の2段目表示。
 * 試合中 → `試合中`、未試合（lastPlayedAt=0）→ `未試合`、30分未満 → `前回 25分前`、
 * 30分以上 → `前回 30分+前`。
 */
export function formatSinceLastGame(lastPlayedAt: number, inCourt: boolean, now: number): string {
  if (inCourt) return '試合中';
  if (!lastPlayedAt || lastPlayedAt <= 0) return '未試合';
  const minutes = Math.max(0, Math.floor((now - lastPlayedAt) / 60000));
  if (minutes >= SINCE_LAST_GAME_CAP_MINUTES) return `前回 ${SINCE_LAST_GAME_CAP_MINUTES}分+前`;
  return `前回 ${minutes}分前`;
}

/** 期待との差の色分け（normal=揺らぎ / watch=様子見 / alert=声かけ・調整）。参加者管理と予約追加で共用 */
export const EXPECTED_DIFF_TONE_CLASS: Record<ExpectedDiffTone, string> = {
  normal: 'text-muted-foreground',
  watch: 'text-amber-600',
  alert: 'text-red-600',
};

/** 並び順の種別。expected = 期待差、lastGame = 経過時間 */
export type GameSortMode = 'expected' | 'lastGame';
