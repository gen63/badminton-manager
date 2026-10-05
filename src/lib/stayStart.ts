import type { Player } from '../types/player';

// algorithm.ts（配置）と playerStats.ts（表示用の統計・期待試合数）の両方から使うため、
// 循環 import を避けて独立モジュールに置く。

/**
 * 滞在時間モードでの「滞在開始時刻」を決定する。
 *
 * 会費・名簿が未対応のまま滞在時間だけが積み上がり、対応済みの人より
 * 優先されてしまう不公平を避けるため、起点は「休憩解除時刻」ではなく
 * 「会費・名簿が両方完了した時刻」を基準にする。3ケース:
 *
 * 1. 会費・名簿とも完了 & `opsCompletedAt` あり
 *    → `max(practiceStartTime, opsCompletedAt)`
 * 2. 会費・名簿とも完了 & `opsCompletedAt` なし（このフィールド追加前に
 *    完了した既存セッション互換）→ `max(practiceStartTime, activatedAt ?? now)`（従来どおり）
 * 3. 会費・名簿のどちらか未完了
 *    → `now`（＝滞在時間ゼロ扱い。下限5分ペナルティが効く）
 *
 * さらに管理者が「みなし開始時刻」(`stayStartOverrideAt`) を設定している場合は、
 * 会費・名簿が完了していることを前提に 1・2 より優先して
 * `min(now, max(practiceStartTime, stayStartOverrideAt))` を使う。
 * 遅刻連絡があった人は実際の到着より早く、体調不良などで控えめにしたい人は遅く設定する
 * （実際の到着より早くも遅くもできる）。未完了なら設定があっても 3（now）のまま。
 *
 * 詳細: docs/plans/2026-08-11-stay-start-at-ops-complete.md /
 *       docs/plans/2026-10-05-stay-start-override.md
 */
export function resolveStayStart(player: Player, practiceStartTime: number, now: number): number {
  const actual = resolveActualStayStart(player, practiceStartTime, now);
  if (actual === null) {
    return now;
  }
  if (player.stayStartOverrideAt !== undefined) {
    return Math.min(now, Math.max(practiceStartTime, player.stayStartOverrideAt));
  }
  return actual;
}

/**
 * みなし開始時刻を無視した、従来ルールでの「実際の」滞在開始時刻（＝実際の到着扱い）。
 * 会費・名簿のどちらかが未完了なら null（未到着）。
 * - `opsCompletedAt` あり → `max(practiceStartTime, opsCompletedAt)`
 * - なし（既存セッション互換）→ `max(practiceStartTime, activatedAt ?? now)`
 */
export function resolveActualStayStart(player: Player, practiceStartTime: number, now: number): number | null {
  const opsComplete = player.operationStatus?.payment === true && player.operationStatus?.roster === true;
  if (!opsComplete) {
    return null;
  }
  if (player.opsCompletedAt !== undefined) {
    return Math.max(practiceStartTime, player.opsCompletedAt);
  }
  return Math.max(practiceStartTime, player.activatedAt ?? now);
}

/** 練習開始からの遅刻分（分単位で四捨五入、0 以上） */
export function lateMinutes(start: number, practiceStartTime: number): number {
  return Math.max(0, Math.round((start - practiceStartTime) / 60000));
}

/**
 * 遅刻救済のクイックボタン用。実際の遅刻分に比率を掛けた「みなし開始時刻」を返す
 * （練習開始 + round(遅刻分 × ratio) 分）。例: ratio=1/2 で遅刻幅を半分、0 で遅刻なしとみなす。
 */
export function reliefOverrideAt(actualStart: number, practiceStartTime: number, ratio: number): number {
  const late = lateMinutes(actualStart, practiceStartTime);
  return practiceStartTime + Math.round(late * ratio) * 60000;
}

/** epoch ms → `<input type="time">` 用の `HH:MM`（端末ローカル時刻）。未設定は空文字 */
export function formatStayOverrideTime(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * `<input type="time">` の `HH:MM` を、練習日（`practiceStartTime` の日付。未設定なら `fallbackNow` の日付）
 * と組み合わせて epoch ms に変換する（端末ローカル時刻）。空・不正な形式は null。
 */
export function parseStayOverrideTime(
  value: string,
  practiceStartTime: number | undefined,
  fallbackNow: number = Date.now(),
): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const base = new Date(practiceStartTime && practiceStartTime > 0 ? practiceStartTime : fallbackNow);
  base.setHours(h, min, 0, 0);
  return base.getTime();
}

/**
 * 編集モーダルに出す遅刻幅の推移の文言。
 * - 実際のみ: `遅刻 40分` / `遅刻なし`
 * - 両方: `遅刻 40分 → 20分（-20分）`（みなしの方が遅ければ `+`、同じなら `±0分`）
 * - みなしのみ（未到着）: `みなし遅刻 20分`
 * - どちらもなし: 空文字
 */
export function describeLateChange(actualLate: number | null, overrideLate: number | null): string {
  if (actualLate === null) {
    return overrideLate === null ? '' : `みなし遅刻 ${overrideLate}分`;
  }
  if (overrideLate === null) {
    return actualLate > 0 ? `遅刻 ${actualLate}分` : '遅刻なし';
  }
  const diff = overrideLate - actualLate;
  const diffText = diff === 0 ? '±0分' : `${diff > 0 ? '+' : '-'}${Math.abs(diff)}分`;
  return `遅刻 ${actualLate}分 → ${overrideLate}分（${diffText}）`;
}
