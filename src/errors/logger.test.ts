import { Logger } from './logger';
import type { LogEntry } from './logger';

/** Test logger that captures entries instead of writing to console */
class TestLogger extends Logger {
  entries: LogEntry[] = [];

  protected write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

describe('Logger', () => {
  let log: TestLogger;

  beforeEach(() => {
    log = new TestLogger('debug');
  });

  it('logs error entries with timestamp, level, and message', () => {
    log.error('something broke');
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].level).toBe('error');
    expect(log.entries[0].message).toBe('something broke');
    expect(log.entries[0].timestamp).toBeDefined();
  });

  it('logs warning, info, and debug levels', () => {
    log.warning('heads up');
    log.info('all good');
    log.debug('details');
    expect(log.entries.map(e => e.level)).toEqual(['warning', 'info', 'debug']);
  });

  it('includes optional context with error type and stack trace', () => {
    const err = new Error('fail');
    log.error('operation failed', {
      errorType: 'NetworkError',
      stack: err.stack,
    });
    expect(log.entries[0].context).toMatchObject({ errorType: 'NetworkError' });
    expect(log.entries[0].context!.stack).toBeDefined();
  });

  it('omits context key when none provided', () => {
    log.info('plain message');
    expect(log.entries[0].context).toBeUndefined();
  });

  it('respects minimum log level', () => {
    log.setLevel('warning');
    log.debug('ignored');
    log.info('also ignored');
    log.warning('kept');
    log.error('also kept');
    expect(log.entries.map(e => e.level)).toEqual(['warning', 'error']);
  });

  it('formats entries as structured JSON', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const jsonLogger = new Logger('info');
    jsonLogger.info('test message');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(parsed).toMatchObject({ level: 'info', message: 'test message' });
    consoleSpy.mockRestore();
  });
});
