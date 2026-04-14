/**
 * SPEC-SH-005 — Observability / MetricsCollector
 * Traceability:
 *   AC-6 collector sets default labels and default metrics
 *   AC-7 counters and histograms attach only to local registry
 *   AC-8 getMetrics returns Prometheus text with all series
 */
import { describe, it, expect } from "vitest";
import { register as globalRegistry } from "prom-client";
import { MetricsCollector } from "../src/observability/metrics";

describe("SPEC-SH-005 MetricsCollector — defaults", () => {
  it("AC-6 registry is fresh and carries default labels {app, env}", async () => {
    const mc = new MetricsCollector({
      serviceName: "catalog-cortex",
      enableDefaultMetrics: false,
    });
    expect(mc.registry).toBeDefined();

    const counter = mc.createCounter("probe_total", "probe", []);
    counter.inc();
    const text = await mc.getMetrics();

    expect(text).toContain("probe_total");
    expect(text).toContain('app="catalog-cortex"');
    // env is either test / development / production depending on runner
    expect(text).toMatch(/env="[^"]+"/);
  });

  it("AC-6 enableDefaultMetrics !== false registers process metrics under app_ prefix", async () => {
    const mc = new MetricsCollector({ serviceName: "svc" });
    const text = await mc.getMetrics();
    expect(text).toContain("app_process_");
  });

  it("AC-6 enableDefaultMetrics === false skips process metrics", async () => {
    const mc = new MetricsCollector({
      serviceName: "svc-nodefaults",
      enableDefaultMetrics: false,
    });
    const text = await mc.getMetrics();
    expect(text).not.toContain("app_process_");
  });
});

describe("SPEC-SH-005 MetricsCollector — isolation (AC-7)", () => {
  it("AC-7 each collector owns its registry; no leakage to global default", async () => {
    const a = new MetricsCollector({
      serviceName: "svc-a",
      enableDefaultMetrics: false,
    });
    const b = new MetricsCollector({
      serviceName: "svc-b",
      enableDefaultMetrics: false,
    });

    a.createCounter("unique_name_a", "a counter", []);
    b.createCounter("unique_name_b", "b counter", []);

    const textA = await a.getMetrics();
    const textB = await b.getMetrics();

    expect(textA).toContain("unique_name_a");
    expect(textA).not.toContain("unique_name_b");
    expect(textB).toContain("unique_name_b");
    expect(textB).not.toContain("unique_name_a");

    // Global default registry must stay untouched by either collector.
    const globalText = await globalRegistry.metrics();
    expect(globalText).not.toContain("unique_name_a");
    expect(globalText).not.toContain("unique_name_b");
  });

  it("AC-7 series carry the owning collector's app label, not the other", async () => {
    const a = new MetricsCollector({
      serviceName: "svc-a",
      enableDefaultMetrics: false,
    });
    const b = new MetricsCollector({
      serviceName: "svc-b",
      enableDefaultMetrics: false,
    });
    a.createCounter("req_total_a", "a", []).inc();
    b.createCounter("req_total_b", "b", []).inc();

    const textA = await a.getMetrics();
    expect(textA).toContain('app="svc-a"');
    expect(textA).not.toContain('app="svc-b"');
  });
});

describe("SPEC-SH-005 MetricsCollector — getMetrics (AC-8)", () => {
  it("AC-8 returns Prometheus text with counter + histogram series", async () => {
    const mc = new MetricsCollector({
      serviceName: "ssa-metrics",
      enableDefaultMetrics: false,
    });

    const counter = mc.createCounter(
      "conjunction_events_total",
      "total conjunction events",
      ["severity"],
    );
    counter.inc({ severity: "high" }, 3);

    const histogram = mc.createHistogram(
      "nano_latency_seconds",
      "nano worker latency",
      [0.01, 0.1, 1],
      ["cortex"],
    );
    histogram.observe({ cortex: "catalog" }, 0.05);

    const text = await mc.getMetrics();

    // counter present with labels
    expect(text).toContain("conjunction_events_total");
    expect(text).toContain('severity="high"');

    // histogram present with the standard pieces
    expect(text).toContain("nano_latency_seconds_bucket");
    expect(text).toContain("nano_latency_seconds_count");
    expect(text).toContain("nano_latency_seconds_sum");
    expect(text).toContain('cortex="catalog"');
  });
});
