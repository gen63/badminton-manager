import { useState, useEffect } from 'react';

/**
 * ゲームの経過時間を計算するカスタムフック
 * nowをstateで管理し、setInterval経由で更新する
 */
export function useGameTimer(startedAt: number | null, isPlaying: boolean) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isPlaying || !startedAt) return;

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
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
