import { CausalAnalyzer } from './causalAnalyzer';
import { EvidenceScorer } from './evidenceScorer';
import { TelemetryEvent, DeploymentEvent } from '../types/telemetry';
import { CausalGraph, Anomaly } from '../types/analysis';

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    timestamp: new Date('2024-01-01T12:00:00Z'),
    eventType: 'exception',
    serviceName: 'svc-a',
    properties: {},
    ...overrides,
  };
}

function makeDeployment(overrides: Partial<DeploymentEvent> = {}): DeploymentEvent {
  return {
    timestamp: new Date('2024-01-01T11:30:00Z'),
    eventType: 'deployment',
    serviceName: 'svc-a',
    properties: {},
    deploymentId: 'dep-1',
    version: 'v1.2.0',
    deployedBy: 'ci',
    ...overrides,
  };
}

describe('CausalAnalyzer', () => {
  let analyzer: CausalAnalyzer;

  beforeEach(() => {
    analyzer = new CausalAnalyzer();
  });

  describe('findEarliestFailure', () => {
    it('throws on empty graph', () => {
      expect(() => analyzer.findEarliestFailure({ nodes: [], edges: [] })).toThrow(
        'Causal graph has no nodes',
      );
    });

    it('returns the single node when graph has one node', () => {
      const node = makeEvent();
      const graph: CausalGraph = { nodes: [node], edges: [] };
      expect(analyzer.findEarliestFailure(graph)).toBe(node);
    });

    it('returns the root node (no incoming edges) with earliest timestamp', () => {
      const early = makeEvent({ timestamp: new Date('2024-01-01T11:00:00Z'), serviceName: 'db' });
      const mid = makeEvent({ timestamp: new Date('2024-01-01T11:05:00Z'), serviceName: 'api' });
      const late = makeEvent({ timestamp: new Date('2024-01-01T11:10:00Z'), serviceName: 'web' });

      const graph: CausalGraph = {
        nodes: [early, mid, late],
        edges: [
          { from: '0', to: '1', confidence: 0.9, evidenceType: 'temporal' },
          { from: '1', to: '2', confidence: 0.8, evidenceType: 'dependency' },
        ],
      };

      expect(analyzer.findEarliestFailure(graph)).toBe(early);
    });

    it('picks earliest among multiple root nodes', () => {
      const rootA = makeEvent({ timestamp: new Date('2024-01-01T11:00:00Z'), serviceName: 'a' });
      const rootB = makeEvent({ timestamp: new Date('2024-01-01T10:50:00Z'), serviceName: 'b' });
      const child = makeEvent({ timestamp: new Date('2024-01-01T11:10:00Z'), serviceName: 'c' });

      const graph: CausalGraph = {
        nodes: [rootA, rootB, child],
        edges: [
          { from: '0', to: '2', confidence: 0.9, evidenceType: 'temporal' },
          { from: '1', to: '2', confidence: 0.8, evidenceType: 'dependency' },
        ],
      };

      expect(analyzer.findEarliestFailure(graph)).toBe(rootB);
    });

    it('falls back to earliest node when all nodes have incoming edges (cycle)', () => {
      const a = makeEvent({ timestamp: new Date('2024-01-01T11:00:00Z'), serviceName: 'a' });
      const b = makeEvent({ timestamp: new Date('2024-01-01T11:05:00Z'), serviceName: 'b' });

      const graph: CausalGraph = {
        nodes: [a, b],
        edges: [
          { from: '0', to: '1', confidence: 0.9, evidenceType: 'temporal' },
          { from: '1', to: '0', confidence: 0.7, evidenceType: 'pattern' },
        ],
      };

      expect(analyzer.findEarliestFailure(graph)).toBe(a);
    });
  });

  describe('identifyRootCauses', () => {
    it('returns empty array for empty graph', () => {
      expect(analyzer.identifyRootCauses({ nodes: [], edges: [] }, [], [])).toEqual([]);
    });

    it('identifies root nodes as root causes', () => {
      const root = makeEvent({ timestamp: new Date('2024-01-01T11:00:00Z'), serviceName: 'db' });
      const child = makeEvent({ timestamp: new Date('2024-01-01T11:05:00Z'), serviceName: 'api' });

      const graph: CausalGraph = {
        nodes: [root, child],
        edges: [{ from: '0', to: '1', confidence: 0.9, evidenceType: 'temporal' }],
      };

      const causes = analyzer.identifyRootCauses(graph, [], []);
      expect(causes).toHaveLength(1);
      expect(causes[0].event).toBe(root);
      expect(causes[0].id).toBe('rc-0');
    });

    it('ranks root causes by confidence (higher first)', () => {
      const rootA = makeEvent({
        timestamp: new Date('2024-01-01T11:00:00Z'),
        serviceName: 'db',
        eventType: 'dependency',
      });
      const rootB = makeEvent({
        timestamp: new Date('2024-01-01T11:02:00Z'),
        serviceName: 'cache',
        eventType: 'request',
      });
      const child = makeEvent({ timestamp: new Date('2024-01-01T11:05:00Z'), serviceName: 'api' });

      const graph: CausalGraph = {
        nodes: [rootA, rootB, child],
        edges: [
          { from: '0', to: '2', confidence: 0.9, evidenceType: 'dependency' },
          { from: '1', to: '2', confidence: 0.5, evidenceType: 'temporal' },
        ],
      };

      const causes = analyzer.identifyRootCauses(graph, [], []);
      expect(causes.length).toBe(2);
      // Higher confidence should come first
      expect(causes[0].confidence).toBeGreaterThanOrEqual(causes[1].confidence);
    });

    it('boosts confidence for deployment-correlated events', () => {
      const event = makeEvent({
        timestamp: new Date('2024-01-01T12:00:00Z'),
        serviceName: 'api',
      });
      const deployment = makeDeployment({
        timestamp: new Date('2024-01-01T11:30:00Z'),
      });

      const graph: CausalGraph = { nodes: [event], edges: [] };

      const withDeploy = analyzer.identifyRootCauses(graph, [], [deployment]);
      const withoutDeploy = analyzer.identifyRootCauses(graph, [], []);

      expect(withDeploy[0].confidence).toBeGreaterThan(withoutDeploy[0].confidence);
      expect(withDeploy[0].category).toBe('deployment');
    });

    it('categorizes dependency events correctly', () => {
      const depEvent = makeEvent({
        eventType: 'dependency',
        serviceName: 'external-api',
      });

      const graph: CausalGraph = { nodes: [depEvent], edges: [] };
      const causes = analyzer.identifyRootCauses(graph, [], []);

      expect(causes[0].category).toBe('dependency');
    });

    it('includes explanation with service name and evidence count', () => {
      const root = makeEvent({ serviceName: 'payment-svc' });
      const child = makeEvent({
        timestamp: new Date('2024-01-01T12:05:00Z'),
        serviceName: 'order-svc',
      });

      const graph: CausalGraph = {
        nodes: [root, child],
        edges: [{ from: '0', to: '1', confidence: 0.9, evidenceType: 'temporal' }],
      };

      const causes = analyzer.identifyRootCauses(graph, [], []);
      expect(causes[0].explanation).toContain('payment-svc');
      expect(causes[0].explanation).toContain('1 correlated downstream event(s)');
    });
  });
});
