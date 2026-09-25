import { Control, controlsUtils, type TransformActionHandler } from 'fabric';
import type { LabelTextbox } from '@/render/LabelTextbox';

/**
 * Text box controls. Side handles resize the box (never stretch glyphs).
 * Corner handles scale the font, or resize the box when auto-fit is on.
 */

type TextTarget = LabelTextbox & { autoFit?: boolean };

const MIN_BOX = 8;

function refit(target: TextTarget): void {
  if (target.autoFit) target.fitToBox(target.width, target.boxHeight);
  else target.initDimensions();
}

/** Resize one box dimension from a handle, keeping the opposite edge fixed. */
function resizeAxis(axis: 'x' | 'y'): TransformActionHandler {
  return (eventData, transform, x, y) => {
    const target = transform.target as TextTarget;
    const origin = axis === 'x' ? transform.originX : transform.originY;
    const local = controlsUtils.getLocalPoint(transform, transform.originX, transform.originY, x, y)[axis];
    const originValue = origin === 'center' ? 0 : origin === 'left' || origin === 'top' ? -0.5 : 0.5;
    // Only grow away from the anchored edge.
    if (!(originValue === 0 || (originValue > 0 && local < 0) || (originValue < 0 && local > 0))) return false;
    const scale = axis === 'x' ? target.scaleX : target.scaleY;
    const size = Math.max(MIN_BOX, Math.abs(local / scale));
    if (axis === 'x') {
      if (size === target.width) return false;
      target.set('width', size);
    } else {
      if (size === target.boxHeight) return false;
      target.set('boxHeight', size);
    }
    refit(target);
    return true;
  };
}

function resizeBoth(): TransformActionHandler {
  const x = resizeAxis('x');
  const y = resizeAxis('y');
  return (eventData, transform, px, py) => {
    const changedX = x(eventData, transform, px, py);
    const changedY = y(eventData, transform, px, py);
    return changedX || changedY;
  };
}

const resizeHandler = (handler: TransformActionHandler) => controlsUtils.wrapWithFireEvent('resizing', controlsUtils.wrapWithFixedAnchor(handler));

function sideControl(x: number, y: number, axis: 'x' | 'y'): Control {
  return new Control({
    x,
    y,
    actionHandler: resizeHandler(resizeAxis(axis)),
    cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
    actionName: 'resizing',
  });
}

function cornerControl(x: number, y: number, autoFit: boolean): Control {
  return autoFit
    ? new Control({ x, y, actionHandler: resizeHandler(resizeBoth()), cursorStyleHandler: controlsUtils.scaleCursorStyleHandler, actionName: 'resizing' })
    : new Control({ x, y, actionHandler: controlsUtils.scalingEqually, cursorStyleHandler: controlsUtils.scaleCursorStyleHandler });
}

export function textControls(autoFit: boolean, base: Record<string, Control>): Record<string, Control> {
  return {
    ...base,
    ml: sideControl(-0.5, 0, 'x'),
    mr: sideControl(0.5, 0, 'x'),
    mt: sideControl(0, -0.5, 'y'),
    mb: sideControl(0, 0.5, 'y'),
    tl: cornerControl(-0.5, -0.5, autoFit),
    tr: cornerControl(0.5, -0.5, autoFit),
    bl: cornerControl(-0.5, 0.5, autoFit),
    br: cornerControl(0.5, 0.5, autoFit),
  };
}
