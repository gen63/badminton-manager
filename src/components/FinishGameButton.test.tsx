import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { FinishGameButton } from './FinishGameButton';

const button = () => screen.getByRole('button', { name: '終了' });

/** 長押し（600ms 以上）で終了を確定させる */
const hold = (ms = 700) => {
  fireEvent.pointerDown(button());
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  fireEvent.pointerUp(button());
};

/** 短タップ（長押しに満たない） */
const tap = (ms = 200) => {
  fireEvent.pointerDown(button());
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  fireEvent.pointerUp(button());
  fireEvent.click(button());
};

describe('FinishGameButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const props = {
    canFinish: true,
    requireHold: true,
    onFinish: () => {},
    onBlocked: () => {},
  };

  it('開始操作の直後は押せない', () => {
    render(<FinishGameButton {...props} startPressedAt={Date.now()} />);
    expect(button()).toBeDisabled();
  });

  it('20秒経つと押せるようになる', () => {
    render(<FinishGameButton {...props} startPressedAt={Date.now()} />);
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
    render(<FinishGameButton {...props} startPressedAt={Date.now() - 21_000} />);
    expect(button()).toBeEnabled();
  });

  it('startPressedAt が無ければロックしない（旧データ）', () => {
    render(<FinishGameButton {...props} startPressedAt={0} />);
    expect(button()).toBeEnabled();
  });

  it('長押しすると終了する', () => {
    const onFinish = vi.fn();
    render(<FinishGameButton {...props} startPressedAt={0} onFinish={onFinish} />);

    hold();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('短タップでは終了せず、操作方法を出す', () => {
    const onFinish = vi.fn();
    render(<FinishGameButton {...props} startPressedAt={0} onFinish={onFinish} />);

    tap();
    expect(onFinish).not.toHaveBeenCalled();
    expect(screen.getByText('長押しで終了')).toBeInTheDocument();
  });

  it('長押し中に指が離れたら終了しない', () => {
    const onFinish = vi.fn();
    render(<FinishGameButton {...props} startPressedAt={0} onFinish={onFinish} />);

    fireEvent.pointerDown(button());
    act(() => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.pointerLeave(button());
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('ロック中は長押ししても終了しない', () => {
    const onFinish = vi.fn();
    render(<FinishGameButton {...props} startPressedAt={Date.now()} onFinish={onFinish} />);

    hold();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('権限が無ければ押しても終了せず、担当のアナウンスだけ出る', () => {
    const onFinish = vi.fn();
    const onBlocked = vi.fn();
    render(
      <FinishGameButton
        {...props}
        startPressedAt={0}
        canFinish={false}
        onFinish={onFinish}
        onBlocked={onBlocked}
      />,
    );

    fireEvent.click(button());
    expect(onFinish).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it('権限が無ければ長押ししても終了しない', () => {
    const onFinish = vi.fn();
    render(
      <FinishGameButton
        {...props}
        startPressedAt={0}
        canFinish={false}
        onFinish={onFinish}
      />,
    );

    hold();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('権限が無くてもロック中は押せない（アナウンスも出ない）', () => {
    const onBlocked = vi.fn();
    render(
      <FinishGameButton
        {...props}
        startPressedAt={Date.now()}
        canFinish={false}
        onBlocked={onBlocked}
      />,
    );
    expect(button()).toBeDisabled();

    fireEvent.click(button());
    expect(onBlocked).not.toHaveBeenCalled();
  });

  describe('長押し設定 OFF（requireHold=false）', () => {
    it('タップ1回で終了する', () => {
      const onFinish = vi.fn();
      render(
        <FinishGameButton {...props} startPressedAt={0} requireHold={false} onFinish={onFinish} />,
      );

      fireEvent.click(button());
      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it('開始直後のロックは効いたまま', () => {
      const onFinish = vi.fn();
      render(
        <FinishGameButton
          {...props}
          startPressedAt={Date.now()}
          requireHold={false}
          onFinish={onFinish}
        />,
      );
      expect(button()).toBeDisabled();

      fireEvent.click(button());
      expect(onFinish).not.toHaveBeenCalled();
    });

    it('権限が無ければタップしても終了せず、担当のアナウンスだけ出る', () => {
      const onFinish = vi.fn();
      const onBlocked = vi.fn();
      render(
        <FinishGameButton
          {...props}
          startPressedAt={0}
          requireHold={false}
          canFinish={false}
          onFinish={onFinish}
          onBlocked={onBlocked}
        />,
      );

      fireEvent.click(button());
      expect(onFinish).not.toHaveBeenCalled();
      expect(onBlocked).toHaveBeenCalledTimes(1);
    });

    it('長押ししても二重に終了しない', () => {
      const onFinish = vi.fn();
      render(
        <FinishGameButton {...props} startPressedAt={0} requireHold={false} onFinish={onFinish} />,
      );

      hold();
      fireEvent.click(button());
      expect(onFinish).toHaveBeenCalledTimes(1);
    });
  });
});
