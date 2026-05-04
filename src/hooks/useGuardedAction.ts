import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 連続クリック / 高速タップによる多重実行を防ぐためのガード付き async wrapper。
 *
 * 用途: トグル系ボタン（支払 / 名簿 / 連続モード等）。1 回目の transaction が
 * 完了する前に同じボタンがタップされると、トグル系では「2 回 toggle = 元に戻る」
 * という UX バグになる。`isPending=true` の間は `run()` が即 return してスキップ。
 *
 * 設計メモ:
 *   - 呼び出し側はインライン async 関数を渡すことが多いので、`fn` は ref で受ける
 *     （GUARD1 fix: `useCallback` の dep に fn を含めると毎レンダー run が
 *     再生成されて子の memoization が壊れる）。
 *   - 同期的な再エントリ防止には `inFlightRef`（state は非同期反映で race）。
 *
 * @returns `run` (in-flight 中は no-op) と `isPending` (UI で disabled に使う)
 */
export function useGuardedAction<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): { run: (...args: A) => Promise<R | undefined>; isPending: boolean } {
  const [isPending, setIsPending] = useState(false);
  const inFlightRef = useRef(false);
  // 最新の fn を ref に保持して run の identity を安定させる
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    if (inFlightRef.current) return undefined;
    inFlightRef.current = true;
    setIsPending(true);
    try {
      return await fnRef.current(...args);
    } finally {
      inFlightRef.current = false;
      setIsPending(false);
    }
  }, []);

  return { run, isPending };
}
