/**
 * Our own crash — Gradula reports to Sentry.
 *
 * Until today the Sentry line was fully built and fully empty: token, hook,
 * signature, one incident per cause, writing back — and `firstEvent: None`.
 * We had built the receiving end of a line nobody had ever called.
 *
 * This is the first caller, and it is the most honest one: the service
 * itself. A tool that puts other people's crashes on a board should put its
 * own there first — otherwise nobody knows whether the path works until the
 * moment it is needed.
 *
 * WITHOUT A DSN NOTHING HAPPENS, and that is no shortcoming: a self-hosted
 * instance should report nothing to us. No phoning home (docs/connections).
 */
export async function watch() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.GRADULA_ENV ?? 'production',
      // No traces, no profiles: we want crashes, not telemetry. What is
      // switched on here costs something on every call.
      tracesSampleRate: 0,
      // The body of a request can carry a card title, and a title can carry a
      // customer's name. A crash report needs neither.
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
          if (event.request.headers) delete event.request.headers.authorization;
        }
        return event;
      },
    });
    return Sentry;
  } catch (error) {
    // A service that refuses to start because its crash reporter is missing
    // is a worse position than one that quietly runs without it.
    console.warn('[gradula] no crash reporting:', error.message);
    return null;
  }
}
