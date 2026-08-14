import type { Session } from '../types/session';
import { median } from './median';

/** 月フィルタの「直近2ヶ月(60日)」を表す sentinel 値（月初 Unix ms と区別するため文字列） */
export const RECENT_MONTHS = 'recent';
/** 「直近2ヶ月」の実体（日数） */
export const RECENT_WINDOW_DAYS = 60;
const RECENT_WINDOW_MS = RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** 月フィルタの選択値。月初 Unix ms もしくは「直近2ヶ月」 */
export type MonthFilterValue = number | typeof RECENT_MONTHS;

/**
 * 月フィルタ「直近2ヶ月」の表示ラベル。3軸を1行に並べる `<select>` の幅
 * （約80px）に収める必要があるため、意味は同じで短い「直近60日」を使う。
 */
export const RECENT_MONTHS_LABEL = `直近${RECENT_WINDOW_DAYS}日`;

/**
 * セッション選択画面のフィルタ状態。各軸 null = 「すべて」（絞り込みなし）。
 */
export interface SessionFilterState {
  gym: string | null;
  practiceType: string | null;
  month: MonthFilterValue | null;
}

/** 画面初期表示のフィルタ。月は「直近2ヶ月(60日)」をデフォルト選択にする */
export const DEFAULT_SESSION_FILTER: SessionFilterState = {
  gym: null,
  practiceType: null,
  month: RECENT_MONTHS,
};

/** 全軸「すべて」（絞り込みなし）のフィルタ。「フィルタをクリア」の戻り先 */
export const CLEARED_SESSION_FILTER: SessionFilterState = {
  gym: null,
  practiceType: null,
  month: null,
};

/** `<select>` の文字列値を月フィルタ値へ戻す。null / 空文字（＝すべて）は null */
export function parseMonthFilterValue(value: string | null): MonthFilterValue | null {
  if (value === null || value === '') return null;
  return value === RECENT_MONTHS ? RECENT_MONTHS : Number(value);
}

/**
 * `ts` が「直近2ヶ月(60日)」の窓に入るか。
 * 上限は設けないため、未来（これから開催）のセッションは常に含む。
 */
export function isWithinRecentMonths(ts: number, now: number): boolean {
  return ts >= now - RECENT_WINDOW_MS;
}

/**
 * 練習種別の表示ラベルを解決する。
 * 1. session.practiceType（実データ）
 * 2. config.gameMode から派生（singles → 単 / doubles → 複）
 * 3. どちらも無ければ「不明」
 */
export function resolvePracticeTypeLabel(session: Session): string {
  if (session.practiceType) return session.practiceType;
  if (session.config.gameMode === 'singles') return '単';
  if (session.config.gameMode === 'doubles') return '複';
  return '不明';
}

/** Unix ms タイムスタンプをローカル月初 0:00 (Unix ms) に丸める */
export function startOfMonth(ts: number): number {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 月初タイムスタンプを「YYYY年M月」形式にフォーマットする */
export function formatMonthLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

/** フィルタ各軸の選択肢（`sessions` に実在する値のみ、distinct）。月は昇順ソート */
export function deriveFilterOptions(sessions: Session[]): {
  gyms: string[];
  practiceTypes: string[];
  months: number[];
} {
  const gyms = new Set<string>();
  const practiceTypes = new Set<string>();
  const months = new Set<number>();

  for (const session of sessions) {
    if (session.config.gym) gyms.add(session.config.gym);
    practiceTypes.add(resolvePracticeTypeLabel(session));
    months.add(startOfMonth(session.config.practiceStartTime));
  }

  return {
    gyms: Array.from(gyms),
    practiceTypes: Array.from(practiceTypes),
    months: Array.from(months).sort((a, b) => a - b),
  };
}

/**
 * `filter` の各軸を AND で適用して `sessions` を絞り込む。軸が null なら無視。
 * `now` は「直近2ヶ月」の基準時刻（呼び出し側の now tick を渡す）。
 */
export function applySessionFilters(
  sessions: Session[],
  filter: SessionFilterState,
  now: number = Date.now(),
): Session[] {
  return sessions.filter((session) => {
    if (filter.gym !== null && session.config.gym !== filter.gym) return false;
    if (filter.practiceType !== null && resolvePracticeTypeLabel(session) !== filter.practiceType) {
      return false;
    }
    if (filter.month === RECENT_MONTHS) {
      if (!isWithinRecentMonths(session.config.practiceStartTime, now)) return false;
    } else if (
      filter.month !== null &&
      startOfMonth(session.config.practiceStartTime) !== filter.month
    ) {
      return false;
    }
    return true;
  });
}

/**
 * 絞り込み後のセッション群の実績サマリ。
 *
 * `median` は **開催（セッション）を1データ点とした中央値**、つまり各開催の
 * `medianGamesPlayed`（＝その開催で1試合以上した人の試合数中央値）を並べたものの
 * 中央値。開催間の比較が目的なので、参加人数の多い開催に引きずられないよう
 * プレイヤー単位でプールせず開催単位で数える。
 *
 * 試合数ゼロの開催（これから開催 / 中止など `medianGamesPlayed` が undefined
 * または 0）は母集団から除外する。含めると中央値が実態より低く出るため。
 * 該当開催が0件なら `median` は undefined（呼び出し側で非表示）。
 *
 * 中央値の中央値は偶数件で .25 刻みになり得るため小数第1位に丸める。
 */
export function summarizeSessionMedians(sessions: Session[]): {
  median: number | undefined;
  sessionCount: number;
} {
  const values = sessions
    .map((s) => s.medianGamesPlayed)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  if (values.length === 0) return { median: undefined, sessionCount: 0 };
  return { median: Math.round(median(values) * 10) / 10, sessionCount: values.length };
}
