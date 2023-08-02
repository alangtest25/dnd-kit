import {effect} from '@dnd-kit/state';
import {Sensor} from '@dnd-kit/abstract';
import type {Axis, Coordinates} from '@dnd-kit/geometry';
import type {CleanupFunction} from '@dnd-kit/types';
import {getOwnerDocument, Listeners} from '@dnd-kit/dom-utilities';

import type {DragDropManager} from '../../manager';
import type {Draggable} from '../../nodes';

export type DistanceMeasurement =
  | number
  | Coordinates
  | Pick<Coordinates, Axis.Horizontal>
  | Pick<Coordinates, Axis.Vertical>;

export interface DelayConstraint {
  value: number;
  tolerance: DistanceMeasurement;
}

export interface DistanceConstraint {
  value: DistanceMeasurement;
  tolerance?: DistanceMeasurement;
}

export interface ActivationConstraints {
  distance?: DistanceConstraint;
  delay?: DelayConstraint;
}

export interface PointerSensorOptions {
  activationConstraints?: ActivationConstraints;
}

/**
 * The PointerSensor class is an input sensor that handles Pointer events,
 * such as mouse, touch and pen interactions.
 */
export class PointerSensor extends Sensor<
  DragDropManager,
  PointerSensorOptions
> {
  protected listeners = new Listeners();

  private cleanup: CleanupFunction | undefined;

  private clearTimeout: CleanupFunction | undefined;

  private initialCoordinates: Coordinates | undefined;

  constructor(protected manager: DragDropManager) {
    super(manager);

    // Adding a non-capture and non-passive `touchmove` listener in order
    // to force `event.preventDefault()` calls to work in dynamically added
    // touchmove event handlers. This is required for iOS Safari.
    this.listeners.bind(window, {
      type: 'touchmove',
      listener() {},
      options: {
        capture: false,
        passive: false,
      },
    });
  }

  public bind(source: Draggable, options?: PointerSensorOptions) {
    const unbind = effect(() => {
      const target = source.activator ?? source.element;
      const listener: EventListener = (event: Event) => {
        if (event instanceof PointerEvent) {
          this.handlePointerDown(event, source, options);
        }
      };

      if (target) {
        target.addEventListener('pointerdown', listener);

        return () => {
          target.removeEventListener('pointerdown', listener);
        };
      }
    });

    return unbind;
  }

  protected handlePointerDown(
    event: PointerEvent,
    source: Draggable,
    options: PointerSensorOptions = {}
  ) {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }

    if (!(event.target instanceof Element)) {
      return;
    }

    if (source.disabled === true) {
      return;
    }

    this.initialCoordinates = {
      x: event.clientX,
      y: event.clientY,
    };

    const {activationConstraints} = options;

    if (!activationConstraints?.delay && !activationConstraints?.distance) {
      this.handleStart(source);
      event.stopImmediatePropagation();
    } else {
      const {delay} = activationConstraints;

      if (delay) {
        const timeout = setTimeout(() => this.handleStart(source), delay.value);

        this.clearTimeout = () => {
          clearTimeout(timeout);
          this.clearTimeout = undefined;
        };
      }
    }

    const ownerDocument = getOwnerDocument(event.target);

    const unbindListeners = this.listeners.bind(ownerDocument, [
      {
        type: 'pointermove',
        listener: (event: PointerEvent) =>
          this.handlePointerMove(event, source, options),
      },
      {
        type: 'pointerup',
        listener: this.handlePointerUp.bind(this),
      },
      {
        // Prevent scrolling on touch devices
        type: 'touchmove',
        listener: preventDefault,
      },
      {
        type: 'keydown',
        listener: this.handleKeyDown.bind(this),
      },
    ]);

    this.cleanup = () => {
      unbindListeners();

      this.clearTimeout?.();
      this.initialCoordinates = undefined;
    };
  }

  protected handlePointerMove(
    event: PointerEvent,
    source: Draggable,
    options: PointerSensorOptions
  ) {
    const coordinates = {
      x: event.clientX,
      y: event.clientY,
    };

    if (this.manager.dragOperation.status === 'dragging') {
      event.preventDefault();
      event.stopPropagation();

      this.manager.actions.move(coordinates);
      return;
    }

    if (!this.initialCoordinates) {
      return;
    }

    const delta = {
      x: coordinates.x - this.initialCoordinates.x,
      y: coordinates.y - this.initialCoordinates.y,
    };
    const {activationConstraints} = options;
    const {distance, delay} = activationConstraints ?? {};

    if (distance) {
      if (
        distance.tolerance != null &&
        hasExceededDistance(delta, distance.tolerance)
      ) {
        return this.handleCancel();
      }
      if (hasExceededDistance(delta, distance.value)) {
        return this.handleStart(source);
      }
    }

    if (delay) {
      if (hasExceededDistance(delta, delay.tolerance)) {
        return this.handleCancel();
      }
    }
  }

  private handlePointerUp(event: PointerEvent) {
    // Prevent the default behaviour of the event
    event.preventDefault();
    event.stopPropagation();

    // End the drag and drop operation
    this.manager.actions.stop();

    // Remove the pointer move and up event listeners
    this.cleanup?.();
  }

  protected handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.handleCancel();
    }
  }

  protected handleStart(source: Draggable) {
    this.clearTimeout?.();

    if (
      !this.initialCoordinates ||
      this.manager.dragOperation.status !== 'idle'
    ) {
      return;
    }

    this.manager.actions.setDragSource(source.id);
    this.manager.actions.start(this.initialCoordinates);
  }

  protected handleCancel() {
    if (this.manager.dragOperation.status !== 'idle') {
      this.manager.actions.cancel();
    }

    // Remove the pointer move and up event listeners
    this.cleanup?.();
  }

  public destroy() {
    // Remove all event listeners
    this.listeners.clear();
  }
}

function preventDefault(event: Event) {
  event.preventDefault();
}

export function hasExceededDistance(
  delta: Coordinates,
  measurement: DistanceMeasurement
): boolean {
  const dx = Math.abs(delta.x);
  const dy = Math.abs(delta.y);

  if (typeof measurement === 'number') {
    return Math.sqrt(dx ** 2 + dy ** 2) > measurement;
  }

  if ('x' in measurement && 'y' in measurement) {
    return dx > measurement.x && dy > measurement.y;
  }

  if ('x' in measurement) {
    return dx > measurement.x;
  }

  if ('y' in measurement) {
    return dy > measurement.y;
  }

  return false;
}
