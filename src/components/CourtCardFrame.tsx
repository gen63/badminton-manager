import { useEffect, useState, type ReactNode } from 'react';
import {
  getCourtEmphasisLevel,
  getNextCourtEmphasisDelay,
  type CourtEmphasisLevel,
} from '../lib/courtEmphasis';

interface CourtCardFrameProps {
  /** 試合開始時刻（Unix timestamp）。未開始なら 0 / undefined。 */
  startedAt: number;
  children: ReactNode;
}

/** 強調レベルごとの外枠クラス。太さは常に同じ実効幅になるよう border-2 で統一する。 */
const FRAME_CLASS: Record<CourtEmphasisLevel, string> = {
  none: 'border border-border',
  thick: 'border-2 border-orange-500',
  blink: 'border-2 border-destructive court-frame-blink',
};

/**
 * コートカードの外枠。試合の経過時間に応じて枠を強調する。
 *
 * - 4分30秒超: 枠を太くする
 * - 6分超: さらに枠を点滅させる（`prefers-reduced-motion` 時は点滅せず太枠のまま）
 *
 * 経過時間そのものは `CourtTimer` が毎秒描画するが、こちらは閾値を跨ぐ瞬間しか
 * 見た目が変わらないため、毎秒 tick せず次の閾値までの `setTimeout` を張る。
 */
export function CourtCardFrame({ startedAt, children }: CourtCardFrameProps) {
  const [level, setLevel] = useState<CourtEmphasisLevel>(() =>
    getCourtEmphasisLevel(startedAt, Date.now())
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      const now = Date.now();
      setLevel(getCourtEmphasisLevel(startedAt, now));
      const delay = getNextCourtEmphasisDelay(startedAt, now);
      // バックグラウンド復帰などで遅れて発火しても now から再計算するので問題ない
      if (delay !== null) timer = setTimeout(tick, delay + 50);
    };

    // setState in effect の lint を避けるためマイクロタスク相当で初回を回す
    timer = setTimeout(tick, 0);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [startedAt]);

  return (
    <div
      className={`w-full bg-card rounded-xl shadow-sm flex flex-col overflow-hidden min-w-0 ${FRAME_CLASS[level]}`}
      data-emphasis={level}
    >
      {children}
    </div>
  );
}
