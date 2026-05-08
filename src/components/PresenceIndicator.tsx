import { useEffect, useState } from 'react';
import { Eye, Hand } from 'lucide-react';
import type { PresenceEntry } from '../types/session';

/** 45秒以上更新がなければ「閲覧中」リストからも除外 */
const VIEWING_WINDOW_MS = 45_000;
/** 最後のタップから「操作中」と表示し続ける時間 */
const ACTING_WINDOW_MS = 10_000;
/** 名前表示の最大文字数（超過時は末尾 … ） */
const NAME_MAX = 12;
/** UI 再評価の tick 間隔 */
const TICK_MS = 1_000;

interface Props {
  presence: { [username: string]: PresenceEntry };
  currentUser: string | null;
}

function truncate(name: string): string {
  if (name.length <= NAME_MAX) return name;
  return `${name.slice(0, NAME_MAX)}…`;
}

function formatNames(names: string[], suffix: string): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${truncate(names[0])}さんが${suffix}`;
  if (names.length === 2) return `${truncate(names[0])}さんと${truncate(names[1])}さんが${suffix}`;
  return `${truncate(names[0])}さん 他${names.length - 1}名が${suffix}`;
}

/**
 * 他ユーザーの在席/操作状況を表示するバッジ
 *
 * - 「操作中」: 直近 ACTING_WINDOW_MS 以内にタップしたユーザー
 * - 「閲覧中」: タップから ACTING_WINDOW_MS 以上経過、または一度もタップ無し
 * - タブを閉じる/非可視化/45秒無反応で presence ごと消え、再訪時は閲覧中に戻る
 * - 自分自身は除外
 * - 該当者ゼロなら何も描画しない
 */
export function PresenceIndicator({ presence, currentUser }: Props) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const entries = Object.entries(presence).filter(([name, entry]) => {
    if (name === currentUser) return false;
    if (!entry || typeof entry.lastSeenAt !== 'number') return false;
    return now - entry.lastSeenAt <= VIEWING_WINDOW_MS;
  });

  if (entries.length === 0) return null;

  const acting = entries
    .filter(([, e]) => typeof e.lastTapAt === 'number' && now - e.lastTapAt <= ACTING_WINDOW_MS)
    .map(([name]) => name);

  if (acting.length > 0) {
    return (
      <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 text-orange-700 rounded-full px-4 py-2 text-sm shadow-md">
        <Hand className="w-4 h-4 shrink-0 animate-pulse" aria-hidden />
        <span className="truncate">{formatNames(acting, '操作中')}</span>
      </div>
    );
  }

  const viewing = entries.map(([name]) => name);
  return (
    <div className="flex items-center gap-2 bg-card border border-border text-muted-foreground rounded-full px-4 py-2 text-sm shadow-md">
      <Eye className="w-4 h-4 shrink-0" aria-hidden />
      <span className="truncate">{formatNames(viewing, '閲覧中')}</span>
    </div>
  );
}
