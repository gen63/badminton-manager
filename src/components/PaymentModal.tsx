import { useState, useEffect } from 'react';
import { X, Plus, Minus } from 'lucide-react';

interface PaymentModalProps {
  playerName: string;
  defaultAmount: number;
  /** 既に支払い登録済みか。true の場合のみ「取消」操作を表示する */
  isPaid?: boolean;
  onConfirm: (amount: number) => void;
  /** 支払い登録を取り消して未登録に戻す（金額は変更しない単純トグル） */
  onRevert?: () => void;
  onCancel: () => void;
}

export function PaymentModal({ playerName, defaultAmount, isPaid, onConfirm, onRevert, onCancel }: PaymentModalProps) {
  const [amount, setAmount] = useState(defaultAmount.toString());

  useEffect(() => {
    setAmount(defaultAmount.toString());
  }, [defaultAmount]);

  const handleConfirm = () => {
    // NUM1/3 fix: radix 明示 + 負値防止
    const numAmount = Math.max(0, parseInt(amount, 10) || 0);
    onConfirm(numAmount);
  };

  const handleIncrement = (delta: number) => {
    const current = Math.max(0, parseInt(amount, 10) || 0);
    const newAmount = Math.max(0, current + delta);
    setAmount(newAmount.toString());
  };

  const handleExempt = () => {
    setAmount('0');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="card p-6 max-w-sm w-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-foreground">支払い金額</h3>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-muted rounded-full transition-colors"
            aria-label="閉じる"
          >
            <X size={20} className="text-muted-foreground" />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-muted-foreground mb-2">{playerName}</p>
          
          {/* 金額入力フィールド */}
          <div className="relative mb-3">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">¥</span>
            <input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input-field pl-8 text-lg font-medium text-right"
              placeholder="0"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm();
              }}
            />
          </div>

          {/* 100円増減ボタン */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => handleIncrement(-100)}
              className="flex-1 bg-muted hover:bg-muted/80 text-foreground rounded-lg py-2 px-3 font-medium transition-colors flex items-center justify-center gap-1"
            >
              <Minus size={16} />
              100円
            </button>
            <button
              onClick={() => handleIncrement(100)}
              className="flex-1 bg-muted hover:bg-muted/80 text-foreground rounded-lg py-2 px-3 font-medium transition-colors flex items-center justify-center gap-1"
            >
              <Plus size={16} />
              100円
            </button>
          </div>

          {/* 免除ボタン */}
          <button
            onClick={handleExempt}
            className="w-full bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg py-2 px-3 font-medium transition-colors text-sm"
          >
            免除（¥0）
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="btn-secondary flex-1"
          >
            キャンセル
          </button>
          <button
            onClick={handleConfirm}
            className="btn-primary flex-1"
          >
            確定
          </button>
        </div>

        {/* 誤って登録した場合の取り消し。確定操作とは分離し、金額は変更しない。
            使用頻度が低いため右寄せの小さいリンクに留める */}
        {isPaid && onRevert && (
          <div className="text-right mt-2">
            <button
              onClick={onRevert}
              className="text-xs text-muted-foreground hover:text-red-600 underline transition-colors"
            >
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
