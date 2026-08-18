import { useEffect, useRef, useState } from 'react';
import { StopCircle } from 'lucide-react';
import type { Court } from '../types/court';
import type { Player } from '../types/player';
import {
  buildFinishOperationGuide,
  buildFinishOperationGuideHeadline,
  getNextFinishGuideDelay,
} from '../lib/finishOperationGuide';

/** 出た瞬間に光らせる時間（CSS の finish-guide-flash 0.6s × 2 回分） */
const FLASH_MS = 1_200;

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
 * 「②付近待機 操作担当」の継続表示。
 *
 * 「気づいた人が終了操作をする」運用から「次の試合に入るメンバー（配置予測の
 * 濃い青）が操作する」運用へ変えるための案内。担当に期待するのは終了 → 配置 →
 * 開始の一連なのでラベルは「操作担当」。アイコンだけ `StopCircle`
 * （`FinishGameButton` と同じ）にして、起点が終了ボタンであることを示す。
 *
 * **出るのは 4:30 を過ぎてから**。「誰が担当か」は配置予測バー
 * （`NextMatchPredictionBar`）が常時出しているので、ここでしか言えない
 * 「どのコート脇で待つか」が決まってから出す。出た瞬間だけ一度光らせて気づかせる
 * （以前この時刻に出していた8秒トーストの代わり）。
 *
 * 4:30 まで毎秒 tick はせず、`CourtCardFrame` と同様に閾値までの `setTimeout` を
 * 1本だけ張る。
 */
export function FinishOperationGuide({
  courts,
  certainIds,
  players,
  selfPlayerId,
  showCourtNumber,
}: FinishOperationGuideProps) {
  const [now, setNow] = useState<number>(() => Date.now());
  const [flashing, setFlashing] = useState(false);

  const guide = buildFinishOperationGuide({ courts, certainIds, now, showCourtNumber });
  const visible = guide !== null;

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

  // 光らせるのは「非表示 → 表示」に変わったときだけ。開き直しや画面復帰で最初から
  // 表示されている場合（前回値が無い）は光らせない（毎回光ると通知の意味が薄れる）。
  const prevVisibleRef = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevVisibleRef.current;
    prevVisibleRef.current = visible;
    if (prev !== false || !visible) return;
    // 点灯・消灯とも setTimeout 経由（effect 本体での同期 setState は避ける）
    const on = setTimeout(() => setFlashing(true), 0);
    const off = setTimeout(() => setFlashing(false), FLASH_MS);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [visible]);

  if (guide === null) return null;

  const targetIds = new Set(guide.playerIds);
  // 表示順は predictedPlayers（入りやすい順）に従う
  const targets = players.filter((p) => targetIds.has(p.id));
  if (targets.length === 0) return null;

  const isSelfTarget = selfPlayerId !== null && targetIds.has(selfPlayerId);

  // 外側の余白まで含めて描画する。ガイドが無いとき（null 復帰）に空の余白行が
  // 残らないよう、呼び出し側ではなくこのコンポーネントが px/pt を持つ。
  return (
    <div className="px-4 pt-2">
      <div
        className={`rounded-xl border px-3 py-1.5 flex items-center gap-2 flex-wrap bg-orange-50 border-orange-300 text-orange-800 ${
          isSelfTarget ? 'ring-1 ring-orange-400' : ''
        } ${flashing ? 'finish-guide-flash' : ''}`}
        data-testid="finish-operation-guide"
        role="status"
      >
        <StopCircle size={14} className="shrink-0 text-orange-600" aria-hidden />
        <span className="text-xs font-bold">{buildFinishOperationGuideHeadline(guide)}</span>
        <span className="flex items-center gap-1 flex-wrap">
          {targets.map((player) => {
            const isSelf = player.id === selfPlayerId;
            const chipClass = isSelf
              ? 'bg-orange-600 text-white font-semibold'
              : 'bg-card border border-orange-300 text-orange-800 font-medium';
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
