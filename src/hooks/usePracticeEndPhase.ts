import { useEffect, useState } from 'react';
import {
  getNextPracticeEndPhaseChangeAt,
  getPracticeEndPhase,
  type PracticeEndPhase,
} from '../lib/practiceEndPhase';

/**
 * 練習終了時刻に向けた進行段階を返す。毎秒 tick せず、次の段階の切り替え時刻まで
 * の `setTimeout` 1 本で再評価する（`CourtCardFrame` と同じ方針）。
 * 詳細: docs/plans/2026-09-26-practice-end-time.md
 */
export function usePracticeEndPhase(practiceEndTime: number | undefined): PracticeEndPhase {
  const [phase, setPhase] = useState<PracticeEndPhase>(() =>
    getPracticeEndPhase(practiceEndTime, Date.now())
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      const now = Date.now();
      setPhase(getPracticeEndPhase(practiceEndTime, now));
      const changeAt = getNextPracticeEndPhaseChangeAt(practiceEndTime, now);
      // バックグラウンド復帰などで遅れて発火しても now から再計算するので問題ない
      if (changeAt !== null) timer = setTimeout(tick, changeAt - now + 50);
    };

    // setState in effect の lint を避けるためマイクロタスク相当で初回を回す
    timer = setTimeout(tick, 0);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [practiceEndTime]);

  return phase;
}
