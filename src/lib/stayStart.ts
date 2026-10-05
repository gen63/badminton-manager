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
 * 2b. 会費・名簿とも完了 & 遅刻救済の倍率 `lateReliefRatio` あり & 練習開始時刻あり（> 0）
 *    → `min(now, practiceStartTime + round((従来の起点 - practiceStartTime) × ratio))`
 *    到着前に予約しておき、受付完了時に自動で効く（従来の起点は known/unknown どちらでも 3・4 の値）。
 *    `stayStartOffsetMin` とは排他（両方ある場合は offset を優先）。
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
  const ratio = player.lateReliefRatio;
  if (ratio !== undefined && Number.isFinite(ratio) && practiceStartTime > 0) {
    return Math.min(now, applyLateRelief(actual.start, practiceStartTime, ratio));
  }
  return actual.start;
}

/**
 * 遅刻救済の倍率を当てた起点: `practiceStartTime + round((actualStart - practiceStartTime) × ratio)`。
 * 実際の遅刻が 0 以下なら練習開始のまま。ratio は 0〜1 に丸める。
 */
export function applyLateRelief(actualStart: number, practiceStartTime: number, ratio: number): number {
  const late = actualStart - practiceStartTime;
  if (late <= 0) return practiceStartTime;
  const r = Math.min(1, Math.max(0, ratio));
  return practiceStartTime + Math.round(late * r);
}

/** 救済の倍率が有効な値か（有限で 0〜1） */
export function isValidLateReliefRatio(ratio: unknown): ratio is number {
  return typeof ratio === 'number' && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1;
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
  if (player.stayStartOffsetMin === undefined && player.lateReliefRatio === undefined) return false;
  const actual = resolveActualStayStart(player, practiceStartTime, now);
  if (actual.status === 'notArrived') return false;
  return resolveStayStart(player, practiceStartTime, now) !== actual.start;
}

/**
 * 未到着（会費・名簿未完了）で遅刻救済の倍率が予約されているか。参加者一覧の「遅刻連絡」バッジ用。
 * 練習開始時刻が無いセッションでは倍率が効かないので false。
 */
export function isLateReliefReserved(player: Player, practiceStartTime: number, now: number): boolean {
  if (player.lateReliefRatio === undefined || !(practiceStartTime > 0)) return false;
  return resolveActualStayStart(player, practiceStartTime, now).status === 'notArrived';
}

/** 練習開始からの遅刻分（分単位で四捨五入、0 以上） */
export function lateMinutes(start: number, practiceStartTime: number): number {
  return Math.max(0, Math.round((start - practiceStartTime) / 60000));
}

/** 救済ボタン（遅刻幅に掛ける倍率） */
export const RELIEF_RATIOS: ReadonlyArray<{ label: string; ratio: number }> = [
  { label: '1/2', ratio: 1 / 2 },
  { label: '1/3', ratio: 1 / 3 },
  { label: '0', ratio: 0 },
];

/** 倍率の表示（1/2・1/3・0。それ以外は %） */
export function formatReliefRatio(ratio: number): string {
  const hit = RELIEF_RATIOS.find((o) => Math.abs(o.ratio - ratio) < 1e-9);
  return hit ? hit.label : `${Math.round(ratio * 100)}%`;
}

/** 未到着で倍率を選んだときの注記 */
export function reliefReservationNote(ratio: number): string {
  return `受付完了時に遅刻幅を ${formatReliefRatio(ratio)} にします`;
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
 * - 両方: `遅刻 40分 → 20分（-20分）`（調整後の方が遅ければ `+`、同じなら `±0分`）。倍率指定時は `（1/2）`
 * - 調整のみ（受付完了時刻なし）: `調整後の遅刻 20分`
 * - どちらもなし: 空文字
 */
export function describeLateChange(
  actualLate: number | null,
  overrideLate: number | null,
  /** 救済の倍率で調整しているとき。両方あれば差分の代わりに `（1/2）` と出す */
  ratio?: number,
): string {
  if (actualLate === null) {
    return overrideLate === null ? '' : `調整後の遅刻 ${overrideLate}分`;
  }
  if (overrideLate === null) {
    return actualLate > 0 ? `遅刻 ${actualLate}分` : '遅刻なし';
  }
  if (ratio !== undefined) {
    return `遅刻 ${actualLate}分 → ${overrideLate}分（${formatReliefRatio(ratio)}）`;
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
 * 救済グループ（遅刻幅 1/2・1/3・0）を出すか。UI の表示条件のみで、公平計算（resolveStayStart）には影響しない。
 * - 未到着（notArrived）: 常に出す（遅刻連絡を受けた時点で予約できるように。猶予は適用しない）
 * - 倍率が設定済み: 常に出す（選択状態を見せるため）
 * - それ以外: 実際の遅刻が猶予（`RELIEF_GRACE_MIN`）を超える場合だけ。受付完了時刻が分からない（null）なら出さない
 */
export function showReliefOptions(
  status: ActualStayStart['status'],
  actualLateMin: number | null,
  hasRatio: boolean,
): boolean {
  if (status === 'notArrived' || hasRatio) return true;
  return actualLateMin !== null && actualLateMin > RELIEF_GRACE_MIN;
}

/** 到着調整の保存内容（undefined＝変更なし / null＝解除 / 値＝設定） */
export interface ArrivalAdjustmentUpdate {
  stayStartOffsetMin?: number | null;
  lateReliefRatio?: number | null;
}

/**
 * 編集モーダルの初期値と現在値から、到着調整の保存内容を決める（変更の有無はここだけで判定する）。
 * 倍率（ratio）と時刻（offsetText＝HH:MM、空文字＝なし）は排他で、倍率を選んでいる間は時刻を使わない。
 * 時刻の形式が不正なら 'invalid'。
 */
export function buildArrivalAdjustmentUpdate(
  initial: { ratio: number | null; offsetText: string },
  current: { ratio: number | null; offsetText: string },
  parseOffset: (hhmm: string) => number | null,
): ArrivalAdjustmentUpdate | 'invalid' {
  if (current.ratio !== null) {
    // 倍率を選んでいる（offset は computeUpdatePlayer が削除する）
    return current.ratio === initial.ratio ? {} : { lateReliefRatio: current.ratio };
  }
  const offsetChanged = current.offsetText !== initial.offsetText || initial.ratio !== null;
  if (current.offsetText !== '' && offsetChanged) {
    const offset = parseOffset(current.offsetText);
    if (offset === null) return 'invalid';
    // 時刻を設定（倍率は computeUpdatePlayer が削除する）
    return { stayStartOffsetMin: offset };
  }
  if (current.offsetText === '') {
    if (initial.ratio !== null) return { lateReliefRatio: null };
    if (initial.offsetText !== '') return { stayStartOffsetMin: null };
  }
  return {};
}
