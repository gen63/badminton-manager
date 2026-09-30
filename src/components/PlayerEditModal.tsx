import { useState } from 'react';
import { X } from 'lucide-react';
import { parsePlayerInput } from '../lib/utils';

interface PlayerEditModalProps {
  playerName: string;
  playerGender?: 'M' | 'F';
  /** 「終了操作の担当外」の現在値（管理者が設定。未設定＝担当） */
  playerExcludeFromOperator?: boolean;
  /** 管理者のみ担当トグルを出す */
  isAdmin?: boolean;
  existingNames: string[];
  onSave: (name: string, gender?: 'M' | 'F', rating?: number, excludeFromOperator?: boolean) => void;
  onCancel: () => void;
}

export function PlayerEditModal({
  playerName,
  playerGender,
  playerExcludeFromOperator,
  isAdmin = false,
  existingNames,
  onSave,
  onCancel,
}: PlayerEditModalProps) {
  const [name, setName] = useState(playerName);
  const [gender, setGender] = useState<'M' | 'F' | undefined>(playerGender);
  // 画面上は肯定形（ON＝担当）。保存時に excludeFromOperator（OFF→true）へ反転する
  const [isOperator, setIsOperator] = useState(playerExcludeFromOperator !== true);
  const [error, setError] = useState('');

  const handleSave = () => {
    const parsed = parsePlayerInput(name);
    if (!parsed) {
      setError('名前を入力してください');
      return;
    }
    const { name: parsedName, rating, gender: parsedGender } = parsed;
    if (parsedName !== playerName && existingNames.includes(parsedName)) {
      setError('同じ名前の参加者が既に存在します');
      return;
    }
    onSave(parsedName, parsedGender ?? gender, rating, !isOperator);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="card p-6 max-w-sm w-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-foreground">参加者を編集</h3>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-muted rounded-full transition-colors"
            aria-label="閉じる"
          >
            <X size={20} className="text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-4">
          {/* 名前入力 */}
          <div>
            <label className="label">名前</label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              className="input-field w-full"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
            />
          </div>

          {/* 性別選択 */}
          <div>
            <label className="label">性別</label>
            <div className="flex gap-2">
              <button
                onClick={() => setGender('M')}
                className={`flex-1 py-2 px-3 rounded-lg font-medium transition-colors ${
                  gender === 'M'
                    ? 'bg-blue-500 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                男
              </button>
              <button
                onClick={() => setGender('F')}
                className={`flex-1 py-2 px-3 rounded-lg font-medium transition-colors ${
                  gender === 'F'
                    ? 'bg-pink-500 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                女
              </button>
              <button
                onClick={() => setGender(undefined)}
                className={`flex-1 py-2 px-3 rounded-lg font-medium transition-colors ${
                  gender === undefined
                    ? 'bg-gray-500 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                未設定
              </button>
            </div>
          </div>

          {/* 終了操作の担当（管理者のみ）。ON＝担当になる、OFF＝担当外 */}
          {isAdmin && (
            <div>
              <label className="label">終了操作の担当</label>
              <button
                type="button"
                role="switch"
                aria-checked={isOperator}
                onClick={() => setIsOperator((v) => !v)}
                className={`w-full py-2 px-3 rounded-lg font-medium transition-colors ${
                  isOperator
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                終了操作担当{isOperator ? '：ON' : '：OFF'}
              </button>
              <p className="text-xs text-muted-foreground mt-1">
                OFFにすると次の試合に入る予測でも終了操作の担当になりません（外部の方・端末不調の方など）
              </p>
            </div>
          )}

          {/* エラーメッセージ */}
          <div className="min-h-[20px]">
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={onCancel}
            className="btn-secondary flex-1"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            className="btn-primary flex-1"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
