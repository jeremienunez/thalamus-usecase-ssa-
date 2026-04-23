import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplFollowUpPlanItem } from "@interview/shared";

const state = vi.hoisted(() => ({
  executeTurnRequest: vi.fn(),
  executeFollowUpRequest: vi.fn(),
  createReplSessionId: vi.fn(),
  createReplTurnId: vi.fn(),
}));

vi.mock("@/usecases/repl-execution", () => ({
  executeTurnRequest: state.executeTurnRequest,
  executeFollowUpRequest: state.executeFollowUpRequest,
}));

vi.mock("@/usecases/repl-session", async () => {
  const actual = await vi.importActual<typeof import("@/usecases/repl-session")>(
    "@/usecases/repl-session",
  );
  return {
    ...actual,
    createReplSessionId: state.createReplSessionId,
    createReplTurnId: state.createReplTurnId,
  };
});

import { useReplRuntime } from "./useReplRuntime";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function item(overrides: Partial<ReplFollowUpPlanItem> = {}): ReplFollowUpPlanItem {
  return {
    followupId: "fu-1",
    kind: "deep_research_30d",
    auto: false,
    title: "Extend verification horizon",
    rationale: "Need more evidence",
    score: 0.7,
    gateScore: 0.6,
    costClass: "medium",
    reasonCodes: ["needs_monitoring"],
    target: null,
    ...overrides,
  };
}

describe("repl useReplRuntime", () => {
  beforeEach(() => {
    state.executeTurnRequest.mockReset();
    state.executeFollowUpRequest.mockReset();
    state.createReplSessionId.mockReset().mockReturnValue("sess-1");
    state.createReplTurnId.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps an empty initial state, ignores blank input, and no-ops on unknown cancellations", () => {
    const { result } = renderHook(() => useReplRuntime());

    act(() => {
      result.current.sendTurn("   ");
      result.current.cancelTurn("missing");
    });

    expect(result.current.open).toBe(false);
    expect(result.current.turns).toEqual([]);
    expect(result.current.inFlight).toBe(0);
    expect(state.executeTurnRequest).not.toHaveBeenCalled();
  });

  it("queues a trimmed turn request and clears its inFlight slot once the request settles", async () => {
    const turn = deferred<void>();
    state.createReplTurnId.mockReturnValueOnce("t-1");
    state.executeTurnRequest.mockImplementationOnce(() => turn.promise);

    const { result } = renderHook(() => useReplRuntime());

    act(() => {
      result.current.sendTurn("  query risk  ");
    });

    expect(result.current.open).toBe(true);
    expect(result.current.inFlight).toBe(1);
    expect(result.current.turns[0]).toMatchObject({
      id: "t-1",
      input: "query risk",
      phase: "classifying",
    });
    expect(state.executeTurnRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: "t-1",
        input: "query risk",
        sessionId: "sess-1",
        signal: expect.any(Object),
        dispatch: expect.any(Function),
      }),
    );

    act(() => {
      turn.resolve();
    });

    await waitFor(() => expect(result.current.inFlight).toBe(0));
  });

  it("dispatches a turn failure when executeTurnRequest rejects with a non-aborted error", async () => {
    state.createReplTurnId.mockReturnValueOnce("t-2");
    state.executeTurnRequest.mockRejectedValueOnce(new Error("turn failed"));

    const { result } = renderHook(() => useReplRuntime());

    act(() => {
      result.current.sendTurn("chat about conjunctions");
    });

    await waitFor(() =>
      expect(result.current.turns[0]).toMatchObject({
        id: "t-2",
        phase: "error",
        error: "turn failed",
      }),
    );
    expect(result.current.inFlight).toBe(0);
  });

  it("stringifies non-Error turn failures and leaves other turns untouched during dispatch", async () => {
    state.createReplTurnId
      .mockReturnValueOnce("t-10")
      .mockReturnValueOnce("t-11");
    state.executeTurnRequest
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce("plain failure");

    const { result } = renderHook(() => useReplRuntime());

    act(() => {
      result.current.sendTurn("first");
    });
    await waitFor(() => expect(result.current.inFlight).toBe(0));

    act(() => {
      result.current.sendTurn("second");
    });

    await waitFor(() =>
      expect(result.current.turns).toMatchObject([
        { id: "t-10", phase: "classifying" },
        { id: "t-11", phase: "error", error: "plain failure" },
      ]),
    );
  });

  it("dispatches a failure on the parent turn when a follow-up request rejects", async () => {
    state.createReplTurnId.mockReturnValueOnce("t-3");
    state.executeTurnRequest.mockResolvedValueOnce(undefined);
    state.executeFollowUpRequest.mockRejectedValueOnce(
      new Error("follow-up failed"),
    );

    const { result } = renderHook(() => useReplRuntime());

    act(() => {
      result.current.sendTurn("parent query");
    });
    await waitFor(() => expect(result.current.inFlight).toBe(0));

    act(() => {
      result.current.runFollowUp("t-3", "parent query", "cycle-1", item());
    });

    expect(state.executeFollowUpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: "t-3",
        query: "parent query",
        parentCycleId: "cycle-1",
        item: item(),
        signal: expect.any(Object),
        dispatch: expect.any(Function),
      }),
    );

    await waitFor(() =>
      expect(result.current.turns[0]).toMatchObject({
        id: "t-3",
        phase: "error",
        error: "follow-up failed",
      }),
    );
    expect(result.current.open).toBe(true);
    expect(result.current.inFlight).toBe(0);
  });

  it("stringifies non-Error follow-up failures", async () => {
    state.createReplTurnId.mockReturnValueOnce("t-12");
    state.executeTurnRequest.mockResolvedValueOnce(undefined);
    state.executeFollowUpRequest.mockRejectedValueOnce(404);

    const { result } = renderHook(() => useReplRuntime());

    act(() => {
      result.current.sendTurn("parent query");
    });
    await waitFor(() => expect(result.current.inFlight).toBe(0));

    act(() => {
      result.current.runFollowUp("t-12", "parent query", "cycle-1", item());
    });

    await waitFor(() =>
      expect(result.current.turns[0]).toMatchObject({
        id: "t-12",
        phase: "error",
        error: "404",
      }),
    );
  });

  it("aborts every in-flight request that belongs to a cancelled turn", () => {
    const turnRequest = deferred<void>();
    const followUpRequest = deferred<void>();
    let turnSignal: AbortSignal | undefined;
    let followUpSignal: AbortSignal | undefined;

    state.createReplTurnId.mockReturnValueOnce("t-4");
    state.executeTurnRequest.mockImplementationOnce(async (args) => {
      turnSignal = args.signal;
      await turnRequest.promise;
    });
    state.executeFollowUpRequest.mockImplementationOnce(async (args) => {
      followUpSignal = args.signal;
      await followUpRequest.promise;
    });

    const { result } = renderHook(() => useReplRuntime());

    act(() => {
      result.current.sendTurn("parent query");
    });
    act(() => {
      result.current.runFollowUp("t-4", "parent query", "cycle-1", item());
    });

    expect(result.current.inFlight).toBe(2);

    act(() => {
      result.current.cancelTurn("t-4");
    });

    expect(turnSignal?.aborted).toBe(true);
    expect(followUpSignal?.aborted).toBe(true);
    expect(result.current.inFlight).toBe(0);
    expect(result.current.turns[0]).toMatchObject({
      id: "t-4",
      phase: "error",
      error: "cancelled",
    });
  });

  it("skips in-flight requests that belong to other turns when cancelling", () => {
    const first = deferred<void>();
    const second = deferred<void>();
    let firstSignal: AbortSignal | undefined;
    let secondSignal: AbortSignal | undefined;

    state.createReplTurnId
      .mockReturnValueOnce("t-20")
      .mockReturnValueOnce("t-21");
    state.executeTurnRequest
      .mockImplementationOnce(async (args) => {
        firstSignal = args.signal;
        await first.promise;
      })
      .mockImplementationOnce(async (args) => {
        secondSignal = args.signal;
        await second.promise;
      });

    const { result } = renderHook(() => useReplRuntime());

    act(() => {
      result.current.sendTurn("first");
      result.current.sendTurn("second");
    });

    act(() => {
      result.current.cancelTurn("t-21");
    });

    expect(firstSignal?.aborted).toBe(false);
    expect(secondSignal?.aborted).toBe(true);
    expect(result.current.inFlight).toBe(1);
  });

  it("ignores aborted turn rejections after cancellation", async () => {
    const turnRequest = deferred<void>();

    state.createReplTurnId.mockReturnValueOnce("t-30");
    state.executeTurnRequest.mockImplementationOnce(async () => {
      await turnRequest.promise;
    });

    const { result } = renderHook(() => useReplRuntime());

    act(() => {
      result.current.sendTurn("cancel me");
    });
    act(() => {
      result.current.cancelTurn("t-30");
    });
    act(() => {
      turnRequest.reject(new Error("should be ignored"));
    });

    await waitFor(() =>
      expect(result.current.turns[0]).toMatchObject({
        id: "t-30",
        phase: "error",
        error: "cancelled",
      }),
    );
  });

  it("ignores aborted follow-up rejections after cancellation", async () => {
    const followUpRequest = deferred<void>();

    state.createReplTurnId.mockReturnValueOnce("t-31");
    state.executeTurnRequest.mockResolvedValueOnce(undefined);
    state.executeFollowUpRequest.mockImplementationOnce(async () => {
      await followUpRequest.promise;
    });

    const { result } = renderHook(() => useReplRuntime());

    act(() => {
      result.current.sendTurn("parent query");
    });
    await waitFor(() => expect(result.current.inFlight).toBe(0));

    act(() => {
      result.current.runFollowUp("t-31", "parent query", "cycle-1", item());
    });
    act(() => {
      result.current.cancelTurn("t-31");
    });
    act(() => {
      followUpRequest.reject(new Error("should be ignored"));
    });

    await waitFor(() =>
      expect(result.current.turns[0]).toMatchObject({
        id: "t-31",
        phase: "error",
        error: "cancelled",
      }),
    );
  });

  it("aborts remaining controllers on unmount", () => {
    const turnRequest = deferred<void>();
    let turnSignal: AbortSignal | undefined;

    state.createReplTurnId.mockReturnValueOnce("t-5");
    state.executeTurnRequest.mockImplementationOnce(async (args) => {
      turnSignal = args.signal;
      await turnRequest.promise;
    });

    const { result, unmount } = renderHook(() => useReplRuntime());

    act(() => {
      result.current.sendTurn("linger");
    });

    expect(turnSignal?.aborted).toBe(false);
    unmount();
    expect(turnSignal?.aborted).toBe(true);
  });
});
