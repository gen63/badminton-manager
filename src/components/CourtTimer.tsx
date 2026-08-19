import { useState, useEffect } from 'react';

interface CourtTimerProps {
  startedAt: number;
  /**
   * 10 分以上（`10:00` 以降で1桁増える）になったときに当てるクラス。
   * 呼び出し側は「9:59 までが収まる大きさ」で文字サイズを決め、桁が増えたときの
   * 縮小だけをここに任せる。実測の試合時間は中央値6.5分・p90 8.0分で 10 分超は稀
   * （15 分で自動終了）。省略時は何も足さない。
   */
  longClassName?: string;
}

/**
 * コートの経過時間を表示するコンポーネント
 * 毎秒更新だが、このコンポーネント内でのみ再レンダリング
 */
export function CourtTimer({ startedAt, longClassName }: CourtTimerProps) {
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

  // 子要素側の font-size が親の指定に勝つので、長いときだけ縮められる
  const className = longClassName !== undefined && minutes >= 10 ? longClassName : undefined;

  return (
    <span className={className}>
      {minutes}:{secs.toString().padStart(2, '0')}
    </span>
  );
}
