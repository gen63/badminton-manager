import type { Session } from '../types/session';

/**
 * セッション選択画面のフィルタ状態。各軸 null = 「すべて」（絞り込みなし）。
 */
export interface SessionFilterState {
  gym: string | null;
  practiceType: string | null;
  month: number | null;
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

/** `filter` の各軸を AND で適用して `sessions` を絞り込む。軸が null なら無視 */
export function applySessionFilters(sessions: Session[], filter: SessionFilterState): Session[] {
  return sessions.filter((session) => {
    if (filter.gym !== null && session.config.gym !== filter.gym) return false;
    if (filter.practiceType !== null && resolvePracticeTypeLabel(session) !== filter.practiceType) {
      return false;
    }
    if (filter.month !== null && startOfMonth(session.config.practiceStartTime) !== filter.month) {
      return false;
    }
    return true;
  });
}
