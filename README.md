# ISS Mission Control

A readable, editable ISS tracking dashboard built with React, TypeScript, Three.js, satellite.js, and Vite/Vinext.

The project intentionally keeps the 2010-era mission-control appearance. The code has been expanded and formatted so each part can be edited without digging through compressed one-line files.

## Start it on Windows

Open PowerShell in this folder and run:

```powershell
npm install
npm run dev
```

Then open the local address printed by Vite, normally `http://localhost:5173/`.

Stop the server with `Ctrl+C`.

## Where to edit things

| File or folder                     | Purpose                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `app/page.tsx`                     | Main dashboard, map, telemetry, menus, TDRSS logic, CSV logger, and state-vector display     |
| `app/Orbit3D.tsx`                  | Three.js Earth and ISS scene, model loading, spacecraft attitude, cameras, and 3D orbit line |
| `app/globals.css`                  | Dashboard styling, map overlays, menus, windows, buttons, and responsive layout              |
| `app/api/orbit/route.ts`           | Server route that retrieves CelesTrak ISS and TDRSS orbital elements                         |
| `app/api/asset/route.ts`           | Server route for remote map imagery                                                          |
| `app/layout.tsx`                   | Browser title, description, and site metadata                                                |
| `public/models/ISS_stationary.glb` | Physical ISS 3D model used by `Orbit3D.tsx`                                                  |
| `public/models/earth.glb`          | Physical Earth 3D model used by `Orbit3D.tsx`                                                |
| `package.json`                     | Project dependencies and commands                                                            |

## Main data flow

1. The browser retrieves current ISS telemetry from Where The ISS At.
2. `/api/orbit` retrieves current GP/TLE data from CelesTrak.
3. `satellite.js` propagates the ISS and TDRSS positions.
4. `page.tsx` draws the world map, ground tracks, links, telemetry, and menus.
5. `Orbit3D.tsx` converts the ISS position into the Earth-fixed Three.js scene.
6. A telemetry sample is stored in memory every 10 seconds. **File → Export telemetry CSV** downloads those accumulated samples as `telemetry.csv`.

## Important limitations

- Web pages cannot silently overwrite a file in your Downloads folder. The dashboard updates its internal CSV data every 10 seconds, then writes the accumulated data when you export it.
- The `.glb` files are binary 3D assets, not application code. Edit them in Blender if you want to change the physical models. Keep their filenames and export them as GLB so the existing loader continues to work.
- The displayed TDRSS relay selection is simulated from geometric line of sight. It is not NASA's operational relay assignment.
- The state-vector velocity is track-derived and labeled as such. Current latitude, longitude, altitude, and scalar speed come from the live ISS telemetry source.

## Useful commands

```powershell
npm run dev       # Start the editable development version
npm run build     # Create a production build (requires a Bash-capable shell)
npm test          # Build and run the included test
```

## Editing the 3D models

1. Open `ISS_stationary.glb` or `earth.glb` in Blender.
2. Make the change.
3. Export as **glTF 2.0 (.glb)**.
4. Replace the matching file under `public/models/`.
5. Do not rename it unless you also update `ISS_MODEL` or `EARTH_MODEL` in `app/Orbit3D.tsx`.

The loader automatically centers and scales both models, so normal Blender object dimensions will not break the cameras.
