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
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return <span>{minutes}:{secs.toString().padStart(2, '0')}</span>;
}
