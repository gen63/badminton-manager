import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CourtTimer } from './CourtTimer';

describe('CourtTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('経過時間を m:ss で表示する', () => {
    render(<CourtTimer startedAt={Date.now() - (5 * 60 * 1000 + 7 * 1000)} />);
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(screen.getByText('5:07')).toBeInTheDocument();
  });

  it('10 分未満では longClassName を当てない', () => {
    render(
      <CourtTimer startedAt={Date.now() - (9 * 60 * 1000 + 59 * 1000)} longClassName="text-base" />,
    );
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(screen.getByText('9:59').className).toBe('');
  });

  it('10 分以上（桁が増える）で longClassName を当てて縮める', () => {
    render(<CourtTimer startedAt={Date.now() - 10 * 60 * 1000} longClassName="text-base" />);
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(screen.getByText('10:00').className).toContain('text-base');
  });

  it('9:59 → 10:00 を跨ぐと縮小に切り替わる', () => {
    render(
      <CourtTimer startedAt={Date.now() - (9 * 60 * 1000 + 59 * 1000)} longClassName="text-base" />,
    );
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(screen.getByText('9:59').className).toBe('');

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText('10:00').className).toContain('text-base');
  });

  it('longClassName を渡さなければ 10 分超でもクラスは付かない', () => {
    render(<CourtTimer startedAt={Date.now() - 12 * 60 * 1000} />);
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(screen.getByText('12:00').className).toBe('');
  });
});
