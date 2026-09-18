import '@testing-library/jest-dom/vitest';

// jsdom has no native modal implementation. Real containment/inertness belongs in browser tests.
HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};
