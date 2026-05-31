import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  title?: string;
  message: ReactNode;
  /** 確定ボタンのラベル（デフォルト: OK） */
  confirmLabel?: string;
  /** キャンセルボタンのラベル（デフォルト: キャンセル） */
  cancelLabel?: string;
  /** 確定ボタンを破壊的アクション色（赤）にする */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 2 択の確認ダイアログ。`window.confirm` と違いボタンラベルを自由に変えられる。
 * スタイルは WinnerSelectModal などの既存モーダルに合わせている。
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'キャンセル',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-background rounded-2xl shadow-2xl w-[90%] max-w-sm">
        <div className="px-6 py-5 flex flex-col gap-2">
          {title && <h2 className="text-base font-bold text-foreground">{title}</h2>}
          <div className="text-sm text-muted-foreground whitespace-pre-line">{message}</div>
        </div>
        <div className="border-t border-border px-4 py-3 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 bg-muted text-foreground rounded-xl font-semibold text-sm hover:bg-muted/80 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-3 rounded-xl font-semibold text-sm transition-colors ${
              destructive
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
