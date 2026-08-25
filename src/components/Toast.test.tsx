import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { Toast } from './Toast';

/** duration + フェードアウト(300ms) を通過させる */
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('duration が過ぎると閉じる', () => {
    const onClose = vi.fn();
    render(<Toast message="⚫︎コートを終了しました" type="info" duration={10_000} onClose={onClose} />);

    advance(9_900);
    expect(onClose).not.toHaveBeenCalled();

    advance(500);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('duration 未指定なら 3 秒で閉じる', () => {
    const onClose = vi.fn();
    render(<Toast message="メッセージ" type="info" onClose={onClose} />);

    advance(3_400);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 回帰: 呼び出し側は onClose を毎レンダー作り直すので、再レンダリングで
  // タイマーが振り出しに戻ると「時間で消えない」トーストになる。
  it('親の再レンダリングで onClose が作り直されてもタイマーは延びない', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Toast message="メッセージ" type="info" duration={10_000} onClose={() => onClose()} />,
    );

    // 1 秒ごとに親が再レンダリングされる状況を再現する
    for (let i = 0; i < 12; i += 1) {
      advance(1_000);
      rerender(
        <Toast message="メッセージ" type="info" duration={10_000} onClose={() => onClose()} />,
      );
    }

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('アクションを押すと onClick が走り、トーストも閉じる', () => {
    const onClose = vi.fn();
    const onClick = vi.fn();
    render(
      <Toast
        message="⚫︎コートを終了しました"
        type="info"
        duration={10_000}
        onClose={onClose}
        action={{ label: '取り消す', onClick }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '取り消す' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    advance(400);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('閉じるボタンで閉じる', () => {
    const onClose = vi.fn();
    render(<Toast message="メッセージ" type="info" onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    advance(400);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
