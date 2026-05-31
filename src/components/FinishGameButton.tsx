import { useState, useEffect } from 'react';
import { StopCircle } from 'lucide-react';

/** 試合開始直後に終了ボタンを押せない時間（誤連打・誤タップ抑止）。 */
const FINISH_LOCK_MS = 10_000;

interface FinishGameButtonProps {
  /** 試合開始時刻 (ms)。0/undefined の場合はロックしない。 */
  startedAt: number | undefined;
  onFinish: () => void;
}

/**
 * 試合終了ボタン。開始から {@link FINISH_LOCK_MS} の間は非活性にして
 * 直後の誤タップ・連続終了を抑止する。ロック解除は startedAt から
 * 算出したタイマーで一度だけ再レンダリングして行う（毎秒 tick しない）。
 */
export function FinishGameButton({ startedAt, onFinish }: FinishGameButtonProps) {
  // 初期ロック状態は遅延初期化（render 本体では Date.now() を呼ばない）。
  // 親側で key={startedAt} を渡してマウントし直すため、試合が変われば再評価される。
  const [locked, setLocked] = useState(
    () => !!startedAt && Date.now() - startedAt < FINISH_LOCK_MS,
  );

  useEffect(() => {
    if (!startedAt) return;
    const remaining = startedAt + FINISH_LOCK_MS - Date.now();
    if (remaining <= 0) return;
    // 解除は必ずタイマー経由（effect 本体での同期 setState は避ける）。
    const id = setTimeout(() => setLocked(false), remaining);
    return () => clearTimeout(id);
  }, [startedAt]);

  return (
    <button
      onClick={onFinish}
      disabled={locked}
      className="w-full min-h-[44px] bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-destructive/10"
    >
      <StopCircle size={14} />
      終了
    </button>
  );
}
