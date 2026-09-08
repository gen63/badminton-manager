import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionQrCode } from './SessionQrCode';

const URL = 'https://example.com/badminton/session/ABC123';

describe('SessionQrCode', () => {
  it('SVG の QR を描画する', () => {
    render(<SessionQrCode url={URL} />);
    const qr = screen.getByTestId('session-qr-code');
    expect(qr.tagName.toLowerCase()).toBe('svg');
    // モジュール（黒セル）が描かれていること。空の SVG でないことの確認。
    expect(qr.querySelector('path')).not.toBeNull();
  });

  it('スクリーンリーダー向けに用途を伝える', () => {
    render(<SessionQrCode url={URL} />);
    expect(screen.getByRole('img', { name: 'セッション参加用QRコード' })).toBeInTheDocument();
  });

  it('既定サイズは 192px、size 指定で上書きできる', () => {
    const { rerender } = render(<SessionQrCode url={URL} />);
    expect(screen.getByTestId('session-qr-code')).toHaveAttribute('height', '192');

    rerender(<SessionQrCode url={URL} size={256} />);
    expect(screen.getByTestId('session-qr-code')).toHaveAttribute('height', '256');
  });

  it('URL が変わると QR の内容も変わる', () => {
    const { rerender } = render(<SessionQrCode url={URL} />);
    const first = screen.getByTestId('session-qr-code').innerHTML;

    rerender(<SessionQrCode url="https://example.com/badminton/session/ZZZ999" />);
    expect(screen.getByTestId('session-qr-code').innerHTML).not.toBe(first);
  });

  it('スキャンできるよう白背景・黒モジュールで描く', () => {
    render(<SessionQrCode url={URL} />);
    const qr = screen.getByTestId('session-qr-code');
    const fills = [...qr.querySelectorAll('path')].map((p) => p.getAttribute('fill'));
    // 背景（白）とモジュール（黒）の2枚。テーマ変数に引きずられて色が変わらないこと。
    expect(fills).toContain('#ffffff');
    expect(fills).toContain('#000000');
  });
});
