const assets: Record<string, { url: string; type: string }> = {
  map: {
    url: "https://neo.gsfc.nasa.gov/servlet/RenderData?cs=rgb&format=JPEG&height=720&si=526308&width=1440",
    type: "image/jpeg",
  },
  earth: {
    url: "https://svs.gsfc.nasa.gov/vis/a030000/a030600/a030614/blue_marble_modis_north_america_print.jpg",
    type: "image/jpeg",
  },
  iss: {
    url: "https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/model/international-space-station-%28iss%29-%28d%29-%28igoal%29/International%20Space%20Station%20%28ISS%29%20%28D%29%20%28IGOAL%29.glb",
    type: "model/gltf-binary",
  },
};
export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind") || "";
  const asset = assets[kind];
  if (!asset) return new Response("Unknown asset", { status: 404 });
  try {
    const response = await fetch(asset.url, {
      headers: { "User-Agent": "ISS-Mission-Control/1.0" },
    });
    if (!response.ok) throw new Error(String(response.status));
    return new Response(response.body, {
      headers: {
        "Content-Type": asset.type,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response("Asset source unavailable", { status: 502 });
  }
}
