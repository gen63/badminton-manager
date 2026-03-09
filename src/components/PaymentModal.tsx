import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface PaymentModalProps {
  playerName: string;
  defaultAmount: number;
  onConfirm: (amount: number) => void;
  onCancel: () => void;
}

export function PaymentModal({ playerName, defaultAmount, onConfirm, onCancel }: PaymentModalProps) {
  const [amount, setAmount] = useState(defaultAmount.toString());

  useEffect(() => {
    setAmount(defaultAmount.toString());
  }, [defaultAmount]);

  const handleConfirm = () => {
    const numAmount = parseInt(amount) || 0;
    onConfirm(numAmount);
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
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">¥</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input-field pl-8 text-lg font-medium text-right"
              placeholder="0"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm();
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            ※ 手伝い免除の場合は ¥0 を入力
          </p>
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
      </div>
    </div>
  );
}
