# Fish operator GLB asset

The fish-operator scene loads its squid model from this directory. The GLB
binary is **not committed** (~13 MB) — drop your local copy here:

```
apps/console/public/assets/models/a1f3d3fa-c3d6-43d6-a450-c3b9bcec8937.glb
```

## Asset URL resolution

`FishSwarmPlot` probes a list of candidate URLs and uses the first one that
returns a valid GLB. Order:

1. `VITE_FISH_OPERATOR_MODEL_URL` (full URL, env override)
2. `${VITE_ASSET_BASE_URL}/a1f3d3fa-c3d6-43d6-a450-c3b9bcec8937.glb`
3. `/assets/models/a1f3d3fa-c3d6-43d6-a450-c3b9bcec8937.glb` ← **this folder**
4. `/assets/a1f3d3fa-c3d6-43d6-a450-c3b9bcec8937.glb`
5. `/api/assets/a1f3d3fa-c3d6-43d6-a450-c3b9bcec8937?asset_type=model`
6. `/api/assets/a1f3d3fa-c3d6-43d6-a450-c3b9bcec8937/model`

If none resolves, the plot shows the "Fish model asset is not available"
overlay and the rest of the operator UI keeps working.

## Naming convention

Filename matches `FISH_OPERATOR_MODEL_ASSET_BASE_ID` in
`apps/console/src/features/fish-operator/FishSwarmPlot.tsx`. Change one,
change the other.
