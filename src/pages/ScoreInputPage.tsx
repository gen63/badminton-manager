import { useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { useSessionStore } from '../stores/sessionStore';
import { sortPairWithIndex } from '../lib/utils';
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
  const targetScore = session?.config.targetScore || 21;
  
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

  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '未設定';
  };

  const handlePlayerTap = (position: number) => {
    if (!selectedPlayer) {
      setSelectedPlayer({ position });
    } else if (selectedPlayer.position === position) {
      setSelectedPlayer(null);
    } else {
      if (isMatchSingles) {
        // シングルス: position 0 と 1 のみ (teamA[0] と teamB[0])
        const p = [match.teamA[0], match.teamB[0]];
        const temp = p[selectedPlayer.position];
        p[selectedPlayer.position] = p[position];
        p[position] = temp;

        const updatedHistory = matchHistory.map((m) =>
          m.id === matchId
            ? { ...m, teamA: [p[0], ''] as [string, string], teamB: [p[1], ''] as [string, string] }
            : m
        );
        useGameStore.setState({ matchHistory: updatedHistory });
      } else {
        const allPlayers = [...match.teamA, ...match.teamB];
        const temp = allPlayers[selectedPlayer.position];
        allPlayers[selectedPlayer.position] = allPlayers[position];
        allPlayers[position] = temp;

        const updatedHistory = matchHistory.map((m) =>
          m.id === matchId
            ? {
                ...m,
                teamA: [allPlayers[0], allPlayers[1]] as [string, string],
                teamB: [allPlayers[2], allPlayers[3]] as [string, string],
              }
            : m
        );
        useGameStore.setState({ matchHistory: updatedHistory });
      }
      setSelectedPlayer(null);
    }
  };

  const handleNumberClick = (num: number) => {
    if (inputHistory.length === 0) {
      setScoreA(num);
      setInputHistory([`${num}`]);
    } else if (inputHistory.length === 1) {
      setScoreB(num);
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

  const handleConfirm = () => {
    if (inputHistory.length !== 2) {
      alert('両チームのスコアを入力してください');
      return;
    }

    const validationError = validateScore(scoreA, scoreB);
    if (validationError) {
      alert(validationError);
      return;
    }

    const winner = (scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : undefined) as 'A' | 'B' | undefined;

    useGameStore.setState((state) => ({
      matchHistory: state.matchHistory.map((m) =>
        m.id === matchId ? { ...m, scoreA, scoreB, winner } : m
      ),
    }));
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

          {isMatchSingles ? (
            /* シングルス: A vs B */
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3">
              <button
                onClick={() => handlePlayerTap(0)}
                className={`min-h-[40px] p-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                  selectedPlayer?.position === 0
                    ? 'bg-indigo-500 text-white ring-2 ring-indigo-300 scale-105'
                    : 'bg-card border border-border text-foreground hover:border-gray-300 active:bg-muted active:scale-[0.98]'
                }`}
              >
                {getPlayerName(match.teamA[0])}
              </button>

              <span className="text-muted-foreground font-bold text-xs self-center">VS</span>

              <button
                onClick={() => handlePlayerTap(1)}
                className={`min-h-[40px] p-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                  selectedPlayer?.position === 1
                    ? 'bg-indigo-500 text-white ring-2 ring-indigo-300 scale-105'
                    : 'bg-card border border-border text-foreground hover:border-gray-300 active:bg-muted active:scale-[0.98]'
                }`}
              >
                {getPlayerName(match.teamB[0])}
              </button>
            </div>
          ) : (() => {
            // 強さ順に並び替え。position は元の配列インデックスを保持（teamA: 0/1, teamB: 2/3）
            const teamADisp = sortPairWithIndex(match.teamA, players);
            const teamBDisp = sortPairWithIndex(match.teamB, players);
            const cellClass = (position: number) =>
              `min-h-[40px] p-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                selectedPlayer?.position === position
                  ? 'bg-indigo-500 text-white ring-2 ring-indigo-300 scale-105'
                  : 'bg-card border border-border text-foreground hover:border-gray-300 active:bg-muted active:scale-[0.98]'
              }`;
            return (
              /* ダブルス: 上段 = 強い方, 下段 = 弱い方 */
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 gap-y-1.5">
                {/* A 上段 */}
                <button
                  onClick={() => handlePlayerTap(teamADisp[0].index)}
                  className={cellClass(teamADisp[0].index)}
                >
                  {getPlayerName(teamADisp[0].id)}
                </button>

                {/* VS */}
                <span className="text-muted-foreground font-bold text-xs row-span-2 self-center">VS</span>

                {/* B 上段 */}
                <button
                  onClick={() => handlePlayerTap(teamBDisp[0].index + 2)}
                  className={cellClass(teamBDisp[0].index + 2)}
                >
                  {getPlayerName(teamBDisp[0].id)}
                </button>

                {/* A 下段 */}
                <button
                  onClick={() => handlePlayerTap(teamADisp[1].index)}
                  className={cellClass(teamADisp[1].index)}
                >
                  {getPlayerName(teamADisp[1].id)}
                </button>

                {/* B 下段 */}
                <button
                  onClick={() => handlePlayerTap(teamBDisp[1].index + 2)}
                  className={cellClass(teamBDisp[1].index + 2)}
                >
                  {getPlayerName(teamBDisp[1].id)}
                </button>
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
                  <span className="text-indigo-500">{scoreA}</span>
                  {inputHistory.length === 2 && (
                    <>
                      <span className="text-muted-foreground mx-4">-</span>
                      <span className="text-indigo-500">{scoreB}</span>
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
    </div>
  );
}
