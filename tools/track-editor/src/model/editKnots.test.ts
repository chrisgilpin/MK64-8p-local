import { describe, expect, it } from 'vitest';
import { createDefaultOval } from './defaults';
import { canDeleteKnot, deleteKnot, MIN_KNOTS } from './editKnots';

describe('deleteKnot', () => {
  it('removes knot and matching segment', () => {
    const doc = createDefaultOval();
    const before = doc.spline.knots.length;
    const result = deleteKnot(doc, 2, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.spline.knots.length).toBe(before - 1);
    expect(result.doc.segments.length).toBe(result.doc.spline.knots.length);
    expect(result.selected).toBe(1);
  });

  it('refuses to delete the start knot', () => {
    const doc = createDefaultOval();
    const result = deleteKnot(doc, 0, 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/start knot/i);
  });

  it('refuses to go below MIN_KNOTS', () => {
    let doc = createDefaultOval();
    // Shrink to MIN_KNOTS
    while (doc.spline.knots.length > MIN_KNOTS) {
      const r = deleteKnot(doc, doc.spline.knots.length - 1, 0);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      doc = r.doc;
    }
    expect(canDeleteKnot(doc, 1)).toBe(false);
    const result = deleteKnot(doc, 1, 1);
    expect(result.ok).toBe(false);
  });

  it('shifts selection when a lower-index knot is removed', () => {
    const doc = createDefaultOval();
    const result = deleteKnot(doc, 1, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selected).toBe(3);
  });
});
