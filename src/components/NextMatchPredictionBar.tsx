import type { Player } from '../types/player';

interface NextMatchPredictionBarProps {
  /** 表示するメンバー（入りやすい順 = 出現率の高い順） */
  players: Player[];
  /** 出現率 100%（ほぼ確定）のメンバー ID。塗りチップで表示する */
  certainIds: Set<string>;
  /**
   * 操作担当（`certainIds` から担当外を除いたもの）。省略時は `certainIds` と同じ。
   * 確定だが担当外の人は濃い青にせず、青枠・白背景で「確定だが担当ではない」と示す。
   */
  operatorIds?: Set<string>;
}

/**
 * 「配置予測」バー。待機中の見出し直下に置き、次に入る可能性が高いメンバーを
 * 入りやすい順に並べて見せ、準備を促す（`src/lib/nextMatchPrediction.ts` の
 * 予測結果を表示する）。
 *
 * 塗り（ほぼ確定かつ担当外でない）のメンバーが「操作担当」＝試合終了→配置→開始の操作をする人。
 * その運用ルールは常時ここに出し、画面上部のガイド（`FinishOperationGuide`）は
 * 4:30 を過ぎて「どのコート脇で待つか」が決まってからだけ出す（同じ情報を2箇所に
 * 常時出すと冗長なため）。
 *
 * どのコートが先に終わるかで結果が変わるため「ほぼ確定4人」は原理的に出せない
 * （3コート稼働・待機10人での実測は平均2人）。塗り＝どのコートが終わっても選ばれる人、
 * 枠線＝それ以外の候補、という2段階で見せる。
 * 予測が空のときは何も描画しない。
 */
export function NextMatchPredictionBar({
  players,
  certainIds,
  operatorIds = certainIds,
}: NextMatchPredictionBarProps) {
  if (players.length === 0) return null;

  const isOperator = (id: string) => operatorIds.has(id);
  // 確定だが担当外（外部メンバー・管理者設定）。塗らずに太めの青枠で区別する
  const isCertainExcluded = (id: string) => certainIds.has(id) && !operatorIds.has(id);
  const hasOperator = players.some(p => isOperator(p.id));
  const hasExcluded = players.some(p => isCertainExcluded(p.id));
  const hasLikely = players.some(p => !certainIds.has(p.id));
  const legendCount = [hasOperator, hasExcluded, hasLikely].filter(Boolean).length;

  return (
    <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl px-3 py-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-bold text-indigo-900 shrink-0">配置予測（操作担当）</span>
        {players.map((player) => (
          <span
            key={player.id}
            className={`px-2 py-0.5 rounded-full text-xs ${
              isOperator(player.id)
                ? 'bg-indigo-600 text-white font-semibold'
                : isCertainExcluded(player.id)
                  ? 'bg-card border-2 border-indigo-600 text-indigo-700 font-semibold'
                  : 'bg-card border border-indigo-300 text-indigo-700 font-medium'
            }`}
          >
            {player.name}
          </span>
        ))}
      </div>

      {legendCount >= 2 && (
        <div className="flex items-center gap-2 text-[10px] text-indigo-700/80 flex-wrap">
          {hasOperator && (
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
              ほぼ確定＝操作担当
            </span>
          )}
          {hasExcluded && (
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-card border-2 border-indigo-600" />
              ほぼ確定（担当外）
            </span>
          )}
          {hasLikely && (
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-card border border-indigo-300" />
              候補
            </span>
          )}
        </div>
      )}
    </div>
  );
}
