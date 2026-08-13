import { Sparkles } from 'lucide-react';
import type { Player } from '../types/player';

interface NextMatchPredictionBarProps {
  /** 全シナリオで選ばれたメンバー（出現率 100% = ほぼ確定） */
  certain: Player[];
  /** 半分以上のシナリオで選ばれたメンバー（候補。出現率の高い順） */
  likely: Player[];
}

/**
 * 「次の試合予測」バー。待機中の見出し直下に置き、次に入る可能性が高いメンバーを
 * 一覧で見せて準備を促す（`src/lib/nextMatchPrediction.ts` の予測結果を表示する）。
 *
 * どのコートが先に終わるかで結果が変わるため「ほぼ確定4人」は原理的に出せない
 * （3コート稼働・待機10人での実測は平均2人）。塗り＝どのコートが終わっても選ばれる人、
 * 枠線＝半分以上のケースで選ばれる人、という2段階で見せる。
 * 予測が空のときは何も描画しない。
 */
export function NextMatchPredictionBar({ certain, likely }: NextMatchPredictionBarProps) {
  if (certain.length === 0 && likely.length === 0) return null;

  return (
    <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl px-3 py-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
        <span className="text-xs font-bold text-indigo-900">次の試合予測</span>
        <span className="text-[10px] text-indigo-700/70">
          ※現在の状況からの予測です
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {certain.map((player) => (
          <span
            key={player.id}
            className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-xs font-semibold"
          >
            {player.name}
          </span>
        ))}
        {likely.map((player) => (
          <span
            key={player.id}
            className="px-2 py-0.5 rounded-full bg-card border border-indigo-300 text-indigo-700 text-xs font-medium"
          >
            {player.name}
          </span>
        ))}
      </div>

      {likely.length > 0 && (
        <div className="flex items-center gap-2 text-[10px] text-indigo-700/80 flex-wrap">
          {certain.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
              どのコートが終わっても出場
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-card border border-indigo-300" />
            候補（終わるコート次第）
          </span>
        </div>
      )}
    </div>
  );
}
