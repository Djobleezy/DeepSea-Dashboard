"""Check fresh Docker configuration import and persistence without a miner."""

import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, urlopen
import uuid


def docker(*args: str) -> str:
    return subprocess.check_output(["docker", *args], text=True).strip()


def request(base: str, path: str, payload: dict | None = None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = Request(base + path, data=data, headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=5) as response:
        return json.load(response)


def wait_ready(base: str) -> None:
    deadline = time.monotonic() + 30
    while True:
        try:
            if request(base, "/api/health")["status"] == "ok":
                return
        except (URLError, TimeoutError, ConnectionError):
            if time.monotonic() >= deadline:
                raise
        if time.monotonic() >= deadline:
            raise TimeoutError("Container did not become healthy within 30 seconds")
        time.sleep(0.25)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="deepsea-dashboard:test")
    args = parser.parse_args()
    name = "deepsea-smoke-" + uuid.uuid4().hex[:12]
    volumes = [name + "-config", name + "-data"]

    with tempfile.TemporaryDirectory(prefix="deepsea-seed-") as directory:
        seed = Path(directory) / "config.json"
        seed.write_text(json.dumps({"wallet": "", "power_cost": 0.12}))
        seed.chmod(0o644)
        original_owner = (seed.stat().st_uid, seed.stat().st_gid)

        def start() -> str:
            docker(
                "run", "-d", "--name", name,
                "-p", "127.0.0.1::8000",
                "--mount", f"type=volume,src={volumes[0]},dst=/config",
                "--mount", f"type=volume,src={volumes[1]},dst=/data",
                "--mount", f"type=bind,src={seed},dst=/config/seed.json,readonly",
                "-e", "CONFIG_SEED_PATH=/config/seed.json",
                "-e", "REDIS_URL=redis://127.0.0.1:6379/0",
                args.image,
            )
            base = "http://" + docker("port", name, "8000/tcp")
            wait_ready(base)
            return base

        try:
            base = start()
            assert request(base, "/api/config")["power_cost"] == 0.12
            assert request(base, "/api/health")["wallet_configured"] is False
            assert request(base, "/api/config", {"power_cost": 0.19})["power_cost"] == 0.19
            assert json.loads(seed.read_text())["power_cost"] == 0.12
            assert (seed.stat().st_uid, seed.stat().st_gid) == original_owner
            docker(
                "exec", name, "python", "-c",
                "import os, pathlib, stat; "
                "p=pathlib.Path('/config/config.json'); "
                "assert os.geteuid() != 0; "
                "assert p.stat().st_uid == os.geteuid(); "
                "assert stat.S_IMODE(p.stat().st_mode) == 0o600; "
                "assert pathlib.Path('/data/deepsea.db').is_file()",
            )

            docker("restart", name)
            base = "http://" + docker("port", name, "8000/tcp")
            wait_ready(base)
            assert request(base, "/api/config")["power_cost"] == 0.19

            # Recreating the container must retain active settings even if the
            # original seed has subsequently been edited.
            docker("rm", "-f", name)
            seed.write_text(json.dumps({"wallet": "", "power_cost": 0.34}))
            base = start()
            assert request(base, "/api/config")["power_cost"] == 0.19
            with urlopen(base + "/dashboard", timeout=5) as response:
                assert b"<script" in response.read()
            print("Container smoke passed: non-root settings import, save, restart, and recreation")
        except Exception:
            subprocess.run(["docker", "logs", name], check=False)
            raise
        finally:
            subprocess.run(["docker", "rm", "-f", name], check=False, capture_output=True)
            for volume in volumes:
                subprocess.run(["docker", "volume", "rm", volume], check=False, capture_output=True)


if __name__ == "__main__":
    main()
