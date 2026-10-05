import type { Player } from '../types/player';
import { formatHHMM, timeOnSameDay } from './practiceEndPhase';

// algorithm.ts（配置）と playerStats.ts（表示用の統計・期待試合数）の両方から使うため、
// 循環 import を避けて独立モジュールに置く。

/**
 * 滞在時間モードでの「滞在開始時刻」を決定する。
 *
 * 会費・名簿が未対応のまま滞在時間だけが積み上がり、対応済みの人より
 * 優先されてしまう不公平を避けるため、起点は「休憩解除時刻」ではなく
 * 「会費・名簿が両方完了した時刻」を基準にする。上から順に:
 *
 * 1. 会費・名簿のどちらか未完了
 *    → `now`（＝滞在時間ゼロ扱い。下限5分ペナルティが効く）。到着調整があっても同じ
 * 2. 会費・名簿とも完了 & 管理者の到着調整 `stayStartOffsetMin` あり & 練習開始時刻あり（> 0）
 *    → `min(now, practiceStartTime + max(0, stayStartOffsetMin) 分)`
 *    遅刻連絡があった人は実際より早く、体調不良などで控えめにしたい人は遅く設定する。
 *    練習開始時刻からの分数で持つので、練習の日付・開始時刻を変えても遅刻幅が保たれる。
 * 3. 会費・名簿とも完了 & `opsCompletedAt` あり
 *    → `max(practiceStartTime, opsCompletedAt)`
 * 4. 会費・名簿とも完了 & `opsCompletedAt` なし（このフィールド追加前に
 *    完了した既存セッション互換）→ `max(practiceStartTime, activatedAt ?? now)`（従来どおり）
 *
 * 詳細: docs/plans/2026-08-11-stay-start-at-ops-complete.md /
 *       docs/plans/2026-10-05-stay-start-override.md
 */
export function resolveStayStart(player: Player, practiceStartTime: number, now: number): number {
  const actual = resolveActualStayStart(player, practiceStartTime, now);
  if (actual.status === 'notArrived') {
    return now;
  }
  const offset = player.stayStartOffsetMin;
  if (offset !== undefined && Number.isFinite(offset) && practiceStartTime > 0) {
    return Math.min(now, practiceStartTime + Math.max(0, offset) * 60000);
  }
  return actual.start;
}

/**
 * 到着調整を無視した、従来ルールでの起点（受付完了＝会費・名簿の両方完了）。
 * - `notArrived`: 会費・名簿のどちらかが未完了
 * - `known`: 受付完了時刻が分かる（`opsCompletedAt`、または到着記録 `activatedAt` > 0 の既存データ）
 * - `unknown`: どちらも無く、練習開始または now に落ちている（表示は「不明」）
 * `start` はいずれも従来ルールの値（`resolveStayStart` の調整なしの結果と同じ）。
 */
export type ActualStayStart =
  | { status: 'notArrived' }
  | { status: 'known'; start: number }
  | { status: 'unknown'; start: number };

export function resolveActualStayStart(player: Player, practiceStartTime: number, now: number): ActualStayStart {
  const opsComplete = player.operationStatus?.payment === true && player.operationStatus?.roster === true;
  if (!opsComplete) {
    return { status: 'notArrived' };
  }
  if (player.opsCompletedAt !== undefined) {
    return { status: 'known', start: Math.max(practiceStartTime, player.opsCompletedAt) };
  }
  const start = Math.max(practiceStartTime, player.activatedAt ?? now);
  return player.activatedAt ? { status: 'known', start } : { status: 'unknown', start };
}

/**
 * 到着調整が実際に効いているか（＝調整ありの起点が従来ルールの起点と異なるか）。
 * 練習開始時刻が無い・未完了・頭打ちで結果が変わらない場合は false。参加者一覧の「到着調整」バッジ用。
 */
export function isStayStartAdjusted(player: Player, practiceStartTime: number, now: number): boolean {
  if (player.stayStartOffsetMin === undefined) return false;
  const actual = resolveActualStayStart(player, practiceStartTime, now);
  if (actual.status === 'notArrived') return false;
  return resolveStayStart(player, practiceStartTime, now) !== actual.start;
}

/** 練習開始からの遅刻分（分単位で四捨五入、0 以上） */
export function lateMinutes(start: number, practiceStartTime: number): number {
  return Math.max(0, Math.round((start - practiceStartTime) / 60000));
}

/**
 * 遅刻救済のクイックボタン用。実際の遅刻分に比率を掛けた到着調整（練習開始からの分数）を返す
 * （`round(遅刻分 × ratio)`）。例: ratio=1/2 で遅刻幅を半分、0 で遅刻なしとみなす。
 */
export function reliefOffsetMin(actualLateMin: number, ratio: number): number {
  return Math.round(Math.max(0, actualLateMin) * ratio);
}

/** 到着調整（練習開始からの分数）→ `<input type="time">` 用の `HH:MM`（練習開始時刻＋分数）。未設定は空文字 */
export function formatStayOffsetTime(offsetMin: number | undefined, practiceStartTime: number): string {
  if (offsetMin === undefined || !Number.isFinite(offsetMin) || !(practiceStartTime > 0)) return '';
  return formatHHMM(practiceStartTime + Math.max(0, offsetMin) * 60000);
}

/** 開始時刻より前の入力をこの差以上なら翌日とみなす（12時間） */
const NEXT_DAY_THRESHOLD_MS = 12 * 60 * 60 * 1000;

/**
 * `<input type="time">` の `HH:MM` を、練習開始からの分数（整数、0 以上）に変換する。
 * - 練習開始と同じ日付で解釈する。
 * - 開始より前で、差が 12 時間以上なら翌日とみなす（日付をまたぐ練習: 23:00 開始で 00:30 → 90分）。
 * - 開始より前で、差が 12 時間未満なら「開始前に受付＝遅刻なし」として 0（19:00 開始で 18:50 → 0）。
 * 空・不正な形式・練習開始時刻なしは null。
 */
export function parseStayOffsetTime(hhmm: string, practiceStartTime: number): number | null {
  if (!(practiceStartTime > 0)) return null;
  let t = timeOnSameDay(practiceStartTime, hhmm);
  if (t === null) return null;
  if (t < practiceStartTime && practiceStartTime - t >= NEXT_DAY_THRESHOLD_MS) {
    t += 24 * 60 * 60 * 1000;
  }
  return Math.max(0, Math.round((t - practiceStartTime) / 60000));
}

/**
 * 編集モーダルに出す遅刻幅の推移の文言（`actualLate` は受付完了時刻が分からなければ null）。
 * - 実際のみ: `遅刻 40分` / `遅刻なし`
 * - 両方: `遅刻 40分 → 20分（-20分）`（調整後の方が遅ければ `+`、同じなら `±0分`）
 * - 調整のみ（受付完了時刻なし）: `調整後の遅刻 20分`
 * - どちらもなし: 空文字
 */
export function describeLateChange(actualLate: number | null, overrideLate: number | null): string {
  if (actualLate === null) {
    return overrideLate === null ? '' : `調整後の遅刻 ${overrideLate}分`;
  }
  if (overrideLate === null) {
    return actualLate > 0 ? `遅刻 ${actualLate}分` : '遅刻なし';
  }
  const diff = overrideLate - actualLate;
  const diffText = diff === 0 ? '±0分' : `${diff > 0 ? '+' : '-'}${Math.abs(diff)}分`;
  return `遅刻 ${actualLate}分 → ${overrideLate}分（${diffText}）`;
}

/**
 * 控えめ（遅れて来たとみなす）クイックボタン用。到着調整 = 実際の遅刻分 + `addMin` 分。
 * 実際の起点を基準に計算するので、何度押しても累積しない。
 * 調整後の開始が練習終了時刻（`practiceEndTime`、> 0 のとき）以降になる場合は滞在が 0 になり
 * 意味がないため `disabled: true`（ボタンを無効化する）。
 */
export function restrainOffsetOption(
  actualLateMin: number,
  addMin: number,
  practiceStartTime: number,
  practiceEndTime?: number,
): { offsetMin: number; disabled: boolean } {
  const offsetMin = Math.max(0, actualLateMin) + addMin;
  const disabled =
    practiceEndTime !== undefined && practiceEndTime > 0 && practiceStartTime + offsetMin * 60000 >= practiceEndTime;
  return { offsetMin, disabled };
}

/** 遅刻幅の変化の効果（縮んだ＝救済 / 増えた＝控えめ / 変化なし・未入力は null） */
export type LateChangeEffect = 'easier' | 'restrained' | null;

export function lateChangeEffect(actualLate: number | null, overrideLate: number | null): LateChangeEffect {
  if (actualLate === null || overrideLate === null || actualLate === overrideLate) return null;
  return overrideLate < actualLate ? 'easier' : 'restrained';
}

/** 効果の一言注記（null は出さない） */
export const LATE_CHANGE_EFFECT_TEXT: Record<Exclude<LateChangeEffect, null>, string> = {
  easier: '→ 試合に入りやすくなります',
  restrained: '→ 試合数が控えめになります',
};

/** 救済ボタンを出さない遅刻の猶予（分）。開始から10分以内の受付完了は「概ね時間どおり」とみなす */
export const RELIEF_GRACE_MIN = 10;

/**
 * 救済グループ（遅刻幅 1/2・1/3・0）を出すか。実際の遅刻が猶予（`RELIEF_GRACE_MIN`）を超える場合だけ true。
 * 受付完了時刻が分からない（null）なら false。UI の表示条件のみで、公平計算（resolveStayStart）には影響しない。
 */
export function showReliefOptions(actualLateMin: number | null): boolean {
  return actualLateMin !== null && actualLateMin > RELIEF_GRACE_MIN;
}
