import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextMatchPredictionBar } from './NextMatchPredictionBar';
import type { Player } from '../types/player';

const mk = (id: string, name: string): Player => ({
  id,
  name,
  isResting: false,
  gamesPlayed: 0,
  lastPlayedAt: 0,
  activatedAt: 0,
});

const players = [mk('a', '太郎'), mk('b', '外部はなこ'), mk('c', '次郎')];

describe('NextMatchPredictionBar', () => {
  it('担当は濃い青の塗り、確定だが担当外は青枠のみ、候補は薄い枠', () => {
    render(
      <NextMatchPredictionBar
        players={players}
        certainIds={new Set(['a', 'b'])}
        operatorIds={new Set(['a'])}
      />,
    );
    expect(screen.getByText('太郎').className).toContain('bg-indigo-600');
    const excluded = screen.getByText('外部はなこ');
    expect(excluded.className).not.toContain('bg-indigo-600');
    expect(excluded.className).toContain('border-indigo-600');
    expect(screen.getByText('次郎').className).not.toContain('border-indigo-600');
    expect(screen.getByText('ほぼ確定（担当外）')).toBeTruthy();
  });

  it('operatorIds 省略時は certainIds が全員担当（従来どおり）', () => {
    render(<NextMatchPredictionBar players={players} certainIds={new Set(['a', 'b'])} />);
    expect(screen.getByText('外部はなこ').className).toContain('bg-indigo-600');
    expect(screen.queryByText('ほぼ確定（担当外）')).toBeNull();
  });
});
