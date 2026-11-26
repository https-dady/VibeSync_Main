import React from 'react';
import { act, create } from 'react-test-renderer';

let mockChange;
let mockResolve;
const mockRemove = jest.fn();
jest.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: jest.fn((name, listener) => {
      mockChange = listener;
      return { remove: mockRemove };
    }),
    isReduceMotionEnabled: jest.fn(() => new Promise(resolve => { mockResolve = resolve; })),
  },
}));
import useReducedMotion from '../src/hooks/useReducedMotion';

function Preference({ enabled = false }) {
  return React.createElement('preference', { enabled: useReducedMotion(enabled) });
}

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  mockRemove.mockClear();
});

test('account preference disables motion even when system preference is off', async () => {
  let tree;
  await act(async () => { tree = create(<Preference enabled />); });
  await act(async () => { mockResolve(false); });
  expect(tree.root.findByType('preference').props.enabled).toBe(true);
  act(() => tree.unmount());
});

test('late initial system read cannot overwrite a newer accessibility event', async () => {
  let tree;
  await act(async () => { tree = create(<Preference />); });
  act(() => mockChange(true));
  await act(async () => { mockResolve(false); });
  expect(tree.root.findByType('preference').props.enabled).toBe(true);
  act(() => mockChange(false));
  expect(tree.root.findByType('preference').props.enabled).toBe(false);
  act(() => tree.unmount());
});

test('unmount removes listener before the initial preference read completes', async () => {
  let tree;
  await act(async () => { tree = create(<Preference />); });
  act(() => tree.unmount());
  expect(mockRemove).toHaveBeenCalledTimes(1);
  await act(async () => { mockResolve(true); mockChange(true); });
});
