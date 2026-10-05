import { useState } from 'react';
import { X } from 'lucide-react';
import { parsePlayerInput } from '../lib/utils';
import { formatStayOverrideTime, parseStayOverrideTime } from '../lib/stayStart';

/** 保存時に呼び出し側へ渡す値 */
export interface PlayerEditSaveValues {
  name: string;
  gender?: 'M' | 'F';
  rating?: number;
  /** 管理者のときだけ入る（非管理者は undefined ＝触らない） */
  excludeFromOperator?: boolean;
  /**
   * みなし開始時刻。undefined ＝変更なし（非管理者・未編集）、null ＝解除、数値 ＝設定（epoch ms）
   */
  stayStartOverrideAt?: number | null;
}

interface PlayerEditModalProps {
  playerName: string;
  playerGender?: 'M' | 'F';
  /** 「終了操作の担当外」の現在値（管理者が設定。未設定＝担当） */
  playerExcludeFromOperator?: boolean;
  /** 現在のみなし開始時刻（epoch ms。未設定は undefined） */
  playerStayStartOverrideAt?: number;
  /** 練習開始日時。みなし開始時刻の日付部分に使う */
  practiceStartTime?: number;
  /** 滞在時間モードが ON か（OFF なら「現在は効かない」注記を出す） */
  useStayDurationPriority?: boolean;
  /** 管理者のみ担当トグル・みなし開始時刻を出す */
  isAdmin?: boolean;
  existingNames: string[];
  onSave: (values: PlayerEditSaveValues) => void;
  onCancel: () => void;
}

export function PlayerEditModal({
  playerName,
  playerGender,
  playerExcludeFromOperator,
  playerStayStartOverrideAt,
  practiceStartTime,
  useStayDurationPriority = false,
  isAdmin = false,
  existingNames,
  onSave,
  onCancel,
}: PlayerEditModalProps) {
  const [name, setName] = useState(playerName);
  const [gender, setGender] = useState<'M' | 'F' | undefined>(playerGender);
  // 画面上は肯定形（ON＝担当）。保存時に excludeFromOperator（OFF→true）へ反転する
  const [isOperator, setIsOperator] = useState(playerExcludeFromOperator !== true);
  // みなし開始時刻（HH:MM）。空文字＝未設定
  const initialOverrideTime = formatStayOverrideTime(playerStayStartOverrideAt);
  const [overrideTime, setOverrideTime] = useState(initialOverrideTime);
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
    const values: PlayerEditSaveValues = { name: parsedName, gender: parsedGender ?? gender, rating };
    if (isAdmin) {
      values.excludeFromOperator = !isOperator;
      // 表示上の時刻が変わっていなければ触らない（秒単位の元の値を保つ）
      if (overrideTime !== initialOverrideTime) {
        if (overrideTime === '') {
          values.stayStartOverrideAt = null;
        } else {
          const ms = parseStayOverrideTime(overrideTime, practiceStartTime);
          if (ms === null) {
            setError('みなし開始時刻の形式が正しくありません');
            return;
          }
          values.stayStartOverrideAt = ms;
        }
      }
    }
    onSave(values);
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

          {/* みなし開始時刻（管理者のみ）。滞在時間モードの公平計算の起点を上書きする */}
          {isAdmin && (
            <div>
              <label className="label" htmlFor="stay-start-override">みなし開始時刻</label>
              <div className="flex gap-2">
                <input
                  id="stay-start-override"
                  type="time"
                  value={overrideTime}
                  onChange={(e) => { setOverrideTime(e.target.value); setError(''); }}
                  className="input-field flex-1 min-w-0"
                />
                <button
                  type="button"
                  onClick={() => { setOverrideTime(''); setError(''); }}
                  disabled={overrideTime === ''}
                  className="btn-secondary px-4 disabled:opacity-50"
                >
                  解除
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                滞在時間モードの公平計算で、この時刻から参加していたとみなします。遅刻連絡があった人は早く、体調不良などで控えめにしたい人は遅く設定
              </p>
              {!useStayDurationPriority && (
                <p className="text-xs text-muted-foreground mt-1">
                  ※現在は回数平均モードのため効きません（滞在時間モードで有効）
                </p>
              )}
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
