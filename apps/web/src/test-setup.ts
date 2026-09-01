import '@testing-library/jest-dom';

// jsdom no implementa scrollIntoView y el chat lo usa para el auto-scroll.
// Sin este stub, cualquier render del chat revienta en el useEffect.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

// ResponsiveContainer de recharts mide el contenedor con ResizeObserver.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {
      /* noop */
    }
    unobserve() {
      /* noop */
    }
    disconnect() {
      /* noop */
    }
  };
}
