/**
 * Deployment correlator — flags deployments occurring within 1 hour
 * before an incident as potential root causes.
 */

import { DeploymentEvent } from '../types/telemetry';

/** Correlation between an incident and a deployment */
export interface DeploymentCorrelation {
  deployment: DeploymentEvent;
  timeDiffMs: number;
  isLikelyRootCause: boolean;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Correlates incidents with recent deployments to identify
 * deployment-related root causes.
 */
export class DeploymentCorrelator {
  /**
   * Find deployments that occurred within 1 hour before the incident.
   * A deployment is "likely root cause" if it targets the same service
   * (or a related service) and happened within 1 hour before the incident.
   *
   * @param incident - The incident with timestamp and service name
   * @param deployments - List of deployment events to check
   * @returns Correlated deployments sorted by time difference (closest first)
   */
  correlateWithDeployments(
    incident: { timestamp: Date; serviceName: string },
    deployments: DeploymentEvent[],
  ): DeploymentCorrelation[] {
    const incidentTime = incident.timestamp.getTime();

    const correlations: DeploymentCorrelation[] = [];

    for (const deployment of deployments) {
      const depTime = deployment.timestamp.getTime();
      const timeDiffMs = incidentTime - depTime;

      // Only consider deployments that occurred within 1 hour before the incident
      if (timeDiffMs >= 0 && timeDiffMs <= ONE_HOUR_MS) {
        const isLikelyRootCause = this.isRelatedService(
          incident.serviceName,
          deployment.serviceName,
        );

        correlations.push({
          deployment,
          timeDiffMs,
          isLikelyRootCause,
        });
      }
    }

    // Sort by time difference ascending (closest deployment first)
    return correlations.sort((a, b) => a.timeDiffMs - b.timeDiffMs);
  }

  /**
   * Determine if two service names are related.
   * Services are related if they share the same name or a common prefix.
   */
  private isRelatedService(incidentService: string, deploymentService: string): boolean {
    if (incidentService === deploymentService) return true;

    // Check common prefix (e.g., "payment-api" and "payment-worker")
    const incidentParts = incidentService.split('-');
    const deploymentParts = deploymentService.split('-');

    if (incidentParts.length > 1 && deploymentParts.length > 1) {
      return incidentParts[0] === deploymentParts[0];
    }

    return false;
  }
}
