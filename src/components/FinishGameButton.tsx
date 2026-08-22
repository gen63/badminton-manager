import { useState, useEffect } from 'react';
import { StopCircle } from 'lucide-react';

/** 「開始」の操作直後に終了ボタンを押せない時間（誤連打・誤タップ抑止）。 */
const FINISH_LOCK_MS = 20_000;

interface FinishGameButtonProps {
  /**
   * 「開始」の操作が行われた時刻 (ms)。0/undefined の場合はロックしない。
   *
   * 試合開始時刻（`Court.startedAt`）ではなく `Court.startPressedAt` を渡す。
   * `startedAt` は配置時刻を採るため、準備中が長かったコートを開始すると
   * その瞬間に既にロック時間を過ぎた扱いになってしまう。
   */
  startPressedAt: number | undefined;
  onFinish: () => void;
}

/**
 * 試合終了ボタン。「開始」の操作から {@link FINISH_LOCK_MS} の間は非活性にして
 * 直後の誤タップ・連続終了を抑止する。ロック解除は startPressedAt から
 * 算出したタイマーで一度だけ再レンダリングして行う（毎秒 tick しない）。
 */
export function FinishGameButton({ startPressedAt, onFinish }: FinishGameButtonProps) {
  // 初期ロック状態は遅延初期化（render 本体では Date.now() を呼ばない）。
  // 親側で key={startPressedAt} を渡してマウントし直すため、試合が変われば再評価される。
  const [locked, setLocked] = useState(
    () => !!startPressedAt && Date.now() - startPressedAt < FINISH_LOCK_MS,
  );

  useEffect(() => {
    if (!startPressedAt) return;
    const remaining = startPressedAt + FINISH_LOCK_MS - Date.now();
    if (remaining <= 0) return;
    // 解除は必ずタイマー経由（effect 本体での同期 setState は避ける）。
    const id = setTimeout(() => setLocked(false), remaining);
    return () => clearTimeout(id);
  }, [startPressedAt]);

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
