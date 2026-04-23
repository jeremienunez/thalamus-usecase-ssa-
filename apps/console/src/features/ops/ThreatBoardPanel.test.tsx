import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThreatBoardPanel } from "./ThreatBoardPanel";
import type { ConjunctionDto } from "@/dto/http";

function row(
  overrides: Partial<ConjunctionDto> = {},
): ConjunctionDto {
  return {
    id: 7,
    primaryId: 100,
    secondaryId: 200,
    primaryName: "ISS",
    secondaryName: "STARLINK-1000",
    regime: "LEO",
    epoch: "2026-04-22T00:00:00.000Z",
    minRangeKm: 18.89,
    relativeVelocityKmps: 1.27,
    probabilityOfCollision: 1e-5,
    combinedSigmaKm: 0.36,
    hardBodyRadiusM: 15,
    pcMethod: "foster-gaussian",
    computedAt: "2026-04-22T00:00:00.000Z",
    covarianceQuality: "MED",
    action: "monitor",
    ...overrides,
  };
}

describe("ThreatBoardPanel", () => {
  it("renders formatted range and velocity and emits selection clicks", async () => {
    const user = userEvent.setup();
    const onSelectThreat = vi.fn();
    const onFocusSatellite = vi.fn();

    render(
      <ThreatBoardPanel
        threats={[row()]}
        selectedThreatId={7}
        onSelectThreat={onSelectThreat}
        onFocusSatellite={onFocusSatellite}
      />,
    );

    expect(screen.getByText("18.89")).toBeInTheDocument();
    expect(screen.getByText("km")).toBeInTheDocument();
    expect(screen.getByText("1.27")).toBeInTheDocument();
    expect(screen.getByText("km/s")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /Focus conjunction ISS to STARLINK-1000/i,
      }),
    );

    expect(onSelectThreat).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, minRangeKm: 18.89, relativeVelocityKmps: 1.27 }),
    );

    await user.click(
      screen.getByRole("button", { name: /Focus satellite STARLINK-1000/i }),
    );

    expect(onFocusSatellite).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ id: 7 }),
    );
  });
});
