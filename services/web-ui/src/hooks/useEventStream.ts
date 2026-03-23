import { useCallback, useEffect, useRef, useState } from "react";

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

interface EventStreamOptions {
  url: string;
  onEvent: (event: { type: string; data: unknown }) => void;
  maxRetries?: number;
}

export function useEventStream({ url, onEvent, maxRetries = 10 }: EventStreamOptions) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const retriesRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      setStatus("connected");
      retriesRef.current = 0;
    };

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        onEventRef.current({ type: parsed.type ?? "message", data: parsed });
      } catch {
        // Ignore malformed messages
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;

      if (retriesRef.current >= maxRetries) {
        setStatus("disconnected");
        return;
      }

      setStatus("reconnecting");
      const delay = Math.min(1000 * Math.pow(2, retriesRef.current), 30_000);
      retriesRef.current++;

      setTimeout(() => {
        connect();
      }, delay);
    };
  }, [url, maxRetries]);

  useEffect(() => {
    connect();
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect]);

  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  return { status, disconnect };
}
