import { Sparkles } from 'lucide-react';
import type { Player } from '../types/player';

interface NextMatchPredictionBarProps {
  /** 代表シナリオのペア単位のメンバー（`[[ペアA], [ペアB], ...]`） */
  teams: Player[][];
  /** どのペアにも入らなかった候補（出現率の高い順） */
  extras: Player[];
  /** 出現率 100%（ほぼ確定）のメンバー ID。塗りチップで表示する */
  certainIds: Set<string>;
}

/**
 * 「配置予測」バー。待機中の見出し直下に置き、次に入る可能性が高いメンバーを
 * 一覧で見せて準備を促す（`src/lib/nextMatchPrediction.ts` の予測結果を表示する）。
 *
 * 並びは代表シナリオの**ペア単位**（同じチームになるであろう2人が隣り合う）。
 * どのコートが先に終わるかで結果が変わるため「ほぼ確定4人」は原理的に出せない
 * （3コート稼働・待機10人での実測は平均2人）。塗り＝どのコートが終わっても選ばれる人、
 * 枠線＝それ以外の候補、という2段階で見せる。
 * 予測が空のときは何も描画しない。
 */
export function NextMatchPredictionBar({ teams, extras, certainIds }: NextMatchPredictionBarProps) {
  const groups = [...teams.filter(t => t.length > 0), ...(extras.length > 0 ? [extras] : [])];
  const allPlayers = groups.flat();
  if (allPlayers.length === 0) return null;

  const hasCertain = allPlayers.some(p => certainIds.has(p.id));
  const hasLikely = allPlayers.some(p => !certainIds.has(p.id));

  return (
    <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl px-3 py-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
        <span className="text-xs font-bold text-indigo-900">配置予測</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {groups.map((group, index) => (
          <div key={index} className="flex flex-wrap items-center gap-1">
            {group.map((player) => (
              <span
                key={player.id}
                className={`px-2 py-0.5 rounded-full text-xs ${
                  certainIds.has(player.id)
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'bg-card border border-indigo-300 text-indigo-700 font-medium'
                }`}
              >
                {player.name}
              </span>
            ))}
          </div>
        ))}
      </div>

      {hasCertain && hasLikely && (
        <div className="flex items-center gap-2 text-[10px] text-indigo-700/80 flex-wrap">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
            ほぼ確定
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-card border border-indigo-300" />
            候補
          </span>
        </div>
      )}
    </div>
  );
}
