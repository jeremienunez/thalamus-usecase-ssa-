/**
 * SPEC-SH-002 — AppError hierarchy
 * Traceability:
 *   AC-1 AppError default and override statusCode
 *   AC-2 subclass default statusCodes
 *   AC-3 name equals class name
 *   AC-4 instanceof hierarchy holds
 *   AC-5 isAppError narrows unknown
 *   AC-6 getErrorMessage total over unknown
 *   AC-7 formatError shape for Error and non-Error
 *   AC-8 UnauthorizedError default message
 */
import { describe, it, expect } from "vitest";
import {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  SystemError,
  isAppError,
  getErrorMessage,
  formatError,
} from "../src/utils/error";

describe("SPEC-SH-002 AppError hierarchy", () => {
  it("AC-1 AppError default statusCode is 500 and override is honored", () => {
    expect(new AppError("m").statusCode).toBe(500);
    expect(new AppError("m", 418).statusCode).toBe(418);
  });

  it("AC-2 subclass default statusCodes", () => {
    expect(new ValidationError("x").statusCode).toBe(400);
    expect(new NotFoundError("x").statusCode).toBe(404);
    expect(new UnauthorizedError().statusCode).toBe(401);
    expect(new SystemError("x").statusCode).toBe(500);
  });

  it("AC-3 name equals class name", () => {
    expect(new AppError("x").name).toBe("AppError");
    expect(new ValidationError("x").name).toBe("ValidationError");
    expect(new NotFoundError("x").name).toBe("NotFoundError");
    expect(new UnauthorizedError().name).toBe("UnauthorizedError");
    expect(new SystemError("x").name).toBe("SystemError");
  });

  it("AC-4 instanceof hierarchy holds for every subclass", () => {
    const cases: AppError[] = [
      new ValidationError("x"),
      new NotFoundError("x"),
      new UnauthorizedError(),
      new SystemError("x"),
    ];
    for (const e of cases) {
      expect(e).toBeInstanceOf(AppError);
      expect(e).toBeInstanceOf(Error);
    }
    expect(new ValidationError("x")).toBeInstanceOf(ValidationError);
    expect(new NotFoundError("x")).toBeInstanceOf(NotFoundError);
  });

  it("AC-8 UnauthorizedError default message is 'Unauthorized'", () => {
    const e = new UnauthorizedError();
    expect(e.message).toBe("Unauthorized");
    expect(e.statusCode).toBe(401);
  });
});

describe("SPEC-SH-002 isAppError", () => {
  it("AC-5 returns true for AppError and subclasses", () => {
    expect(isAppError(new AppError("x"))).toBe(true);
    expect(isAppError(new ValidationError("x"))).toBe(true);
    expect(isAppError(new NotFoundError("x"))).toBe(true);
    expect(isAppError(new UnauthorizedError())).toBe(true);
    expect(isAppError(new SystemError("x"))).toBe(true);
  });

  it("AC-5 returns false for plain Error and non-errors; never throws", () => {
    const inputs: unknown[] = [
      new Error("x"),
      new TypeError("x"),
      "str",
      42,
      null,
      undefined,
      { message: "fake" },
      [],
    ];
    for (const v of inputs) {
      expect(() => isAppError(v)).not.toThrow();
      expect(isAppError(v)).toBe(false);
    }
  });
});

describe("SPEC-SH-002 getErrorMessage", () => {
  it("AC-6 returns error.message for Error instances", () => {
    expect(getErrorMessage(new Error("x"))).toBe("x");
    expect(getErrorMessage(new ValidationError("v"))).toBe("v");
  });

  it("AC-6 stringifies non-Error values and never throws", () => {
    expect(getErrorMessage("y")).toBe("y");
    expect(getErrorMessage(42)).toBe("42");
    expect(getErrorMessage(null)).toBe("null");
    expect(getErrorMessage(undefined)).toBe("undefined");
    expect(getErrorMessage({ a: 1 })).toBe(String({ a: 1 }));
    expect(() => getErrorMessage(Symbol("s"))).not.toThrow();
  });
});

describe("SPEC-SH-002 formatError", () => {
  it("AC-7 for AppError returns name, message, stack", () => {
    const e = new AppError("oops");
    const out = formatError(e);
    expect(out.name).toBe("AppError");
    expect(out.message).toBe("oops");
    expect(typeof out.stack).toBe("string");
  });

  it("AC-7 for plain Error returns name, message, stack", () => {
    const e = new TypeError("bad");
    const out = formatError(e);
    expect(out.name).toBe("TypeError");
    expect(out.message).toBe("bad");
    expect(typeof out.stack).toBe("string");
  });

  it("AC-7 for non-Error returns just message string", () => {
    expect(formatError("boom")).toEqual({ message: "boom" });
    expect(formatError(42)).toEqual({ message: "42" });
    expect(formatError(null)).toEqual({ message: "null" });
    expect(formatError(undefined)).toEqual({ message: "undefined" });
  });

  it("AC-7 never throws on arbitrary unknown input", () => {
    const inputs: unknown[] = [null, undefined, 0, "", NaN, {}, [], new Date()];
    for (const v of inputs) {
      expect(() => formatError(v)).not.toThrow();
      const out = formatError(v);
      expect(typeof out.message).toBe("string");
    }
  });
});
