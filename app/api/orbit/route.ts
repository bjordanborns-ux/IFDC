const urls = {
  iss: "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE",
  tdrs: "https://celestrak.org/NORAD/elements/gp.php?GROUP=tdrss&FORMAT=TLE",
};
export async function GET(request: Request) {
  const mode =
    (new URL(request.url).searchParams.get("mode") as keyof typeof urls) ||
    "iss";
  if (!urls[mode]) return new Response("Unknown orbit source", { status: 404 });
  try {
    const response = await fetch(urls[mode], {
      headers: { "User-Agent": "ISS-Mission-Control/1.0" },
    });
    if (!response.ok) throw new Error(String(response.status));
    return new Response(await response.text(), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=7200",
      },
    });
  } catch {
    return new Response("Ephemeris unavailable", { status: 502 });
  }
}
