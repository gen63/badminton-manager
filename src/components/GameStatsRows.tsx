import type { ReactNode } from 'react';
import {
  EXPECTED_DIFF_TONE_CLASS,
  expectedDiffTone,
  formatDiff,
  formatExpected,
  formatSinceLastGame,
  formatStayMinutes,
  type ExpectedGames,
  type GameSortMode,
  type StayInfo,
} from '../lib/playerStats';

interface GameStatsRowsProps {
  /** 1段目の左（性別・名前など）。残り幅を使う */
  children: ReactNode;
  gamesPlayed: number;
  sortMode: GameSortMode;
  /** 滞在時間モードのときの滞在情報（回数平均モードは undefined） */
  stay: StayInfo | undefined;
  expected: ExpectedGames | undefined;
  lastPlayedAt: number;
  inCourt: boolean;
  now: number;
  /** 2段目左に出す注意書き（予約ゲートの警告など）。あれば経過・滞在表示の前に並べる */
  note?: ReactNode;
}

/**
 * 参加者の2段表示（参加者管理カードと予約追加の行で共用。表記と配置をここで一元化する）。
 * - 1段目: 左 = children / 右端 = 「N試合」
 * - 2段目: 左 = 経過時間ソート時「前回 25分前（30分以上は 30分+前） / 試合中 / 未試合」、期待差ソート時は滞在時間モードなら
 *   「滞在 2:40 (94%) / 滞在 —（未完了）」（回数平均モードは空。到着調整が効いている人は「到着調整」目印を添える）/ 右 = 「期待 x.x (±y.y)」（差の色分け、常に表示）
 * 文字は 11px・同じ太さ・tabular-nums。
 */
export function GameStatsRows({
  children,
  gamesPlayed,
  sortMode,
  stay,
  expected,
  lastPlayedAt,
  inCourt,
  now,
  note,
}: GameStatsRowsProps) {
  const left =
    sortMode === 'lastGame'
      ? formatSinceLastGame(lastPlayedAt, inCourt, now)
      : stay &&
        (stay.complete
          ? `滞在 ${formatStayMinutes(stay.minutes)}${stay.percent !== null ? ` (${stay.percent}%)` : ''}`
          : '滞在 —（未完了）');
  // 管理者の到着調整が実際に効いている人は、滞在表示の横に小さな目印を出す（全員に表示）
  const showOverrideMark = sortMode !== 'lastGame' && !!stay?.overridden && stay.complete;
  // 未到着で遅刻救済の倍率を予約している人には「遅刻連絡」の目印（受付完了で到着調整に切り替わる）
  const showReliefReservedMark = sortMode !== 'lastGame' && !!stay?.reliefReserved && !stay.complete;
  const hasExpected = !!expected && expected.expected !== null && expected.diff !== null;

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-0.5 text-[11px] leading-tight tabular-nums text-left">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">{children}</div>
        <span className="flex-shrink-0 text-right whitespace-nowrap text-foreground">{gamesPlayed}試合</span>
      </div>
      <div className="flex items-center gap-2">
        {note}
        {left && <span className="whitespace-nowrap text-muted-foreground">{left}</span>}
        {showOverrideMark && (
          <span
            title="到着調整中（滞在時間モードの公平計算で、受付完了時刻の代わりに管理者が設定した開始時刻を使っています）"
            className="shrink-0 px-1 py-0.5 rounded text-[10px] leading-none bg-primary/10 text-primary"
          >
            到着調整
          </span>
        )}
        {showReliefReservedMark && (
          <span
            title="遅刻連絡あり（受付完了時に遅刻幅の救済を自動で適用します）"
            className="shrink-0 px-1 py-0.5 rounded text-[10px] leading-none bg-primary/10 text-primary"
          >
            遅刻連絡
          </span>
        )}
        <span
          className={`ml-auto shrink-0 text-right whitespace-nowrap ${
            hasExpected ? EXPECTED_DIFF_TONE_CLASS[expectedDiffTone(expected!.diff!)] : ''
          }`}
        >
          {hasExpected && `期待 ${formatExpected(expected!.expected!)} (${formatDiff(expected!.diff!)})`}
        </span>
      </div>
    </div>
  );
}
