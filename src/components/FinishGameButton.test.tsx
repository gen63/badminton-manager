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
    render(<FinishGameButton startPressedAt={Date.now()} onFinish={() => {}} />);
    expect(button()).toBeDisabled();
  });

  it('5秒経つと押せるようになる', () => {
    render(<FinishGameButton startPressedAt={Date.now()} onFinish={() => {}} />);
    expect(button()).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(4_900);
    });
    expect(button()).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(button()).toBeEnabled();
  });

  it('5秒より前に開始操作されたコートは最初から押せる', () => {
    render(<FinishGameButton startPressedAt={Date.now() - 6_000} onFinish={() => {}} />);
    expect(button()).toBeEnabled();
  });

  it('startPressedAt が無ければロックしない（旧データ）', () => {
    render(<FinishGameButton startPressedAt={0} onFinish={() => {}} />);
    expect(button()).toBeEnabled();
  });
});
