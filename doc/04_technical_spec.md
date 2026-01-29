# バドミントンゲーム練習管理システム - 技術仕様

## 目次
- [1. 技術スタック](#1-技術スタック)
- [2. 認証とセッション管理](#2-認証とセッション管理)
- [3. リアルタイム同期](#3-リアルタイム同期)
- [4. データ永続化](#4-データ永続化)
- [5. Firestore構造](#5-firestore構造)
- [6. 通知システム](#6-通知システム)
- [7. 状態管理](#7-状態管理)
- [8. エラーハンドリング](#8-エラーハンドリング)

---

## 1. 技術スタック（確定版）

### 1.1 フロントエンド
- **フレームワーク**: React 18+ (TypeScript)
- **ビルドツール**: Vite
- **デプロイ形式**: PWA（Progressive Web App）
  - **iOS対応**: `apple-mobile-web-app-capable` 等のメタタグ設定により、Safariの「ホーム画面に追加」からネイティブアプリのように全画面表示が可能。
  - **スプラッシュ画面**: iOS向けに各解像度の起動画面（Splash Screen）を設定。
  - **アプリアイコン**: ホーム画面用の高品質なアイコンを設定。
  - アプリストア不要
  - 更新が即座に反映
  - ホーム画面追加でネイティブ風UI

### 1.2 スタイリング・UI
- **CSS Framework**: Tailwind CSS
- **コンポーネント**: Headless UI（必要に応じて）
- **アイコン**: Lucide React
- **トースト通知**: react-hot-toast

### 1.3 状態管理
- **グローバル状態**: Zustand
- **Firestore連携**: カスタムフック
- **ローカル状態**: React Hooks (useState, useReducer)

### 1.4 ルーティング
- **Router**: React Router v6
- **URL構造**:
  - `/session/create` - セッション作成
  - `/session/:sessionId` - 参加者入室・メイン画面

### 1.5 バックエンド
- **Platform**: Firebase
- **Services**:
  - **Firestore**: リアルタイムデータベース
  - **Authentication**: Anonymous Auth（匿名認証）
  - **Cloud Functions**: サーバーサイド処理（Node.js 20）
    - セッション自動削除
    - プッシュ通知送信
    - スコア未入力リマインダー
  - **Cloud Messaging (FCM)**: プッシュ通知
  - **Hosting**: Webホスティング

### 1.6 開発ツール
- **パッケージ管理**: npm
- **型チェック**: TypeScript 5+
- **リンター**: ESLint
- **フォーマッター**: Prettier
- **テスト**: Vitest（将来実装）
- **PWA**: Vite PWA Plugin

### 1.7 その他ライブラリ
- **日付処理**: date-fns
- **スプレッドシート連携**: Google Sheets API (googleapis)

### 1.8 プロジェクト構成

```
badminton-manager/
├── src/
│   ├── components/          # UIコンポーネント
│   │   ├── Court.tsx
│   │   ├── PlayerList.tsx
│   │   ├── MatchLog.tsx
│   │   └── ...
│   ├── hooks/               # カスタムフック
│   │   ├── useSession.ts
│   │   ├── usePlayers.ts
│   │   ├── useCourts.ts
│   │   └── useFirestore.ts
│   ├── stores/              # Zustand stores
│   │   ├── sessionStore.ts
│   │   ├── playerStore.ts
│   │   └── gameStore.ts
│   ├── lib/                 # ユーティリティ
│   │   ├── firebase.ts      # Firebase初期化
│   │   ├── algorithm.ts     # 配置アルゴリズム
│   │   └── utils.ts
│   ├── types/               # TypeScript型定義
│   │   ├── player.ts
│   │   ├── court.ts
│   │   └── match.ts
│   ├── pages/               # ページコンポーネント
│   │   ├── SessionCreate.tsx
│   │   ├── PlayerSelect.tsx
│   │   ├── Main.tsx
│   │   └── Settings.tsx
│   ├── App.tsx
│   └── main.tsx
├── functions/               # Cloud Functions
│   ├── src/
│   │   ├── index.ts
│   │   ├── cleanup.ts       # セッション自動削除
│   │   └── notifications.ts # 通知送信
│   └── package.json
├── public/
│   ├── manifest.json        # PWA manifest
│   ├── sw.js                # Service Worker
│   └── sounds/
│       └── match-start.mp3
├── firestore.rules          # Firestore Security Rules
├── firestore.indexes.json   # Firestore Indexes
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

### 1.9 TypeScript型定義例

```typescript
// types/player.ts
export interface Player {
  id: string;                    // Anonymous Auth UID
  name: string;                  // ニックネーム
  rating: number;                // レーティング（デフォルト1500）
  matchCount: number;            // 試合数
  lastFinishTime: Date | null;   // 最後の試合終了時刻
  hasUnscoredMatch: boolean;     // スコア未入力フラグ
  isResting: boolean;            // 休憩中フラグ
  fcmToken?: string;             // FCMトークン
  joinedAt: Date;                // 入室時刻
}

// types/court.ts
export type CourtStatus = 'empty' | 'ready' | 'playing';

export interface Court {
  id: string;                    // "court1", "court2", "court3"
  status: CourtStatus;
  playerIds: string[];           // 4人のプレイヤーID
  pairA: string[];               // ペアA（2人）
  startTime?: Date;
}

// types/match.ts
export interface Match {
  id: string;
  matchNumber: number;           // 連番
  courtId: string;
  playerIds: string[];           // 終了時点の4人
  pairA: string[];
  pairB: string[];
  score?: string;                // "21-15" 形式
  startTime: Date;
  endTime?: Date;
  duration?: number;             // 分単位
}

// types/session.ts
export type ScoreType = '21' | '15' | 'free';

export interface SessionConfig {
  scoreType: ScoreType;
  courtCount: number;            // 1-3
  createdAt: Date;
  lastAccessAt: Date;
  spreadsheetUrl?: string;
}
```

---

## 2. 認証とセッション管理

### 2.1 認証方式
**Firebase Anonymous Authentication**

#### 特徴
- ユーザー登録不要
- 初回アクセス時に匿名ユーザーID自動発行
- リロードしても同じユーザーとして認識
- 複数デバイス対応なし（1人1デバイス）

#### 認証フロー
```javascript
// 1. 初回アクセス時
const userCredential = await signInAnonymously(auth);
const uid = userCredential.user.uid;  // 匿名ユーザーID

// 2. 名前選択後、Firestoreに紐付け
await setDoc(doc(db, `sessions/${sessionId}/players/${uid}`), {
  name: selectedName,
  rating: ratingFromSheet || 1500,
  matchCount: 0,
  // ...
});

// 3. リロード時、自動的に同じUIDで認証
onAuthStateChanged(auth, (user) => {
  if (user) {
    // 既存ユーザーとして継続
  }
});
```

### 2.2 セッション管理

#### セッションID生成
```javascript
// ランダムな6文字の英数字
function generateSessionId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}
// 例: "ABC123"
```

#### セッションURL
- 管理者用: `/session/create`
- 参加者用: `/session/{sessionId}`

#### セッション有効期限
- **保持期間**: 48時間アクセスなしで自動削除
- **実装**: Cloud Functions（scheduled）

```javascript
// Cloud Functions
export const cleanupSessions = functions.pubsub
  .schedule('every 1 hours')
  .onRun(async () => {
    const now = Date.now();
    const threshold = 48 * 60 * 60 * 1000; // 48時間
    
    const sessionsRef = db.collection('sessions');
    const snapshot = await sessionsRef.get();
    
    const batch = db.batch();
    snapshot.forEach(doc => {
      const lastAccess = doc.data().config.lastAccessAt;
      if (now - lastAccess > threshold) {
        batch.delete(doc.ref);
      }
    });
    
    await batch.commit();
  });
```

---

## 3. リアルタイム同期

### 3.1 同期方式
**Firestoreリアルタイムリスナー**を使用

### 3.2 監視範囲

#### 常時監視（即座に反映が必要）
- `sessions/{sessionId}/config`
- `sessions/{sessionId}/players`
- `sessions/{sessionId}/courts`

#### 部分監視（最新データのみ）
- `sessions/{sessionId}/matches`（最新10件のみリスナー、残りはページング）

### 3.3 実装例

```javascript
// config監視
const configRef = doc(db, `sessions/${sessionId}/config`);
onSnapshot(configRef, (snapshot) => {
  const config = snapshot.data();
  updateLocalState(config);
});

// players監視
const playersRef = collection(db, `sessions/${sessionId}/players`);
onSnapshot(playersRef, (snapshot) => {
  const players = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
  updatePlayers(players);
});

// matches監視（最新10件のみ）
const matchesRef = collection(db, `sessions/${sessionId}/matches`);
const q = query(matchesRef, orderBy('matchNumber', 'desc'), limit(10));
onSnapshot(q, (snapshot) => {
  const matches = snapshot.docs.map(doc => doc.data());
  updateRecentMatches(matches);
});
```

### 3.4 オフライン対応
- **基本方針**: オンライン必須
- **オフライン時**: 閲覧のみ可能（操作は制限）
- **再接続時**: 自動的にFirestoreと再同期

---

## 4. データ永続化

### 4.1 保存場所
Firestore（クラウド）

### 4.2 保存期間
- 48時間アクセスなしで自動削除
- 手動削除も可能（練習リセット機能）

### 4.3 データバックアップ
- 履歴コピー機能でローカルに保存可能（テキスト形式）
- 将来実装: ログアーカイブ機能（Firestoreに別コレクションで保存）

---

## 5. Firestore構造

### 5.1 データモデル

```javascript
sessions/{sessionId}/
  ├─ config/
  │   ├─ scoreType: "21" | "15" | "free"
  │   ├─ courtCount: number (1-3)
  │   ├─ createdAt: timestamp
  │   ├─ lastAccessAt: timestamp
  │   └─ spreadsheetUrl?: string
  │
  ├─ players/{playerId}/  // playerIdはAnonymous Auth UID
  │   ├─ name: string
  │   ├─ rating: number (デフォルト1500)
  │   ├─ matchCount: number
  │   ├─ lastFinishTime: timestamp | null
  │   ├─ hasUnscoredMatch: boolean
  │   ├─ isResting: boolean
  │   ├─ fcmToken?: string  // 最新デバイスのトークンのみ
  │   └─ joinedAt: timestamp
  │
  ├─ courts/{courtId}/  // courtId: "court1", "court2", "court3"
  │   ├─ status: "empty" | "ready" | "playing"
  │   ├─ playerIds: string[] (4人)
  │   ├─ startTime?: timestamp
  │   └─ pairA: string[] (2人)
  │
  ├─ matches/{matchId}/
  │   ├─ matchNumber: number
  │   ├─ courtId: string
  │   ├─ playerIds: string[] (終了時点の4人)
  │   ├─ pairA: string[]
  │   ├─ pairB: string[]
  │   ├─ score?: string
  │   ├─ startTime: timestamp
  │   ├─ endTime?: timestamp
  │   └─ duration?: number (分単位)
  │
  └─ userPreferences/{userId}/
      └─ hiddenMatchIds: string[]  // 個人ごとの非表示設定
```

### 5.2 Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // セッション配下のデータは全員読み書き可能
    match /sessions/{sessionId}/{document=**} {
      allow read, write: if true;
    }
    
    // ユーザープリファレンスは本人のみ
    match /sessions/{sessionId}/userPreferences/{userId} {
      allow read, write: if request.auth.uid == userId;
    }
  }
}
```

### 5.3 インデックス

```json
{
  "indexes": [
    {
      "collectionGroup": "matches",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "matchNumber", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "players",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "matchCount", "order": "ASCENDING" },
        { "fieldPath": "joinedAt", "order": "ASCENDING" }
      ]
    }
  ]
}
```

---

## 6. 通知システム

### 6.1 FCM（Firebase Cloud Messaging）

#### トークン管理
```javascript
// トークン取得タイミング: 名前選択後（S02完了時）
const messaging = getMessaging();
const token = await getToken(messaging);

// Firestoreに保存
await updateDoc(doc(db, `sessions/${sessionId}/players/${uid}`), {
  fcmToken: token  // 最新デバイスのトークンで上書き
});
```

#### 通知送信（Cloud Functions）
```javascript
export const sendMatchStartNotification = functions.firestore
  .document('sessions/{sessionId}/courts/{courtId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    
    // ready → playing に変更された場合
    if (before.status === 'ready' && after.status === 'playing') {
      const playerIds = after.playerIds;
      
      // FCMトークン取得
      const tokens = await Promise.all(
        playerIds.map(async id => {
          const playerDoc = await getDoc(
            doc(db, `sessions/${context.params.sessionId}/players/${id}`)
          );
          return playerDoc.data().fcmToken;
        })
      );
      
      // 通知送信
      await messaging.sendMulticast({
        tokens: tokens.filter(Boolean),
        notification: {
          title: '試合開始',
          body: 'あなたの試合が始まります！'
        }
      });
    }
  });
```

### 6.2 Web Audio API

```javascript
// アプリ内音声再生
function playMatchStartSound() {
  if (document.hasFocus()) {
    const audio = new Audio('/sounds/match-start.mp3');
    audio.play().catch(err => console.error('Audio play failed:', err));
  }
}
```

### 1.10 主要な実装例

#### Zustand Store
```typescript
// stores/sessionStore.ts
import { create } from 'zustand';
import { Player, Court, Match, SessionConfig } from '@/types';

interface SessionState {
  sessionId: string | null;
  config: SessionConfig | null;
  players: Player[];
  courts: Court[];
  matches: Match[];
  
  setSessionId: (id: string) => void;
  updateConfig: (config: SessionConfig) => void;
  // ...
}

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: null,
  config: null,
  players: [],
  courts: [],
  matches: [],
  
  setSessionId: (id) => set({ sessionId: id }),
  updateConfig: (config) => set({ config }),
  // ...
}));
```

#### Firestore Hook
```typescript
// hooks/usePlayers.ts
import { useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useSessionStore } from '@/stores/sessionStore';

export function usePlayers() {
  const { sessionId, players, setPlayers } = useSessionStore();
  
  useEffect(() => {
    if (!sessionId) return;
    
    const unsubscribe = onSnapshot(
      collection(db, `sessions/${sessionId}/players`),
      (snapshot) => {
        const playerData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          lastFinishTime: doc.data().lastFinishTime?.toDate() || null,
          joinedAt: doc.data().joinedAt.toDate(),
        })) as Player[];
        
        setPlayers(playerData);
      }
    );
    
    return () => unsubscribe();
  }, [sessionId]);
  
  return players;
}
```

#### 配置アルゴリズム
```typescript
// lib/algorithm.ts
export function selectPlayers(
  candidates: Player[],
  courtCount: number,
  targetCourt: number
): Player[] {
  // 1. グルーピング
  const groups = groupPlayersByRating(candidates, courtCount);
  
  // 2. 選択可能メンバー抽出
  const eligible = getEligiblePlayers(groups, targetCourt, courtCount);
  
  // 3. 優先度スコアリング
  const scored = eligible.map(player => ({
    player,
    score: calculatePriorityScore(player, candidates)
  }));
  
  // 4. 上位4人選択
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(s => s.player);
}

function calculatePriorityScore(player: Player, allPlayers: Player[]): number {
  const waitTime = player.lastFinishTime 
    ? Date.now() - player.lastFinishTime.getTime() 
    : 0;
  
  const unscoredCoef = player.hasUnscoredMatch ? 0.5 : 1.0;
  
  const avgMatches = allPlayers.reduce((sum, p) => sum + p.matchCount, 0) / allPlayers.length;
  const matchCoef = (avgMatches - player.matchCount) / avgMatches + 1.0;
  
  return waitTime * unscoredCoef * matchCoef;
}
```

### 1.11 package.json（主要な依存関係）

```json
{
  "name": "badminton-manager",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "deploy": "npm run build && firebase deploy"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.21.0",
    "zustand": "^4.4.7",
    "firebase": "^10.7.1",
    "date-fns": "^3.0.6",
    "react-hot-toast": "^2.4.1",
    "lucide-react": "^0.303.0",
    "googleapis": "^129.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.47",
    "@types/react-dom": "^18.2.18",
    "@vitejs/plugin-react": "^4.2.1",
    "typescript": "^5.3.3",
    "vite": "^5.0.10",
    "vite-plugin-pwa": "^0.17.4",
    "tailwindcss": "^3.4.1",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.33",
    "eslint": "^8.56.0",
    "prettier": "^3.1.1"
  }
}
```

---

## 7. 状態管理

### 7.1 クライアント側状態
- **待機時間**: 各メンバーの最後のプレイ終了時刻を記録
- **試合数**: 各メンバーの当日の試合数をカウント（終了ボタン押下時に+1）
- **平均試合数**: 全参加者の試合数から平均を計算し、試合数係数の算出に使用
- **スコア未入力状態**: 各メンバーが参加した試合のうち、スコア未入力の試合があるかを管理
- **グルーピング**: 参加者数とコート数に応じて動的にグループを計算
- **組み合わせ履歴**: 当日の4人組み合わせを記録し、3回以上の重複をチェック

### 7.2 実装例（React Context）

```javascript
const GameContext = createContext();

export function GameProvider({ children, sessionId }) {
  const [players, setPlayers] = useState([]);
  const [courts, setCourts] = useState([]);
  const [matches, setMatches] = useState([]);
  
  // Firestoreリスナー
  useEffect(() => {
    const unsubPlayers = onSnapshot(
      collection(db, `sessions/${sessionId}/players`),
      snapshot => setPlayers(snapshot.docs.map(d => ({id: d.id, ...d.data()})))
    );
    
    const unsubCourts = onSnapshot(
      collection(db, `sessions/${sessionId}/courts`),
      snapshot => setCourts(snapshot.docs.map(d => ({id: d.id, ...d.data()})))
    );
    
    return () => {
      unsubPlayers();
      unsubCourts();
    };
  }, [sessionId]);
  
  return (
    <GameContext.Provider value={{ players, courts, matches }}>
      {children}
    </GameContext.Provider>
  );
}
```

---

## 8. エラーハンドリング

### 8.1 ネットワークエラー
```javascript
async function withRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) {
        toast.error('接続エラーが発生しました。再試行してください');
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}
```

### 8.2 Firebaseエラー
```javascript
try {
  await updateDoc(docRef, data);
} catch (error) {
  if (error.code === 'permission-denied') {
    toast.error('アクセス権限がありません');
  } else if (error.code === 'not-found') {
    // ローカル状態とFirestoreを再同期
    await resyncData();
  } else {
    toast.error('エラーが発生しました');
  }
}
```

### 8.3 UI制御
- **ボタン無効化**: 非表示にする
- **ローディング**: 基本不要（重い処理のみ検討）

```javascript
// コート数減少ボタン
{hasActiveCourts ? null : (
  <button onClick={decreaseCourtCount}>−</button>
)}
```

---

## 関連ドキュメント

- [01_overview.md](./01_overview.md) - 概要
- [02_functional_requirements.md](./02_functional_requirements.md) - 機能要件
- [03_session_and_notification.md](./03_session_and_notification.md) - セッション・通知
- [05_screen_design.md](./05_screen_design.md) - 画面設計

---

**作成日**: 2026/01/29  
**最終更新**: 2026/01/29
