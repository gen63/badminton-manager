import { useState, useEffect } from 'react';

interface CourtTimerProps {
  startedAt: number;
}

/**
 * コートの経過時間を表示するコンポーネント
 * 毎秒更新だが、このコンポーネント内でのみ再レンダリング
 */
export function CourtTimer({ startedAt }: CourtTimerProps) {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);

  useEffect(() => {
    // TIMER1 fix: startedAt 変化時、初回 interval (1s) までは旧 elapsed が残る。
    // マイクロタスクで 1 回 tick させて即座に再計算させる
    // (setState in effect lint を避けるため setTimeout に包む)
    const initial = setTimeout(() => setElapsed(Date.now() - startedAt), 0);
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [startedAt]);

  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return <span>{minutes}:{secs.toString().padStart(2, '0')}</span>;
}
