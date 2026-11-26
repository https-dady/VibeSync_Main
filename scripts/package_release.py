"""Create and validate a sanitized source archive using Python's standard library."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_DIRS = {"node_modules", ".git", ".gradle", "build", "Pods", "DerivedData", "coverage", ".verification", ".qa", "secrets", "vendor", ".bundle", ".idea", ".vscode", "__pycache__"}
EXCLUDED_SUFFIXES = {".keystore", ".jks", ".pem", ".p8", ".p12", ".mobileprovision", ".log", ".zip", ".backup", ".pyc", ".class"}

def allowed(relative):
    if any(part in EXCLUDED_DIRS for part in relative.parts):
        return False
    name = relative.name
    if name in {"local.properties", ".DS_Store", "Thumbs.db"} or relative.suffix.lower() in EXCLUDED_SUFFIXES:
        return False
    if name.startswith(".env") and not name.endswith(".example"):
        return False
    if relative.parts[:4] == ("services", "api", "storage", "uploads") and name != ".gitkeep":
        return False
    return True

def digest(data):
    return hashlib.sha256(data).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--original", help="Original input ZIP, for the modified-file record")
    args = parser.parse_args()
    output = Path(args.output).resolve()
    if ROOT == output or ROOT in output.parents:
        raise ValueError("Write the deliverable outside the source tree")
    files = {file.relative_to(ROOT).as_posix(): file for file in ROOT.rglob("*") if file.is_file() and allowed(file.relative_to(ROOT))}
    if args.original:
        old = {}
        with zipfile.ZipFile(args.original) as original:
            for entry in original.infolist():
                if entry.is_dir():
                    continue
                relative = Path(*Path(entry.filename).parts[1:])
                old[relative.as_posix()] = digest(original.read(entry))
        inventory = "# Source inventory\n\nEvery original archive file and added deliverable file is listed below. This inventory records coverage and delivery changes; it does not turn source inspection into runtime verification. Feature traces/findings are in AUDIT_REPORT.md; all 21 screens are mapped in docs/UI_AUDIT.md. Binary resources/signing material were inspected as metadata. The original archive is preserved outside this rebuild.\n\n| File | Original input | Final delivery |\n| --- | --- | --- |\n"
        inventory_names = set(files) | {"SOURCE_INVENTORY.md", "MODIFIED_FILES.md", "SOURCE_MANIFEST.sha256.json"}
        inventory += "".join(f"| `{name}` | {'yes' if name in old else 'added'} | {'included' if name in inventory_names else 'excluded obsolete/signing material'} |\n" for name in sorted(set(old) | inventory_names))
        (ROOT / "SOURCE_INVENTORY.md").write_text(inventory, encoding="utf-8")
        files["SOURCE_INVENTORY.md"] = ROOT / "SOURCE_INVENTORY.md"
        changed = [(name, "added" if name not in old else "modified") for name, file in sorted(files.items()) if name != "MODIFIED_FILES.md" and old.get(name) != digest(file.read_bytes())]
        removed = sorted(name for name in old if name not in files)
        report = "# Modified files\n\nCompared with the supplied archive. Signing keys and accidental backups are excluded from delivery.\n\n| File | Change |\n| --- | --- |\n"
        report += "".join(f"| `{name}` | {kind} |\n" for name, kind in changed)
        report += "| `MODIFIED_FILES.md` | generated change record |\n| `SOURCE_MANIFEST.sha256.json` | generated archive integrity manifest |\n"
        report += "".join(f"| `{name}` | removed from deliverable |\n" for name in removed)
        (ROOT / "MODIFIED_FILES.md").write_text(report, encoding="utf-8")
        files["MODIFIED_FILES.md"] = ROOT / "MODIFIED_FILES.md"
    manifest = {name: digest(file.read_bytes()) for name, file in sorted(files.items())}
    prefix = "VibeSync-rebuilt/"
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, file in sorted(files.items()):
            archive.write(file, prefix + name)
        archive.writestr(prefix + "SOURCE_MANIFEST.sha256.json", json.dumps(manifest, indent=2) + "\n")
    with zipfile.ZipFile(output) as archive:
        bad = archive.testzip()
        if bad:
            raise ValueError(f"ZIP CRC failure: {bad}")
        for name, expected in manifest.items():
            if digest(archive.read(prefix + name)) != expected:
                raise ValueError(f"Manifest mismatch: {name}")
        for required in ["package.json", "services/api/package-lock.json", "apps/mobile/package-lock.json", "apps/mobile/android/gradle/wrapper/gradle-wrapper.jar", "AUDIT_REPORT.md", "PROJECT_EXECUTION_LEDGER.md", "CHANGELOG.md", "DEPLOYMENT.md", "TEST_REPORT.md", "PERFORMANCE_REPORT.md", "PRODUCTION_ENV.example", "SECURITY_CHECKLIST.md", "KNOWN_LIMITATIONS.md", "MODIFIED_FILES.md", "SOURCE_INVENTORY.md", "docs/ANDROID_BUILD.md", "docs/IOS_BUILD.md", "docs/BACKEND_SETUP.md", "docs/MONGODB_SETUP.md", "docs/REDIS_SETUP.md", "docs/TURN_SETUP.md", "docs/SFU.md", ".github/workflows/verify.yml"]:
            if prefix + required not in archive.namelist():
                raise ValueError(f"Missing required source: {required}")
    checksum = digest(output.read_bytes())
    output.with_suffix(output.suffix + ".sha256").write_text(f"{checksum}  {output.name}\n", encoding="utf-8")
    print(json.dumps({"archive": str(output), "source_files": len(files), "bytes": output.stat().st_size, "sha256": checksum, "crc_and_manifest": "passed"}, indent=2))

if __name__ == "__main__":
    main()
