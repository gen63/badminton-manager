import { useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSessionWriterWithToast } from '../hooks/useSessionWriterToast';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { X, Trash2, LogOut } from 'lucide-react';

export function ScoreInputPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { matchId } = useParams<{ matchId: string }>();
  const matchHistory = useGameStore((state) => state.matchHistory);
  const players = usePlayerStore((state) => state.players);
  const fromPage = (location.state as { from?: string })?.from || '/history';

  const match = matchHistory.find((m) => m.id === matchId);
  const session = useSessionStore((state) => state.session);
  const targetScore = session?.config.targetScore || 15;
  const toast = useToast();
  const writer = useSessionWriterWithToast(toast);
  
  // 開いた時は常に空からスタート（履歴からの編集は「訂正」前提のため、
  // 既存スコアを残すと一部の数字だけ上書きする操作が分かりにくい）。
  // 視覚的なレイアウト（左右の入れ替え）は履歴と揃えるため、既存の winner
  // を見て swap だけ初期化する。
  const swap = match?.winner === 'B';
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<{
    position: number;
  } | null>(null);

  if (!match) {
    navigate(fromPage);
    return null;
  }

  const isMatchSingles = match.teamA[1] === '' && match.teamB[1] === '';
  const leftScore = swap ? scoreB : scoreA;
  const rightScore = swap ? scoreA : scoreB;

  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '未設定';
  };

  const handlePlayerTap = async (position: number) => {
    if (!selectedPlayer) {
      setSelectedPlayer({ position });
      return;
    }
    if (selectedPlayer.position === position) {
      setSelectedPlayer(null);
      return;
    }
    if (!matchId) return;

    if (isMatchSingles) {
      // シングルス: position 0 (teamA[0]) と position 1 (teamB[0]) のみ
      const p = [match.teamA[0], match.teamB[0]];
      const temp = p[selectedPlayer.position];
      p[selectedPlayer.position] = p[position];
      p[position] = temp;
      await writer.updateMatch(matchId, {
        teamA: [p[0], ''] as [string, string],
        teamB: [p[1], ''] as [string, string],
      });
    } else {
      const allPlayers = [...match.teamA, ...match.teamB];
      const temp = allPlayers[selectedPlayer.position];
      allPlayers[selectedPlayer.position] = allPlayers[position];
      allPlayers[position] = temp;
      await writer.updateMatch(matchId, {
        teamA: [allPlayers[0], allPlayers[1]] as [string, string],
        teamB: [allPlayers[2], allPlayers[3]] as [string, string],
      });
    }
    setSelectedPlayer(null);
  };

  const handleNumberClick = (num: number) => {
    if (inputHistory.length === 0) {
      if (swap) setScoreB(num);
      else setScoreA(num);
      setInputHistory([`${num}`]);
    } else if (inputHistory.length === 1) {
      if (swap) setScoreA(num);
      else setScoreB(num);
      setInputHistory([...inputHistory, `${num}`]);
    }
  };

  const handleClear = () => {
    setScoreA(0);
    setScoreB(0);
    setInputHistory([]);
  };

  // 目標点数に対する最大点数を取得
  const getMaxScore = (target: number): number => {
    switch (target) {
      case 21: return 30;
      case 15: return 21;
      default: return target + 9;
    }
  };

  const maxScore = getMaxScore(targetScore);

  // スコアバリデーション
  const validateScore = (a: number, b: number): string | null => {
    // 同点禁止
    if (a === b) {
      return '同点は入力できません';
    }
    
    // 最大点数到達時は2点差不要（先取で勝利）
    if (a === maxScore || b === maxScore) {
      return null;
    }
    
    // 両方targetScore以上の場合（デュース突入後）、2点差が必要
    if (a >= targetScore && b >= targetScore) {
      if (Math.abs(a - b) !== 2) {
        return 'デュース後は2点差で終了する必要があります';
      }
    }
    
    return null; // バリデーションOK
  };

  const handleConfirm = async () => {
    if (inputHistory.length !== 2) {
      alert('両チームのスコアを入力してください');
      return;
    }

    const validationError = validateScore(scoreA, scoreB);
    if (validationError) {
      alert(validationError);
      return;
    }
    if (!matchId) return;

    const winner = (scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : undefined) as 'A' | 'B' | undefined;
    await writer.updateMatchScore(matchId, scoreA, scoreB, winner);
    navigate(fromPage);
  };

  return (
    <div className="h-[100dvh] bg-muted flex flex-col">
      <div className="max-w-2xl mx-auto w-full flex-1 flex flex-col p-2 gap-1.5 min-h-0">
        {/* 対戦カード */}
        <div className="bg-card rounded-2xl shadow-sm p-3 relative">
          {/* 閉じるボタン - カード右上 */}
          <button
            onClick={() => navigate(fromPage)}
            aria-label="閉じる"
            className="absolute top-1 right-1 p-2 hover:bg-muted active:bg-muted active:scale-[0.98] rounded-full transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <X size={20} className="text-muted-foreground" />
          </button>
          {selectedPlayer && (
            <div className="mb-2 p-2 bg-indigo-50 border border-indigo-200 rounded-xl text-sm text-indigo-700 text-center">
              メンバーを選択中 — 交換したい相手をタップ
            </div>
          )}

          {(() => {
            const renderPlayerButton = (position: number, playerId: string) => (
              <button
                onClick={() => handlePlayerTap(position)}
                className={`min-h-[40px] p-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                  selectedPlayer?.position === position
                    ? 'bg-indigo-500 text-white ring-2 ring-indigo-300 scale-105'
                    : 'bg-card border border-border text-foreground hover:border-gray-300 active:bg-muted active:scale-[0.98]'
                }`}
              >
                {getPlayerName(playerId)}
              </button>
            );

            // position 0=teamA[0], 1=teamA[1], 2=teamB[0], 3=teamB[1]
            // swap が true の時は teamB を左に表示する
            const leftTop = swap ? 2 : 0;
            const leftBottom = swap ? 3 : 1;
            const rightTop = swap ? 0 : 2;
            const rightBottom = swap ? 1 : 3;
            const playerIdAt = (pos: number) =>
              pos === 0 ? match.teamA[0]
                : pos === 1 ? match.teamA[1]
                : pos === 2 ? match.teamB[0]
                : match.teamB[1];

            return isMatchSingles ? (
              /* シングルス: 勝者 vs 敗者 */
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3">
                {renderPlayerButton(leftTop, playerIdAt(leftTop))}
                <span className="text-muted-foreground font-bold text-xs self-center">VS</span>
                {renderPlayerButton(rightTop, playerIdAt(rightTop))}
              </div>
            ) : (
              /* ダブルス: 勝者ペア vs 敗者ペア */
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 gap-y-1.5">
                {renderPlayerButton(leftTop, playerIdAt(leftTop))}
                <span className="text-muted-foreground font-bold text-xs row-span-2 self-center">VS</span>
                {renderPlayerButton(rightTop, playerIdAt(rightTop))}
                {renderPlayerButton(leftBottom, playerIdAt(leftBottom))}
                {renderPlayerButton(rightBottom, playerIdAt(rightBottom))}
              </div>
            );
          })()}
        </div>

        {/* スコア表示 */}
        <div className="bg-card rounded-2xl shadow-sm px-4 py-2">
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">
              {inputHistory.length > 0 ? (
                <>
                  <span className="text-indigo-500">{leftScore}</span>
                  {inputHistory.length === 2 && (
                    <>
                      <span className="text-muted-foreground mx-4">-</span>
                      <span className="text-indigo-500">{rightScore}</span>
                    </>
                  )}
                  {inputHistory.length === 1 && (
                    <span className="text-muted-foreground mx-4">- ?</span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground text-base font-normal">点数を順番にタップ</span>
              )}
            </div>
          </div>
        </div>

        {/* 点数ボタングリッド */}
        <div className="bg-card rounded-2xl shadow-sm p-3 flex-1 min-h-0 flex flex-col">
          <div className="grid grid-cols-6 gap-1 flex-1 min-h-0">
            {Array.from({ length: 31 }, (_, i) => i).map((num) => {
              // targetScore付近（±2）を目立たせる
              const isHighlighted = Math.abs(num - targetScore) <= 2;

              return (
                <button
                  key={num}
                  onClick={() => handleNumberClick(num)}
                  disabled={inputHistory.length >= 2}
                  className={`rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed ${
                    isHighlighted
                      ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 active:bg-indigo-300 active:scale-[0.95]'
                      : 'bg-muted text-foreground hover:bg-muted active:bg-gray-300 active:scale-[0.95]'
                  }`}
                >
                  {num}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* アクションボタン - 画面下部 */}
      <div className="bg-card p-2 pb-safe">
        <div className="max-w-2xl mx-auto grid grid-cols-2 gap-3">
          <button
            onClick={handleClear}
            className="btn-secondary min-h-[44px] py-2 flex items-center justify-center gap-2"
          >
            <Trash2 size={18} />
            クリア
          </button>
          {inputHistory.length === 2 ? (
            <button
              onClick={handleConfirm}
              className="btn-primary min-h-[44px] py-2 font-semibold"
            >
              確定
            </button>
          ) : (
            <button
              onClick={() => navigate(fromPage)}
              className="btn-secondary min-h-[44px] py-2 flex items-center justify-center gap-2"
            >
              <LogOut size={18} />
              閉じる
            </button>
          )}
        </div>
      </div>

      {/* トースト通知（writer エラー用） */}
      <div className="fixed bottom-20 left-0 right-0 z-50 flex flex-col items-center gap-2 pointer-events-none">
        {toast.toasts.map((t) => (
          <Toast key={t.id} message={t.message} type={t.type} onClose={() => toast.hideToast(t.id)} />
        ))}
      </div>
    </div>
  );
}
