/**
 * Structured logging utility for the RCA Assistant.
 * Outputs JSON-formatted log entries for easy parsing.
 */

export type LogLevel = 'error' | 'warning' | 'info' | 'debug';

/** A single structured log entry */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warning: 1,
  info: 2,
  debug: 3,
};

export class Logger {
  private minLevel: LogLevel;

  constructor(minLevel: LogLevel = 'info') {
    this.minLevel = minLevel;
  }

  /** Set the minimum log level */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  warning(message: string, context?: Record<string, unknown>): void {
    this.log('warning', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  /** Core logging method — builds a structured entry and writes it */
  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] > LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (context) {
      entry.context = context;
    }

    this.write(entry);
  }

  /** Writes the log entry as a JSON string. Override for custom output. */
  protected write(entry: LogEntry): void {
    const output = JSON.stringify(entry);
    if (entry.level === 'error') {
      console.error(output);
    } else if (entry.level === 'warning') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }
}

/** Default singleton logger instance */
export const logger = new Logger();
