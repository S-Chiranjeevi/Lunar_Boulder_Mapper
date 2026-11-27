"""Policy guard preventing unreviewed Bickel rockfall labels from entering boulder training."""

from __future__ import annotations

from dataclasses import dataclass

from .schema import TileRecord

_BICKEL_MARKERS = ("bickel", "rockfall")


@dataclass(frozen=True)
class ExcludedTile:
    """Audit entry for a tile excluded during curation."""

    image_id: str
    source_observation_id: str
    label_source: str
    reason_code: str
    detail: str


def is_bickel_rockfall_record(record: TileRecord) -> bool:
    """Return True when a record originates from Bickel or another rockfall-track task."""
    if record.task_type == "rockfall":
        return True
    haystack = f"{record.label_source} {record.provenance_notes}".lower()
    return any(marker in haystack for marker in _BICKEL_MARKERS)


def filter_curated_records(
    records: list[TileRecord],
    *,
    include_reviewed_bickel: bool = False,
) -> tuple[list[TileRecord], list[ExcludedTile]]:
    """Separate curated standalone boulder records from rockfall/unreviewed records.

    Bickel rockfall labels represent displaced-boulder / rockfall-track events rather
    than exhaustive standalone boulder inventories across terrain, so they are excluded
    by default unless explicitly reviewed and relabeled for standalone boulder detection.
    """
    accepted: list[TileRecord] = []
    excluded: list[ExcludedTile] = []

    for record in records:
        if is_bickel_rockfall_record(record):
            if (
                include_reviewed_bickel
                and record.reviewed_for_standalone_boulder
                and record.task_type == "standalone_boulder"
            ):
                accepted.append(record)
            else:
                excluded.append(
                    ExcludedTile(
                        image_id=record.image_id,
                        source_observation_id=record.source_observation_id,
                        label_source=record.label_source,
                        reason_code="BICKEL_ROCKFALL_DIFFERENT_TASK",
                        detail=(
                            "Excluded: rockfall/Bickel labels target rockfall tracks rather than "
                            "standalone boulder screening unless explicitly reviewed and relabeled."
                        ),
                    )
                )
            continue

        if record.task_type != "standalone_boulder":
            excluded.append(
                ExcludedTile(
                    image_id=record.image_id,
                    source_observation_id=record.source_observation_id,
                    label_source=record.label_source,
                    reason_code="UNSUPPORTED_TASK_TYPE",
                    detail=f"Excluded: task_type='{record.task_type}' is not standalone_boulder.",
                )
            )
            continue

        if not record.reviewed_for_standalone_boulder:
            excluded.append(
                ExcludedTile(
                    image_id=record.image_id,
                    source_observation_id=record.source_observation_id,
                    label_source=record.label_source,
                    reason_code="UNREVIEWED_LABELS",
                    detail="Excluded: labels are not marked reviewed_for_standalone_boulder.",
                )
            )
            continue

        accepted.append(record)

    return accepted, excluded
