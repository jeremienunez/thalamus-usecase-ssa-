import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FieldInput } from "./FieldInput";

describe("FieldInput", () => {
  it("renders StringArrayInput for string[] fields even when choices exist", () => {
    render(
      <FieldInput
        kind="string[]"
        choices={["thalamus", "sweep-nullscan"]}
        fieldName="rotation"
        value={["thalamus"]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\+ sweep-nullscan/i })).toBeInTheDocument();
  });
});
