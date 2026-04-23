import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as units from "@/shared/types/units";
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

  it("covers telemetry formatter fallbacks, secondary-side conjunction labels, and payload/query defaults", () => {
    state.drawerId = "sat:300";
    state.payloadsData = undefined;

    const conjunctions = [
      conjunctionFixture({
        id: 30,
        primaryId: 100,
        primaryName: "PRIMARY-HOT",
        secondaryId: 300,
        secondaryName: "SECONDARY-HOT",
        probabilityOfCollision: 2e-4,
        epoch: "2026-04-22T08:00:00.000Z",
      }),
      conjunctionFixture({
        id: 31,
        primaryId: 101,
        primaryName: "PRIMARY-AMBER",
        secondaryId: 300,
        secondaryName: "SECONDARY-AMBER",
        probabilityOfCollision: 2e-5,
        epoch: "2026-04-22T09:00:00.000Z",
      }),
      conjunctionFixture({
        id: 32,
        primaryId: 102,
        primaryName: "PRIMARY-DIM",
        secondaryId: 300,
        secondaryName: "SECONDARY-DIM",
        probabilityOfCollision: 5e-8,
        epoch: "2026-04-22T10:00:00.000Z",
      }),
    ];

    const sparseTelemetry = satelliteFixture({
      id: 300,
      name: "SECONDARY-SAT",
      noradId: 300,
      photoUrl: null,
      shortDescription: null,
      opacityScore: 0,
      telemetry: telemetryFixture({
        powerDraw: null,
        thermalMargin: 5.2,
        pointingAccuracy: null,
        attitudeRate: null,
        linkBudget: null,
        dataRate: null,
        payloadDuty: null,
        eclipseRatio: 0.5,
        solarArrayHealth: null,
        batteryDepthOfDischarge: null,
        propellantRemaining: null,
        radiationDose: null,
        debrisProximity: null,
        missionAge: null,
      }),
      lastTleIngestedAt: "2026-04-23T12:00:00.000Z",
      meanMotionDrift: -0.0007,
    });

    const { rerender } = render(
      <OpsDrawer
        satellite={sparseTelemetry}
        conjunctions={conjunctions}
        selectedConjunctionId={30}
      />,
    );

    expect(screen.getByText("+5.2 °C")).toBeInTheDocument();
    expect(screen.getByText("50 %")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("Δmm -0.0007")).toBeInTheDocument();
    expect(screen.queryByText(/PAYLOADS/i)).not.toBeInTheDocument();

    const conjunctionSection = screen.getByText("CONJUNCTIONS (3)").closest("section");
    expect(conjunctionSection).toBeTruthy();
    if (!conjunctionSection) return;

    const rows = within(conjunctionSection);
    expect(rows.getByText("PRIMARY-HOT")).toBeInTheDocument();
    expect(rows.getByText("PRIMARY-AMBER")).toBeInTheDocument();
    expect(rows.getByText("PRIMARY-DIM")).toBeInTheDocument();

    rerender(
      <OpsDrawer
        satellite={satelliteFixture({
          id: 300,
          name: "SECONDARY-SAT",
          noradId: 300,
          photoUrl: null,
          shortDescription: null,
          opacityScore: 0,
          telemetry: telemetryFixture({
            powerDraw: 400,
            thermalMargin: 1.2,
          }),
        })}
        conjunctions={[conjunctions[1]!, conjunctions[0]!]}
        selectedConjunctionId={31}
      />,
    );

    expect(screen.getByText("400 W")).toBeInTheDocument();
    const hot = screen.getByText("PRIMARY-HOT");
    const amber = screen.getByText("PRIMARY-AMBER");
    expect(amber.compareDocumentPosition(hot)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    rerender(
      <OpsDrawer
        satellite={satelliteFixture({
          id: 300,
          name: "SECONDARY-SAT",
          noradId: 300,
          photoUrl: null,
          shortDescription: null,
          telemetry: telemetryFixture({
            powerDraw: 400,
            thermalMargin: null,
          }),
          tleLine1: null,
          tleLine2: null,
          lastTleIngestedAt: null,
          opacityScore: 0,
        })}
        conjunctions={[]}
        selectedConjunctionId={null}
      />,
    );

    expect(screen.queryByText(/^TLE$/)).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders ratio values even when the shared formatter returns a unitless tuple", () => {
    state.drawerId = "sat:500";
    const fmtPctSpy = vi.spyOn(units, "fmtPct").mockReturnValue(["42", ""]);

    try {
      render(
        <OpsDrawer
          satellite={satelliteFixture({
            id: 500,
            name: "UNITLESS-SAT",
            noradId: 500,
            photoUrl: null,
            shortDescription: null,
            telemetry: telemetryFixture({
              powerDraw: 400,
              payloadDuty: 0.42,
            }),
            opacityScore: 0,
          })}
          conjunctions={[]}
          selectedConjunctionId={null}
        />,
      );

      expect(screen.getAllByText("42").length).toBeGreaterThan(0);
    } finally {
      fmtPctSpy.mockRestore();
    }
  });
});
