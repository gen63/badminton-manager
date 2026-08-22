import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
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
    render(<FinishGameButton startPressedAt={Date.now()} canFinish onFinish={() => {}} onBlocked={() => {}} />);
    expect(button()).toBeDisabled();
  });

  it('20秒経つと押せるようになる', () => {
    render(<FinishGameButton startPressedAt={Date.now()} canFinish onFinish={() => {}} onBlocked={() => {}} />);
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
    render(<FinishGameButton startPressedAt={Date.now() - 21_000} canFinish onFinish={() => {}} onBlocked={() => {}} />);
    expect(button()).toBeEnabled();
  });

  it('startPressedAt が無ければロックしない（旧データ）', () => {
    render(<FinishGameButton startPressedAt={0} canFinish onFinish={() => {}} onBlocked={() => {}} />);
    expect(button()).toBeEnabled();
  });

  it('権限が無ければ押しても試合は終わらず、担当のアナウンスだけ出る', () => {
    const onFinish = vi.fn();
    const onBlocked = vi.fn();
    render(
      <FinishGameButton
        startPressedAt={Date.now() - 60_000}
        canFinish={false}
        onFinish={onFinish}
        onBlocked={onBlocked}
      />,
    );

    fireEvent.click(button());
    expect(onFinish).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it('権限が無くてもロック中は押せない（アナウンスも出ない）', () => {
    const onBlocked = vi.fn();
    render(
      <FinishGameButton
        startPressedAt={Date.now()}
        canFinish={false}
        onFinish={() => {}}
        onBlocked={onBlocked}
      />,
    );
    expect(button()).toBeDisabled();

    fireEvent.click(button());
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('権限があれば押すと終了する', () => {
    const onFinish = vi.fn();
    const onBlocked = vi.fn();
    render(
      <FinishGameButton
        startPressedAt={Date.now() - 60_000}
        canFinish
        onFinish={onFinish}
        onBlocked={onBlocked}
      />,
    );

    fireEvent.click(button());
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onBlocked).not.toHaveBeenCalled();
  });
});
