/*
 * Pure formatting helpers shared by the badges and the change list. No DOM and no bpmn-js here,
 * so everything in this file is unit-tested in ../test/format.test.js.
 */

export function displayName(change) {
  const model = change.model || {};

  return (model.name || '').trim() || change.id;
}

export function typeName(change) {
  const type = change.model && change.model.$type || '';

  return type.replace(/^bpmn:/, '');
}

export function formatValue(value) {
  if (value === undefined || value === null) {
    return '∅';
  }

  if (Array.isArray(value)) {
    return '[' + value.map(formatValue).join(', ') + ']';
  }

  if (typeof value === 'object') {
    if (value.$type) {
      return value.$type.replace(/^bpmn:/, '') + (value.id ? '#' + value.id : '');
    }

    return JSON.stringify(value);
  }

  const text = String(value);

  return text.length > 120 ? JSON.stringify(text.slice(0, 117) + '...') : JSON.stringify(text);
}

export function describeAttrs(attrs) {
  if (!attrs) {
    return '';
  }

  return Object.entries(attrs)
    .map(([ name, { oldValue, newValue } ]) => name + ': ' + formatValue(oldValue) + ' → ' + formatValue(newValue))
    .join('\n');
}
