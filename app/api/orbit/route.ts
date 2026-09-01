const sources = {
  iss: [
    "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE",
    "https://raw.githubusercontent.com/satvisorcom/satvisor-data/master/celestrak/tle/stations.tle",
  ],
  tdrs: [
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=tdrss&FORMAT=TLE",
    "https://raw.githubusercontent.com/satvisorcom/satvisor-data/master/celestrak/tle/tdrss.tle",
  ],
  starlink: [
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=TLE",
    "https://raw.githubusercontent.com/satvisorcom/satvisor-data/master/celestrak/tle/starlink.tle",
  ],
};

const timeouts: Record<keyof typeof sources, number> = {
  iss: 12_000,
  tdrs: 15_000,
  starlink: 30_000,
};

export async function GET(request: Request) {
  const mode =
    (new URL(request.url).searchParams.get("mode") as keyof typeof sources) ||
    "iss";
  if (!sources[mode]) return new Response("Unknown orbit source", { status: 404 });

  const failures: string[] = [];
  for (const [sourceIndex, source] of sources[mode].entries()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeouts[mode]);
    try {
      const response = await fetch(source, {
        headers: {
          Accept: "text/plain",
          "User-Agent": "IFDC-Mission-Console/1.1",
        },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        failures.push(`${sourceIndex}:${response.status}`);
        continue;
      }
      return new Response(response.body, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=7200, stale-while-revalidate=21600",
          "X-Orbit-Source": sourceIndex === 0 ? `CelesTrak-${mode}` : `CelesTrak-mirror-${mode}`,
        },
      });
    } catch (error) {
      failures.push(`${sourceIndex}:${error instanceof Error && error.name === "AbortError" ? "timeout" : "network"}`);
    } finally {
      clearTimeout(timeout);
    }
  }
  return new Response(`CelesTrak ${mode.toUpperCase()} sources unavailable (${failures.join(",")})`, { status: 502 });
}
