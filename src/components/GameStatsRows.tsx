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
 *   「滞在 2:40 (94%) / 滞在 —（未完了）」（回数平均モードは空）/ 右 = 「期待 x.x (±y.y)」（差の色分け、常に表示）
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
