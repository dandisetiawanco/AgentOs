"""Export the FastAPI OpenAPI schema to docs/api/openapi.json for contract validation."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from agentos.api.app import create_app
from agentos.config import AgentOSSettings


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    out_path = repo_root / "docs" / "api" / "openapi.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp_dir:
        settings = AgentOSSettings(
            host="127.0.0.1",
            port=47821,
            session_token="schema-export-placeholder-token-00000000",
            data_dir=Path(tmp_dir),
        )
        app = create_app(settings=settings, force_memory_keychain=True)
        schema = app.openapi()
    out_path.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Exported OpenAPI schema ({len(schema.get('paths', {}))} paths) to {out_path}")


if __name__ == "__main__":
    main()
