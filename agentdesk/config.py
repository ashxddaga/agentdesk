"""
agentdesk.config: Configuration discovery, token loading, and authentication checks.
"""
from __future__ import annotations

import json
import os
from typing import Dict, Any
from urllib.parse import urlparse, parse_qs

CONFIG_DIR = os.path.expanduser("~/.config/agentdesk")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")
LEGACY_CONFIG = "/home/ashish/Work/tries/herdr-phone/.herdr-phone.json"


def load_config() -> Dict[str, Any]:
    """Loads AgentDesk configuration from ~/.config/agentdesk/config.json with legacy fallback."""
    cfg = {
        "bind": "0.0.0.0",
        "port": 9876,
        "secret": "",
        "socket": os.path.expanduser("~/.config/herdr/herdr.sock"),
        "workspace": "/home/ashish/Work",
    }
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg.update(json.load(f))
        except Exception:
            pass
    elif os.path.exists(LEGACY_CONFIG):
        try:
            with open(LEGACY_CONFIG, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data.get("secret"):
                    cfg["secret"] = data["secret"]
                if data.get("socket"):
                    cfg["socket"] = data["socket"]
        except Exception:
            pass
    return cfg


def get_secret(cfg: Dict[str, Any]) -> str:
    return str(cfg.get("secret", "")).strip()


def check_auth(path: str, headers: Any, secret: str) -> bool:
    """Validate query param, Bearer token, or cookie against configured secret."""
    if not secret:
        return True

    # 1. Query parameter ?secret=...
    parsed = urlparse(path)
    qs = parse_qs(parsed.query)
    if qs.get("secret", [""])[0] == secret:
        return True

    # 2. Authorization header: Bearer <secret>
    auth = headers.get("Authorization", "")
    if auth.startswith("Bearer ") and auth[7:].strip() == secret:
        return True

    # 3. Cookie header: agentdesk_secret=<secret>
    cookie_header = headers.get("Cookie", "")
    for item in cookie_header.split(";"):
        item = item.strip()
        if item.startswith("agentdesk_secret="):
            val = item[len("agentdesk_secret="):].strip()
            if val == secret:
                return True

    return False
