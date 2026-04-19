import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Sigma + graphology-layout-forceatlas2 touch WebGL/Canvas at import time,
// neither of which exists in jsdom. Mock both globally so any test that
// transitively pulls in the graph adapter (via AppProviders / WrapProviders)
// can mount without blowing up.
vi.mock("sigma", () => ({
  default: vi.fn().mockImplementation(() => ({
    kill: vi.fn(),
    on: vi.fn(),
    getCamera: () => ({
      animate: vi.fn(),
      animatedReset: vi.fn(),
      getState: () => ({}),
      setState: vi.fn(),
    }),
    getGraph: () => ({ nodes: () => [], edges: () => [], forEachNode: vi.fn() }),
    getContainer: () => ({ clientWidth: 800, clientHeight: 600 }),
    refresh: vi.fn(),
    setSetting: vi.fn(),
  })),
}));

vi.mock("graphology-layout-forceatlas2", () => ({
  default: {
    assign: vi.fn(),
    inferSettings: vi.fn(() => ({})),
  },
}));
