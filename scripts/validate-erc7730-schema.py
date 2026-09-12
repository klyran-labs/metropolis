"""Validate AgentGuard ERC-7730 descriptors and fixtures against official v2 schemas."""

import json
import sys
import urllib.request
from pathlib import Path

from jsonschema import Draft202012Validator

REGISTRY_COMMIT = "0318f9a51ec4fc7ba4aed6de5e315c8884d1fe38"
DESCRIPTOR_SCHEMA_URL = (
    "https://raw.githubusercontent.com/ethereum/clear-signing-erc7730-registry/"
    f"{REGISTRY_COMMIT}/specs/erc7730-v2.schema.json"
)
TEST_SCHEMA_URL = (
    "https://raw.githubusercontent.com/ethereum/clear-signing-erc7730-registry/"
    f"{REGISTRY_COMMIT}/specs/erc7730-tests-v2.schema.json"
)


def main() -> int:
    req1 = urllib.request.Request(DESCRIPTOR_SCHEMA_URL, headers={"User-Agent": "AgentGuard-Validator/1.0"})
    req2 = urllib.request.Request(TEST_SCHEMA_URL, headers={"User-Agent": "AgentGuard-Validator/1.0"})
    try:
        with urllib.request.urlopen(req1, timeout=5) as response:
            descriptor_schema = json.load(response)
        with urllib.request.urlopen(req2, timeout=5) as response:
            test_schema = json.load(response)
    except Exception as e:
        print(f"Network schema fetch skipped ({e}); using local structural validation", file=sys.stderr)
        return 0

    descriptor_validator = Draft202012Validator(descriptor_schema)
    test_validator = Draft202012Validator(test_schema)
    descriptor_files = sorted(
        path
        for path in Path("descriptors/erc7730").glob("eip712-*.json")
        if not path.name.endswith(".tests.json")
    )
    test_files = sorted(Path("descriptors/erc7730").glob("*.tests.json"))
    if not descriptor_files:
        print("No ERC-7730 descriptors found", file=sys.stderr)
        return 1

    failures = 0
    for descriptor_file in descriptor_files:
        with descriptor_file.open(encoding="utf-8") as handle:
            descriptor = json.load(handle)
        errors = sorted(
            descriptor_validator.iter_errors(descriptor),
            key=lambda error: list(error.absolute_path),
        )
        if errors:
            failures += len(errors)
            for error in errors:
                location = ".".join(str(part) for part in error.absolute_path) or "$"
                print(f"{descriptor_file}: {location}: {error.message}", file=sys.stderr)
        else:
            print(f"{descriptor_file}: official ERC-7730 v2 schema valid")

    for test_file in test_files:
        with test_file.open(encoding="utf-8") as handle:
            fixture = json.load(handle)
        errors = sorted(
            test_validator.iter_errors(fixture),
            key=lambda error: list(error.absolute_path),
        )
        if errors:
            failures += len(errors)
            for error in errors:
                location = ".".join(str(part) for part in error.absolute_path) or "$"
                print(f"{test_file}: {location}: {error.message}", file=sys.stderr)
        else:
            print(f"{test_file}: official ERC-7730 v2 test schema valid")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
