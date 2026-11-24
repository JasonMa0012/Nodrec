"""Query Nodrec JSONL. Times are integer 100 ns ticks on the active recording session clock."""
import argparse
import json
from pathlib import Path


def decode(row, header):
    if isinstance(row, dict):
        return row
    kind, *values = row
    columns = header["columns"][kind]
    if len(values) > len(columns):
        raise ValueError(f"Too many columns in {kind} report")
    return {"type": kind, **dict(zip(columns, values)),
            **{key: header["defaults"][key] for key in columns[len(values):]}}


def records(video, frame=None, interval=None):
    with video.with_suffix(".input.jsonl").open("rb") as events:
        header = json.loads(events.readline())
        if header["version"] not in (1, 2):
            raise ValueError("Unsupported input version")
        index_path = video.with_suffix(".frames.jsonl")
        if frame is not None or (interval is not None and index_path.is_file()):
            with index_path.open("rb") as frames:
                index_header = json.loads(frames.readline())
                if header["version"] == 2:
                    shared = {k: v for k, v in header.items() if k not in ("columns", "defaults")}
                    matched = all(index_header.get(k) == v for k, v in shared.items())
                else:
                    matched = index_header == header
                if not matched:
                    raise ValueError("Input and frame index headers differ")
                for number, row in enumerate(map(json.loads, frames)):
                    if header["version"] == 2:
                        row = dict(zip(index_header["columns"], row, strict=True))
                        row.update(frame=number, session_start=row["start"] + index_header["session_shift"],
                                   session_end=row["end"] + index_header["session_shift"])
                    if frame is None:
                        start, _ = interval
                        if row["session_start"] > start:
                            break
                        if start < row["session_end"]:
                            events.seek(row["byte_start"])
                            break
                        events.seek(row["byte_end"])
                    elif row["frame"] == frame:
                        events.seek(row["byte_start"])
                        while events.tell() < row["byte_end"]:
                            yield decode(json.loads(events.readline()), header)
                        return
                if frame is not None:
                    raise ValueError(f"Frame {frame} does not exist")
        if interval is not None:
            start, end = interval
            if end < start:
                raise ValueError("END must be at least START")
            for packed in map(json.loads, events):
                row = decode(packed, header)
                if row["t"] >= end:
                    return
                if row["t"] >= start:
                    yield row
        else:
            for packed in map(json.loads, events):
                yield decode(packed, header)


def actions(rows):
    movement = None
    for row in rows:
        if (row["type"] == "mouse" and not row["button_flags"] and not row["raw_buttons"]
                and not row["button_data"] and row["wheel"] is None and not row["flags"] & 4):
            if movement is None or movement["device"] != row["device"] or movement["flags"] != row["flags"]:
                if movement:
                    yield movement
                movement = {"type": "move", "device": row["device"], "flags": row["flags"],
                            "start": row["t"], "from_px": row["cursor_px"], "reports": 0}
            movement.update(end=row["t"], to_px=row["cursor_px"], reports=movement["reports"] + 1)
        else:
            if movement:
                yield movement
                movement = None
            yield row
    if movement:
        yield movement


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--raw", action="store_true", help="Show every original report and state snapshot")
    query = parser.add_mutually_exclusive_group()
    query.add_argument("--frame", type=int)
    query.add_argument("--time", type=int, nargs=2, metavar=("START", "END"))
    args = parser.parse_args()
    rows = records(args.video, args.frame, args.time)
    for record in (rows if args.raw else actions(rows)):
        print(json.dumps(record, separators=(",", ":")))
