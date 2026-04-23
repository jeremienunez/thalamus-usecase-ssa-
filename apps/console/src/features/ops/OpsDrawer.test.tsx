import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  conjunctionFixture,
  payloadFixture,
  satelliteFixture,
  telemetryFixture,
} from "../../../tests/ssa-fixtures";

type OpsDrawerTestState = {
  drawerId: string | null;
  payloadsData: { items: ReturnType<typeof payloadFixture>[] } | undefined;
};

const state: OpsDrawerTestState = vi.hoisted(() => ({
  drawerId: null,
  payloadsData: undefined,
}));

vi.mock("@/shared/ui/uiStore", () => ({
  useUiStore: (
    selector: (value: { drawerId: string | null }) => unknown,
  ) => selector({ drawerId: state.drawerId }),
}));

vi.mock("@/usecases/useSatellitePayloadsQuery", () => ({
  useSatellitePayloadsQuery: () => ({ data: state.payloadsData }),
}));

import { OpsDrawer } from "./OpsDrawer";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));
  state.drawerId = null;
  state.payloadsData = undefined;
});

describe("OpsDrawer", () => {
  it("renders the empty drawer when no satellite is selected", () => {
    render(<OpsDrawer satellite={null} conjunctions={[]} />);

    expect(screen.getByText("SATELLITE")).toBeInTheDocument();
    expect(screen.getByText("select a node")).toBeInTheDocument();
  });

  it("renders identity, telemetry, payloads, tle, provenance, and prioritised conjunctions", () => {
    state.drawerId = "sat:100";
    state.payloadsData = {
      items: [
        payloadFixture(),
        payloadFixture({
          id: 2,
          name: "Relay",
          role: null,
          massKg: null,
          powerW: null,
        }),
      ],
    };
    const satellite = satelliteFixture({
      classificationTier: "restricted",
      opacityScore: 0.93,
      opacityDeficitReasons: ["operator mass unpublished", "bus generation unstated"],
      telemetry: telemetryFixture({
        powerDraw: 1500,
        thermalMargin: -3.2,
      }),
      lastTleIngestedAt: "2026-04-23T11:30:00.000Z",
      meanMotionDrift: 0.0012,
    });
    const conjunctions = [
      conjunctionFixture({
        id: 12,
        probabilityOfCollision: 4e-5,
        secondaryName: "OBJECT-B",
        covarianceQuality: "HIGH",
        epoch: "2026-04-22T10:00:00.000Z",
      }),
      conjunctionFixture({
        id: 11,
        probabilityOfCollision: 1e-6,
        secondaryName: "OBJECT-A",
        epoch: "2026-04-22T09:00:00.000Z",
      }),
    ];

    render(
      <OpsDrawer
        satellite={satellite}
        conjunctions={conjunctions}
        selectedConjunctionId={11}
      />,
    );

    expect(screen.getByText("Crewed orbital laboratory.")).toBeInTheDocument();
    expect(screen.getByText("25544")).toBeInTheDocument();
    expect(screen.getByText("UNDISCLOSED")).toBeInTheDocument();
    expect(screen.getByText("420,000")).toBeInTheDocument();
    expect(screen.getByText("1.5 kW")).toBeInTheDocument();
    expect(screen.getByText("-3.2 °C")).toBeInTheDocument();
    expect(screen.getByText("72 %")).toBeInTheDocument();
    expect(screen.getByText("30 min ago")).toBeInTheDocument();
    expect(screen.getByText("Δmm +0.0012")).toBeInTheDocument();
    expect(screen.getByText("operator mass unpublished")).toBeInTheDocument();
    expect(screen.getByText("σHIGH")).toBeInTheDocument();

    const conjunctionSection = screen.getByText("CONJUNCTIONS (2)").closest("section");
    expect(conjunctionSection).toBeTruthy();
    if (!conjunctionSection) {
      return;
    }
    const rows = within(conjunctionSection);
    const objectA = rows.getByText("OBJECT-A");
    const objectB = rows.getByText("OBJECT-B");
    expect(objectA.compareDocumentPosition(objectB)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    const img = screen.getByAltText("ISS");
    fireEvent.error(img);
    expect(img).toHaveStyle({ display: "none" });
  });

  it("handles limited/open classification, day-scale tle age, null telemetry, and missing payload budgets", () => {
    state.drawerId = "sat:200";
    state.payloadsData = {
      items: [
        payloadFixture({
          id: 3,
          name: "Dry payload",
          massKg: null,
          powerW: null,
        }),
      ],
    };

    const limited = satelliteFixture({
      id: 200,
      name: "LIMITED-SAT",
      classificationTier: "sensitive",
      telemetry: telemetryFixture({
        powerDraw: null,
        thermalMargin: null,
        pointingAccuracy: null,
        attitudeRate: null,
        linkBudget: null,
        dataRate: null,
        payloadDuty: null,
        eclipseRatio: null,
        solarArrayHealth: null,
        batteryDepthOfDischarge: null,
        propellantRemaining: null,
        radiationDose: null,
        debrisProximity: null,
        missionAge: null,
      }),
      massKg: null,
      tleLine1: null,
      tleLine2: null,
      lastTleIngestedAt: "2026-04-20T00:00:00.000Z",
      meanMotionDrift: Number.NaN,
      opacityScore: 0.75,
      opacityDeficitReasons: [],
      photoUrl: null,
      shortDescription: null,
    });

    const { rerender } = render(
      <OpsDrawer satellite={limited} conjunctions={[]} selectedConjunctionId={null} />,
    );

    expect(screen.getByText("LIMITED")).toBeInTheDocument();
    expect(screen.getByText("NON COMMUNIQUE")).toBeInTheDocument();
    expect(screen.getByText("3.5 d ago")).toBeInTheDocument();
    expect(screen.queryByText("HEALTH · 14D")).not.toBeInTheDocument();
    const payloadRow = screen.getByText("Dry payload").closest("div");
    expect(payloadRow).toBeTruthy();
    expect(payloadRow).not.toHaveTextContent("kg");
    expect(payloadRow).not.toHaveTextContent("W");

    const open = satelliteFixture({
      id: 201,
      name: "OPEN-SAT",
      classificationTier: "unclassified",
      opacityScore: 0.4,
      lastTleIngestedAt: "not-a-date",
      meanMotionDrift: Number.POSITIVE_INFINITY,
    });

    rerender(<OpsDrawer satellite={open} conjunctions={[]} selectedConjunctionId={null} />);

    expect(screen.getByText("OPEN")).toBeInTheDocument();
    expect(screen.getByText("PUBLIC DATA GAPS")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();

    rerender(
      <OpsDrawer
        satellite={satelliteFixture({
          id: 202,
          name: "NO-GAPS-SAT",
          opacityScore: 0,
          opacityDeficitReasons: [],
        })}
        conjunctions={[]}
        selectedConjunctionId={null}
      />,
    );

    expect(screen.queryByText("PUBLIC DATA GAPS")).not.toBeInTheDocument();
  });
});
