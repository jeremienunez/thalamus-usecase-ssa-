import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THALAMUS_TRANSPORT_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";
import { defaultFixturesDir } from "../src/config/transport-config";
import { setThalamusTransportConfigProvider } from "../src/config/runtime-config";

const mocks = vi.hoisted(() => ({
  createLlmTransportMock: vi.fn(),
  realCallMock: vi.fn(),
  fixtureCtorMock: vi.fn(),
  fixtureCallMock: vi.fn(),
}));

vi.mock("../src/transports/llm-chat", () => ({
  createLlmTransport: mocks.createLlmTransportMock,
}));

vi.mock("../src/transports/fixture-transport", () => ({
  FixtureLlmTransport: class {
    constructor(opts: unknown) {
      mocks.fixtureCtorMock(opts);
    }

    async call(userPrompt: string) {
      return mocks.fixtureCallMock(userPrompt);
    }
  },
}));

import { createLlmTransportWithMode } from "../src/transports/factory";

beforeEach(() => {
  mocks.realCallMock.mockReset();
  mocks.fixtureCtorMock.mockReset();
  mocks.fixtureCallMock.mockReset();
  mocks.createLlmTransportMock.mockReset();
  mocks.createLlmTransportMock.mockReturnValue({
    call: mocks.realCallMock,
  });
  setThalamusTransportConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_TRANSPORT_CONFIG),
  );
});

afterEach(() => {
  setThalamusTransportConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_TRANSPORT_CONFIG),
  );
  vi.restoreAllMocks();
});

describe("createLlmTransportWithMode", () => {
  it("calls the real transport directly in cloud mode", async () => {
    mocks.realCallMock.mockResolvedValue({
      content: "cloud reply",
      provider: "openai",
    });
    setThalamusTransportConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_THALAMUS_TRANSPORT_CONFIG,
        mode: "cloud",
      }),
    );

    const transport = createLlmTransportWithMode("SYSTEM", {
      maxRetries: 7,
      enableWebSearch: true,
      preferredProvider: "openai",
    });

    await expect(transport.call("USER")).resolves.toEqual({
      content: "cloud reply",
      provider: "openai",
    });
    expect(mocks.createLlmTransportMock).toHaveBeenCalledWith("SYSTEM", {
      maxRetries: 7,
      enableWebSearch: true,
      preferredProvider: "openai",
    });
    expect(mocks.fixtureCtorMock).not.toHaveBeenCalled();
    expect(mocks.realCallMock).toHaveBeenCalledWith("USER");
  });

  it("routes record mode through the fixture transport with the resolved defaults", async () => {
    mocks.fixtureCallMock.mockResolvedValue({
      content: "recorded reply",
      provider: "kimi",
    });
    setThalamusTransportConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_THALAMUS_TRANSPORT_CONFIG,
        mode: "record",
        fixturesDir: "",
        fallbackFixture: "",
      }),
    );

    const transport = createLlmTransportWithMode("SYSTEM", {
      preferredProvider: "kimi",
    });

    await expect(transport.call("USER")).resolves.toEqual({
      content: "recorded reply",
      provider: "kimi",
    });
    expect(mocks.fixtureCtorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: "SYSTEM",
        mode: "record",
        realTransport: expect.objectContaining({
          call: mocks.realCallMock,
        }),
        fixturesDir: defaultFixturesDir(),
        fallbackFixture: undefined,
      }),
    );
    expect(mocks.fixtureCallMock).toHaveBeenCalledWith("USER");
  });
});
