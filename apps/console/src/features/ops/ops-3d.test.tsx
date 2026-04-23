import { act, fireEvent, render, screen } from "@testing-library/react";
import React, { createRef } from "react";
import * as THREE from "three";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  conjunctionFixture,
  satelliteFixture,
} from "../../../tests/ssa-fixtures";

type FrameCallback = (state: { clock: { elapsedTime: number } }, dt: number) => void;

const r3fState = vi.hoisted(() => ({
  frameCallbacks: Array<FrameCallback>(),
  camera: {
    position: {},
    quaternion: {},
    lookAt: vi.fn(),
  },
  raycaster: {},
  controls: {
    target: {},
    update: vi.fn(),
  },
  loaderTextures: Array<unknown>(),
  lastTailsGeometry: null,
  fullGeometries: Array<object>(),
  buildFullCalls: Array<number>(),
  buildTailCalls: Array<number>(),
  injectUndefinedTailSat: false,
}));

const elementPositions = new WeakMap<HTMLElement, THREE.Vector3>();
const elementScales = new WeakMap<HTMLElement, THREE.Vector3>();
const elementRotations = new WeakMap<HTMLElement, { x: number; y: number; z: number }>();
const elementQuaternions = new WeakMap<HTMLElement, THREE.Quaternion>();
const elementMaterials = new WeakMap<HTMLElement, { opacity: number }>();
const elementInstanceColors = new WeakMap<HTMLElement, { needsUpdate: boolean }>();
const elementInstanceMatrices = new WeakMap<HTMLElement, { needsUpdate: boolean }>();
const colorCalls = new WeakMap<HTMLElement, Array<number>>();
const matrixCalls = new WeakMap<HTMLElement, Array<number>>();

function getPosition(node: HTMLElement): THREE.Vector3 {
  let value = elementPositions.get(node);
  if (!value) {
    value = new THREE.Vector3();
    elementPositions.set(node, value);
  }
  return value;
}

function getScale(node: HTMLElement): THREE.Vector3 {
  let value = elementScales.get(node);
  if (!value) {
    value = new THREE.Vector3(1, 1, 1);
    elementScales.set(node, value);
  }
  return value;
}

function getRotation(node: HTMLElement) {
  let value = elementRotations.get(node);
  if (!value) {
    value = { x: 0, y: 0, z: 0 };
    elementRotations.set(node, value);
  }
  return value;
}

function getQuaternion(node: HTMLElement): THREE.Quaternion {
  let value = elementQuaternions.get(node);
  if (!value) {
    value = new THREE.Quaternion();
    elementQuaternions.set(node, value);
  }
  return value;
}

function getMaterial(node: HTMLElement) {
  let value = elementMaterials.get(node);
  if (!value) {
    value = { opacity: 0 };
    elementMaterials.set(node, value);
  }
  return value;
}

function getInstanceColor(node: HTMLElement) {
  let value = elementInstanceColors.get(node);
  if (!value) {
    value = { needsUpdate: false };
    elementInstanceColors.set(node, value);
  }
  return value;
}

function getInstanceMatrix(node: HTMLElement) {
  let value = elementInstanceMatrices.get(node);
  if (!value) {
    value = { needsUpdate: false };
    elementInstanceMatrices.set(node, value);
  }
  return value;
}

beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value(_type: string) {
      return {
        clearRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        set lineCap(_value: string) {},
        set lineWidth(_value: number) {},
        set shadowColor(_value: string) {},
        set shadowBlur(_value: number) {},
        set strokeStyle(_value: string) {},
      };
    },
  });

  Object.defineProperty(HTMLElement.prototype, "position", {
    configurable: true,
    get() {
      return getPosition(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scale", {
    configurable: true,
    get() {
      return getScale(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "rotation", {
    configurable: true,
    get() {
      return getRotation(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "quaternion", {
    configurable: true,
    get() {
      return getQuaternion(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "material", {
    configurable: true,
    get() {
      return getMaterial(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "instanceColor", {
    configurable: true,
    get() {
      return getInstanceColor(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "instanceMatrix", {
    configurable: true,
    get() {
      return getInstanceMatrix(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "setColorAt", {
    configurable: true,
    value(index: number) {
      const calls = colorCalls.get(this) ?? [];
      calls.push(index);
      colorCalls.set(this, calls);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "setMatrixAt", {
    configurable: true,
    value(index: number) {
      const calls = matrixCalls.get(this) ?? [];
      calls.push(index);
      matrixCalls.set(this, calls);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "update", {
    configurable: true,
    value() {},
  });
  Object.defineProperty(HTMLElement.prototype, "lookAt", {
    configurable: true,
    value() {},
  });
});

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="canvas">{children}</div>
  ),
  useFrame: (callback: FrameCallback) => {
    r3fState.frameCallbacks.push(callback);
  },
  useLoader: (_loader: unknown, input: string[]) =>
    input.map(
      (_item, index) =>
        index in r3fState.loaderTextures
          ? r3fState.loaderTextures[index]
          : new THREE.Texture(),
    ),
  useThree: () => ({
    camera: r3fState.camera,
    raycaster: r3fState.raycaster,
  }),
}));

vi.mock("@react-three/drei", () => ({
  Html: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="html">{children}</div>
  ),
  Environment: () => <div data-testid="environment" />,
  Stars: () => <div data-testid="stars" />,
  OrbitControls: React.forwardRef(function OrbitControls(
    _props: Record<string, unknown>,
    ref: React.ForwardedRef<object>,
  ) {
    React.useImperativeHandle(ref, () => r3fState.controls);
    return <div data-testid="orbit-controls" />;
  }),
}));

vi.mock("@react-three/postprocessing", () => ({
  EffectComposer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="composer">{children}</div>
  ),
  Bloom: () => <div data-testid="bloom" />,
  Vignette: () => <div data-testid="vignette" />,
  Noise: () => <div data-testid="noise" />,
}));

vi.mock("postprocessing", () => ({
  BlendFunction: { OVERLAY: "OVERLAY" },
  KernelSize: { LARGE: "LARGE" },
}));

vi.mock("@/adapters/propagator/sgp4", () => ({
  EARTH_UNITS: 1,
  satellitePosition: (
    sat: { id: number },
    time: number,
    target: THREE.Vector3,
  ) => {
    if (sat.id === 999) {
      return target.set(0, 0, 0);
    }
    return target.set(
      sat.id / 1000 + time / 1000,
      sat.id / 2000,
      1 + sat.id / 3000,
    );
  },
  propagateSgp4: (
    sat: { id: number },
    nowMs: number,
    target: THREE.Vector3,
  ) =>
    target.set(
      sat.id / 100 + nowMs / 1_000_000,
      sat.id / 200,
      sat.id / 300,
    ),
}));

vi.mock("@/adapters/renderer/RendererContext", () => ({
  useRenderer: () => ({
    makeGoldBumpTexture: () => new THREE.Texture(),
    makeSolarPanelTexture: () => new THREE.Texture(),
    makeHaloTexture: () => new THREE.Texture(),
    getCompanyColor: (name: string) =>
      name.includes("NASA")
        ? new THREE.Color("#05d9e8")
        : new THREE.Color("#8ecae6"),
    ringColor: (regime: "LEO" | "MEO" | "GEO" | "HEO") =>
      ({ LEO: "#8ecae6", MEO: "#2a9d8f", GEO: "#e9c46a", HEO: "#c77dff" })[regime],
    buildFullRingsGeometry: (satellites: Array<{ id: number }>) => {
      r3fState.buildFullCalls.push(satellites.length);
      if (satellites.length === 0) return null;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1]), 3),
      );
      r3fState.fullGeometries.push(geometry);
      return geometry;
    },
    buildTailsGeometry: (satellites: Array<{ id: number }>, tailLen: number) => {
      r3fState.buildTailCalls.push(satellites.length);
      const geometry = new THREE.BufferGeometry();
      const count = Math.max(1, satellites.length * (tailLen - 1) * 2 * 3);
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(count), 3),
      );
      geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(new Float32Array(count), 3),
      );
      const tailsGeometry = Object.assign(geometry, {
        _sats: r3fState.injectUndefinedTailSat
          ? [satellites[0], undefined]
          : satellites,
      });
      r3fState.lastTailsGeometry = tailsGeometry;
      return tailsGeometry;
    },
  }),
}));

import { CameraFocus } from "./CameraFocus";
import { ConjunctionArcs } from "./ConjunctionArcs";
import { ConjunctionMarkers } from "./ConjunctionMarkers";
import { Globe } from "./Globe";
import { OpsScene } from "./OpsScene";
import { OrbitTrails } from "./OrbitTrails";
import { SatelliteField } from "./SatelliteField";

function runFrame(dt = 0.25, elapsedTime = 1.5) {
  act(() => {
    for (const callback of r3fState.frameCallbacks) {
      callback(
        { camera: r3fState.camera, clock: { elapsedTime } },
        dt,
      );
    }
  });
}

function clickWithInstanceId(node: Element, instanceId: number) {
  const reactPropsKey = Reflect.ownKeys(node).find(
    (key) => typeof key === "string" && key.startsWith("__reactProps"),
  );
  if (!reactPropsKey) {
    return;
  }
  const reactProps = Reflect.get(node, reactPropsKey);
  const onClick = Reflect.get(reactProps, "onClick");
  if (typeof onClick === "function") {
    onClick({
      instanceId,
      stopPropagation() {},
    });
  }
}

function clickWithoutInstanceId(node: Element) {
  const reactPropsKey = Reflect.ownKeys(node).find(
    (key) => typeof key === "string" && key.startsWith("__reactProps"),
  );
  if (!reactPropsKey) {
    return;
  }
  const reactProps = Reflect.get(node, reactPropsKey);
  const onClick = Reflect.get(reactProps, "onClick");
  if (typeof onClick === "function") {
    onClick({
      stopPropagation() {},
    });
  }
}

beforeEach(() => {
  r3fState.frameCallbacks = [];
  r3fState.camera = {
    position: new THREE.Vector3(0, 0, 5),
    quaternion: new THREE.Quaternion(),
    lookAt: vi.fn(),
  };
  r3fState.controls = {
    target: new THREE.Vector3(0, 0, 0),
    update: vi.fn(),
  };
  r3fState.raycaster = {};
  r3fState.loaderTextures = [
    new THREE.Texture(),
    new THREE.Texture(),
    new THREE.Texture(),
    new THREE.Texture(),
  ];
  r3fState.lastTailsGeometry = null;
  r3fState.fullGeometries = [];
  r3fState.buildFullCalls = [];
  r3fState.buildTailCalls = [];
  r3fState.injectUndefinedTailSat = false;
  vi.useFakeTimers();
});

describe("ops 3d components", () => {
  it("renders the scene shell without fleet overlays when no filtered satellites are present", () => {
    render(
      <OpsScene
        filteredSats={[]}
        satellites={[satelliteFixture({ id: 1, name: "ISS" })]}
        selectedId={null}
        labelIds={[]}
        conjunctions={[]}
        satellitesById={new Map()}
        focusId={null}
        trailMode="off"
        orbitRegimeFilter="ALL"
        effectiveSpeed={1}
        onSelectSatellite={vi.fn()}
        onFocusDone={vi.fn()}
      />,
    );

    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByTestId("environment")).toBeInTheDocument();
    expect(screen.getByTestId("stars")).toBeInTheDocument();
    expect(screen.getByTestId("composer")).toBeInTheDocument();
    expect(screen.getByTestId("orbit-controls")).toBeInTheDocument();
    expect(document.querySelectorAll("instancedmesh").length).toBe(0);
  });

  it("configures globe textures and advances earth/cloud rotation on each frame", () => {
    r3fState.loaderTextures = [
      new THREE.Texture(),
      null,
      new THREE.Texture(),
      null,
    ];
    const { container } = render(<Globe />);

    const textures = r3fState.loaderTextures;
    expect(textures[0]).toHaveProperty("anisotropy", 16);
    expect(textures[1]).toBeNull();

    runFrame(0.5, 1);

    const group = container.querySelector("group");
    const meshes = container.querySelectorAll("mesh");
    expect(group).toBeInstanceOf(HTMLElement);
    expect(meshes.length).toBeGreaterThan(1);
    if (group instanceof HTMLElement && meshes[1] instanceof HTMLElement) {
      expect(getRotation(group).y).toBeGreaterThan(0);
      expect(getRotation(meshes[1]).y).toBeGreaterThan(0);
    }

    const { unmount } = render(<Globe />);
    unmount();
    runFrame(0.5, 1.5);
  });

  it("renders full orbit rings, warns once for ALL/full on large fleets, and updates tails geometry", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const many = Array.from({ length: 501 }, (_item, index) =>
      satelliteFixture({
        id: index + 1,
        name: `SAT-${index + 1}`,
        regime: index % 2 === 0 ? "LEO" : "GEO",
      }),
    );

    const { container, unmount } = render(
      <OrbitTrails
        satellites={many}
        regimeFilter="ALL"
        trailMode="full"
        timeScale={1}
      />,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("linesegments").length).toBeGreaterThan(0);

    const firstGeometry = r3fState.fullGeometries[0];
    unmount();
    if (firstGeometry instanceof THREE.BufferGeometry) {
      expect(firstGeometry.attributes.position).toBeDefined();
    }

    const tRef = { current: 5 };
    render(
      <OrbitTrails
        satellites={[
          satelliteFixture({ id: 10, name: "TAIL-1", regime: "LEO" }),
          satelliteFixture({ id: 11, name: "TAIL-2", regime: "LEO" }),
        ]}
        regimeFilter="LEO"
        trailMode="tails"
        timeScale={4}
        tRef={tRef}
      />,
    );

    runFrame(0.3, 2);
    runFrame(0.3, 2.3);

    expect(tRef.current).toBe(5);
    expect(r3fState.lastTailsGeometry).toBeTruthy();
    if (r3fState.lastTailsGeometry instanceof THREE.BufferGeometry) {
      const position = r3fState.lastTailsGeometry.getAttribute("position");
      const color = r3fState.lastTailsGeometry.getAttribute("color");
      expect(Array.from(position.array).some((value) => value !== 0)).toBe(true);
      expect(Array.from(color.array).some((value) => value !== 0)).toBe(true);
    }
  });

  it("covers off/full/tails edge paths in orbit trails", () => {
    const tRef = { current: 10 };
    const { rerender, container } = render(
      <OrbitTrails
        satellites={[satelliteFixture({ id: 1, name: "LEO-1", regime: "LEO" })]}
        regimeFilter="ALL"
        trailMode="off"
        timeScale={2}
        tRef={tRef}
      />,
    );

    expect(container.innerHTML).toBe("");
    runFrame(0.2, 0.2);
    expect(tRef.current).toBe(10);

    rerender(
      <OrbitTrails
        satellites={[
          satelliteFixture({ id: 1, name: "LEO-1", regime: "LEO" }),
          satelliteFixture({ id: 2, name: "GEO-1", regime: "GEO" }),
        ]}
        regimeFilter="LEO"
        trailMode="full"
        timeScale={2}
      />,
    );
    expect(r3fState.buildFullCalls).toContain(1);

    rerender(
      <OrbitTrails
        satellites={[
          satelliteFixture({ id: 1, name: "LEO-1", regime: "LEO" }),
          satelliteFixture({ id: 2, name: "LEO-2", regime: "LEO" }),
        ]}
        regimeFilter="LEO"
        trailMode="tails"
        timeScale={2}
      />,
    );
    for (let index = 0; index < 65; index++) {
      runFrame(0.2, 0.2 + index * 0.2);
    }

    rerender(
      <OrbitTrails
        satellites={[satelliteFixture({ id: 1, name: "LEO-1", regime: "LEO" })]}
        regimeFilter="LEO"
        trailMode="tails"
        timeScale={2}
      />,
    );
    runFrame(0.2, 14);

    r3fState.injectUndefinedTailSat = true;
    rerender(
      <OrbitTrails
        satellites={[
          satelliteFixture({ id: 1, name: "LEO-1", regime: "LEO" }),
          satelliteFixture({ id: 3, name: "LEO-3", regime: "LEO" }),
        ]}
        regimeFilter="LEO"
        trailMode="tails"
        timeScale={2}
      />,
    );
    runFrame(0.2, 14.2);
  });

  it("early-returns camera focus when focus target is missing and completes easing when present", () => {
    const onDone = vi.fn();
    const orbitControlsRef = createRef<object>();
    orbitControlsRef.current = r3fState.controls;

    const { rerender } = render(
      <CameraFocus
        focusId={null}
        satellites={[satelliteFixture({ id: 100, name: "ISS" })]}
        orbitControlsRef={orbitControlsRef}
        timeScale={2}
        onDone={onDone}
      />,
    );

    runFrame(0.2, 0.2);
    expect(onDone).not.toHaveBeenCalled();

    rerender(
      <CameraFocus
        focusId={404}
        satellites={[satelliteFixture({ id: 100, name: "ISS" })]}
        orbitControlsRef={orbitControlsRef}
        timeScale={2}
        onDone={onDone}
      />,
    );

    runFrame(0.2, 0.2);
    expect(onDone).not.toHaveBeenCalled();

    orbitControlsRef.current = null;
    rerender(
      <CameraFocus
        focusId={100}
        satellites={[satelliteFixture({ id: 100, name: "ISS" })]}
        orbitControlsRef={orbitControlsRef}
        timeScale={2}
        onDone={onDone}
      />,
    );

    runFrame(0.2, 0.2);
    expect(onDone).not.toHaveBeenCalled();

    orbitControlsRef.current = r3fState.controls;
    rerender(
      <CameraFocus
        focusId={100}
        satellites={[satelliteFixture({ id: 100, name: "ISS" })]}
        orbitControlsRef={orbitControlsRef}
        timeScale={2}
        onDone={onDone}
      />,
    );

    vi.spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(900);

    runFrame(0.2, 0.2);
    orbitControlsRef.current = null;
    runFrame(0.2, 0.4);
    orbitControlsRef.current = r3fState.controls;
    runFrame(0.2, 0.6);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(r3fState.controls.update).toHaveBeenCalled();
  });

  it("stops camera focus cleanly if controls disappear mid-animation", () => {
    const onDone = vi.fn();
    const orbitControlsRef = createRef<object>();
    orbitControlsRef.current = r3fState.controls;

    render(
      <CameraFocus
        focusId={100}
        satellites={[satelliteFixture({ id: 100, name: "ISS" })]}
        orbitControlsRef={orbitControlsRef}
        timeScale={1}
        onDone={onDone}
      />,
    );

    vi.spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(100);

    orbitControlsRef.current = null;
    runFrame(0.2, 0.2);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("renders and animates conjunction arcs, including zero-direction and top-20 trimming", () => {
    const satellites = [
      satelliteFixture({ id: 100, name: "ISS" }),
      satelliteFixture({ id: 200, name: "STARLINK-1000" }),
      satelliteFixture({ id: 999, name: "ZERO-VECTOR" }),
    ];
    const conjunctions = [
      conjunctionFixture({
        id: 1,
        primaryId: 999,
        secondaryId: 999,
        probabilityOfCollision: 9e-4,
      }),
      ...Array.from({ length: 20 }, (_item, index) =>
        conjunctionFixture({
          id: index + 2,
          primaryId: 100,
          secondaryId: 200,
          probabilityOfCollision: 1e-5 - index * 1e-7,
        }),
      ),
    ];

    const { container } = render(
      <ConjunctionArcs
        satellites={satellites}
        conjunctions={conjunctions}
        timeScale={3}
      />,
    );

    const meshes = container.querySelectorAll("instancedmesh");
    expect(meshes.length).toBe(2);

    const cylinders = meshes[0];
    const rings = meshes[1];
    if (cylinders instanceof HTMLElement && rings instanceof HTMLElement) {
      expect((colorCalls.get(rings) ?? []).length).toBe(20);
      expect((colorCalls.get(cylinders) ?? []).length).toBe(20 * 28);
    }

    runFrame(0.25, 1.5);

    if (cylinders instanceof HTMLElement && rings instanceof HTMLElement) {
      expect((matrixCalls.get(rings) ?? []).length).toBe(20);
      expect((matrixCalls.get(cylinders) ?? []).length).toBe(20 * 28);
      expect(getInstanceMatrix(cylinders).needsUpdate).toBe(true);
      expect(getInstanceMatrix(rings).needsUpdate).toBe(true);
    }
  });

  it("returns null for empty conjunction arcs and tolerates missing instanceColor handles", () => {
    const { container, rerender } = render(
      <ConjunctionArcs satellites={[]} conjunctions={[]} timeScale={1} />,
    );

    expect(container.innerHTML).toBe("");

    rerender(
      <ConjunctionArcs
        satellites={[
          satelliteFixture({ id: 100, name: "ISS" }),
          satelliteFixture({ id: 200, name: "STARLINK-1000" }),
        ]}
        conjunctions={[conjunctionFixture({ id: 9, primaryId: 100, secondaryId: 200 })]}
        timeScale={1}
      />,
    );

    const meshes = container.querySelectorAll("instancedmesh");
    for (const mesh of meshes) {
      Object.defineProperty(mesh, "instanceColor", {
        configurable: true,
        value: null,
      });
    }

    rerender(
      <ConjunctionArcs
        satellites={[
          satelliteFixture({ id: 100, name: "ISS" }),
          satelliteFixture({ id: 200, name: "STARLINK-1000" }),
        ]}
        conjunctions={[conjunctionFixture({ id: 9, primaryId: 100, secondaryId: 200 })]}
        timeScale={1}
      />,
    );
    runFrame(0.2, 0.2);
  });

  it("positions conjunction markers, handles hover dismissal, and emits selections", () => {
    const onHover = vi.fn();
    const onSelect = vi.fn();
    const satellitesById = new Map([
      [100, satelliteFixture({ id: 100, name: "ISS" })],
      [200, satelliteFixture({ id: 200, name: "STARLINK-1000" })],
    ]);

    const { container, rerender, unmount } = render(
      <ConjunctionMarkers
        conjunctions={[
          conjunctionFixture({ id: 5, primaryId: 100, secondaryId: 200 }),
          conjunctionFixture({ id: 6, primaryId: 100, secondaryId: 404 }),
        ]}
        satellitesById={satellitesById}
        hoveredId={null}
        selectedId={null}
        timeScale={2}
        onHover={onHover}
        onSelect={onSelect}
      />,
    );

    runFrame(0.2, 0.2);

    const sprites = container.querySelectorAll("sprite");
    expect(sprites.length).toBe(2);
    const visible = sprites[0];
    const pick = sprites[1];

    fireEvent.pointerOver(pick);
    expect(onHover).toHaveBeenCalledWith("5");

    fireEvent.pointerOut(pick);
    fireEvent.pointerOut(pick);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onHover).toHaveBeenLastCalledWith(null);

    fireEvent.pointerOver(pick);
    fireEvent.click(pick);
    expect(onSelect).toHaveBeenCalledWith("5");

    rerender(
      <ConjunctionMarkers
        conjunctions={[conjunctionFixture({ id: 5, primaryId: 100, secondaryId: 200 })]}
        satellitesById={satellitesById}
        hoveredId="5"
        selectedId="5"
        timeScale={2}
        onHover={onHover}
        onSelect={onSelect}
      />,
    );

    runFrame(0.2, 0.5);
    if (visible instanceof HTMLElement) {
      expect(getScale(visible).x).toBeCloseTo(0.15);
      expect(getMaterial(visible).opacity).toBe(1);
    }

    fireEvent.pointerOut(pick);
    unmount();
    runFrame(0.2, 0.8);
  });

  it("renders telecom, probe, and smallsat buses, schedules floating labels, and selects by instance id", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.95);
    const onSelect = vi.fn();
    const smallsat = satelliteFixture({ id: 3, name: "STARLINK-5000", regime: "LEO" });
    Reflect.deleteProperty(smallsat, "opacityScore");
    const satellites = [
      satelliteFixture({ id: 1, name: "INTELSAT-1", regime: "GEO", opacityScore: 0.95 }),
      satelliteFixture({ id: 2, name: "ISS", regime: "LEO", opacityScore: 0.8 }),
      smallsat,
    ];

    const { container, rerender } = render(
      <SatelliteField
        satellites={satellites}
        selectedId={2}
        onSelect={onSelect}
        timeScale={5}
        labelIds={[1]}
      />,
    );

    runFrame(0.2, 0.2);

    const meshes = container.querySelectorAll("instancedmesh");
    expect(meshes.length).toBeGreaterThan(4);
    if (meshes[0] instanceof HTMLElement) {
      expect(getInstanceColor(meshes[0]).needsUpdate).toBe(true);
    }

    const clickableMesh = meshes[1];
    clickWithInstanceId(clickableMesh, 1);
    expect(onSelect).toHaveBeenCalledWith(2);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    runFrame(0.2, 0.4);

    expect(screen.getByText("INTELSAT-1")).toBeInTheDocument();
    expect(screen.getByText("ISS")).toBeInTheDocument();
    expect(screen.getByText("STARLINK-5000")).toBeInTheDocument();

    rerender(
      <SatelliteField
        satellites={satellites}
        selectedId={3}
        onSelect={onSelect}
        timeScale={5}
        labelIds={[1]}
      />,
    );
    runFrame(0.2, 0.6);

    rerender(
      <SatelliteField
        satellites={satellites}
        selectedId={1}
        onSelect={onSelect}
        timeScale={5}
        labelIds={[1]}
      />,
    );
    runFrame(0.2, 0.8);
  });

  it("handles empty fleets and out-of-range instance clicks in the satellite field", () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(
      <SatelliteField
        satellites={[]}
        selectedId={null}
        onSelect={onSelect}
        timeScale={1}
      />,
    );

    rerender(
      <SatelliteField
        satellites={[satelliteFixture({ id: 10, name: "SMALL-ONE" })]}
        selectedId={null}
        onSelect={onSelect}
        timeScale={1}
      />,
    );

    const clickableMesh = container.querySelectorAll("instancedmesh")[1];
    clickWithInstanceId(clickableMesh, 99);
    clickWithoutInstanceId(clickableMesh);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("skips floating-label refresh when there are no requested labels yet", () => {
    render(
      <SatelliteField
        satellites={[satelliteFixture({ id: 10, name: "STARLINK-10", regime: "LEO" })]}
        selectedId={null}
        onSelect={vi.fn()}
        timeScale={1}
      />,
    );

    runFrame(0.05, 0.05);
    expect(screen.queryByTestId("html")).not.toBeInTheDocument();
  });

  it("returns early when the halo ref never binds", async () => {
    vi.resetModules();
    vi.doMock("react", async () => {
      const actual = await vi.importActual<typeof import("react")>("react");
      let refCalls = 0;
      return {
        ...actual,
        useRef(initial: unknown) {
          refCalls++;
          const ref = actual.useRef(initial);
          if (refCalls === 1) {
            return Object.defineProperty({}, "current", {
              configurable: true,
              get() {
                return null;
              },
              set() {},
            });
          }
          return ref;
        },
      };
    });

    try {
      const { SatelliteField: GuardedSatelliteField } = await import("./SatelliteField");
      const { container } = render(
        <GuardedSatelliteField
          satellites={[satelliteFixture({ id: 20, name: "STARLINK-20", regime: "LEO" })]}
          selectedId={null}
          onSelect={vi.fn()}
          timeScale={1}
        />,
      );

      runFrame(0.2, 0.2);
      const haloMesh = container.querySelector("instancedmesh");
      expect(haloMesh).toBeTruthy();
      if (haloMesh instanceof HTMLElement) {
        expect(getInstanceMatrix(haloMesh).needsUpdate).toBe(false);
      }
    } finally {
      vi.doUnmock("react");
      vi.resetModules();
    }
  });

  it("tolerates missing child mesh refs and orphaned label entries", async () => {
    vi.resetModules();
    vi.doMock("react", async () => {
      const actual = await vi.importActual<typeof import("react")>("react");
      let refCalls = 0;
      let memoCalls = 0;
      return {
        ...actual,
        useRef(initial: unknown) {
          refCalls++;
          if (refCalls >= 2 && refCalls <= 11) {
            actual.useRef(initial);
            return Object.defineProperty({}, "current", {
              configurable: true,
              get() {
                return null;
              },
              set() {},
            });
          }
          return actual.useRef(initial);
        },
        useMemo(factory: () => unknown, deps: React.DependencyList | undefined) {
          memoCalls++;
          const value = actual.useMemo(factory, deps);
          if (memoCalls === 4) {
            return [satelliteFixture({ id: 777, name: "ORPHAN-LABEL", regime: "LEO" })];
          }
          return value;
        },
      };
    });

    try {
      const { SatelliteField: SparseSatelliteField } = await import("./SatelliteField");
      const onSelect = vi.fn();
      const { container } = render(
        <SparseSatelliteField
          satellites={[satelliteFixture({ id: 21, name: "STARLINK-21", regime: "LEO" })]}
          selectedId={21}
          onSelect={onSelect}
          timeScale={1}
          labelIds={[21]}
        />,
      );

      runFrame(0.2, 0.2);

      const clickableMesh = container.querySelectorAll("instancedmesh")[1];
      clickWithoutInstanceId(clickableMesh);
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.queryByText("ORPHAN-LABEL")).not.toBeInTheDocument();
    } finally {
      vi.doUnmock("react");
      vi.resetModules();
    }
  });

  it("renders the full ops scene overlays when filtered satellites are present", () => {
    const satellites = [
      satelliteFixture({ id: 100, name: "ISS" }),
      satelliteFixture({ id: 200, name: "STARLINK-1000" }),
    ];

    render(
      <OpsScene
        filteredSats={satellites}
        satellites={satellites}
        selectedId={100}
        labelIds={[100]}
        conjunctions={[conjunctionFixture({ id: 1, primaryId: 100, secondaryId: 200 })]}
        satellitesById={new Map([
          [100, satellites[0]],
          [200, satellites[1]],
        ])}
        focusId={100}
        trailMode="tails"
        orbitRegimeFilter="ALL"
        effectiveSpeed={2}
        onSelectSatellite={vi.fn()}
        onFocusDone={vi.fn()}
      />,
    );

    expect(document.querySelectorAll("instancedmesh").length).toBeGreaterThan(0);
  });
});
