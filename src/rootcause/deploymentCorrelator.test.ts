import { DeploymentCorrelator } from './deploymentCorrelator';
import { DeploymentEvent } from '../types/telemetry';

function makeDeployment(overrides: Partial<DeploymentEvent> = {}): DeploymentEvent {
  return {
    timestamp: new Date('2024-01-15T10:00:00Z'),
    eventType: 'deployment',
    serviceName: 'payment-api',
    properties: {},
    deploymentId: 'dep-1',
    version: '1.2.0',
    deployedBy: 'ci-pipeline',
    ...overrides,
  };
}

describe('DeploymentCorrelator', () => {
  const correlator = new DeploymentCorrelator();

  it('returns empty array when no deployments provided', () => {
    const result = correlator.correlateWithDeployments(
      { timestamp: new Date('2024-01-15T11:00:00Z'), serviceName: 'payment-api' },
      [],
    );
    expect(result).toEqual([]);
  });

  it('finds deployment within 1 hour before incident', () => {
    const incident = { timestamp: new Date('2024-01-15T10:30:00Z'), serviceName: 'payment-api' };
    const deployments = [makeDeployment({ timestamp: new Date('2024-01-15T10:00:00Z') })];

    const result = correlator.correlateWithDeployments(incident, deployments);
    expect(result).toHaveLength(1);
    expect(result[0].timeDiffMs).toBe(30 * 60 * 1000);
    expect(result[0].isLikelyRootCause).toBe(true);
  });

  it('excludes deployments more than 1 hour before incident', () => {
    const incident = { timestamp: new Date('2024-01-15T12:00:00Z'), serviceName: 'payment-api' };
    const deployments = [makeDeployment({ timestamp: new Date('2024-01-15T10:00:00Z') })];

    const result = correlator.correlateWithDeployments(incident, deployments);
    expect(result).toHaveLength(0);
  });

  it('excludes deployments after the incident', () => {
    const incident = { timestamp: new Date('2024-01-15T09:00:00Z'), serviceName: 'payment-api' };
    const deployments = [makeDeployment({ timestamp: new Date('2024-01-15T10:00:00Z') })];

    const result = correlator.correlateWithDeployments(incident, deployments);
    expect(result).toHaveLength(0);
  });

  it('marks same-service deployment as likely root cause', () => {
    const incident = { timestamp: new Date('2024-01-15T10:30:00Z'), serviceName: 'payment-api' };
    const deployments = [
      makeDeployment({ timestamp: new Date('2024-01-15T10:00:00Z'), serviceName: 'payment-api' }),
    ];

    const result = correlator.correlateWithDeployments(incident, deployments);
    expect(result[0].isLikelyRootCause).toBe(true);
  });

  it('marks related-service deployment as likely root cause', () => {
    const incident = { timestamp: new Date('2024-01-15T10:30:00Z'), serviceName: 'payment-api' };
    const deployments = [
      makeDeployment({ timestamp: new Date('2024-01-15T10:00:00Z'), serviceName: 'payment-worker' }),
    ];

    const result = correlator.correlateWithDeployments(incident, deployments);
    expect(result[0].isLikelyRootCause).toBe(true);
  });

  it('marks unrelated-service deployment as not likely root cause', () => {
    const incident = { timestamp: new Date('2024-01-15T10:30:00Z'), serviceName: 'payment-api' };
    const deployments = [
      makeDeployment({ timestamp: new Date('2024-01-15T10:00:00Z'), serviceName: 'user-service' }),
    ];

    const result = correlator.correlateWithDeployments(incident, deployments);
    expect(result).toHaveLength(1);
    expect(result[0].isLikelyRootCause).toBe(false);
  });

  it('sorts results by time difference ascending', () => {
    const incident = { timestamp: new Date('2024-01-15T10:30:00Z'), serviceName: 'payment-api' };
    const deployments = [
      makeDeployment({ timestamp: new Date('2024-01-15T09:45:00Z'), deploymentId: 'dep-far' }),
      makeDeployment({ timestamp: new Date('2024-01-15T10:25:00Z'), deploymentId: 'dep-close' }),
    ];

    const result = correlator.correlateWithDeployments(incident, deployments);
    expect(result).toHaveLength(2);
    expect(result[0].deployment.deploymentId).toBe('dep-close');
    expect(result[1].deployment.deploymentId).toBe('dep-far');
  });
});
