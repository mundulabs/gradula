/**
 * Live — the one channel from the service to the browser.
 *
 * SSE, not WebSockets, and the reason is not taste:
 *
 *   We need ONLY service → browser. The browser already has a door for the
 *   other direction, and that door has sign-in, rights and a rate counter. A
 *   second channel running the other way would be a second door in one wall.
 *
 *   SSE reconnects BY ITSELF. A WebSocket that falls through a proxy at three
 *   in the morning stays fallen until someone reloads the page — and a board
 *   that quietly goes stale is worse than one that is empty.
 *
 *   It is ordinary HTTP. The same sign-in, the same headers, the same
 *   Traefik in front of it.
 *
 * WHAT DOES NOT PASS THROUGH HERE: card contents. A message says "something
 * moved in project GRD", and the browser asks. That costs one request and
 * saves having card titles sitting in an open channel whose rights may have
 * changed since it was opened.
 */

const KEEPALIVE_MS = 25_000;

/**
 * `onPresence(projectKey, count)` is told every time a project's audience
 * changes size — the system poll (system.mjs) starts on the first listener
 * and stops on the last, so a service nobody is watching asks nobody.
 */
export function createLive({ onPresence = null } = {}) {
  /** Who is listening — one set of responses per project. */
  const listeners = new Map();

  const write = (res, event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
    catch { /* a dead line clears itself away on the next move */ }
  };

  const presence = (projectKey) => {
    try { onPresence?.(projectKey, listeners.get(projectKey)?.size ?? 0); }
    catch { /* a watcher that throws must not take the line with it */ }
  };

  return {
    /** A browser attaches itself to a project. Returns the cleanup. */
    join(projectKey, res) {
      if (!listeners.has(projectKey)) listeners.set(projectKey, new Set());
      listeners.get(projectKey).add(res);

      // One blank line every 25 seconds. Without it a proxy closes the silent
      // line after a minute, and nobody finds out.
      const clock = setInterval(() => write(res, 'ping', Date.now()), KEEPALIVE_MS);
      clock.unref?.();

      let gone = false;
      const leave = () => {
        if (gone) return;
        gone = true;
        clearInterval(clock);
        listeners.get(projectKey)?.delete(res);
        if (!listeners.get(projectKey)?.size) listeners.delete(projectKey);
        presence(projectKey);
      };
      res.on('close', leave);
      presence(projectKey);
      return leave;
    },

    /**
     * Something moved. ONLY the verb and the card key go out — whoever wants
     * more asks through the door that knows their rights.
     */
    announce(projectKey, { verb, card, actor }) {
      const here = listeners.get(projectKey);
      if (!here?.size) return 0;
      for (const res of here) write(res, 'moved', { verb, card, actor, at: new Date().toISOString() });
      return here.size;
    },

    /**
     * The system picture changed. Like a move, this carries NO content —
     * only WHAT changed and when; whoever listens fetches /api/v1/system
     * through the door that knows their rights. A picture that sat in an
     * open line would be a second copy with rights of its own.
     */
    announceSystem(projectKey, { at, changed = [] }) {
      const here = listeners.get(projectKey);
      if (!here?.size) return 0;
      for (const res of here) write(res, 'system', { at, changed });
      return here.size;
    },

    /** End old subscriptions so EventSource reconnects through canonical authorization. */
    disconnect(projectKey) {
      for (const res of [...(listeners.get(projectKey) ?? [])]) res.end();
    },

    /** The projects somebody is listening to right now. */
    projects() { return [...listeners.keys()]; },

    /** How many browsers are hanging on right now — for the health door. */
    count() {
      let all = 0;
      for (const here of listeners.values()) all += here.size;
      return all;
    },
  };
}

/** The headers without which a proxy buffers the stream and nothing arrives. */
export const LIVE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store, no-transform',
  Connection: 'keep-alive',
  // nginx and its relatives buffer otherwise, and the stream arrives in gusts.
  'X-Accel-Buffering': 'no',
};
