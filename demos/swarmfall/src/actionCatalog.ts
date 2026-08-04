import {
  InputSourceId,
  type SettingsActionDefinition,
} from '../../../packages/adaptive-input/src/index.ts';
import type { ActionPayloadMap } from './actionBus.ts';

/** The only Swarmfall-specific information consumed by the adaptive layer. */
export const SWARMFALL_ACTION_CATALOG = [
  {
    id: 'TOGGLE_SQUAD',
    label: 'Switch squad',
    description: 'Changes control between guards and harvesters.',
    context: 'GAMEPLAY',
    requirements: { task: 'TRIGGER', spatial: false, latencyCritical: false },
    defaultSource: InputSourceId.TOUCH_BUTTON,
    remappable: true,
  },
] as const satisfies readonly SettingsActionDefinition<ActionPayloadMap>[];
