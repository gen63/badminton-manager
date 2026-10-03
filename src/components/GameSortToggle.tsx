import type { GameSortMode } from '../lib/playerStats';

const OPTIONS: ReadonlyArray<readonly [GameSortMode, string]> = [
  ['expected', '期待差'],
  ['lastGame', '経過時間'],
];

interface GameSortToggleProps {
  value: GameSortMode;
  onChange: (mode: GameSortMode) => void;
}

/** 参加者の並び順切替（期待差 / 経過時間）。参加者管理と予約追加モーダルで共用 */
export function GameSortToggle({ value, onChange }: GameSortToggleProps) {
  return (
    <div className="flex gap-2 mb-3">
      {OPTIONS.map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          aria-pressed={value === mode}
          className={`flex-1 min-h-[44px] px-2 rounded-xl text-sm font-medium transition-colors active:scale-[0.98] ${
            value === mode ? '' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}
          style={value === mode ? { backgroundColor: '#e0e7ff', color: '#3730a3' } : undefined}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
