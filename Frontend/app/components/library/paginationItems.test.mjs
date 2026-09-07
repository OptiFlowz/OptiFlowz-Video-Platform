import assert from 'node:assert/strict';
import test from 'node:test';
import { getPaginationItems } from './paginationItems.ts';

test('empty and single-page lists retain a visible first page', () => {
  assert.deepEqual(getPaginationItems(1, 0), [1]);
  assert.deepEqual(getPaginationItems(1, 1), [1]);
});

test('page controls stay bounded and keep current, first, and last pages reachable', () => {
  for (const total of [2, 7, 8, 20, 1000]) {
    for (let current = 1; current <= total; current++) {
      const items = getPaginationItems(current, total);
      const numbers = items.filter((item) => typeof item === 'number');
      assert.ok(items.length <= 7);
      assert.equal(numbers[0], 1);
      assert.equal(numbers.at(-1), total);
      assert.ok(numbers.includes(current));
      assert.deepEqual(numbers, [...new Set(numbers)].sort((a, b) => a - b));
      for (let index = 1; index < items.length; index++) {
        if (items[index] === '…') {
          assert.equal(typeof items[index - 1], 'number');
          assert.equal(typeof items[index + 1], 'number');
          assert.ok(items[index + 1] - items[index - 1] > 1);
        } else if (typeof items[index - 1] === 'number') {
          assert.equal(items[index], items[index - 1] + 1);
        }
      }
    }
  }
});

test('out-of-range current pages are clamped after result counts shrink', () => {
  assert.deepEqual(getPaginationItems(99, 8), getPaginationItems(8, 8));
  assert.deepEqual(getPaginationItems(-1, 8), getPaginationItems(1, 8));
});
