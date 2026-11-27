# Boulder-Risk Scoring (`moonsafe.risk`)

`moonsafe.risk.compute_risk_grid` aggregates boulder detections over a
configurable grid and produces the shared `RiskGrid` screening map.

## Important Disclaimer

All built-in `lander` and `rover` threshold presets are **illustrative,
unvalidated screening defaults** (`validated: false`, `illustrative_default: true`,
`screening_only: true`). Outputs are not mission-certified landing or traverse
safety guidance.

## Conflict Resolution (Size vs. Density)

Each cell evaluates:
- **Size risk** from `max_size_m` against `caution_boulder_size_m` / `unsafe_boulder_size_m`.
- **Density risk** from `boulder_count` (and optional `density_per_100m2`) against
  `caution_boulder_count` / `unsafe_boulder_count` (and optional areal density thresholds).

When size and density disagree, `RiskConfig.conflict_policy` controls which wins:
- **`worst_case` (default):** the higher hazard severity (`unsafe > caution > safe`) wins, emitting `size_and_density_disagree_worst_case_wins`.
- **`size_priority`:** size risk wins.
- **`density_priority`:** density risk wins.

## Uncertain Cells & Reason Codes

A cell is classified `uncertain` (with UI `reason_codes`) when:
- Image coverage is `missing` (`missing_image_coverage`), `partial` without per-cell
  masks (`partial_image_coverage`), or cell overlap is below `min_valid_coverage`
  (`insufficient_cell_coverage`).
- GSD is missing (`missing_gsd_cannot_resolve_size`) or the image pixel scale
  cannot resolve the active threshold size (`image_resolution_cannot_resolve_caution_threshold` /
  `image_resolution_cannot_resolve_unsafe_threshold`).
- Detections in the cell lack `estimated_size_m`, exceed configured
  `max_size_uncertainty_m` / `max_relative_size_uncertainty` / `max_position_uncertainty_m`,
  fall below `min_detection_confidence`, or have uncertain positions in `lunar_local_m`.
