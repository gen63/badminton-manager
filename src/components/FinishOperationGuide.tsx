import { useEffect, useState } from 'react';
import { StopCircle } from 'lucide-react';
import type { Court } from '../types/court';
import type { Player } from '../types/player';
import {
  buildFinishOperationGuide,
  buildFinishOperationGuideHeadline,
  getNextFinishGuideDelay,
} from '../lib/finishOperationGuide';

interface FinishOperationGuideProps {
  courts: Court[];
  /** 配置予測の「ほぼ確定」メンバー ID（`NextMatchPredictionBar` の濃い青と同じ集合） */
  certainIds: Set<string>;
  /** 名前解決と表示順に使う。`predictedPlayers`（入りやすい順）をそのまま渡す */
  players: Player[];
  /** 自分の Player ID。特定できないときは null */
  selfPlayerId: string | null;
  /** コート番号を出すか（1面運用では冗長なので出さない） */
  showCourtNumber: boolean;
}

/**
 * 「終了操作をお願いします」の継続表示。
 *
 * 「気づいた人が終了操作をする」運用から「次の試合に入るメンバー（配置予測の
 * 濃い青）が終了操作をする」運用へ変えるための常時案内。4:30 の呼び出しトーストは
 * 8秒で消えてしまうため、担当が誰かをいつでも確認できる場所として画面上部に置く。
 *
 * - 4:30 未満: 控えめな1行で担当だけ示す（どのコートが終わるかはまだ分からない）
 * - 4:30 以降: オレンジで強調し「Nコート脇で終了操作をお願いします」に変える
 *   （同じ閾値でコートカードの外枠も太くなるので見た目が連動する）
 * - 自分が担当なら枠を強調し、自分の名前チップを塗る
 *
 * 見た目が変わるのは閾値を跨ぐ瞬間だけなので、`CourtCardFrame` と同様に毎秒
 * tick せず次の閾値までの `setTimeout` を1本だけ張る。
 */
export function FinishOperationGuide({
  courts,
  certainIds,
  players,
  selfPlayerId,
  showCourtNumber,
}: FinishOperationGuideProps) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      const current = Date.now();
      setNow(current);
      const delay = getNextFinishGuideDelay(courts, current);
      // バックグラウンド復帰などで遅れて発火しても current から再計算するので問題ない
      if (delay !== null) timer = setTimeout(tick, delay + 50);
    };

    // setState in effect の lint を避けるためマイクロタスク相当で初回を回す
    timer = setTimeout(tick, 0);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [courts]);

  const guide = buildFinishOperationGuide({ courts, certainIds, now, showCourtNumber });
  if (guide === null) return null;

  const targetIds = new Set(guide.playerIds);
  // 表示順は predictedPlayers（入りやすい順）に従う
  const targets = players.filter((p) => targetIds.has(p.id));
  if (targets.length === 0) return null;

  const isSelfTarget = selfPlayerId !== null && targetIds.has(selfPlayerId);
  const imminent = guide.phase === 'imminent';

  const containerClass = imminent
    ? 'bg-orange-50 border-orange-300 text-orange-800'
    : 'bg-muted/40 border-border text-muted-foreground';

  // 外側の余白まで含めて描画する。ガイドが無いとき（null 復帰）に空の余白行が
  // 残らないよう、呼び出し側ではなくこのコンポーネントが px/pt を持つ。
  return (
    <div className="px-4 pt-2">
      <div
        className={`rounded-xl border px-3 py-1.5 flex items-center gap-2 flex-wrap ${containerClass} ${
          isSelfTarget ? 'ring-1 ring-orange-400' : ''
        }`}
        data-phase={guide.phase}
        role="status"
      >
        <StopCircle size={14} className={`shrink-0 ${imminent ? 'text-orange-600' : ''}`} aria-hidden />
        <span className={`text-xs ${imminent ? 'font-bold' : 'font-medium'}`}>
          {buildFinishOperationGuideHeadline(guide)}
        </span>
        <span className="flex items-center gap-1 flex-wrap">
          {targets.map((player) => {
            const isSelf = player.id === selfPlayerId;
            const chipClass = isSelf
              ? 'bg-orange-600 text-white font-semibold'
              : imminent
                ? 'bg-card border border-orange-300 text-orange-800 font-medium'
                : 'bg-card border border-border text-foreground font-medium';
            return (
              <span key={player.id} className={`px-2 py-0.5 rounded-full text-xs ${chipClass}`}>
                {player.name}
              </span>
            );
          })}
        </span>
      </div>
    </div>
  );
}
