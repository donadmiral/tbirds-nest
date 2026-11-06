const React = require('react');
const Reconciler = require('react-reconciler');
const { DefaultEventPriority } = require('react-reconciler/constants');

// Real React reconciliation with an in-memory native host. Tests can observe
// instance replacement, prop updates and render failures without a device.
function createHostRenderer() {
  let serial = 0, priority = DefaultEventPriority;
  const errors = [], created = [], removed = [], hostContext = {};
  const append = (parent, child) => {
    const previous = parent.children.indexOf(child);
    if (previous !== -1) parent.children.splice(previous, 1);
    parent.children.push(child);
  };
  const remove = (parent, child) => { removed.push(child); parent.children.splice(parent.children.indexOf(child), 1); };
  const insert = (parent, child, before) => {
    const previous = parent.children.indexOf(child);
    if (previous !== -1) parent.children.splice(previous, 1);
    parent.children.splice(parent.children.indexOf(before), 0, child);
  };
  const noop = () => {};
  const renderer = Reconciler({
    isPrimaryRenderer: true, supportsMutation: true, supportsPersistence: false, supportsHydration: false,
    getPublicInstance: value => value, getRootHostContext: () => hostContext, getChildHostContext: () => hostContext,
    prepareForCommit: () => null, resetAfterCommit: noop, finalizeInitialChildren: () => false,
    shouldSetTextContent: () => false, createTextInstance: text => ({ text, children: [] }),
    createInstance(type, props) { const node = { type, props, serial: ++serial, children: [] }; created.push(node); return node; },
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    clearContainer: parent => { parent.children.length = 0; }, commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; },
    commitTextUpdate: (node, oldText, text) => { node.text = text; }, resetTextContent: noop, commitMount: noop,
    detachDeletedInstance: noop, scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
    supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    setCurrentUpdatePriority: value => { priority = value; }, getCurrentUpdatePriority: () => priority,
    resolveUpdatePriority: () => priority || DefaultEventPriority, shouldAttemptEagerTransition: () => false,
    maySuspendCommit: () => false, preloadInstance: () => true, startSuspendingCommit: noop, suspendInstance: noop,
    waitForCommitToBeReady: () => null, NotPendingTransition: null, HostTransitionContext: React.createContext(null),
    getInstanceFromNode: () => null,
  });
  const container = { children: [] };
  const root = renderer.createContainer(container, 1, null, false, null, '', error => errors.push(error), error => errors.push(error), error => errors.push(error), null);
  const render = element => { renderer.updateContainerSync(element, root, null, null); renderer.flushSyncWork(); };
  const walk = node => [node, ...node.children.flatMap(walk)];
  return {
    render,
    update(action) { renderer.flushSyncFromReconciler(action); renderer.flushSyncWork(); },
    nodes: () => container.children.flatMap(walk),
    close: () => render(null),
    created, removed, errors,
  };
}
module.exports = { createHostRenderer };
