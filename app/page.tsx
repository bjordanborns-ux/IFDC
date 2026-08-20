"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Orbit3D from "./Orbit3D";
import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import land110 from "world-atlas/land-110m.json";
import {
  propagateIss,
  propagateRelays,
  propagateTrack,
  newestTleEpoch,
  tleEpoch,
  type OrbitalState,
  type RelayState,
  type TrackPoint,
} from "./orbital";

type Telemetry = OrbitalState;
type Point = TrackPoint;
type Relay = RelayState;
type CsvSample = Telemetry & { sampledAt: string; sequence: number };
type Severity = "ok" | "caution" | "warning";
type Alert = { id: string; severity: Severity; text: string };

// Fixed TDRSS ground terminals shown on the tracker.
const terminals = [
  { name: "WHITE SANDS", code: "WSC", lat: 32.5, lon: -106.6 },
  { name: "GUAM", code: "GRGT", lat: 13.6, lon: 144.9 },
];
const seed: Telemetry = {
  latitude: 22.4,
  longitude: -41.3,
  altitude: 418.2,
  velocity: 27576,
  visibility: "daylight",
  timestamp: 0,
  epochMs: 0,
  gmst: 0,
  positionEci: { x: 6778, y: 0, z: 0 },
  velocityEci: { x: 0, y: 4.7, z: 6.0 },
  positionEcf: { x: 6778, y: 0, z: 0 },
};
const world = feature(
  land110 as never,
  (land110 as { objects: { land: never } }).objects.land,
);
const worldD =
  geoPath(geoEquirectangular().translate([500, 250]).scale(159.15))(
    world as never,
  ) || "";
function Titlebar({ title, wide = false }: { title: string; wide?: boolean }) {
  return (
    <div className={`titlebar ${wide ? "wide" : ""}`}>
      <span className="app-icon">▣</span>
      <b>{title}</b>
      <div className="window-buttons">
        <i>_</i>
        <i>□</i>
        <i>×</i>
      </div>
    </div>
  );
}
function svgPath(points: Point[]) {
  let d = "",
    last: number | undefined;
  points.forEach((p) => {
    const x = (p.lon + 180) / 3.6,
      y = (90 - p.lat) / 1.8;
    d +=
      (last !== undefined && Math.abs(p.lon - last) < 120 ? "L" : "M") +
      `${x.toFixed(2)},${y.toFixed(2)} `;
    last = p.lon;
  });
  return d;
}
const ecef = (lat: number, lon: number, alt: number) => {
  const la = (lat * Math.PI) / 180,
    lo = (lon * Math.PI) / 180,
    r = 6371 + alt;
  return {
    x: r * Math.cos(la) * Math.cos(lo),
    y: r * Math.cos(la) * Math.sin(lo),
    z: r * Math.sin(la),
  };
};
// Check whether the straight path between two objects clears Earth.
function linkGeometry(
  a: { lat: number; lon: number; alt: number },
  b: { lat: number; lon: number; alt: number },
) {
  const p = ecef(a.lat, a.lon, a.alt),
    q = ecef(b.lat, b.lon, b.alt),
    dx = q.x - p.x,
    dy = q.y - p.y,
    dz = q.z - p.z,
    l2 = dx * dx + dy * dy + dz * dz,
    t = Math.max(0, Math.min(1, -(p.x * dx + p.y * dy + p.z * dz) / l2)),
    cx = p.x + t * dx,
    cy = p.y + t * dy,
    cz = p.z + t * dz;
  return {
    range: Math.sqrt(l2),
    los: Math.sqrt(cx * cx + cy * cy + cz * cz) > 6371,
  };
}
function fallbackTrack(t: Telemetry, fromMin: number, toMin: number) {
  const inc = (51.64 * Math.PI) / 180,
    period = 92.7,
    phase = Math.asin(
      Math.max(
        -1,
        Math.min(1, Math.sin((t.latitude * Math.PI) / 180) / Math.sin(inc)),
      ),
    ),
    out: Point[] = [];
  for (let m = fromMin; m <= toMin; m += 0.75) {
    const a = phase + (2 * Math.PI * m) / period,
      lat = (Math.asin(Math.sin(inc) * Math.sin(a)) * 180) / Math.PI,
      lon =
        ((t.longitude + (360 / period - 360 / 1436.07) * m + 540) % 360) - 180;
    out.push({ lat, lon });
  }
  return out;
}
function footprint(lat: number, lon: number, alt: number) {
  const radius = (Math.acos(6371 / (6371 + alt)) * 180) / Math.PI,
    out: Point[] = [];
  for (let b = 0; b <= 360; b += 5) {
    const br = (b * Math.PI) / 180,
      p1 = (lat * Math.PI) / 180,
      d = (radius * Math.PI) / 180;
    const p2 = Math.asin(
      Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(br),
    );
    const l2 =
      (lon * Math.PI) / 180 +
      Math.atan2(
        Math.sin(br) * Math.sin(d) * Math.cos(p1),
        Math.cos(d) - Math.sin(p1) * Math.sin(p2),
      );
    out.push({
      lat: (p2 * 180) / Math.PI,
      lon: (((l2 * 180) / Math.PI + 540) % 360) - 180,
    });
  }
  return out;
}
function terminator(date: Date) {
  const day =
      (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
        Date.UTC(date.getUTCFullYear(), 0, 0)) /
      86400000,
    dec = (23.44 * Math.sin((2 * Math.PI * (284 + day)) / 365) * Math.PI) / 180,
    subLon = 180 - date.getUTCHours() * 15 - date.getUTCMinutes() * 0.25,
    a: Point[] = [],
    b: Point[] = [];
  for (let lat = -89; lat <= 89; lat += 2) {
    const c =
      (Math.acos(
        Math.max(
          -1,
          Math.min(1, -Math.tan((lat * Math.PI) / 180) * Math.tan(dec)),
        ),
      ) *
        180) /
      Math.PI;
    a.push({ lat, lon: ((subLon + c + 540) % 360) - 180 });
    b.push({ lat, lon: ((subLon - c + 540) % 360) - 180 });
  }
  return [a, b];
}
function GroundTrack({
  t,
  trail,
  predicted,
  nextOrbit,
  relays,
  showGrid,
  showOrbits,
  showTdrs,
  utc,
}: {
  t: Telemetry;
  trail: Point[];
  predicted: Point[];
  nextOrbit: Point[];
  relays: Relay[];
  showGrid: boolean;
  showOrbits: boolean;
  showTdrs: boolean;
  utc: string;
}) {
  const x = (t.longitude + 180) / 3.6,
    y = (90 - t.latitude) / 1.8,
    [termA, termB] = terminator(new Date()),
    radio = footprint(t.latitude, t.longitude, t.altitude),
    visible = relays.filter((r) => r.los).sort((a, b) => a.range - b.range),
    active = visible[0],
    coverage = active ? footprint(active.lat, active.lon, active.alt) : [],
    terminal = active
      ? [...terminals]
          .filter((s) => linkGeometry(active, { ...s, alt: 0 }).los)
          .sort(
            (a, b) =>
              linkGeometry(active, { ...a, alt: 0 }).range -
              linkGeometry(active, { ...b, alt: 0 }).range,
          )[0]
      : undefined;
  return (
    <div className="map-wrap">
      <div className="map-image" />
      <svg
        className="world-base"
        viewBox="0 0 1000 500"
        preserveAspectRatio="none"
      >
        <path d={worldD} />
      </svg>
      {showGrid && <div className="latlon-grid" />}
      <svg
        className="orbit-lines"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {showOrbits && (
          <>
            <path className="history" d={svgPath(trail)} />
            <path className="current-orbit" d={svgPath(predicted)} />
            <path className="next-orbit" d={svgPath(nextOrbit)} />
            <path className="radio-footprint" d={svgPath(radio)} />
            <path className="terminator" d={svgPath(termA)} />
            <path className="terminator" d={svgPath(termB)} />
          </>
        )}
        {showTdrs && active && (
          <>
            <path className="tdrs-coverage" d={svgPath(coverage)} />
            <path
              className="tdrs-link"
              d={svgPath([{ lat: t.latitude, lon: t.longitude }, active])}
            />
            {terminal && (
              <path className="ground-link" d={svgPath([active, terminal])} />
            )}
          </>
        )}
      </svg>
      {showTdrs &&
        terminals.map((s) => (
          <div
            className="nsn-site"
            key={s.code}
            style={{
              left: `${(s.lon + 180) / 3.6}%`,
              top: `${(90 - s.lat) / 1.8}%`,
            }}
          >
            <i>⌁</i>
            <span>
              {s.code}
              <small>{s.name}</small>
            </span>
          </div>
        ))}
      {showTdrs &&
        relays.map((r) => (
          <div
            className={`tdrs-site ${r === active ? "active" : ""} ${r.los ? "available" : "blocked"}`}
            key={r.name}
            style={{
              left: `${(r.lon + 180) / 3.6}%`,
              top: `${(90 - r.lat) / 1.8}%`,
            }}
          >
            <i>◆</i>
            <span>
              {r.name.replace("TDRS ", "TDRS-")}
              <small>
                {r.los
                  ? `${(r.range / 1000).toFixed(1)}K KM LOS`
                  : "EARTH BLOCKED"}
              </small>
            </span>
          </div>
        ))}
      <div className="iss-dot" style={{ left: `${x}%`, top: `${y}%` }}>
        ✦<span>ISS</span>
      </div>
      <div className="map-data left">
        LAT {t.latitude.toFixed(2)}
        <br />
        ALT {t.altitude.toFixed(1)} KM
        <br />
        LON {t.longitude.toFixed(2)}
      </div>
      <div className="map-data center">GMT {utc || "--:--:--"}</div>
      <div className="map-data right">
        INC 51.64
        <br />
        NORAD 25544
        <br />
        {t.visibility.toUpperCase()}
      </div>
      <div className="ops-board comm-board">
        <b>TDRSS RELAY ANALYSIS</b>
        <span>
          VISIBLE&nbsp; {visible.length}/{relays.length}
        </span>
        <span>
          SELECT&nbsp;&nbsp;{" "}
          {active?.name.replace("TDRS ", "TDRS-") || "NO DATA"}
        </span>
        <span>
          RANGE&nbsp;&nbsp;&nbsp;{" "}
          {active ? `${active.range.toFixed(0)} KM` : "--"}
        </span>
        <span>TERMINAL {terminal?.code || "--"}</span>
        <span className="sim-label">ASSIGNMENT SIMULATED</span>
      </div>
      <div className="map-legend">
        <i className="leg-white" /> PREVIOUS <i className="leg-yellow" />{" "}
        CURRENT <i className="leg-cyan" /> NEXT <i className="leg-link" />{" "}
        ISS↔TDRS <em>◆ TDRS</em>
      </div>
      <div className="map-footer">
        ◉ LIVE CELESTRAK TDRSS GP DATA &nbsp; GREEN = GEOMETRIC LOS &nbsp; RELAY
        ASSIGNMENT SIMULATED
      </div>
    </div>
  );
}
// The labels here drive both the menu bar and its action dispatcher.
const menus: { [k: string]: string[] } = {
  File: ["Export telemetry CSV", "Print console"],
  View: [
    "Toggle map grid",
    "Toggle orbit paths",
    "Toggle TDRSS network",
    "Reset 3D cameras",
  ],
  Tracking: ["Center on ISS", "Sync propagation", "Run / hold propagation"],
  Telemetry: ["Show state vector", "Copy current values"],
  Windows: ["Show / hide 3D views", "Maximize tracker"],
  Help: ["Data sources", "Controls & keyboard", "TDRSS network legend"],
};
export default function Home() {
  const [t, setT] = useState(seed),
    latest = useRef(seed),
    [trail, setTrail] = useState<Point[]>([]),
    [predicted, setPredicted] = useState<Point[]>([]),
    [nextOrbit, setNextOrbit] = useState<Point[]>([]),
    [relays, setRelays] = useState<Relay[]>([]),
    [link, setLink] = useState(false),
    [paused, setPaused] = useState(false),
    [syncing, setSyncing] = useState(false),
    [menu, setMenu] = useState<string | null>(null),
    [showGrid, setShowGrid] = useState(true),
    [showOrbits, setShowOrbits] = useState(true),
    [showTdrs, setShowTdrs] = useState(true),
    [showViews, setShowViews] = useState(true),
    [mapMax, setMapMax] = useState(false),
    [cameraKey, setCameraKey] = useState(0),
    [gpEpoch, setGpEpoch] = useState("LOADING"),
    [tdrsEpochMs, setTdrsEpochMs] = useState(0),
    [lastElementUpdateMs, setLastElementUpdateMs] = useState(0),
    [lastPropagationMs, setLastPropagationMs] = useState(0),
    [lastSampleMs, setLastSampleMs] = useState(0),
    [sampleCadenceOk, setSampleCadenceOk] = useState(true),
    [assetWarnings, setAssetWarnings] = useState<Record<string, string>>({}),
    [notice, setNotice] = useState("Ready"),
    [utc, setUtc] = useState(""),
    [dialog, setDialog] = useState<{ title: string; body: string } | null>(
      null,
    ),
    [samples, setSamples] = useState<CsvSample[]>([]);
  const issTle = useRef("");
  const tdrsTle = useRef("");
  const pausedRef = useRef(paused);
  const simulationClock = useRef({ epochMs: Date.now(), wallMs: Date.now() });
  const sampleSequence = useRef(0);
  pausedRef.current = paused;

  const currentSimulationEpoch = (wallMs = Date.now()) =>
    simulationClock.current.epochMs +
    (pausedRef.current ? 0 : wallMs - simulationClock.current.wallMs);

  const commandRun = () => {
    if (!pausedRef.current) return;
    simulationClock.current.wallMs = Date.now();
    pausedRef.current = false;
    setPaused(false);
    setNotice("PROPAGATION RUNNING — SIMULATION CLOCK ADVANCING");
  };

  const commandHold = () => {
    if (pausedRef.current) return;
    const wallMs = Date.now();
    simulationClock.current.epochMs = currentSimulationEpoch(wallMs);
    simulationClock.current.wallMs = wallMs;
    pausedRef.current = true;
    setPaused(true);
    setNotice("PROPAGATION HOLD — COMMON EPOCH FROZEN");
  };

  // Every display product is generated from this one epoch and one ISS TLE.
  const propagateSameEpoch = (epoch: Date) => {
    if (!issTle.current) throw new Error("ISS element set unavailable");
    const state = propagateIss(issTle.current, epoch);
    const past = propagateTrack(issTle.current, epoch, -93, 0, 0.75);
    const future = propagateTrack(issTle.current, epoch, 0, 93, 0.75);
    const next = propagateTrack(issTle.current, epoch, 93, 186, 0.75);
    latest.current = state;
    setT(state);
    setTrail(past);
    setPredicted(future);
    setNextOrbit(next);
    if (tdrsTle.current) {
      setRelays(propagateRelays(tdrsTle.current, epoch, state));
    }
    setLastPropagationMs(Date.now());
  };

  const loadOrbitalElements = async (epoch: Date) => {
    const [issResponse, tdrsResponse] = await Promise.all([
      fetch("/api/orbit?mode=iss", { cache: "no-store" }),
      fetch("/api/orbit?mode=tdrs", { cache: "no-store" }),
    ]);
    if (!issResponse.ok || !tdrsResponse.ok) {
      throw new Error("Orbital element source unavailable");
    }
    const nextIssTle = await issResponse.text();
    const nextTdrsTle = await tdrsResponse.text();
    // Validate both payloads before replacing the last known-good solution.
    const issEpoch = tleEpoch(nextIssTle);
    const relayEpoch = newestTleEpoch(nextTdrsTle);
    propagateIss(nextIssTle, epoch);
    issTle.current = nextIssTle;
    tdrsTle.current = nextTdrsTle;
    setGpEpoch(
      issEpoch.toISOString().slice(0, 19).replace("T", " "),
    );
    setTdrsEpochMs(relayEpoch.getTime());
    setLastElementUpdateMs(Date.now());
    propagateSameEpoch(epoch);
    setLink(true);
    setNotice("COMMON-EPOCH SGP4 SOLUTION VALID — ISS + TDRSS");
  };

  const syncAll = async () => {
    if (syncing) return;
    setSyncing(true);
    setNotice("SYNC IN PROGRESS — COMMON UTC EPOCH");
    try {
      const now = Date.now();
      simulationClock.current = { epochMs: now, wallMs: now };
      await loadOrbitalElements(new Date(now));
      setCameraKey((value) => value + 1);
    } catch {
      setLink(false);
      setNotice("CELESTRAK LINK ERROR — RETAINING LAST VALID SOLUTION");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    setUtc(new Date().toISOString().slice(11, 19));
    const clock = setInterval(
      () => setUtc(new Date().toISOString().slice(11, 19)),
      1000,
    );
    const now = Date.now();
    simulationClock.current = { epochMs: now, wallMs: now };
    loadOrbitalElements(new Date(now)).catch(() => {
      setLink(false);
      setNotice("CELESTRAK LINK ERROR — WAITING FOR SYNC");
    });
    const propagationTimer = setInterval(() => {
      if (!pausedRef.current) {
        try {
          propagateSameEpoch(new Date(currentSimulationEpoch()));
        } catch {
          setLink(false);
          setNotice("PROPAGATION ERROR — DISPLAY FROZEN AT LAST VALID STATE");
        }
      }
    }, 1000);
    // CelesTrak asks clients not to request GP data more often than two hours.
    const elementTimer = setInterval(
      () => {
        loadOrbitalElements(new Date(currentSimulationEpoch())).catch(() =>
          setNotice("GP REFRESH DEFERRED — LAST VALID ELEMENT SET ACTIVE"),
        );
      },
      2 * 60 * 60 * 1000,
    );
    return () => {
      clearInterval(propagationTimer);
      clearInterval(elementTimer);
      clearInterval(clock);
    };
  }, []);
  useEffect(() => {
    // Add one telemetry.csv row every ten seconds while the page is open.
    const sample = () => {
      const sampledAtMs = Date.now();
      setLastSampleMs((previous) => {
        if (previous) setSampleCadenceOk(Math.abs(sampledAtMs - previous - 10000) <= 1500);
        return sampledAtMs;
      });
      sampleSequence.current += 1;
      setSamples((rows) =>
        [...rows, { ...latest.current, sampledAt: new Date(sampledAtMs).toISOString(), sequence: sampleSequence.current }].slice(-8640),
      );
    };
    sample();
    const csv = setInterval(sample, 10000);
    return () => clearInterval(csv);
  }, []);
  const stateVector = useMemo(() => {
    return {
      x: t.positionEci.x,
      y: t.positionEci.y,
      z: t.positionEci.z,
      vx: t.velocityEci.x,
      vy: t.velocityEci.y,
      vz: t.velocityEci.z,
    };
  }, [t]);
  const exportCsv = () => {
    const rows = [
      "sequence,sample_time_utc,simulation_epoch_utc,source_timestamp_unix,latitude_deg,longitude_deg,altitude_km,velocity_kmh,eci_x_km,eci_y_km,eci_z_km,eci_vx_km_s,eci_vy_km_s,eci_vz_km_s,solution",
      ...samples.map(
        (s) =>
          `${s.sequence},${s.sampledAt},${new Date(s.epochMs).toISOString()},${s.timestamp},${s.latitude},${s.longitude},${s.altitude},${s.velocity},${s.positionEci.x},${s.positionEci.y},${s.positionEci.z},${s.velocityEci.x},${s.velocityEci.y},${s.velocityEci.z},${s.visibility}`,
      ),
    ];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([rows.join("\n") + "\n"], { type: "text/csv" }),
    );
    a.download = "telemetry.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    setNotice(`CSV EXPORT COMPLETE — ${samples.length} VERIFIED 10-SECOND SAMPLES`);
  };
  const operatorValues = () => {
    const epoch = new Date(t.epochMs).toISOString();
    return [
      `ISS CURRENT VALUES | ${pausedRef.current ? "HOLD" : "RUN"}`,
      `Epoch (UTC): ${epoch}`,
      `Position ECI (km): X ${stateVector.x.toFixed(3)} | Y ${stateVector.y.toFixed(3)} | Z ${stateVector.z.toFixed(3)}`,
      `Velocity ECI (km/s): VX ${stateVector.vx.toFixed(5)} | VY ${stateVector.vy.toFixed(5)} | VZ ${stateVector.vz.toFixed(5)}`,
      `Geodetic: LAT ${t.latitude.toFixed(5)} deg | LON ${t.longitude.toFixed(5)} deg | ALT ${t.altitude.toFixed(3)} km`,
      `Speed: ${(t.velocity / 3600).toFixed(5)} km/s`,
      `Solution: CelesTrak GP / SGP4 | TDRSS relay assignment simulated`,
    ].join("\n");
  };
  const openDialog = (title: string, body: string) =>
    setDialog({ title, body });
  const act = (m: string, item: string) => {
    setMenu(null);
    setNotice(item.toUpperCase());
    if (item.includes("Export")) exportCsv();
    else if (item.includes("Print")) window.print();
    else if (item.includes("grid")) setShowGrid((v) => !v);
    else if (item.includes("orbit paths")) setShowOrbits((v) => !v);
    else if (item.includes("Toggle TDRSS")) setShowTdrs((v) => !v);
    else if (item.includes("Reset 3D") || item.includes("Center on"))
      setCameraKey((v) => v + 1);
    else if (item.includes("Sync propagation")) syncAll();
    else if (item.includes("Run / hold")) pausedRef.current ? commandRun() : commandHold();
    else if (item.includes("Copy")) {
      navigator.clipboard?.writeText(operatorValues());
      setNotice("CURRENT VALUES COPIED — OPERATOR NOTE FORMAT");
    }
    else if (item.includes("Show / hide")) setShowViews((v) => !v);
    else if (item.includes("Maximize")) setMapMax((v) => !v);
    else if (item.includes("Data sources"))
      openDialog(
        "DATA SOURCES",
        "ISS and TDRSS orbital elements: CelesTrak GP/TLE. Position and velocity: satellite.js SGP4/SDP4 at one shared UTC epoch. Map coordinates: WGS84 geodetic. 3D scene: ECI with Earth rotated by GMST. Earth and ISS geometry: local GLB assets.",
      );
    else if (item.includes("Controls"))
      openDialog(
        "CONTROLS & KEYBOARD",
        "3D view: drag to orbit the camera and use the mouse wheel to zoom. RUN/HOLD controls live updates. SYNC immediately refreshes ISS, TDRSS and SGP4 propagation. ESC closes this window.",
      );
    else if (item.includes("TDRSS network"))
      openDialog(
        "TDRSS NETWORK LEGEND",
        "Diamond: TDRS spacecraft propagated from real CelesTrak GP elements. Green: ISS↔TDRS line of sight that clears the WGS84 ellipsoid. Cyan: selected relay coverage. WSC and GRGT: ground terminals. Relay assignment is simulated and is not NASA operational routing.",
      );
    else if (item.includes("state vector"))
      openDialog(
        "ISS STATE VECTOR — ECI / SGP4",
        `${operatorValues()}\n\nPOSITION ECF (km)\nX  ${t.positionEcf.x.toFixed(3)}\nY  ${t.positionEcf.y.toFixed(3)}\nZ  ${t.positionEcf.z.toFixed(3)}\n\nMAGNITUDES\nR  ${Math.hypot(stateVector.x, stateVector.y, stateVector.z).toFixed(3)} km\nV  ${Math.hypot(stateVector.vx, stateVector.vy, stateVector.vz).toFixed(5)} km/s\n\nElement age: ${gpEpoch === "LOADING" ? "UNKNOWN" : ((Date.now() - tleEpoch(issTle.current).getTime()) / 3600000).toFixed(1) + " h"}\nFrame note: ECI is TEME-compatible SGP4 output; ECF/geodetic use GMST/WGS84.`,
      );
  };
  const nowMs = Date.now();
  const alerts: Alert[] = [
    { id: "link", severity: link ? "ok" : "warning", text: link ? "CELESTRAK LINK / LAST UPDATE VALID" : "CELESTRAK UPDATE UNAVAILABLE — LAST VALID DATA RETAINED" },
    { id: "prop", severity: !paused && lastPropagationMs && nowMs - lastPropagationMs > 5000 ? "warning" : paused ? "caution" : "ok", text: paused ? "PROPAGATION HELD BY OPERATOR" : lastPropagationMs && nowMs - lastPropagationMs > 5000 ? "PROPAGATION STALLED — EPOCH NOT ADVANCING" : "PROPAGATION CLOCK ADVANCING" },
    { id: "tdrs", severity: tdrsEpochMs && nowMs - tdrsEpochMs > 7 * 86400000 ? "caution" : relays.length ? "ok" : "warning", text: !relays.length ? "TDRSS EPHEMERIS UNAVAILABLE" : tdrsEpochMs && nowMs - tdrsEpochMs > 7 * 86400000 ? `TDRSS EPHEMERIS STALE — ${((nowMs - tdrsEpochMs) / 86400000).toFixed(1)} DAYS` : "TDRSS EPHEMERIS CURRENT" },
    { id: "csv", severity: sampleCadenceOk && (!lastSampleMs || nowMs - lastSampleMs < 12500) ? "ok" : "warning", text: sampleCadenceOk && (!lastSampleMs || nowMs - lastSampleMs < 12500) ? "CSV LOGGER 10-SECOND CADENCE VALID" : "CSV LOGGER CADENCE MISSED" },
    ...Object.entries(assetWarnings).map(([id, text]) => ({ id, severity: "caution" as const, text })),
  ];
  const epochLabel = t.epochMs
    ? new Date(t.epochMs).toISOString().slice(11, 19)
    : "--:--:--";
  return (
    <main
      className="desktop-shell"
      onKeyDown={(e) => {
        if (e.key === "Escape") setDialog(null);
      }}
      tabIndex={-1}
    >
      <Titlebar title="ISS ORBIT 3D — Mission Tracking Display" wide />
      <div className="menu">
        {Object.keys(menus).map((m) => (
          <div className="menu-root" key={m}>
            <button onClick={() => setMenu(menu === m ? null : m)}>{m}</button>
            {menu === m && (
              <div className="dropdown">
                {menus[m].map((i) => (
                  <button key={i} onClick={() => act(m, i)}>
                    {i}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <b>
          {syncing
            ? "● SYNCHRONIZING"
            : link
              ? "● DATA LINK"
              : "● LINK DEGRADED"}
        </b>
      </div>
      <div className="toolbar">
        <button
          onClick={commandRun}
          className={!paused ? "pressed" : ""}
        >
          ▶ RUN
        </button>
        <button
          onClick={commandHold}
          className={paused ? "pressed" : ""}
        >
          Ⅱ HOLD
        </button>
        <button disabled={syncing} onClick={syncAll}>
          ↻ {syncing ? "SYNCING" : "SYNC"}
        </button>
        <label>
          SCENARIO{" "}
          <select aria-label="Scenario">
            <option>ISS + TDRSS NETWORK</option>
          </select>
        </label>
        <label>
          GP EPOCH <input aria-label="GP Epoch" value={gpEpoch} readOnly />
        </label>
      </div>
      <section
        className={`workspace ${mapMax ? "map-max" : ""} ${!showViews ? "views-hidden" : ""}`}
      >
        <div className="window map-window">
          <Titlebar title="ISS / TDRSS Real-Time Network Map" />
          <GroundTrack
            t={t}
            trail={trail}
            predicted={predicted}
            nextOrbit={nextOrbit}
            relays={relays}
            showGrid={showGrid}
            showOrbits={showOrbits}
            showTdrs={showTdrs}
            utc={utc}
          />
        </div>
        {showViews && !mapMax && (
          <div className="bottom-row">
            <div className="window">
              <Titlebar title="3D Orbital View — Chase Camera" />
              <Orbit3D
                key={`c${cameraKey}`}
                positionEci={t.positionEci}
                velocityEci={t.velocityEci}
                gmst={t.gmst}
                mode="CHASE"
                onHealth={(mode, message) => setAssetWarnings((current) => { const next = { ...current }; if (message) next[mode] = `${mode} VIEW: ${message}`; else delete next[mode]; return next; })}
              />
            </div>
            <div className="window">
              <Titlebar title="3D Orbital View — Nadir Camera" />
              <Orbit3D
                key={`n${cameraKey}`}
                positionEci={t.positionEci}
                velocityEci={t.velocityEci}
                gmst={t.gmst}
                mode="NADIR"
                onHealth={(mode, message) => setAssetWarnings((current) => { const next = { ...current }; if (message) next[mode] = `${mode} VIEW: ${message}`; else delete next[mode]; return next; })}
              />
            </div>
          </div>
        )}
      </section>
      <div className="control-strip">
        <div>
          <b>PROPAGATION</b>
          <button
            className={!paused ? "pressed" : ""}
            onClick={commandRun}
          >
            Run
          </button>
          <button
            className={paused ? "pressed" : ""}
            onClick={commandHold}
          >
            Hold
          </button>
          <button disabled={syncing} onClick={syncAll}>
            {syncing ? "Syncing…" : "Sync"}
          </button>
        </div>
        <div>
          <b>TELEMETRY</b>
          <span>
            ALT <strong>{t.altitude.toFixed(2)}</strong> km
          </span>
          <span>
            VEL <strong>{t.velocity.toFixed(1)}</strong> km/h
          </span>
          <span>
            LAT <strong>{t.latitude.toFixed(3)}</strong>°
          </span>
          <span>
            LON <strong>{t.longitude.toFixed(3)}</strong>°
          </span>
        </div>
        <div>
          <b>STATUS</b>
          <span className={link ? "green" : "red"}>■ ISS {link ? "VALID" : "DEGRADED"}</span>
          <span className={paused ? "amber" : "green"}>■ EPOCH {epochLabel} UTC</span>
          <span className={sampleCadenceOk ? "green" : "red"}>■ CSV {samples.length} SAMPLES</span>
          <span className={relays.length ? "green" : "red"}>
            ■ TDRSS {relays.length ? `${relays.length} OBJECTS` : "INIT"}
          </span>
        </div>
      </div>
      <div className="annunciator" role="status" aria-live="polite">
        {alerts.filter((alert) => alert.severity !== "ok").length ? alerts.filter((alert) => alert.severity !== "ok").map((alert) => <span key={alert.id} className={alert.severity}>▲ {alert.text}</span>) : <span className="ok">● ALL MONITORED SYSTEMS NOMINAL</span>}
        {lastElementUpdateMs > 0 && <small>LAST GP UPDATE {new Date(lastElementUpdateMs).toISOString().slice(11, 19)} UTC</small>}
      </div>
      <div className="statusbar">
        <span>{notice}</span>
        <span>Frames: ECI / GMST / WGS84</span>
        <span>Sources: CelesTrak GP / SGP4 / Local GLB</span>
        <span>CSV sample: 10 sec</span>
        <span>{paused ? "HOLD" : "RUNNING"}</span>
      </div>
      {dialog && (
        <div className="dialog-shade" onMouseDown={() => setDialog(null)}>
          <section
            className="help-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={dialog.title}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Titlebar title={dialog.title} />
            <pre>{dialog.body}</pre>
            <div className="dialog-actions">
              <button autoFocus onClick={() => setDialog(null)}>
                OK
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
