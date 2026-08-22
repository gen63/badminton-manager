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
  /**
   * 終了操作の権限があるか。管理者（＝作成者・管理権限・開発モード）か
   * 「操作担当」（配置予測のほぼ確定メンバー）のときだけ true。
   */
  canFinish: boolean;
  onFinish: () => void;
  /**
   * 権限が無いままタップされたときの通知。誰が担当かをアナウンスする。
   * `disabled` にしてしまうと onClick が飛ばず「押しても無反応」になるため、
   * 権限が無いときも**押せる状態のまま**にしてここで説明する。
   */
  onBlocked: () => void;
}

/**
 * 試合終了ボタン。試合が終わるのは以下の2条件をどちらも満たすときだけ。
 *
 * 1. 終了操作の権限がある（{@link FinishGameButtonProps.canFinish}）。
 *    「気づいた人が終了操作をする」運用から「管理者か、次の試合に入るメンバー
 *    （＝操作担当）が操作する」運用へ寄せるためのガード。権限が無い人には
 *    薄く見せるが **タップ自体は受ける**（`onBlocked` で誰が担当かを案内する）。
 *    無反応だと故障や同期ずれに見えてしまい、かえって連打を招くため。
 * 2. 「開始」の操作から {@link FINISH_LOCK_MS} 経過している。直後の誤タップ・
 *    連続終了を抑止する。こちらは案内する相手が居ないので素直に `disabled`。
 *    ロック解除は startPressedAt から算出したタイマーで一度だけ再レンダリング
 *    して行う（毎秒 tick しない）。
 */
export function FinishGameButton({
  startPressedAt,
  canFinish,
  onFinish,
  onBlocked,
}: FinishGameButtonProps) {
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
      onClick={canFinish ? onFinish : onBlocked}
      disabled={locked}
      title={canFinish ? undefined : '終了操作は管理者と操作担当のみできます'}
      className={`w-full min-h-[44px] bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-destructive/10${
        canFinish ? '' : ' opacity-40'
      }`}
    >
      <StopCircle size={14} />
      終了
    </button>
  );
}
