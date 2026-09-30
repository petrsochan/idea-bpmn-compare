/*
 * Comparison of extensionElements, the part of a BPMN file bpmn-js-differ does not look at.
 *
 * The differ only diffs a fixed set of BPMN attributes, so a changed Camunda execution listener,
 * input/output mapping, form field or Zeebe task definition produces no change at all - in engine
 * projects exactly the edits that happen most often. The result uses the same
 * { oldValue, newValue } shape as the differ's attribute changes, keyed by extension type, so the
 * existing change list, badges and tooltips render it without any special case.
 *
 * Unlike the differ's own attributes, these values are already in our orientation:
 * oldValue comes from the revision, newValue from the current file, so they must NOT be passed
 * through normalizeAttrs.
 */

/** Rendered per extension type, or undefined when that type is absent on a side. */
export function compareExtensions(oldElement, newElement) {
  const before = byType(oldElement);
  const after = byType(newElement);
  const differences = {};

  for (const type of new Set([ ...Object.keys(before), ...Object.keys(after) ])) {
    if (before[type] !== after[type]) {
      differences[type] = { oldValue: before[type], newValue: after[type] };
    }
  }

  return differences;
}

/** All extension elements of one element, rendered to one stable string per extension type. */
function byType(element) {
  const values = element && element.extensionElements && element.extensionElements.values || [];
  const grouped = {};

  for (const value of values) {
    const type = value && value.$type || 'extension';

    grouped[type] = grouped[type] === undefined ? describe(value) : grouped[type] + ', ' + describe(value);
  }

  return grouped;
}

/**
 * `ExecutionListener(class=com.acme.Listener, event=start)`.
 *
 * Properties are sorted by name so a reordered attribute is not reported as a change. `$parent` is
 * skipped because it is a cyclic back-reference moddle adds, and `$type` because it is already the
 * prefix. `id` is kept: on an extension element it is author-written and meaningful, a form field
 * being the obvious case.
 */
function describe(value) {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  const properties = Object.entries(value)
    .filter(([ name ]) => name !== '$parent' && name !== '$type')
    .sort(([ a ], [ b ]) => a.localeCompare(b))
    .map(([ name, property ]) => name + '=' + describeProperty(property));

  return localName(value.$type) + '(' + properties.join(', ') + ')';
}

function describeProperty(property) {
  if (Array.isArray(property)) {
    return '[' + property.map(describe).join(', ') + ']';
  }

  return describe(property);
}

function localName(type) {
  return type === undefined ? 'extension' : String(type).replace(/^[^:]+:/, '');
}
