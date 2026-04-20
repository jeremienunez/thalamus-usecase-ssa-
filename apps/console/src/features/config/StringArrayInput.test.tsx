import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StringArrayInput } from "./StringArrayInput";

function Harness() {
  const [value, setValue] = useState<string[]>([]);
  return (
    <StringArrayInput
      value={value}
      choices={["thalamus", "sweep-nullscan", "fish-swarm"]}
      onChange={setValue}
    />
  );
}

describe("StringArrayInput", () => {
  it("adds suggestions as chips and deduplicates them", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /\+ thalamus/i }));
    expect(screen.getByText("thalamus")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /\+ thalamus/i }),
    ).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox"), "thalamus{enter}");
    expect(screen.getAllByText("thalamus")).toHaveLength(1);
  });
});
