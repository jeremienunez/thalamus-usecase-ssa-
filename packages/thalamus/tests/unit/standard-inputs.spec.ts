import { describe, expect, it, vi } from "vitest";
import type { CortexSkill } from "../../src/cortices/registry";
import type { CortexDataProvider } from "../../src/cortices/types";
import {
  normalizeProviderRows,
  runCortexSqlHelper,
} from "../../src/cortices/strategies/standard-inputs";

const skill: CortexSkill = {
  header: {
    name: "catalog",
    description: "",
    sqlHelper: "listRows",
    params: {},
  },
  body: "",
  filePath: "test://catalog.md",
};

const logger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
};

describe("standard-inputs provider normalization", () => {
  it("normalizes SQL provider rows into JSON-safe records", async () => {
    const row: Record<string, unknown> = {
      id: 123n,
      plannedAt: new Date("2026-04-25T12:00:00.000Z"),
      covariance: new Float32Array([1, 2, 3]),
      nested: {
        noradId: 456n,
        invalidNumber: Number.NaN,
        omitMe: undefined,
      },
    };
    row.self = row;

    const dataProvider: CortexDataProvider = {
      listRows: vi.fn(async () => [row]),
    };

    await expect(
      runCortexSqlHelper({
        skill,
        params: {},
        dataProvider,
        logger,
      }),
    ).resolves.toEqual([
      {
        id: "123",
        plannedAt: "2026-04-25T12:00:00.000Z",
        covariance: { type: "binary", bytes: 12 },
        nested: {
          noradId: "456",
          invalidNumber: null,
        },
        self: "[Circular]",
      },
    ]);
  });

  it("wraps primitive provider output as value rows", () => {
    expect(normalizeProviderRows("raw")).toEqual([{ value: "raw" }]);
    expect(normalizeProviderRows([1n, "two"])).toEqual([
      { value: "1" },
      { value: "two" },
    ]);
  });
});
