import { describe, it, expect } from "vitest";
import { detectFabrication } from "./fabrication-detector";

describe("detectFabrication", () => {
  it("flags hedging tokens", () => {
    expect(detectFabrication("value is approximately 500 kg")).toBe(
      "approximately",
    );
    expect(detectFabrication("typically around 1200 W")).toBe("typically");
    expect(detectFabrication("not available")).toBe("not available");
  });
  it("returns null for clean text", () => {
    expect(detectFabrication("Mass is 872 kg per NASA press kit")).toBeNull();
  });
});
