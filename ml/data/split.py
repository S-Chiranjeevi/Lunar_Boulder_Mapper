"""Leakage-free train/val/test splitting grouped by source observation or site."""

from __future__ import annotations

import random
from collections import defaultdict
from typing import Literal

from .schema import TileRecord

SplitName = Literal["train", "val", "test"]


def assign_group_splits(
    records: list[TileRecord],
    *,
    train_ratio: float = 0.7,
    val_ratio: float = 0.15,
    test_ratio: float = 0.15,
    seed: int = 42,
) -> dict[SplitName, list[TileRecord]]:
    """Split tiles into train/val/test without splitting any observation or site.

    All tiles sharing ``site_id`` (when supplied) or ``source_observation_id`` are
    placed in the exact same split to avoid neighboring-tile spatial leakage.
    """
    if train_ratio < 0 or val_ratio < 0 or test_ratio < 0:
        raise ValueError("Split ratios must be non-negative")
    total_ratio = train_ratio + val_ratio + test_ratio
    if abs(total_ratio - 1.0) > 1e-6:
        raise ValueError(f"Split ratios must sum to 1.0 (got {total_ratio:.6f})")

    groups: dict[str, list[TileRecord]] = defaultdict(list)
    for record in records:
        groups[record.split_group_key].append(record)

    splits: dict[SplitName, list[TileRecord]] = {"train": [], "val": [], "test": []}
    if not groups:
        return splits

    # Deterministic shuffle before size-descending greedy assignment keeps group balance predictable.
    rng = random.Random(seed)
    group_items = list(groups.items())
    group_items.sort(key=lambda item: item[0])
    rng.shuffle(group_items)
    group_items.sort(key=lambda item: len(item[1]), reverse=True)

    total_tiles = len(records)
    targets: dict[SplitName, float] = {
        "train": train_ratio * total_tiles,
        "val": val_ratio * total_tiles,
        "test": test_ratio * total_tiles,
    }
    ratios: dict[SplitName, float] = {
        "train": train_ratio,
        "val": val_ratio,
        "test": test_ratio,
    }
    enabled_splits: list[SplitName] = [name for name, ratio in ratios.items() if ratio > 0]
    counts: dict[SplitName, int] = {"train": 0, "val": 0, "test": 0}

    for _, group_records in group_items:
        # Pick the enabled split furthest below its target fraction.
        chosen = max(
            enabled_splits,
            key=lambda split_name: (
                (targets[split_name] - counts[split_name]) / max(targets[split_name], 1e-9),
                targets[split_name] - counts[split_name],
            ),
        )
        splits[chosen].extend(group_records)
        counts[chosen] += len(group_records)

    verify_no_group_leakage(splits)
    return splits


def verify_no_group_leakage(splits: dict[SplitName, list[TileRecord]]) -> None:
    """Raise ValueError if any site_id or source_observation_id appears in multiple splits."""
    obs_to_splits: dict[str, set[str]] = defaultdict(set)
    site_to_splits: dict[str, set[str]] = defaultdict(set)
    group_to_splits: dict[str, set[str]] = defaultdict(set)

    for split_name, records in splits.items():
        for record in records:
            obs_to_splits[record.source_observation_id].add(split_name)
            group_to_splits[record.split_group_key].add(split_name)
            if record.site_id:
                site_to_splits[record.site_id].add(split_name)

    leaked_groups = {k: sorted(v) for k, v in group_to_splits.items() if len(v) > 1}
    leaked_obs = {k: sorted(v) for k, v in obs_to_splits.items() if len(v) > 1}
    leaked_sites = {k: sorted(v) for k, v in site_to_splits.items() if len(v) > 1}

    if leaked_groups or leaked_obs or leaked_sites:
        raise ValueError(
            "Leakage detected across splits: "
            f"groups={leaked_groups}, observations={leaked_obs}, sites={leaked_sites}"
        )
