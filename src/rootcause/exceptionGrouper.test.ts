import { ExceptionGrouper } from './exceptionGrouper';
import { Exception } from '../types/telemetry';

function makeException(overrides: Partial<Exception> = {}): Exception {
  return {
    timestamp: new Date('2024-01-15T10:00:00Z'),
    eventType: 'exception',
    serviceName: 'api-service',
    properties: {},
    exceptionType: 'NullReferenceException',
    message: 'Object reference not set',
    stackTrace: 'at Foo.Bar()\nat Main.Run()',
    severity: 'error',
    ...overrides,
  };
}

describe('ExceptionGrouper', () => {
  const grouper = new ExceptionGrouper();

  it('returns empty array for empty input', () => {
    expect(grouper.groupExceptions([])).toEqual([]);
  });

  it('groups exceptions by type', () => {
    const exceptions = [
      makeException({ exceptionType: 'NullReferenceException' }),
      makeException({ exceptionType: 'NullReferenceException' }),
      makeException({ exceptionType: 'TimeoutException' }),
    ];

    const groups = grouper.groupExceptions(exceptions);
    const types = groups.map((g) => g.exceptionType);
    expect(types).toContain('NullReferenceException');
    expect(types).toContain('TimeoutException');
  });

  it('counts exceptions correctly within a group', () => {
    const exceptions = [
      makeException({ exceptionType: 'NullReferenceException', stackTrace: 'at A()\nat B()' }),
      makeException({ exceptionType: 'NullReferenceException', stackTrace: 'at A()\nat C()' }),
    ];

    const groups = grouper.groupExceptions(exceptions);
    const nullGroup = groups.find((g) => g.exceptionType === 'NullReferenceException');
    expect(nullGroup).toBeDefined();
    expect(nullGroup!.count).toBe(2);
  });

  it('computes common stack prefix for same-type exceptions', () => {
    const exceptions = [
      makeException({ stackTrace: 'at Foo.Bar()\nat Main.Run()' }),
      makeException({ stackTrace: 'at Foo.Bar()\nat Other.Execute()' }),
    ];

    const groups = grouper.groupExceptions(exceptions);
    expect(groups).toHaveLength(1);
    expect(groups[0].commonStackPrefix).toBe('at Foo.Bar()');
  });

  it('returns full stack trace as prefix for single exception', () => {
    const exceptions = [makeException({ stackTrace: 'at Foo.Bar()\nat Main.Run()' })];

    const groups = grouper.groupExceptions(exceptions);
    expect(groups).toHaveLength(1);
    expect(groups[0].commonStackPrefix).toBe('at Foo.Bar()\nat Main.Run()');
  });

  it('sub-groups by different stack prefixes within same type', () => {
    const exceptions = [
      makeException({ stackTrace: 'at Foo.Bar()\nat Main.Run()' }),
      makeException({ stackTrace: 'at Foo.Bar()\nat Main.Run()' }),
      makeException({ stackTrace: 'at Baz.Qux()\nat Other.Start()' }),
    ];

    const groups = grouper.groupExceptions(exceptions);
    // Same type but different stack prefixes → 2 sub-groups
    expect(groups.length).toBe(2);
    expect(groups.some((g) => g.count === 2)).toBe(true);
    expect(groups.some((g) => g.count === 1)).toBe(true);
  });

  it('includes all exceptions in the group', () => {
    const ex1 = makeException({ message: 'first' });
    const ex2 = makeException({ message: 'second' });

    const groups = grouper.groupExceptions([ex1, ex2]);
    const allExceptions = groups.flatMap((g) => g.exceptions);
    expect(allExceptions).toContain(ex1);
    expect(allExceptions).toContain(ex2);
  });
});
