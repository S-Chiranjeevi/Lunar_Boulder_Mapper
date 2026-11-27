"""Configuration and illustrative threshold profiles for MoonSafe."""

from __future__ import annotations

import os
from pathlib import Path

from .schemas import ThresholdConfig, ThresholdProfile


# Unvalidated, illustrative threshold profiles for early screening prototypes only.
ILLUSTRATIVE_THRESHOLD_PROFILES: dict[ThresholdProfile, ThresholdConfig] = {
    "lander": ThresholdConfig(
        cell_size_m=25.0,
        caution_boulder_size_m=0.5,
        unsafe_boulder_size_m=1.0,
        caution_boulder_count=3,
        unsafe_boulder_count=8,
        min_confidence=0.25,
        min_cell_coverage=0.8,
        require_lunar_transform_for_safe=False,
        illustrative_only=True,
        note=(
            "Illustrative unvalidated Lander profile. Do not treat as a flight "
            "landing certification or hazard-avoidance guarantee."
        ),
    ),
    "rover": ThresholdConfig(
        cell_size_m=10.0,
        caution_boulder_size_m=0.3,
        unsafe_boulder_size_m=0.6,
        caution_boulder_count=2,
        unsafe_boulder_count=5,
        min_confidence=0.25,
        min_cell_coverage=0.8,
        require_lunar_transform_for_safe=False,
        illustrative_only=True,
        note=(
            "Illustrative unvalidated Rover profile. Do not treat as a traverse "
            "clearance or mobility guarantee."
        ),
    ),
    "custom": ThresholdConfig(
        cell_size_m=20.0,
        caution_boulder_size_m=0.5,
        unsafe_boulder_size_m=1.0,
        caution_boulder_count=3,
        unsafe_boulder_count=8,
        min_confidence=0.25,
        min_cell_coverage=0.8,
        require_lunar_transform_for_safe=False,
        illustrative_only=True,
        note=(
            "Custom screening thresholds (unvalidated unless calibrated against "
            "mission-specific NAC imagery and terrain requirements)."
        ),
    ),
}


def resolve_thresholds(
    profile: ThresholdProfile,
    override: ThresholdConfig | None = None,
) -> ThresholdConfig:
    """Return a validated ThresholdConfig for the requested profile."""
    if override is not None:
        return override.model_copy(deep=True)
    return ILLUSTRATIVE_THRESHOLD_PROFILES[profile].model_copy(deep=True)


def get_data_dir() -> Path:
    """Return the writable MoonSafe runtime data directory."""
    env_dir = os.environ.get("MOONSAFE_DATA_DIR")
    if env_dir:
        return Path(env_dir)
    return Path(__file__).resolve().parents[1] / "data"
