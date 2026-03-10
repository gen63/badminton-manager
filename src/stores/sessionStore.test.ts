import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSessionStore } from './sessionStore';
import type { SessionInformation } from '../types/session';

// Firebase関連のモック
vi.mock('../services/sessionService', () => ({
  updateSession: vi.fn(() => Promise.resolve()),
}));

describe('sessionStore - Information機能', () => {
  beforeEach(() => {
    // ストアをリセット
    useSessionStore.setState({
      session: null,
      currentUser: null,
    });
  });

  describe('updateInformation', () => {
    it('テキストを保存できる', async () => {
      // セッションを初期化
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceDate: '2024-01-01', practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        currentUser: 'TestUser',
      });

      const { updateInformation } = useSessionStore.getState();
      await updateInformation('テスト周知事項');

      const session = useSessionStore.getState().session;
      expect(session?.information).toBeDefined();
      expect(session?.information?.text).toBe('テスト周知事項');
      expect(session?.information?.updatedBy).toBe('TestUser');
      expect(session?.information?.readBy).toEqual(['TestUser']);
    });

    it('空文字列で削除される', async () => {
      // 既に情報がある状態
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceDate: '2024-01-01', practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          information: {
            text: '既存の情報',
            updatedAt: Date.now(),
            readBy: ['TestUser'],
          },
        },
        currentUser: 'TestUser',
      });

      const { updateInformation } = useSessionStore.getState();
      await updateInformation('');

      const session = useSessionStore.getState().session;
      expect(session?.information).toBeUndefined();
    });

    it('空白文字列（スペースのみ）でも削除される', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceDate: '2024-01-01', practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          information: {
            text: '既存の情報',
            updatedAt: Date.now(),
            readBy: ['TestUser'],
          },
        },
        currentUser: 'TestUser',
      });

      const { updateInformation } = useSessionStore.getState();
      await updateInformation('   ');

      const session = useSessionStore.getState().session;
      expect(session?.information).toBeUndefined();
    });

    it('前後の空白がトリムされる', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceDate: '2024-01-01', practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        currentUser: 'TestUser',
      });

      const { updateInformation } = useSessionStore.getState();
      await updateInformation('  テスト  ');

      const session = useSessionStore.getState().session;
      expect(session?.information?.text).toBe('テスト');
    });

    it('更新時に編集者のみreadByに含まれる', async () => {
      // 既に複数人が既読の状態
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceDate: '2024-01-01', practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          information: {
            text: '既存の情報',
            updatedAt: Date.now(),
            readBy: ['User1', 'User2', 'Admin'],
          },
        },
        currentUser: 'Admin',
      });

      const { updateInformation } = useSessionStore.getState();
      await updateInformation('更新された情報');

      const session = useSessionStore.getState().session;
      expect(session?.information?.readBy).toEqual(['Admin']);
    });
  });

  describe('markInformationAsRead', () => {
    it('未読から既読になる', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceDate: '2024-01-01', practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          information: {
            text: 'テスト情報',
            updatedAt: Date.now(),
            readBy: ['Admin'],
          },
        },
        currentUser: 'Member1',
      });

      const { markInformationAsRead } = useSessionStore.getState();
      await markInformationAsRead();

      const session = useSessionStore.getState().session;
      expect(session?.information?.readBy).toEqual(['Admin', 'Member1']);
    });

    it('既読済みの場合は重複しない', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceDate: '2024-01-01', practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          information: {
            text: 'テスト情報',
            updatedAt: Date.now(),
            readBy: ['Admin', 'Member1'],
          },
        },
        currentUser: 'Member1',
      });

      const { markInformationAsRead } = useSessionStore.getState();
      await markInformationAsRead();

      const session = useSessionStore.getState().session;
      expect(session?.information?.readBy).toEqual(['Admin', 'Member1']);
    });

    it('readByがundefinedの場合でも動作する', async () => {
      // 古いデータ構造をシミュレート（readByがない）
      const oldInformation = {
        text: 'テスト情報',
        updatedAt: Date.now(),
      };

      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceDate: '2024-01-01', practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          information: oldInformation as unknown as SessionInformation, // 古いデータ構造をシミュレート
        },
        currentUser: 'Member1',
      });

      const { markInformationAsRead } = useSessionStore.getState();
      await markInformationAsRead();

      const session = useSessionStore.getState().session;
      expect(session?.information?.readBy).toEqual(['Member1']);
    });

    it('informationがない場合は何もしない', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceDate: '2024-01-01', practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        currentUser: 'Member1',
      });

      const { markInformationAsRead } = useSessionStore.getState();
      await markInformationAsRead();

      const session = useSessionStore.getState().session;
      expect(session?.information).toBeUndefined();
    });

    it('currentUserがない場合は何もしない', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceDate: '2024-01-01', practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          information: {
            text: 'テスト情報',
            updatedAt: Date.now(),
            readBy: ['Admin'],
          },
        },
        currentUser: null,
      });

      const { markInformationAsRead } = useSessionStore.getState();
      await markInformationAsRead();

      const session = useSessionStore.getState().session;
      expect(session?.information?.readBy).toEqual(['Admin']);
    });
  });

  describe('未読バッジの判定ロジック', () => {
    it('管理者が更新後、メンバーは未読になる', async () => {
      // 初期状態: 管理者が情報を保存
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceDate: '2024-01-01', practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        currentUser: 'Admin',
      });

      const { updateInformation } = useSessionStore.getState();
      await updateInformation('新しいお知らせ');

      // メンバー視点
      useSessionStore.setState({
        currentUser: 'Member1',
      });

      const session = useSessionStore.getState().session;
      const currentUser = useSessionStore.getState().currentUser;
      const isUnread = session?.information?.text && currentUser && !session.information.readBy?.includes(currentUser);

      expect(isUnread).toBe(true);
    });

    it('メンバーが既読後、未読ではなくなる', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceDate: '2024-01-01', practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          information: {
            text: 'テスト情報',
            updatedAt: Date.now(),
            readBy: ['Admin'],
          },
        },
        currentUser: 'Member1',
      });

      const { markInformationAsRead } = useSessionStore.getState();
      await markInformationAsRead();

      const session = useSessionStore.getState().session;
      const currentUser = useSessionStore.getState().currentUser;
      const isUnread = session?.information?.text && currentUser && !session.information.readBy?.includes(currentUser);

      expect(isUnread).toBe(false);
    });
  });
});
