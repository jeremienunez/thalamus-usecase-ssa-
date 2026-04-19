import { describe, it, expect } from "vitest";
import { classifySatellite } from "./satellite-classification";

describe("classifySatellite", () => {
  it("station platforms → PROBE", () => {
    expect(classifySatellite({ name: "ISS (ZARYA)", regime: "LEO" })).toBe("PROBE");
    expect(classifySatellite({ name: "TIANGONG", regime: "LEO" })).toBe("PROBE");
    expect(classifySatellite({ name: "HST", regime: "LEO" })).toBe("PROBE");
  });

  it("earth-observation prefixes → PROBE", () => {
    expect(classifySatellite({ name: "NOAA 18", regime: "LEO" })).toBe("PROBE");
    expect(classifySatellite({ name: "SENTINEL-2A", regime: "LEO" })).toBe("PROBE");
    expect(classifySatellite({ name: "JASON-3", regime: "LEO" })).toBe("PROBE");
  });

  it("agency mentions → PROBE", () => {
    expect(classifySatellite({ name: "JAXA-SAT", regime: "LEO" })).toBe("PROBE");
    expect(classifySatellite({ name: "TEST-NASA-1", regime: "LEO" })).toBe("PROBE");
  });

  it("comms bus prefixes → TELECOM", () => {
    expect(classifySatellite({ name: "INTELSAT 33E", regime: "GEO" })).toBe("TELECOM");
    expect(classifySatellite({ name: "EUTELSAT 7A", regime: "GEO" })).toBe("TELECOM");
    expect(classifySatellite({ name: "VIASAT-2", regime: "GEO" })).toBe("TELECOM");
  });

  it("GNSS buses → TELECOM", () => {
    expect(classifySatellite({ name: "NAVSTAR 76", regime: "MEO" })).toBe("TELECOM");
    expect(classifySatellite({ name: "GALILEO FOC-22", regime: "MEO" })).toBe("TELECOM");
    expect(classifySatellite({ name: "BEIDOU-3 M15", regime: "MEO" })).toBe("TELECOM");
  });

  it("unknown name + GEO regime → TELECOM", () => {
    expect(classifySatellite({ name: "MYSTERY-1", regime: "GEO" })).toBe("TELECOM");
  });

  it("unknown name + non-GEO regime → SMALLSAT", () => {
    expect(classifySatellite({ name: "STARLINK-5678", regime: "LEO" })).toBe("SMALLSAT");
    expect(classifySatellite({ name: "COSMOS 2491", regime: "LEO" })).toBe("SMALLSAT");
    expect(classifySatellite({ name: "ONEWEB-0123", regime: "LEO" })).toBe("SMALLSAT");
  });

  it("matches regardless of case", () => {
    expect(classifySatellite({ name: "intelsat 33e", regime: "GEO" })).toBe("TELECOM");
  });
});
