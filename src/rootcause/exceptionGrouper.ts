/**
 * Exception grouper — groups exceptions by type and similar stack traces
 * to identify common failure modes.
 */

import { Exception } from '../types/telemetry';

/** A group of related exceptions */
export interface ExceptionGroup {
  exceptionType: string;
  count: number;
  exceptions: Exception[];
  commonStackPrefix: string;
}

/**
 * Groups exceptions by type and common stack trace prefix
 * to surface common failure modes.
 */
export class ExceptionGrouper {
  /**
   * Group exceptions by type, then within each type group by
   * common stack trace prefix.
   *
   * @param exceptions - Exceptions to group
   * @returns Groups of related exceptions
   */
  groupExceptions(exceptions: Exception[]): ExceptionGroup[] {
    if (exceptions.length === 0) return [];

    // First pass: group by exceptionType
    const byType = new Map<string, Exception[]>();
    for (const ex of exceptions) {
      const list = byType.get(ex.exceptionType) ?? [];
      list.push(ex);
      byType.set(ex.exceptionType, list);
    }

    // Second pass: within each type, sub-group by common stack trace prefix
    const groups: ExceptionGroup[] = [];

    for (const [exceptionType, typeExceptions] of byType) {
      const subGroups = this.subGroupByStackPrefix(typeExceptions);

      for (const subGroup of subGroups) {
        groups.push({
          exceptionType,
          count: subGroup.length,
          exceptions: subGroup,
          commonStackPrefix: this.findCommonStackPrefix(subGroup),
        });
      }
    }

    return groups;
  }

  /**
   * Sub-group exceptions by similar stack trace prefix.
   * Two exceptions are in the same sub-group if they share
   * at least one common stack frame line.
   */
  private subGroupByStackPrefix(exceptions: Exception[]): Exception[][] {
    if (exceptions.length <= 1) return [exceptions];

    const groups: Exception[][] = [];
    const assigned = new Set<number>();

    for (let i = 0; i < exceptions.length; i++) {
      if (assigned.has(i)) continue;

      const group: Exception[] = [exceptions[i]];
      assigned.add(i);

      const baseLines = this.getStackLines(exceptions[i]);

      for (let j = i + 1; j < exceptions.length; j++) {
        if (assigned.has(j)) continue;

        const candidateLines = this.getStackLines(exceptions[j]);
        if (this.hasCommonPrefix(baseLines, candidateLines)) {
          group.push(exceptions[j]);
          assigned.add(j);
        }
      }

      groups.push(group);
    }

    return groups;
  }

  /**
   * Split a stack trace into individual lines.
   */
  private getStackLines(exception: Exception): string[] {
    return exception.stackTrace
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  /**
   * Check if two stack traces share at least one common prefix line.
   */
  private hasCommonPrefix(linesA: string[], linesB: string[]): boolean {
    const minLen = Math.min(linesA.length, linesB.length);
    if (minLen === 0) return true; // empty stacks grouped together

    for (let i = 0; i < minLen; i++) {
      if (linesA[i] === linesB[i]) return true;
      break; // only check from the start
    }

    return false;
  }

  /**
   * Find the longest common stack trace prefix across a group of exceptions.
   */
  private findCommonStackPrefix(exceptions: Exception[]): string {
    if (exceptions.length === 0) return '';
    if (exceptions.length === 1) return exceptions[0].stackTrace;

    const allLines = exceptions.map((ex) => this.getStackLines(ex));
    const minLen = Math.min(...allLines.map((l) => l.length));

    const commonLines: string[] = [];
    for (let i = 0; i < minLen; i++) {
      const line = allLines[0][i];
      if (allLines.every((lines) => lines[i] === line)) {
        commonLines.push(line);
      } else {
        break;
      }
    }

    return commonLines.join('\n');
  }
}
