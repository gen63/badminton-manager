import { useState } from 'react';
import { X } from 'lucide-react';

interface PlayerEditModalProps {
  playerName: string;
  playerGender?: 'M' | 'F';
  existingNames: string[];
  onSave: (name: string, gender?: 'M' | 'F') => void;
  onCancel: () => void;
}

export function PlayerEditModal({ playerName, playerGender, existingNames, onSave, onCancel }: PlayerEditModalProps) {
  const [name, setName] = useState(playerName);
  const [gender, setGender] = useState<'M' | 'F' | undefined>(playerGender);
  const [error, setError] = useState('');

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('名前を入力してください');
      return;
    }
    if (trimmed !== playerName && existingNames.includes(trimmed)) {
      setError('同じ名前の参加者が既に存在します');
      return;
    }
    onSave(trimmed, gender);
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
