const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
} as const;

type LogLevelName = keyof typeof LOG_LEVELS;

interface Logger {
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, error?: unknown): void;
  debug(msg: string, extra?: unknown): void;
}

const rawLevel = (
  process.env.LOG_LEVEL ?? "INFO"
).toUpperCase() as LogLevelName;
const currentLogLevel: number =
  rawLevel in LOG_LEVELS ? LOG_LEVELS[rawLevel] : LOG_LEVELS.INFO;

function formatMessage(level: string, message: string): string {
  return `[${new Date().toISOString()}] [${level}] ${message}`;
}

function withExtra(message: string, extra: unknown): string {
  if (extra === undefined) return message;
  let detail: string;
  if (extra instanceof Error) {
    detail = extra.stack ?? extra.message;
  } else if (
    typeof extra === "string" ||
    typeof extra === "number" ||
    typeof extra === "boolean"
  ) {
    detail = String(extra);
  } else {
    try {
      detail = JSON.stringify(extra);
    } catch {
      detail = Object.prototype.toString.call(extra);
    }
  }
  return `${message}\n${detail}`;
}

const logger: Logger = {
  info(message: string, extra?: unknown): void {
    if (currentLogLevel >= LOG_LEVELS.INFO) {
      console.log(formatMessage("INFO", withExtra(message, extra)));
    }
  },

  warn(message: string, extra?: unknown): void {
    if (currentLogLevel >= LOG_LEVELS.WARN) {
      console.warn(formatMessage("WARN", withExtra(message, extra)));
    }
  },

  error(message: string, error?: unknown): void {
    if (currentLogLevel >= LOG_LEVELS.ERROR) {
      console.error(formatMessage("ERROR", withExtra(message, error)));
    }
  },

  debug(message: string, extra?: unknown): void {
    if (currentLogLevel >= LOG_LEVELS.DEBUG) {
      console.debug(formatMessage("DEBUG", withExtra(message, extra)));
    }
  },
};

export default logger;
export type { Logger };
