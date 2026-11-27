"""Illustrative threshold profiles and validation for boulder-risk scoring."""

from __future__ import annotations

import math
from copy import deepcopy
from typing import Any, Mapping


class RiskGridError(ValueError):
    """Raised when risk-scoring inputs or threshold configurations are invalid."""


CONFLICT_POLICIES: tuple[str, ...] = ("worst_case", "size_priority", "density_priority")

# Illustrative unvalidated screening defaults; never mission-certified guidance.
ILLUSTRATIVE_PROFILES: dict[str, dict[str, Any]] = {
    "lander": {
        "threshold_profile": "lander",
        "cell_size_m": 10.0,
        "cell_size_units": "m",
        "caution_boulder_size_m": 0.5,
        "unsafe_boulder_size_m": 1.0,
        "caution_boulder_count": 1,
        "unsafe_boulder_count": 3,
        "caution_density_per_100m2": None,
        "unsafe_density_per_100m2": None,
        "min_valid_coverage": 0.8,
        "validated": False,
        "illustrative_default": True,
        "notes": "Illustrative unvalidated lander screening defaults only; not mission-certified guidance.",
    },
    "rover": {
        "threshold_profile": "rover",
        "cell_size_m": 5.0,
        "cell_size_units": "m",
        "caution_boulder_size_m": 0.3,
        "unsafe_boulder_size_m": 0.6,
        "caution_boulder_count": 2,
        "unsafe_boulder_count": 5,
        "caution_density_per_100m2": None,
        "unsafe_density_per_100m2": None,
        "min_valid_coverage": 0.8,
        "validated": False,
        "illustrative_default": True,
        "notes": "Illustrative unvalidated rover screening defaults only; not mission-certified guidance.",
    },
}


def _finite_float(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise RiskGridError(f"{name} must be a finite number")
    return float(value)


def _positive_float(value: Any, name: str) -> float:
    result = _finite_float(value, name)
    if result <= 0:
        raise RiskGridError(f"{name} must be > 0")
    return result


def _non_negative_int(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise RiskGridError(f"{name} must be a non-negative integer")
    return value


def resolve_thresholds(
    threshold_config: Mapping[str, Any] | None = None,
    *,
    threshold_profile: str | None = None,
    overrides: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Resolve and validate a threshold configuration, preserving illustrative labels."""
    base_source = dict(threshold_config) if threshold_config is not None else {}
    profile = threshold_profile or base_source.get("threshold_profile") or "lander"

    if profile in ILLUSTRATIVE_PROFILES:
        resolved = deepcopy(ILLUSTRATIVE_PROFILES[profile])
        is_default = True
    elif profile == "custom":
        resolved = deepcopy(ILLUSTRATIVE_PROFILES["lander"])
        resolved["threshold_profile"] = "custom"
        is_default = False
    else:
        raise RiskGridError(f"Unsupported threshold_profile {profile!r}; expected lander, rover, or custom")

    allowed_keys = {
        "cell_size_m",
        "caution_boulder_size_m",
        "unsafe_boulder_size_m",
        "caution_boulder_count",
        "unsafe_boulder_count",
        "caution_density_per_100m2",
        "unsafe_density_per_100m2",
        "min_valid_coverage",
    }

    for source in (base_source, dict(overrides or {})):
        for key in allowed_keys:
            if key in source and source[key] is not None:
                if resolved.get(key) != source[key] or profile == "custom":
                    is_default = False
                resolved[key] = source[key]

    resolved["cell_size_m"] = _positive_float(resolved["cell_size_m"], "cell_size_m")
    resolved["caution_boulder_size_m"] = _positive_float(
        resolved["caution_boulder_size_m"], "caution_boulder_size_m"
    )
    resolved["unsafe_boulder_size_m"] = _positive_float(
        resolved["unsafe_boulder_size_m"], "unsafe_boulder_size_m"
    )
    if resolved["caution_boulder_size_m"] > resolved["unsafe_boulder_size_m"]:
        raise RiskGridError("caution_boulder_size_m cannot exceed unsafe_boulder_size_m")

    resolved["caution_boulder_count"] = _non_negative_int(
        resolved["caution_boulder_count"], "caution_boulder_count"
    )
    resolved["unsafe_boulder_count"] = _non_negative_int(
        resolved["unsafe_boulder_count"], "unsafe_boulder_count"
    )
    if resolved["caution_boulder_count"] > resolved["unsafe_boulder_count"]:
        raise RiskGridError("caution_boulder_count cannot exceed unsafe_boulder_count")

    caution_dens = resolved.get("caution_density_per_100m2")
    unsafe_dens = resolved.get("unsafe_density_per_100m2")
    if (caution_dens is None) != (unsafe_dens is None):
        raise RiskGridError("Both caution_density_per_100m2 and unsafe_density_per_100m2 must be provided together")
    if caution_dens is not None and unsafe_dens is not None:
        c_dens = _finite_float(caution_dens, "caution_density_per_100m2")
        u_dens = _finite_float(unsafe_dens, "unsafe_density_per_100m2")
        if c_dens < 0 or u_dens < 0 or c_dens > u_dens:
            raise RiskGridError("Density thresholds must be non-negative with caution <= unsafe")
        resolved["caution_density_per_100m2"] = c_dens
        resolved["unsafe_density_per_100m2"] = u_dens

    min_cov = _finite_float(resolved["min_valid_coverage"], "min_valid_coverage")
    if min_cov < 0.0 or min_cov > 1.0:
        raise RiskGridError("min_valid_coverage must be in [0.0, 1.0]")
    resolved["min_valid_coverage"] = min_cov

    resolved["cell_size_units"] = "m"
    resolved["validated"] = False
    resolved["illustrative_default"] = is_default
    resolved["notes"] = (
        "Illustrative unvalidated screening defaults only; not mission-certified guidance."
        if is_default
        else "Configurable unvalidated screening thresholds; screening only, not mission-certified guidance."
    )
    return resolved
