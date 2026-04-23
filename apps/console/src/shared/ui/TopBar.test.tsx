import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "./TopBar";

const state = vi.hoisted(() => ({
  pathname: "/thalamus",
  utc: "12:34:56",
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    to,
  }: {
    children: React.ReactNode;
    className?: string;
    to: string;
  }) => (
    <a href={to} data-testid={`link:${to}`} className={className}>
      {children}
    </a>
  ),
  useRouterState: () => ({
    location: { pathname: state.pathname },
  }),
}));

vi.mock("@/hooks/useUtcClock", () => ({
  useUtcClock: () => ({ utc: state.utc }),
}));

vi.mock("@/features/autonomy/Control", () => ({
  AutonomyControl: () => <div>autonomy</div>,
}));

describe("TopBar", () => {
  beforeEach(() => {
    state.pathname = "/thalamus";
    state.utc = "12:34:56";
  });

  it("renders navigation with the active route highlighted", () => {
    render(<TopBar />);

    expect(screen.getByText("THALAMUS · OPERATOR CONSOLE")).toBeInTheDocument();
    expect(screen.getByText("autonomy")).toBeInTheDocument();
    expect(screen.getByText("12:34:56 UTC")).toBeInTheDocument();
    expect(screen.getByTestId("link:/thalamus")).toHaveClass("border-cyan", "text-primary");
    expect(screen.getByTestId("link:/ops")).toHaveClass("border-transparent", "text-muted");
    expect(screen.getByTestId("link:/config")).toHaveTextContent("CONFIG");
  });

  it("switches the active tab when the route changes", () => {
    state.pathname = "/config/runtime";

    render(<TopBar />);

    expect(screen.getByTestId("link:/config")).toHaveClass("border-cyan", "text-primary");
    expect(screen.getByTestId("link:/sweep")).toHaveClass("border-transparent", "text-muted");
  });
});
