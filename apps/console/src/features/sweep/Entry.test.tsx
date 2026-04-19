import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SweepEntry } from "./Entry";
import { WrapProviders, makeStubApi } from "../../../tests/wrap";
import type { SweepSuggestionDTO, FindingDTO } from "@/shared/types";

describe("SweepEntry", () => {
  it("renders tab bar with suggestions / overview / map / stats", async () => {
    render(<SweepEntry />, {
      wrapper: ({ children }) => <WrapProviders>{children}</WrapProviders>,
    });
    for (const label of ["OVERVIEW", "SUGGESTIONS", "MAP", "STATS"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });

  it("shows pending/accepted/rejected counts from useFindings", async () => {
    const findings: FindingDTO[] = [
      {
        id: "f1",
        title: "t1",
        summary: "",
        cortex: "c",
        status: "pending",
        priority: 1,
        createdAt: "",
        linkedEntityIds: [],
        evidence: [],
      },
      {
        id: "f2",
        title: "t2",
        summary: "",
        cortex: "c",
        status: "accepted",
        priority: 1,
        createdAt: "",
        linkedEntityIds: [],
        evidence: [],
      },
      {
        id: "f3",
        title: "t3",
        summary: "",
        cortex: "c",
        status: "pending",
        priority: 1,
        createdAt: "",
        linkedEntityIds: [],
        evidence: [],
      },
    ];
    const api = makeStubApi({
      findings: {
        list: async () => ({ items: findings, count: findings.length }),
        findById: async () => findings[0],
        decide: async () => ({ ok: true, finding: findings[0] }),
      },
    });
    render(<SweepEntry />, {
      wrapper: ({ children }) => <WrapProviders deps={{ api }}>{children}</WrapProviders>,
    });
    await waitFor(() => {
      expect(screen.getByText(/PENDING/)).toBeInTheDocument();
      expect(screen.getByText(/ACCEPTED/)).toBeInTheDocument();
      expect(screen.getByText(/REJECTED/)).toBeInTheDocument();
    });
  });

  it("SUGGESTIONS tab shows amber count badge when suggestions exist", async () => {
    const suggestions: SweepSuggestionDTO[] = [
      {
        id: "s1",
        title: "One",
        description: "",
        suggestedAction: "",
        category: "null-scan",
        severity: "info",
        operatorCountryName: "Acme",
        affectedSatellites: 1,
        createdAt: "",
        accepted: null,
        resolutionStatus: null,
        hasPayload: false,
      },
      {
        id: "s2",
        title: "Two",
        description: "",
        suggestedAction: "",
        category: "null-scan",
        severity: "info",
        operatorCountryName: "Acme",
        affectedSatellites: 1,
        createdAt: "",
        accepted: null,
        resolutionStatus: null,
        hasPayload: false,
      },
    ];
    const api = makeStubApi({
      sweep: {
        listSuggestions: async () => ({ items: suggestions, count: 2 }),
        review: async () => ({ ok: true, reviewed: true, resolution: null }),
      },
    });
    render(<SweepEntry />, {
      wrapper: ({ children }) => <WrapProviders deps={{ api }}>{children}</WrapProviders>,
    });
    const tab = await screen.findByRole("button", { name: /SUGGESTIONS/ });
    await waitFor(() => {
      expect(tab.textContent).toContain("2");
    });
  });
});
