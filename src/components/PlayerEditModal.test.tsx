import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerEditModal } from './PlayerEditModal';

const baseProps = {
  playerName: '太郎',
  existingNames: [],
  onSave: vi.fn(),
  onCancel: vi.fn(),
};

describe('PlayerEditModal 初期レート表示', () => {
  it('showRating 時は登録レートを読み取り専用で表示する', () => {
    render(<PlayerEditModal {...baseProps} playerRating={1500} showRating />);
    expect(screen.getByText('初期レート: 1500')).toBeInTheDocument();
  });

  it('showRating 時、未設定・0 は「未設定」と表示する', () => {
    const { rerender } = render(<PlayerEditModal {...baseProps} showRating />);
    expect(screen.getByText('初期レート: 未設定')).toBeInTheDocument();
    rerender(<PlayerEditModal {...baseProps} playerRating={0} showRating />);
    expect(screen.getByText('初期レート: 未設定')).toBeInTheDocument();
  });

  it('showRating が無ければ表示しない', () => {
    render(<PlayerEditModal {...baseProps} playerRating={1500} />);
    expect(screen.queryByText(/初期レート/)).not.toBeInTheDocument();
  });
});
