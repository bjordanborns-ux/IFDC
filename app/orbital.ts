import {
  degreesLat,
  degreesLong,
  eciToEcf,
  eciToGeodetic,
  gstime,
  propagate,
  twoline2satrec,
} from "satellite.js";

export type Vec3 = { x: number; y: number; z: number };

export type OrbitalState = {
  latitude: number;
  longitude: number;
  altitude: number;
  velocity: number;
  visibility: string;
  timestamp: number;
  epochMs: number;
  gmst: number;
  positionEci: Vec3;
  velocityEci: Vec3;
  positionEcf: Vec3;
};

export type TrackPoint = { lat: number; lon: number };

export type RelayState = TrackPoint & {
  name: string;
  alt: number;
  range: number;
  los: boolean;
  positionEci: Vec3;
  positionEcf: Vec3;
};

const EARTH_EQUATORIAL_KM = 6378.137;
const EARTH_POLAR_KM = 6356.752314245;

function tleLines(tle: string) {
  const lines = tle.trim().split(/\r?\n/);
  const line1 = lines.find((line) => line.startsWith("1 "));
  const line2 = lines.find((line) => line.startsWith("2 "));
  if (!line1 || !line2) throw new Error("TLE is incomplete");
  return { lines, line1, line2 };
}

export function tleEpoch(tle: string) {
  const { line1 } = tleLines(tle);
  const year = Number(line1.slice(18, 20));
  const dayOfYear = Number(line1.slice(20, 32));
  return new Date(
    Date.UTC(year < 57 ? 2000 + year : 1900 + year, 0, 1) +
      (dayOfYear - 1) * 86_400_000,
  );
}

export function propagateIss(tle: string, epoch: Date): OrbitalState {
  const { line1, line2 } = tleLines(tle);
  const result = propagate(twoline2satrec(line1, line2), epoch);
  if (
    !result.position ||
    typeof result.position === "boolean" ||
    !result.velocity ||
    typeof result.velocity === "boolean"
  ) {
    throw new Error("SGP4 propagation failed");
  }

  const theta = gstime(epoch);
  const geodetic = eciToGeodetic(result.position, theta);
  const positionEcf = eciToEcf(result.position, theta);
  const speedKmS = Math.hypot(
    result.velocity.x,
    result.velocity.y,
    result.velocity.z,
  );

  return {
    latitude: degreesLat(geodetic.latitude),
    longitude: degreesLong(geodetic.longitude),
    altitude: geodetic.height,
    velocity: speedKmS * 3600,
    visibility: "SGP4",
    timestamp: Math.floor(epoch.getTime() / 1000),
    epochMs: epoch.getTime(),
    gmst: theta,
    positionEci: { ...result.position },
    velocityEci: { ...result.velocity },
    positionEcf: { ...positionEcf },
  };
}

export function propagateTrack(
  tle: string,
  epoch: Date,
  fromMinutes: number,
  toMinutes: number,
  stepMinutes = 1,
) {
  const { line1, line2 } = tleLines(tle);
  const satellite = twoline2satrec(line1, line2);
  const points: TrackPoint[] = [];

  for (
    let minutes = fromMinutes;
    minutes <= toMinutes;
    minutes += stepMinutes
  ) {
    const sampleEpoch = new Date(epoch.getTime() + minutes * 60_000);
    const result = propagate(satellite, sampleEpoch);
    if (!result.position || typeof result.position === "boolean") continue;
    const geodetic = eciToGeodetic(result.position, gstime(sampleEpoch));
    points.push({
      lat: degreesLat(geodetic.latitude),
      lon: degreesLong(geodetic.longitude),
    });
  }

  return points;
}

// Segment-versus-WGS84-ellipsoid test. Scaling ECF coordinates turns the
// oblate Earth into a unit sphere, then the closest point on the segment is used.
export function geometricLos(a: Vec3, b: Vec3) {
  const p = {
    x: a.x / EARTH_EQUATORIAL_KM,
    y: a.y / EARTH_EQUATORIAL_KM,
    z: a.z / EARTH_POLAR_KM,
  };
  const q = {
    x: b.x / EARTH_EQUATORIAL_KM,
    y: b.y / EARTH_EQUATORIAL_KM,
    z: b.z / EARTH_POLAR_KM,
  };
  const d = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };
  const lengthSquared = d.x * d.x + d.y * d.y + d.z * d.z;
  const fraction = Math.max(
    0,
    Math.min(1, -(p.x * d.x + p.y * d.y + p.z * d.z) / lengthSquared),
  );
  const closest = {
    x: p.x + fraction * d.x,
    y: p.y + fraction * d.y,
    z: p.z + fraction * d.z,
  };
  const clearsEarth =
    closest.x * closest.x + closest.y * closest.y + closest.z * closest.z > 1;
  const range = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  return { los: clearsEarth, range };
}

export function propagateRelays(
  tleCatalog: string,
  epoch: Date,
  iss: OrbitalState,
) {
  const lines = tleCatalog.trim().split(/\r?\n/);
  const relays: RelayState[] = [];

  for (let index = 0; index < lines.length - 2; index += 1) {
    const name = lines[index].trim();
    const line1 = lines[index + 1];
    const line2 = lines[index + 2];
    if (
      !/^TDRS\s/i.test(name) ||
      !line1.startsWith("1 ") ||
      !line2.startsWith("2 ")
    ) {
      continue;
    }

    const result = propagate(twoline2satrec(line1, line2), epoch);
    if (!result.position || typeof result.position === "boolean") continue;
    const theta = gstime(epoch);
    const geodetic = eciToGeodetic(result.position, theta);
    const positionEcf = eciToEcf(result.position, theta);
    const geometry = geometricLos(iss.positionEcf, positionEcf);
    relays.push({
      name: name.replace(/\s+/g, " "),
      lat: degreesLat(geodetic.latitude),
      lon: degreesLong(geodetic.longitude),
      alt: geodetic.height,
      range: geometry.range,
      los: geometry.los,
      positionEci: { ...result.position },
      positionEcf: { ...positionEcf },
    });
  }

  return relays;
}
