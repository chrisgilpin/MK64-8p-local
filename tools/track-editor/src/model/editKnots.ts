import type { TrackDoc } from './types';

export const MIN_KNOTS = 3;

export type DeleteKnotResult =
  | { ok: true; doc: TrackDoc; selected: number }
  | { ok: false; reason: string };

/**
 * Remove a knot and its outgoing segment from a closed loop.
 * Knot 0 (start) cannot be deleted. At least MIN_KNOTS must remain.
 */
export function deleteKnot(
  doc: TrackDoc,
  index: number,
  selected: number,
): DeleteKnotResult {
  const n = doc.spline.knots.length;
  if (index < 0 || index >= n) {
    return { ok: false, reason: 'Invalid knot index.' };
  }
  if (index === 0) {
    return {
      ok: false,
      reason: 'Cannot delete the start knot (orange). It stays at the origin for spawns.',
    };
  }
  if (n <= MIN_KNOTS) {
    return {
      ok: false,
      reason: `Need at least ${MIN_KNOTS} knots for a closed loop.`,
    };
  }

  const next = structuredClone(doc);
  next.spline.knots.splice(index, 1);
  // Segment i is the span from knot i → next; remove the span that left this knot.
  if (index < next.segments.length) {
    next.segments.splice(index, 1);
  }
  // Keep lengths aligned if something drifted.
  while (next.segments.length > next.spline.knots.length) {
    next.segments.pop();
  }
  while (next.segments.length < next.spline.knots.length) {
    const template = next.segments[next.segments.length - 1] ?? next.segments[0];
    next.segments.push(structuredClone(template));
  }

  let newSelected = selected;
  if (selected === index) {
    newSelected = index - 1;
  } else if (selected > index) {
    newSelected = selected - 1;
  }
  newSelected = Math.max(0, Math.min(newSelected, next.spline.knots.length - 1));

  return { ok: true, doc: next, selected: newSelected };
}

export function canDeleteKnot(doc: TrackDoc, index: number): boolean {
  return (
    index > 0 &&
    index < doc.spline.knots.length &&
    doc.spline.knots.length > MIN_KNOTS
  );
}
