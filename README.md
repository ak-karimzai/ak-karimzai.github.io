# ak-karimzai.github.io

Portfolio and project-enquiry page of Khalid Karimzai: https://ak-karimzai.github.io

The page contains four live 3D views built with the three.js `WebGPURenderer` and TSL (Three Shading Language) materials, and an enquiry form that prepares a brief for Telegram, email or a GitHub issue.

## 3D views

| View | What it shows | Notable technique |
| --- | --- | --- |
| Service map (`src/gl/systemmap.js`) | Components of a payment platform with request flow on the connections and per-service metrics on hover | Flow dashes animated in a TSL `colorNode`, HTML labels projected from world space, shadow-mapped lighting |
| Warehouse digital twin (`src/gl/warehouse.js`) | Rack occupancy and pick frequency with an automated vehicle on a route | Instanced racking and pallets, per-bay raycast picking, `instanceColor` re-tinting by metric |
| Operations dashboard (`src/gl/dataviz.js`) | A week of API traffic, hour by hour, as a bar surface | One `InstancedMesh` for all bars, eased transitions between metrics, hover readout |
| Product configurator (`src/gl/configurator.js`) | Headphones with colour, finish and accent options and a running price | `MeshPhysicalMaterial` with environment lighting, option blending, TSL contact shadow |

`src/gl/stage.js` owns the renderer. It tries WebGPU first, draws one probe frame inside GPU error scopes, and rebuilds on the WebGL 2 backend if the device reports errors or is lost. Rendering pauses while a view is off screen or the tab is hidden. Add `?gl=webgl` to the URL to force the WebGL 2 backend.

All metrics, inventory and prices on the page are generated sample data.

## Development

```
npm install
npm run dev      # local server with hot reload
npm run build    # production build in dist/
```

Pushes to `main` are built and deployed by `.github/workflows/deploy.yml` to GitHub Pages.

Contact details and enquiry options live in `src/config.js`. The GitHub-issue enquiry form is `.github/ISSUE_TEMPLATE/order.yml`.
