import { readBrainIndex } from './brain.js';
import { sourceRefs } from './config-access.js';
import type { ControlPlane, SourceFreshnessInput } from './types.js';

export async function sourceFreshnessFromBrain(
  controlPlane: ControlPlane,
  brainDir: string
): Promise<SourceFreshnessInput[]> {
  const index = await readBrainIndex(brainDir);
  return sourceRefs(controlPlane)
    .filter((source) => source.freshnessTtl)
    .flatMap((source) => {
      const entityId = source.brainEntityId ?? source.id;
      const entity = index.entities.find((candidate) => candidate.id === entityId);
      return entity
        ? [
            {
              sourceId: source.id,
              lastUpdated: entity.lastUpdated
            }
          ]
        : [];
    });
}
