import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CourtCardFrame } from './CourtCardFrame';

/** data-emphasis を持つ枠要素 */
function frame() {
  return screen.getByTestId('court').parentElement as HTMLElement;
}

describe('CourtCardFrame', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('未開始（startedAt=0）は強調しない', () => {
    render(
      <CourtCardFrame startedAt={0}>
        <span data-testid="court">court</span>
      </CourtCardFrame>
    );
    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });
    expect(frame()).toHaveAttribute('data-emphasis', 'none');
  });

  it('4分30秒・6分の閾値で none → thick → blink と変わる', () => {
    render(
      <CourtCardFrame startedAt={Date.now()}>
        <span data-testid="court">court</span>
      </CourtCardFrame>
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(frame()).toHaveAttribute('data-emphasis', 'none');

    act(() => {
      // 閾値ちょうど + タイマーの余裕分(50ms)
      vi.advanceTimersByTime(4.5 * 60 * 1000 + 100);
    });
    expect(frame()).toHaveAttribute('data-emphasis', 'thick');
    expect(frame().className).toContain('border-2');

    act(() => {
      vi.advanceTimersByTime(1.5 * 60 * 1000 + 100);
    });
    expect(frame()).toHaveAttribute('data-emphasis', 'blink');
    expect(frame().className).toContain('court-frame-blink');
    expect(frame().className).toContain('border-destructive');
  });

  it('既に6分を超えて開始済みのコートは初回描画で blink', () => {
    render(
      <CourtCardFrame startedAt={Date.now() - 7 * 60 * 1000}>
        <span data-testid="court">court</span>
      </CourtCardFrame>
    );
    expect(frame()).toHaveAttribute('data-emphasis', 'blink');
  });
});
