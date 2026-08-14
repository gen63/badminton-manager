import { describe, it, expect, vi, afterEach } from 'vitest';
import { notifyNextMatchSoon } from './notifications';

/** 内部の showNotificationSafely は非同期 IIFE なのでマイクロタスクをフラッシュする。 */
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('notifyNextMatchSoon', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // navigator.serviceWorker は jsdom にデフォルトで存在しないため、
    // テストで生やしたものは明示的に削除して次のテストに影響させない。
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  it('SW registration が active を持つとき showNotification が呼ばれる', async () => {
    const showNotificationMock = vi.fn().mockResolvedValue(undefined);
    const getRegistrationMock = vi.fn().mockResolvedValue({
      active: {},
      showNotification: showNotificationMock,
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: getRegistrationMock },
      configurable: true,
    });

    class NotificationMock {
      static permission: NotificationPermission = 'granted';
    }
    vi.stubGlobal('Notification', NotificationMock);

    notifyNextMatchSoon('3コート付近で試合終了をお待ちください');
    await flushPromises();

    expect(getRegistrationMock).toHaveBeenCalled();
    expect(showNotificationMock).toHaveBeenCalledWith(
      'まもなく出番です',
      expect.objectContaining({
        body: '3コート付近で試合終了をお待ちください',
        tag: 'next-match-soon',
        vibrate: [200, 100, 200],
      })
    );
  });

  it('SW 登録が無いとき new Notification にフォールバックする', async () => {
    // navigator.serviceWorker 自体を生やさない = 'serviceWorker' in navigator が false
    const ctorSpy = vi.fn();
    class NotificationMock {
      static permission: NotificationPermission = 'granted';
      constructor(title: string, options?: NotificationOptions) {
        ctorSpy(title, options);
      }
    }
    vi.stubGlobal('Notification', NotificationMock);

    notifyNextMatchSoon('body');
    await flushPromises();

    expect(ctorSpy).toHaveBeenCalledWith(
      'まもなく出番です',
      expect.objectContaining({ body: 'body', tag: 'next-match-soon' })
    );
  });

  it('コンストラクタが throw しても呼び出し側に伝播しない', async () => {
    class ThrowingNotification {
      static permission: NotificationPermission = 'granted';
      constructor() {
        throw new Error('Illegal constructor');
      }
    }
    vi.stubGlobal('Notification', ThrowingNotification);

    expect(() => notifyNextMatchSoon('body')).not.toThrow();
    await flushPromises();
  });

  it('Notification.permission が granted でないとき何もしない', async () => {
    const getRegistrationMock = vi.fn();
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: getRegistrationMock },
      configurable: true,
    });

    class NotificationMock {
      static permission: NotificationPermission = 'default';
    }
    vi.stubGlobal('Notification', NotificationMock);

    notifyNextMatchSoon('body');
    await flushPromises();

    expect(getRegistrationMock).not.toHaveBeenCalled();
  });
});
