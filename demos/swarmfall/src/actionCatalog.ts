import {
  InputSourceId,
  type SettingsActionDefinition,
} from '../../../packages/adaptive-input/src/index.ts';
import type { ActionPayloadMap } from './actionBus.ts';

/** The only Swarmfall-specific information consumed by the adaptive layer. */
export const SWARMFALL_ACTION_CATALOG = [
  {
    id: 'GATHER_UNITS',
    label: 'Gather units',
    description: 'Pull selected units together.',
    context: 'GAMEPLAY',
    requirements: { task: 'TRIGGER', spatial: false, latencyCritical: false },
    defaultSource: InputSourceId.TOUCH_BUTTON,
    remappable: true,
  },
  {
    id: 'SPREAD_UNITS',
    label: 'Spread units',
    description: 'Spread selected units out.',
    context: 'GAMEPLAY',
    requirements: { task: 'TRIGGER', spatial: false, latencyCritical: false },
    defaultSource: InputSourceId.TOUCH_BUTTON,
    remappable: true,
  },
  {
    id: 'TOGGLE_SQUAD',
    label: 'Switch squad',
    description: 'Switch guards and harvesters.',
    context: 'GAMEPLAY',
    requirements: { task: 'TRIGGER', spatial: false, latencyCritical: false },
    defaultSource: InputSourceId.TOUCH_BUTTON,
    remappable: true,
  },
  {
    id: 'DIRECT_UNITS',
    label: 'Direct units',
    description: 'Steer selected units.',
    context: 'GAMEPLAY',
    requirements: { task: 'DIRECTION', spatial: false, latencyCritical: true },
    defaultSource: InputSourceId.TOUCH_DIRECTION,
    remappable: true,
  },
] as const satisfies readonly SettingsActionDefinition<ActionPayloadMap>[];
