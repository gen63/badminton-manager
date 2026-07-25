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

/**
 * `lastSeenAt`（最終画面参照時刻, Unix ms）から現在時刻 `now` までの経過時間を
 * 参加者管理ページ用の表示（ラベル + トーン）に整形する。
 *
 * - `lastSeenAt` が `undefined` / 数値でない場合は「未閲覧」
 * - クライアント時計のずれで未来時刻になった場合は負値を表示せず「閲覧中」扱い
 * - 90秒以内は「閲覧中」、それ以降は常に「N分前」（分単位のみ）。
 *   15分未満は `recent`、15分以上は放置扱いの `stale` としてトーンだけ切り替える。
 * - 実運用ではセッション中の放置検知用途であり、100分以上放置されるケースは
 *   想定しないため時間/日表記は持たない（分表記のみで足りる）。
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

  const minutes = Math.floor(diff / 60_000);
  return { label: `${minutes}分前`, tone: diff < RECENT_WINDOW_MS ? 'recent' : 'stale' };
}
