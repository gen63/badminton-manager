import { useCallback, useRef, useState } from 'react';

/**
 * 連続クリック / 高速タップによる多重実行を防ぐためのガード付き async wrapper。
 *
 * 用途: トグル系ボタン（支払 / 名簿 / 連続モード等）。1 回目の transaction が
 * 完了する前に同じボタンがタップされると、トグル系では「2 回 toggle = 元に戻る」
 * という UX バグになる。`isPending=true` の間は `run()` が即 return してスキップ。
 *
 * @returns `run` (in-flight 中は no-op) と `isPending` (UI で disabled に使う)
 */
export function useGuardedAction<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): { run: (...args: A) => Promise<R | undefined>; isPending: boolean } {
  const [isPending, setIsPending] = useState(false);
  // 同期的な再エントリ防止用フラグ（setState は非同期反映なので state 経由だと race する）
  const inFlightRef = useRef(false);

  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (inFlightRef.current) return undefined;
      inFlightRef.current = true;
      setIsPending(true);
      try {
        return await fn(...args);
      } finally {
        inFlightRef.current = false;
        setIsPending(false);
      }
    },
    [fn],
  );

  return { run, isPending };
}
