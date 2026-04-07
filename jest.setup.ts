import '@testing-library/jest-dom';

process.env.TZ = 'UTC';

class ResizeObserverMock {
  observe() {}

  unobserve() {}

  disconnect() {}
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
  });
}

globalThis.ResizeObserver = ResizeObserverMock;
