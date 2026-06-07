/* ============================================================================
 * lib/observability/log.ts — tiny structured logger.
 *
 * A non-invasive wrapper over `console` that emits one structured JSON line per
 * event (level + message + context + ISO timestamp) so logs are greppable and
 * machine-parseable in any log drain. When Sentry is configured
 * (`NEXT_PUBLIC_SENTRY_DSN` set) `warn`/`error` are also forwarded to Sentry as
 * a breadcrumb / captured event respectively. Sentry is imported lazily so this
 * util stays dependency-light and safe to call from any runtime (node/edge),
 * and so it is a complete no-op for Sentry when no DSN is present.
 *
 * This changes no behavior — it only standardizes how a couple of high-value
 * server paths report. Drop-in: `log.error('diligence_run_failed', { runId })`.
 * ========================================================================= */

export type LogLevel = 'info' | 'warn' | 'error';

/** Arbitrary structured context attached to a log line. */
export type LogContext = Record<string, unknown>;

const sentryEnabled = !!process.env.NEXT_PUBLIC_SENTRY_DSN;

/** Serialize an Error into a plain, JSON-friendly shape. */
function serializeError(err: unknown): Record<string, unknown> | undefined {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  if (err === undefined) return undefined;
  return { value: String(err) };
}

/** Pull a leading `Error` (if any) out of the context so it serializes well. */
function normalizeContext(context?: LogContext): {
  rest: LogContext;
  error?: unknown;
} {
  if (!context) return { rest: {} };
  const { error, err, ...rest } = context as LogContext & {
    error?: unknown;
    err?: unknown;
  };
  return { rest, error: error ?? err };
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  const { rest, error } = normalizeContext(context);
  const line = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...rest,
    ...(error !== undefined ? { error: serializeError(error) } : {})
  };

  // One structured line per event. `console.error`/`warn` keep the right stream
  // + severity in hosted log viewers.
  const serialized = JSON.stringify(line);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);

  // Forward to Sentry only when configured. Lazy + best-effort: never let
  // observability throw into a real code path.
  if (!sentryEnabled || level === 'info') return;
  void import('@sentry/nextjs')
    .then((Sentry) => {
      if (level === 'error') {
        if (error instanceof Error) {
          Sentry.captureException(error, { extra: { message, ...rest } });
        } else {
          Sentry.captureMessage(message, { level: 'error', extra: rest });
        }
      } else {
        Sentry.addBreadcrumb({ level: 'warning', message, data: rest });
      }
    })
    .catch(() => {
      /* observability must never break the caller */
    });
}

export const log = {
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context)
};

export default log;
