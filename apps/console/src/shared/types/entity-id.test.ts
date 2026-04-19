import { describe, it, expect } from "vitest";
import { entityKind } from "./entity-id";

describe("entityKind", () => {
  it("sat:… → satellite", () => expect(entityKind("sat:12345")).toBe("satellite"));
  it("op:… → operator", () => expect(entityKind("op:SpaceX")).toBe("operator"));
  it("finding:… → finding", () => expect(entityKind("finding:abc")).toBe("finding"));
  it("conj:… → conjunction", () => expect(entityKind("conj:42")).toBe("conjunction"));
  it("unknown prefix → 'unknown'", () => expect(entityKind("mystery:x")).toBe("unknown"));
  it("no prefix → 'unknown'", () => expect(entityKind("abc")).toBe("unknown"));
});
