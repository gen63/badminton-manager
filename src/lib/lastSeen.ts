/** 参加者管理ページの「最終画面参照からの経過時間」バッジの色味カテゴリ */
export type LastSeenTone = 'live' | 'recent' | 'stale' | 'never';

/** 経過時間表示用のラベルとトーン */
export interface LastSeenView {
  label: string;
  tone: LastSeenTone;
}

/** 「閲覧中」と見なす経過時間の上限 (ms) */
const LIVE_WINDOW_MS = 90_000;
/** 「直近」（stale ではない）と見なす経過時間の上限 (ms) */
const RECENT_WINDOW_MS = 15 * 60 * 1000;
/** 分表示から時間表示に切り替える経過時間 (ms) */
const HOUR_MS = 60 * 60 * 1000;
/** これ以上は「1日以上前」にまとめる経過時間 (ms) */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `lastSeenAt`（最終画面参照時刻, Unix ms）から現在時刻 `now` までの経過時間を
 * 参加者管理ページ用の表示（ラベル + トーン）に整形する。
 *
 * - `lastSeenAt` が `undefined` / 数値でない場合は「未閲覧」
 * - クライアント時計のずれで未来時刻になった場合は負値を表示せず「閲覧中」扱い
 * - 90秒以内は「閲覧中」、15分未満は「N分前」、15分以上は放置扱いで「N分前」/「N時間前」、
 *   24時間以上は「1日以上前」にまとめる（セッションは実質半日のため上限表記で十分）
 */
export function formatLastSeen(lastSeenAt: number | undefined, now: number): LastSeenView {
  if (typeof lastSeenAt !== 'number' || Number.isNaN(lastSeenAt)) {
    return { label: '未閲覧', tone: 'never' };
  }

  const diff = now - lastSeenAt;

  // 未来時刻（クライアント時計ずれ）は負値を表示せず「閲覧中」扱い
  if (diff <= LIVE_WINDOW_MS) {
    return { label: '閲覧中', tone: 'live' };
  }

  if (diff < RECENT_WINDOW_MS) {
    const minutes = Math.floor(diff / 60_000);
    return { label: `${minutes}分前`, tone: 'recent' };
  }

  if (diff < HOUR_MS) {
    const minutes = Math.floor(diff / 60_000);
    return { label: `${minutes}分前`, tone: 'stale' };
  }

  if (diff < DAY_MS) {
    const hours = Math.floor(diff / HOUR_MS);
    return { label: `${hours}時間前`, tone: 'stale' };
  }

  return { label: '1日以上前', tone: 'stale' };
}
