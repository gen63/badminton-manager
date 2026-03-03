# Phase 1 実装ガイド

## 📋 実装済み機能

### ✅ 基盤実装（Firebase登録前でも動作）

1. **Firebase SDK 統合**
   - `package.json`: firebase 11.2.0 追加
   - `src/lib/firebase.ts`: Firebase初期化（設定は後で追加）

2. **セッション管理サービス（抽象化）**
   - `src/services/sessionService.ts`
   - モック実装（LocalStorage）→ Firebase実装に段階的移行可能
   - エラーハンドリング統合
   - 主な関数:
     - `createSession()`: セッション作成
     - `getSession()`: セッション取得
     - `subscribeToSession()`: リアルタイム監視
     - `updateSession()`: セッション更新
     - `joinSession()`: 参加者追加

3. **型定義拡張**
   - `src/types/session.ts`: Session型にPhase 1フィールド追加
     - `createdBy`: 管理者名
     - `createdByUID`: LINE UID（Phase 1.5で使用）
     - `participants`: 入室済み参加者リスト
     - `status`: セッション状態

4. **ルーティング**
   - `src/App.tsx`: Phase 1ルート追加
     - `/session/create` (管理者用)
     - `/session/:sessionId` (参加者用)

5. **参加者選択画面（S02）**
   - `src/pages/SessionJoinPage.tsx`
   - URL経由で入室
   - セッション情報表示
   - 参加者リスト表示
   - エラーハンドリング

6. **URL生成・共有機能**
   - `src/components/SessionURLDisplay.tsx`
   - クリップボードコピー
   - Web Share API対応（モバイル）
   - セッションID表示

7. **セッション作成画面の拡張**
   - `src/pages/SessionCreate.tsx`: Phase 1モード対応
   - `/session/create` からのアクセス時はFirebaseにセッション作成
   - Phase 0モード（LocalStorage）も維持
   - エラーハンドリング

### ✅ 権限管理・エラーハンドリング

8. **権限管理ロジック**
   - `src/stores/sessionStore.ts`
     - `currentUser`: 現在のユーザー（Phase 1: 名前、Phase 1.5: LINE UID）
     - `initialize()`: セッション初期化 + currentUser設定
     - `isCreator()`: 管理者判定
     - `updateSession()`: 部分更新

9. **管理者専用UI**
   - `src/pages/SettingsPage.tsx`
     - セッション管理セクション（管理者のみ表示）
     - 履歴コピー機能（タブ区切りフォーマット）
     - 練習リセット（確認ダイアログ付き）
     - 一般ユーザー向け注意事項表示

10. **エラーハンドリング**
    - `src/lib/errorHandler.ts`
      - `SessionError` クラス
      - `getErrorMessage()`: Firebaseエラー変換
      - `withRetry()`: リトライ機能
      - オフライン検出
    - 全サービス関数にエラーハンドリング統合

### ✅ リアルタイム同期の準備

11. **リアルタイム同期フック**
    - `src/hooks/useRealtimeSession.ts`
      - `subscribeToSession()` との連携
      - Zustand `updateSession()` 呼び出し
      - クリーンアップ処理
      - `useRealtimeSessionControl()`: コントロール用

12. **メイン画面統合**
    - `src/pages/MainPage.tsx`
      - `useRealtimeSession()` フック使用
      - Firebase登録後に自動的にリアルタイム同期開始

---

## 🚧 次のステップ（Firebase登録後）

### 1. Firebase 設定情報の追加

`src/lib/firebase.ts` の設定を更新:

```typescript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef"
};
```

### 2. sessionService.ts をFirestore実装に切り替え

各関数のTODOコメントを削除し、Firestore APIを有効化:

```typescript
// 必要なインポート追加
import { db } from '../lib/firebase';
import { doc, setDoc, getDoc, updateDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';

// createSession()
const docRef = doc(db, 'sessions', sessionId);
await setDoc(docRef, {
  ...session,
  id: sessionId,
  createdAt: serverTimestamp(),
  status: 'active'
});

// getSession()
const docRef = doc(db, 'sessions', sessionId);
const docSnap = await getDoc(docRef);
return docSnap.exists() ? docSnap.data() as Session : null;

// subscribeToSession()
const docRef = doc(db, 'sessions', sessionId);
return onSnapshot(docRef, (doc) => {
  callback(doc.exists() ? doc.data() as Session : null);
});

// updateSession()
const docRef = doc(db, 'sessions', sessionId);
await updateDoc(docRef, updates);

// joinSession()
const participantRef = doc(db, `sessions/${sessionId}/participants`, playerName);
await setDoc(participantRef, {
  name: playerName,
  joinedAt: serverTimestamp()
});
```

### 3. リアルタイム同期の有効化

**すでに実装済み！**

- `src/hooks/useRealtimeSession.ts` が自動的に動作
- `src/pages/MainPage.tsx` で既に使用中
- sessionService.ts のFirestore実装に切り替えるだけで自動的にリアルタイム同期開始

### 4. npm install 実行

```bash
cd /home/gen/badminton-manager
npm install
```

### 5. ローカルテスト

```bash
npm run dev
```

- Phase 0モード: http://localhost:5173/badminton-manager/
- Phase 1モード: http://localhost:5173/badminton-manager/session/create

### 6. デプロイ

```bash
git add -A
git commit -m "Phase 1完了: Firebase設定追加"
git push origin phase1-session-sharing
```

---

## 🧪 テスト方法

### ローカルサーバー起動

```bash
cd /home/gen/badminton-manager
npm run dev
```

サーバー起動後:
- **Phase 0モード**: http://localhost:5173/badminton-manager/
- **Phase 1モード**: http://localhost:5173/badminton-manager/session/create

### Phase 0（LocalStorage版）のテスト
1. `/` にアクセス
2. セッション作成
3. `/main` へ遷移
4. 正常に動作することを確認

### Phase 1（Firebase版・モック実装）のテスト

#### シナリオ1: セッション作成
1. `/session/create` にアクセス
2. コート数・点数・参加者を設定
3. 「開始」ボタンをクリック
4. ✅ セッションURLが表示される
5. ✅ URLコピーボタンが機能する
6. 「メイン画面へ」をクリック

#### シナリオ2: セッション情報表示
1. メイン画面で以下が表示されることを確認:
   - ✅ セッション情報カード（ID、管理者、参加者数）
   - ✅ 管理者バッジ
   - ✅ オンライン状態表示

#### シナリオ3: 権限管理
1. 設定画面へ移動
2. ✅ 「セッション管理」セクションが表示される（管理者のみ）
3. ✅ 履歴コピーボタンが機能する
4. ✅ 練習リセットボタンが機能する（確認ダイアログ付き）

#### シナリオ4: 参加者入室（同一ブラウザでテスト）
1. セッションURL（例: `/session/ABC123`）を新しいタブで開く
2. ✅ セッション情報が表示される
3. 名前を入力して「入室する」
4. ✅ メイン画面へ遷移
5. ✅ セッション情報カードで「参加者モード」と表示される
6. 設定画面へ移動
7. ✅ セッション管理セクションが表示されない（一般ユーザー向け注意事項のみ）

#### シナリオ5: リアルタイム同期（モック）
1. 2つのタブで同じセッションを開く
2. 一方で配置・スコア入力などを操作
3. ✅ 2秒ごとにポーリングで状態が同期される（モック実装）

### オフライン動作テスト
1. Chrome DevTools → Network → Offline にチェック
2. ✅ 「オフライン」警告が表示される
3. セッション作成を試みる
4. ✅ エラーメッセージが表示される（モック実装ではオフライン検出のみ）

---

## 📁 ファイル構成

```
src/
├── lib/
│   └── firebase.ts            # Firebase初期化
├── services/
│   └── sessionService.ts      # セッション管理（抽象化）
├── components/
│   └── SessionURLDisplay.tsx  # URL表示・共有
├── pages/
│   ├── SessionCreate.tsx      # セッション作成（Phase 0/1対応）
│   └── SessionJoinPage.tsx    # 参加者選択（Phase 1）
├── stores/
│   └── sessionStore.ts        # セッション状態管理
└── types/
    └── session.ts             # 型定義
```

---

## 🔐 Firestore セキュリティルール（Phase 1）

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // セッション: 誰でも読める、誰でも書ける（Phase 1）
    match /sessions/{sessionId} {
      allow read: if true;
      allow create: if true;
      allow update: if true;
      allow delete: if false;  // 削除は不可
      
      // サブコレクション
      match /{document=**} {
        allow read, write: if true;
      }
    }
  }
}
```

**注意**: Phase 1.5（LINE認証）でルールを厳格化します。

---

## 📊 現在の状態

- ✅ ブランチ作成: `phase1-session-sharing`
- ✅ Firebase SDK追加
- ✅ セッション管理サービス実装（モック）
- ✅ URL生成・共有機能実装
- ✅ 参加者選択画面実装
- ✅ ルーティング追加
- ✅ 権限管理ロジック実装
- ✅ 管理者専用UI実装
- ✅ エラーハンドリング実装
- ✅ リアルタイム同期の準備完了
- ✅ セッション情報表示コンポーネント実装
- ✅ オンライン/オフライン状態表示実装
- ✅ npm install 完了
- ✅ ビルド成功
- ✅ ローカルテスト準備完了
- ⏸️ Firebase 設定待ち
- ⏸️ Firebase実装への切り替え待ち（sessionService.ts のコメント解除）

---

## ❓ FAQ

### Q: Phase 0とPhase 1は同時に動く？
**A**: はい。`/` はPhase 0、`/session/create` はPhase 1として動作します。

### Q: Firebase登録前でもテストできる？
**A**: はい。モック実装（LocalStorage）で動作確認できます。

### Q: Firebase Config はどこに書く？
**A**: `src/lib/firebase.ts` に直接記述（公開情報なのでOK）。

### Q: リアルタイム同期はいつ実装？
**A**: Firebase設定後、`sessionService.ts` のFirestore実装を有効化した後。

---

最終更新: 2026-03-03
