import { useState, useEffect } from 'react';

/**
 * ゲームの経過時間を計算するカスタムフック
 * nowをstateで管理し、setInterval経由で更新する
 */
export function useGameTimer(startedAt: number | null, isPlaying: boolean) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isPlaying || !startedAt) return;

    // TIMER1 fix: 初回 interval 発火 (1s) までの間、古い `now` が使われて elapsed が
    // 一瞬ズレる。マイクロタスクで 1 回 tick して即座に再 render させる。
    // (setState in effect lint を避けるため setTimeout に包む)
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [startedAt, isPlaying]);

  const elapsed = isPlaying && startedAt ? Math.max(0, now - startedAt) : 0;
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);

  return {
    elapsed,
    minutes,
    seconds,
    formatted: `${minutes}:${seconds.toString().padStart(2, '0')}`,
  };
}
