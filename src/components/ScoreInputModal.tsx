import { useState } from 'react';
import { X, Trash2 } from 'lucide-react';

interface ScoreInputModalProps {
  matchId: string;
  teamA: [string, string];
  teamB: [string, string];
  targetScore: number;
  getPlayerName: (id: string) => string;
  onConfirm: (matchId: string, scoreA: number, scoreB: number, winner: 'A' | 'B') => void;
  onSkip: () => void;
}

export function ScoreInputModal({
  matchId,
  teamA,
  teamB,
  targetScore,
  getPlayerName,
  onConfirm,
  onSkip,
}: ScoreInputModalProps) {
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [inputHistory, setInputHistory] = useState<number[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  const isSingles = teamA[1] === '' && teamB[1] === '';
  const teamANames = isSingles
    ? getPlayerName(teamA[0])
    : `${getPlayerName(teamA[0])} ${getPlayerName(teamA[1])}`;
  const teamBNames = isSingles
    ? getPlayerName(teamB[0])
    : `${getPlayerName(teamB[0])} ${getPlayerName(teamB[1])}`;

  // 目標点数に対する最大点数
  const getMaxScore = (target: number): number => {
    switch (target) {
      case 21: return 30;
      case 15: return 21;
      default: return target + 9;
    }
  };
  const maxScore = getMaxScore(targetScore);

  const validateScore = (a: number, b: number): string | null => {
    if (a === b) return '同点は入力できません';
    if (a === maxScore || b === maxScore) return null;
    if (a >= targetScore && b >= targetScore) {
      if (Math.abs(a - b) !== 2) {
        return 'デュース後は2点差で終了する必要があります';
      }
    }
    return null;
  };

  const handleNumberClick = (num: number) => {
    if (inputHistory.length >= 2) return;
    setValidationError(null);

    if (inputHistory.length === 0) {
      setScoreA(num);
      setInputHistory([num]);
    } else {
      setScoreB(num);
      setInputHistory([inputHistory[0], num]);
    }
  };

  const handleClear = () => {
    setScoreA(0);
    setScoreB(0);
    setInputHistory([]);
    setValidationError(null);
  };

  const handleConfirm = () => {
    if (inputHistory.length !== 2) return;

    const error = validateScore(scoreA, scoreB);
    if (error) {
      setValidationError(error);
      return;
    }

    const winner: 'A' | 'B' = scoreA > scoreB ? 'A' : 'B';
    onConfirm(matchId, scoreA, scoreB, winner);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="bg-background rounded-t-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col animate-in slide-in-from-bottom duration-200">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-base font-bold text-foreground">試合結果を入力</h2>
          <button
            onClick={onSkip}
            aria-label="スキップ"
            className="p-2 hover:bg-muted rounded-full transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <X size={20} className="text-muted-foreground" />
          </button>
        </div>

        {/* 対戦チーム */}
        <div className="px-4 pb-2">
          <div className="flex items-center justify-center gap-3 text-sm">
            <span className="font-bold text-foreground truncate flex-1 text-right">{teamANames}</span>
            <span className="text-muted-foreground font-bold text-[10px] px-1.5 bg-muted rounded-full py-0.5 flex-shrink-0">VS</span>
            <span className="text-muted-foreground truncate flex-1 text-left">{teamBNames}</span>
          </div>
        </div>

        {/* スコア表示 */}
        <div className="px-4 pb-2">
          <div className="text-center py-2">
            {inputHistory.length === 0 ? (
              <span className="text-muted-foreground text-sm">左チームの点数をタップ</span>
            ) : (
              <div className="text-2xl font-bold">
                <span className="text-indigo-500">{scoreA}</span>
                {inputHistory.length === 2 ? (
                  <>
                    <span className="text-muted-foreground mx-3">-</span>
                    <span className="text-indigo-500">{scoreB}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground mx-3">- ?</span>
                )}
              </div>
            )}
          </div>
          {validationError && (
            <p className="text-destructive text-xs text-center">{validationError}</p>
          )}
        </div>

        {/* 点数ボタングリッド */}
        <div className="px-4 pb-2 flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-6 gap-1">
            {Array.from({ length: maxScore + 1 }, (_, i) => i).map((num) => {
              const isHighlighted = Math.abs(num - targetScore) <= 2;
              return (
                <button
                  key={num}
                  onClick={() => handleNumberClick(num)}
                  disabled={inputHistory.length >= 2}
                  className={`h-10 rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.95] ${
                    isHighlighted
                      ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                      : 'bg-muted text-foreground hover:bg-muted/80'
                  }`}
                >
                  {num}
                </button>
              );
            })}
          </div>
        </div>

        {/* アクションボタン */}
        <div className="px-4 pt-2 pb-safe border-t border-border">
          <div className="grid grid-cols-3 gap-2 pb-2">
            <button
              onClick={handleClear}
              className="btn-secondary min-h-[44px] py-2 flex items-center justify-center gap-1 text-sm"
            >
              <Trash2 size={16} />
              クリア
            </button>
            {inputHistory.length === 2 ? (
              <button
                onClick={handleConfirm}
                className="btn-primary min-h-[44px] py-2 font-semibold text-sm col-span-2"
              >
                確定
              </button>
            ) : (
              <button
                onClick={onSkip}
                className="btn-secondary min-h-[44px] py-2 text-sm col-span-2"
              >
                スキップ
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
