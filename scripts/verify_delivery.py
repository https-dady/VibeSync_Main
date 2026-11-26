"""Safely extract the produced source ZIP and verify every manifest byte."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
from package_release import allowed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", required=True)
    parser.add_argument("--extract", required=True, help="New directory; never overwrites an existing extraction")
    args = parser.parse_args()
    archive_path = Path(args.archive).resolve()
    destination = Path(args.extract).resolve()
    if destination.exists():
        raise ValueError("Use a new extraction directory")
    prefix = "VibeSync-rebuilt/"
    with zipfile.ZipFile(archive_path) as archive:
        if archive.testzip():
            raise ValueError("ZIP CRC validation failed")
        manifest = json.loads(archive.read(prefix + "SOURCE_MANIFEST.sha256.json"))
        expected_names = {prefix + name for name in manifest} | {prefix + "SOURCE_MANIFEST.sha256.json"}
        if set(archive.namelist()) != expected_names:
            raise ValueError("Unexpected or missing archive entries")
        for entry in archive.infolist():
            relative = Path(entry.filename)
            if relative.is_absolute() or ".." in relative.parts or not entry.filename.startswith(prefix):
                raise ValueError("Unsafe ZIP path")
            if not allowed(Path(*relative.parts[1:])):
                raise ValueError(f"Generated/private file in delivery: {entry.filename}")
        destination.mkdir(parents=True)
        archive.extractall(destination)
    root = destination / "VibeSync-rebuilt"
    for name, expected in manifest.items():
        actual = hashlib.sha256((root / name).read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError(f"Extracted hash mismatch: {name}")
    print(json.dumps({"extract": str(root), "verified_source_files": len(manifest),
                      "crc": "passed", "manifest_after_extraction": "passed", "excluded_file_check": "passed"}, indent=2))


if __name__ == "__main__":
    main()
