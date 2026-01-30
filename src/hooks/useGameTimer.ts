import { useState, useEffect } from 'react';

/**
 * ゲームの経過時間を計算するカスタムフック
 */
export function useGameTimer(startedAt: number | null, isPlaying: boolean) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isPlaying || !startedAt) {
      setElapsed(0);
      return;
    }

    const updateElapsed = () => {
      setElapsed(Date.now() - startedAt);
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [startedAt, isPlaying]);

  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);

  return {
    elapsed,
    minutes,
    seconds,
    formatted: `${minutes}:${seconds.toString().padStart(2, '0')}`,
  };
}
