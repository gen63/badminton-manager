import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { FinishGameButton } from './FinishGameButton';

const button = () => screen.getByRole('button', { name: '終了' });

describe('FinishGameButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('開始操作の直後は押せない', () => {
    render(<FinishGameButton startPressedAt={Date.now()} canFinish onFinish={() => {}} />);
    expect(button()).toBeDisabled();
  });

  it('20秒経つと押せるようになる', () => {
    render(<FinishGameButton startPressedAt={Date.now()} canFinish onFinish={() => {}} />);
    expect(button()).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(19_900);
    });
    expect(button()).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(button()).toBeEnabled();
  });

  it('20秒より前に開始操作されたコートは最初から押せる', () => {
    render(<FinishGameButton startPressedAt={Date.now() - 21_000} canFinish onFinish={() => {}} />);
    expect(button()).toBeEnabled();
  });

  it('startPressedAt が無ければロックしない（旧データ）', () => {
    render(<FinishGameButton startPressedAt={0} canFinish onFinish={() => {}} />);
    expect(button()).toBeEnabled();
  });

  it('権限が無ければロック解除後も押せない', () => {
    render(<FinishGameButton startPressedAt={Date.now()} canFinish={false} onFinish={() => {}} />);
    expect(button()).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(21_000);
    });
    expect(button()).toBeDisabled();
  });

  it('権限が無ければ開始から時間が経ったコートでも押せない', () => {
    render(
      <FinishGameButton
        startPressedAt={Date.now() - 60_000}
        canFinish={false}
        onFinish={() => {}}
      />,
    );
    expect(button()).toBeDisabled();
  });
});
