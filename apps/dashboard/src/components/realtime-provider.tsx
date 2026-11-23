'use client';

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';

export type RealtimeEventType = 'server.updated' | 'server.removed' | 'player.online' | 'player.offline' | 'player.updated' | 'punishment.changed' | 'anticheat.event' | 'inventory.changed';
export interface RealtimeEvent {
  type: RealtimeEventType;
  serverId?: string;
  uuid?: string;
}

type Listener = (event: RealtimeEvent) => void;

interface RealtimeContextValue {
  connected: boolean;
  subscribe: (listener: Listener) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({ connected: false, subscribe: () => () => undefined });

const EVENT_TYPES: RealtimeEventType[] = ['server.updated', 'server.removed', 'player.online', 'player.offline', 'player.updated', 'punishment.changed', 'anticheat.event', 'inventory.changed'];

/**
 * Single Server-Sent Events connection per tab (GET /api/events). The browser
 * reconnects automatically; if the stream is closed because the access token
 * expired, the session is refreshed before reconnecting.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = () => {
      source = new EventSource('/api/events');
      source.addEventListener('ready', () => setConnected(true));
      for (const type of EVENT_TYPES) {
        source.addEventListener(type, (message) => {
          try {
            const event = JSON.parse((message as MessageEvent<string>).data) as RealtimeEvent;
            listeners.current.forEach((listener) => listener(event));
          } catch {
            // ignore malformed payloads
          }
        });
      }
      source.onerror = () => {
        setConnected(false);
        if (source?.readyState === EventSource.CLOSED && !stopped) {
          // The server rejected the stream (e.g. expired access token): refresh, then retry.
          source.close();
          void fetch('/api/auth/refresh', { method: 'POST', headers: { 'x-mnm-csrf': '1' } }).finally(() => {
            if (!stopped) retryTimer = setTimeout(connect, 5000);
          });
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, []);

  const subscribe = (listener: Listener) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  };

  return <RealtimeContext.Provider value={{ connected, subscribe }}>{children}</RealtimeContext.Provider>;
}

/**
 * Calls `onChange` (debounced) whenever one of the given event types arrives.
 * Also falls back to polling every `fallbackMs` in case the stream is down.
 */
export function useLiveRefresh(types: RealtimeEventType[], onChange: () => void, fallbackMs = 60_000): boolean {
  const { connected, subscribe } = useContext(RealtimeContext);
  const callback = useRef(onChange);
  callback.current = onChange;
  const key = types.join(',');

  useEffect(() => {
    const wanted = new Set(key.split(','));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribe((event) => {
      if (!wanted.has(event.type)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => callback.current(), 400);
    });
    const poll = setInterval(() => callback.current(), fallbackMs);
    return () => {
      unsubscribe();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [key, subscribe, fallbackMs]);

  return connected;
}
