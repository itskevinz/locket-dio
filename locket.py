#!/usr/bin/env python3
"""
Locket Web — All-in-one Flask app, powered by the binhake action-API
(https://locket.binhake.dev/server/) for everything except login, which still
goes through Locket's own Firebase auth.

Server-side console logs every Firebase/binhake call. Moments are cached and
kept warm via a long-lived WebSocket so reopening Moments is instant;
/api/moments/poll streams live updates. Token auto-refresh + Remember me
(30-day permanent session).

Requires: pip install flask requests pillow websocket-client
"""

from __future__ import annotations

import io
import json
import logging
import threading
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import requests
from requests.adapters import HTTPAdapter, Retry
from PIL import Image
from flask import Flask, request, session, jsonify, render_template_string

try:
    import websocket  # websocket-client
except ImportError:
    websocket = None

# ============================================================
# Console logger (server-side, colored) — separate from the
# per-request debug records that get shipped to the browser.
# ============================================================

class ColorFormatter(logging.Formatter):
    COLORS = {"DEBUG": "\033[36m", "INFO": "\033[32m", "WARNING": "\033[33m",
              "ERROR": "\033[31m", "CRITICAL": "\033[35m"}
    RESET = "\033[0m"; DIM = "\033[2m"; BOLD = "\033[1m"

    def format(self, record):
        c = self.COLORS.get(record.levelname, "")
        ts = self.formatTime(record, "%H:%M:%S")
        msg = record.getMessage()
        lines = msg.split("\n")
        out = f"{self.DIM}{ts}{self.RESET} {c}{record.levelname:8}{self.RESET} {self.BOLD}{lines[0]}{self.RESET}"
        for line in lines[1:]:
            out += f"\n{' '*20}{self.DIM}{line}{self.RESET}"
        return out


handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(ColorFormatter())
logger = logging.getLogger("LocketWeb")
logger.setLevel(logging.DEBUG)
logger.handlers = []
logger.addHandler(handler)


def _snip(text: Optional[str], n: int = 900) -> str:
    if text is None:
        return ""
    return text if len(text) <= n else text[:n] + f"…(+{len(text)-n}b)"


def console_log(label: str, method: str, url: str, payload=None, status=None, resp_text=None, duration=None):
    lines = [f"{'='*60}", f"  {label}", f"  {method} {url}"]
    if payload is not None:
        try:
            p = json.dumps(payload, ensure_ascii=False, indent=2)
        except Exception:
            p = str(payload)
        lines.append(f"  >>> PAYLOAD:\n    {_snip(p).replace(chr(10), chr(10)+'    ')}")
    if status is not None:
        color = "\033[32m" if status < 300 else "\033[33m" if status < 400 else "\033[31m"
        lines.append(f"  <<< STATUS: {color}{status}\033[0m")
    if resp_text is not None:
        lines.append(f"  <<< BODY: {_snip(resp_text, 600)}")
    if duration is not None:
        lines.append(f"  <<< TIME: {duration:.3f}s")
    lines.append("=" * 60)
    logger.info("\n".join(lines))


def make_debug(kind: str, label: str, method: str, url: str, payload=None,
                status=None, resp_text=None, duration=None, error=None) -> Dict[str, Any]:
    """One entry for the browser-side debug console."""
    return {
        "t": time.time(),
        "kind": kind,           # "send" | "recv" | "error"
        "label": label,
        "method": method,
        "url": url,
        "payload": payload if payload is None else json.loads(json.dumps(payload, default=str, ensure_ascii=False)),
        "status": status,
        "body": _snip(resp_text, 1500) if resp_text else None,
        "duration": round(duration, 3) if duration is not None else None,
        "error": str(error) if error else None,
    }


# ============================================================
# Config
# ============================================================

FIREBASE_API_KEY = "AIzaSyCQngaaXQIfJaH0aS2l7REgIjD7nL431So"
LOGIN_URL = f"https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key={FIREBASE_API_KEY}"
ACCOUNT_URL = f"https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key={FIREBASE_API_KEY}"
REFRESH_URL = f"https://securetoken.googleapis.com/v1/token?key={FIREBASE_API_KEY}"

BINHAKE_API = "https://locket.binhake.dev/server/"
WS_URL = "wss://locket.binhake.dev/server/"

# Moments live-cache (per local_id). Avoids re-fetching the full history every tab open.
_MOMENTS_LOCK = threading.Lock()
_MOMENTS_CACHE: Dict[str, Dict[str, Any]] = {}
# token refresh tracking
_TOKEN_LOCK = threading.Lock()

IOS_UA = "com.locket.Locket/1.100.0 iPhone/18.2 hw/iPhone14_3"
FIREBASE_GMPID = "1:641029076083:ios:cc8eb46290d69b234fa606"
IOS_BUNDLE = "com.locket.Locket"

WEB_UA_POOL = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
]

GOLD_BADGE = "https://locket.binhake.dev/assets/images/locket_gold_badge_small_Normal@2x.png"
CELEB_BADGE = "https://locket.binhake.dev/assets/images/celebrity_badge_small_Normal@2x.png"
FONT_URL = "https://raw.githubusercontent.com/itskevinz/assets/main/proxima_soft_bold.otf"
FAVICON_URL = "https://locket.binhake.dev/assets/images/app_icon/app_icon_preview_Normal@2x.png"


class LocketError(RuntimeError):
    pass


@dataclass
class LocketSession:
    id_token: str
    refresh_token: Optional[str]
    local_id: str
    email: str
    display_name: str
    photo_url: str
    ua: str
    raw: Dict[str, Any] = field(default_factory=dict, repr=False)


# ============================================================
# binhake_core — auth (Firebase, unchanged) + every other call
# through https://locket.binhake.dev/server/ (action-based POST,
# cookie-authenticated with user_id, plus a WebSocket for moments).
# ============================================================

def _fb_headers() -> Dict[str, str]:
    return {
        "Accept": "*/*",
        "Content-Type": "application/json",
        "User-Agent": IOS_UA,
        "X-Client-Version": "iOS/FirebaseSDK/10.23.1/FirebaseCore-iOS",
        "X-Firebase-GMPID": FIREBASE_GMPID,
        "X-Ios-Bundle-Identifier": IOS_BUNDLE,
    }


def _web_headers(id_token: str, ua: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {id_token}",
        "Content-Type": "application/json",
        "Origin": "https://locket.binhake.dev",
        "Referer": "https://locket.binhake.dev/posts.html",
        "User-Agent": ua,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.7",
        "X-Client-OS": "Windows",
        "Sec-Ch-Ua": '"Not=A?Brand";v="99", "Chromium";v="151"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Gpc": "1",
        "Dnt": "1",
    }


def _make_http() -> requests.Session:
    s = requests.Session()
    adapter = HTTPAdapter(
        pool_connections=10, pool_maxsize=10,
        # GET only — retrying POST automatically risks double-submitting a non-idempotent
        # action (e.g. posting the same moment twice) if the first attempt actually landed
        # server-side but the response got lost. Reads are safe to retry, writes aren't.
        max_retries=Retry(total=2, backoff_factor=0.6,
                           status_forcelist=[500, 502, 503, 504],
                           allowed_methods=["GET"]),
    )
    s.mount("https://", adapter)
    return s


# Shared retrying session for read-only upstream calls (currently: image proxy). A single
# transient 502/503/504 from Firebase/Google Storage used to fail the request outright and
# surface as our own 502 all the way to the browser — this was previously built but never
# actually wired up anywhere, so every hiccup was a hard failure with no retry.
_http = _make_http()


class LoginError(RuntimeError):
    """Carries whatever debug entries were captured before the failure, so
    the browser's debug console still shows the real request/response even
    when login fails (bad password, network down, Firebase change, etc)."""
    def __init__(self, message: str, debug: List[Dict[str, Any]], friendly: Optional[str] = None):
        super().__init__(message)
        self.debug = debug
        self.friendly = friendly or message


def login(email: str, password: str, timeout: int = 30) -> Tuple[LocketSession, List[Dict[str, Any]]]:
    """Firebase login — the one call that stays on Locket's own API, because
    binhake authenticates the exact same way under the hood."""
    debug: List[Dict[str, Any]] = []
    payload = {"email": email.strip(), "password": password,
               "clientType": "CLIENT_TYPE_IOS", "returnSecureToken": True}
    debug.append(make_debug("send", "FIREBASE LOGIN", "POST", LOGIN_URL, {"email": email, "password": "***"}))

    t0 = time.time()
    try:
        r = requests.post(LOGIN_URL, json=payload, headers=_fb_headers(), timeout=timeout)
    except requests.exceptions.RequestException as e:
        dt = time.time() - t0
        console_log("FIREBASE LOGIN — CONNECTION FAILED", "POST", LOGIN_URL, {"email": email}, None, str(e), dt)
        debug.append(make_debug("error", "FIREBASE LOGIN", "POST", LOGIN_URL, None, None, None, dt, e))
        raise LoginError(str(e), debug,
                          friendly=f"Không kết nối được tới máy chủ Firebase/Locket ({type(e).__name__}). "
                                    "Kiểm tra mạng, DNS, hoặc tường lửa trên máy chạy server.") from e

    dt = time.time() - t0
    console_log("FIREBASE LOGIN", "POST", LOGIN_URL, {"email": email}, r.status_code, r.text, dt)
    debug.append(make_debug("recv" if r.ok else "error", "FIREBASE LOGIN", "POST", LOGIN_URL,
                             None, r.status_code, r.text, dt))
    try:
        r.raise_for_status()
    except requests.HTTPError as e:
        friendly = "Sai email hoặc mật khẩu."
        try:
            msg = (r.json().get("error") or {}).get("message", "")
            if msg:
                friendly = f"Đăng nhập thất bại: {msg}"
        except Exception:
            pass
        raise LoginError(str(e), debug, friendly=friendly) from e
    data = r.json()

    t1 = time.time()
    try:
        r2 = requests.post(ACCOUNT_URL, json={"idToken": data["idToken"]}, headers=_fb_headers(), timeout=timeout)
        dt2 = time.time() - t1
        console_log("ACCOUNT INFO", "POST", ACCOUNT_URL, {"idToken": "***"}, r2.status_code, r2.text, dt2)
        debug.append(make_debug("recv", "ACCOUNT INFO", "POST", ACCOUNT_URL, None, r2.status_code, r2.text, dt2))
        display_name, photo_url = "", ""
        if r2.ok:
            users = (r2.json() or {}).get("users") or []
            if users:
                display_name = users[0].get("displayName") or ""
                photo_url = users[0].get("photoUrl") or ""
    except requests.exceptions.RequestException as e:
        # Non-fatal — we already have a valid id_token, account info is just extra polish.
        dt2 = time.time() - t1
        debug.append(make_debug("error", "ACCOUNT INFO", "POST", ACCOUNT_URL, None, None, None, dt2, e))
        display_name, photo_url = "", ""

    if not display_name:
        display_name = data.get("email", email).split("@")[0]

    ses = LocketSession(
        id_token=data["idToken"], refresh_token=data.get("refreshToken"),
        local_id=data["localId"], email=data.get("email", email),
        display_name=display_name, photo_url=photo_url,
        ua=WEB_UA_POOL[hash(data["localId"]) % len(WEB_UA_POOL)], raw=data,
    )
    return ses, debug


def refresh_id_token(s: LocketSession, timeout: int = 20) -> bool:
    """Exchange refreshToken for a fresh idToken. API key is iOS-restricted so
    we must send the same X-Ios-Bundle-Identifier / GMPID headers as login."""
    if not s.refresh_token:
        return False
    with _TOKEN_LOCK:
        t0 = time.time()
        try:
            headers = {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "*/*",
                "User-Agent": IOS_UA,
                "X-Client-Version": "iOS/FirebaseSDK/10.23.1/FirebaseCore-iOS",
                "X-Firebase-GMPID": FIREBASE_GMPID,
                "X-Ios-Bundle-Identifier": IOS_BUNDLE,
            }
            r = requests.post(
                REFRESH_URL,
                data={"grant_type": "refresh_token", "refresh_token": s.refresh_token},
                headers=headers,
                timeout=timeout,
            )
            dt = time.time() - t0
            console_log("FIREBASE REFRESH", "POST", REFRESH_URL, {"refresh_token": "***"}, r.status_code, r.text, dt)
            if not r.ok:
                return False
            data = r.json()
            new_id = data.get("id_token") or data.get("idToken")
            new_rt = data.get("refresh_token") or data.get("refreshToken") or s.refresh_token
            if not new_id:
                return False
            s.id_token = new_id
            s.refresh_token = new_rt
            try:
                session["token"] = new_id
                session["refresh_token"] = new_rt
                session["token_issued_at"] = time.time()
            except Exception:
                pass
            return True
        except Exception as e:
            logger.warning("Token refresh failed: %s", e)
            return False


def ensure_fresh_token(s: LocketSession) -> LocketSession:
    issued = session.get("token_issued_at") or 0
    if time.time() - issued > 50 * 60:
        if refresh_id_token(s):
            session["token_issued_at"] = time.time()
    return s


def binhake_call(action: str, s: LocketSession, extra: Optional[Dict[str, Any]] = None,
                  timeout: int = 25) -> Tuple[Any, Dict[str, Any]]:
    """Generic POST to the binhake action-API. Returns (parsed_json, debug_entry)."""
    payload = {"action": action, **(extra or {})}
    cookies = {"user_id": s.local_id}
    headers = _web_headers(s.id_token, s.ua)
    t0 = time.time()
    err = None
    r = None
    try:
        r = requests.post(BINHAKE_API, headers=headers, json=payload, cookies=cookies, timeout=timeout)
        dt = time.time() - t0
        console_log(f"LOCK {action}", "POST", "api://lock/" + action, payload, r.status_code, r.text, dt)
        r.raise_for_status()
        dbg = make_debug("recv", f"binhake:{action}", "POST", BINHAKE_API, payload, r.status_code, r.text, dt)
        try:
            return r.json(), dbg
        except ValueError:
            raise LocketError(f"binhake:{action} returned non-JSON body")
    except requests.HTTPError as e:
        dt = time.time() - t0
        dbg = make_debug("error", f"binhake:{action}", "POST", BINHAKE_API, payload,
                          getattr(r, "status_code", None), getattr(r, "text", None), dt, e)
        console_log(f"LOCK {action} FAIL", "POST", "api://lock/" + action, payload,
                     getattr(r, "status_code", None), getattr(r, "text", None), dt)
        raise
    except Exception as e:
        dt = time.time() - t0
        dbg = make_debug("error", f"binhake:{action}", "POST", BINHAKE_API, payload, None, None, dt, e)
        console_log(f"LOCK {action} ERROR", "POST", "api://lock/" + action, payload, None, str(e), dt)
        raise LocketError(str(e)) from e


def _first(d: Dict[str, Any], *keys, default=None):
    for k in keys:
        if isinstance(d, dict) and k in d and d[k] not in (None, ""):
            return d[k]
    return default


def _split_display_name(name: str) -> Tuple[str, str]:
    parts = (name or "").strip().split(None, 1)
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[1]



def _flatten_firestore_value(v):
    if not isinstance(v, dict):
        return v
    if "stringValue" in v:
        return v["stringValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return float(v["doubleValue"])
    if "booleanValue" in v:
        return v["booleanValue"]
    if "timestampValue" in v:
        from datetime import datetime, timezone
        try:
            ts = v["timestampValue"].replace("Z", "+00:00")
            dt = datetime.fromisoformat(ts)
            return {"_seconds": int(dt.timestamp()), "_nanoseconds": 0}
        except Exception:
            return {"_seconds": 0, "_nanoseconds": 0}
    if "nullValue" in v:
        return None
    if "arrayValue" in v:
        values = v["arrayValue"].get("values", [])
        return [_flatten_firestore_value(x) for x in values]
    if "mapValue" in v:
        fields = v["mapValue"].get("fields", {})
        return {k: _flatten_firestore_value(val) for k, val in fields.items()}
    return v


def flatten_firestore(doc):
    if not isinstance(doc, dict):
        return doc
    fields = doc.get("fields")
    if not isinstance(fields, dict):
        return doc
    result = {}
    for k, v in fields.items():
        result[k] = _flatten_firestore_value(v)
    for key in ("createTime", "updateTime", "name"):
        if key in doc:
            result[key] = doc[key]
    return result

def _normalize_user(u: Dict[str, Any]) -> Dict[str, Any]:
    """binhake's exact field names aren't guaranteed everywhere, so every
    likely alias is checked. If a field is missing here, check the debug
    console — the raw payload is right there and this function just needs
    another key added to the matching _first(...) call."""
    if not isinstance(u, dict):
        return {}
    first_name = _first(u, "first_name", "firstName", default="")
    last_name = _first(u, "last_name", "lastName", default="")
    if not first_name and not last_name:
        # confirmed real shape from getInfo: only a combined "displayName"
        first_name, last_name = _split_display_name(_first(u, "displayName", "display_name", "name", default=""))
    pic = _first(u, "profile_picture_url", "profilePictureUrl",
                 "avatar", "avatar_url", "photo_url", "photoUrl", default="") or ""
    if isinstance(pic, str):
        pic = pic.replace("firebasestorage.googleapis.com:443", "firebasestorage.googleapis.com")
    return {
        "uid": _first(u, "uid", "user_id", "userId", "id", default=""),
        "username": _first(u, "username", "user_name", default=""),
        "first_name": first_name,
        "last_name": last_name,
        "profile_picture_url": pic,
        "celebrity": bool(_first(u, "celebrity", "is_celebrity", default=False)),
        "badge": _first(u, "badge", "badge_type", default="") or "",
        "streak": _first(u, "streak", "streak_count", "streakCount", "current_streak", default=0),
    }


def get_self_info(s: LocketSession) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """action=getInfo — confirmed real shape:
    {"success":true,"data":{"displayName":"...","photoUrl":"..."},
     "streak":{"count":396,"last_updated_yyyymmdd":20260804}}
    Note streak sits at the TOP level, as a sibling of "data" — not inside it."""
    debug = [make_debug("send", "binhake:getInfo", "POST", BINHAKE_API, {"action": "getInfo"})]
    data, dbg = binhake_call("getInfo", s)
    debug.append(dbg)

    body = data.get("data") if isinstance(data, dict) and isinstance(data.get("data"), dict) else (data or {})
    info = _normalize_user(body)

    streak_val = 0
    if isinstance(data, dict):
        streak_obj = data.get("streak")
        if isinstance(streak_obj, dict):
            streak_val = _first(streak_obj, "count", "streak", "value", default=0)
        elif isinstance(streak_obj, (int, float)):
            streak_val = streak_obj
        elif not streak_val:
            streak_val = _first(data, "streak_count", "streakCount", default=0)
    info["streak"] = streak_val or 0

    if not info.get("first_name") and not info.get("username"):
        info["first_name"] = s.display_name
    if not info.get("profile_picture_url"):
        info["profile_picture_url"] = s.photo_url
    return info, debug


def get_friends(s: LocketSession) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """action=getFriendsList_v3 — full friend list with profiles, already
    server-side (binhake resolves profiles for us, no N+1 fan-out needed)."""
    debug = [make_debug("send", "binhake:getFriendsList_v3", "POST", BINHAKE_API, {"action": "getFriendsList_v3"})]
    data, dbg = binhake_call("getFriendsList_v3", s)
    debug.append(dbg)
    raw_list = None
    if isinstance(data, dict):
        for path in (data.get("data"), data.get("friends"), (data.get("result") or {}).get("data")):
            if isinstance(path, list):
                raw_list = path
                break
    if raw_list is None:
        raw_list = []
    friends = [_normalize_user(u) for u in raw_list if isinstance(u, dict)]

    def sort_key(p):
        name = (f"{p.get('first_name','')} {p.get('last_name','')}").strip() or p.get("username") or p.get("uid") or ""
        return name.casefold()

    celebs = sorted([p for p in friends if p.get("celebrity")], key=sort_key)
    normals = sorted([p for p in friends if not p.get("celebrity")], key=sort_key)
    return celebs + normals, debug



def _extract_moments_list(data: Any) -> List[Dict[str, Any]]:
    """Normalize binhake HTTP/WS payloads into a flat list of moment dicts."""
    if data is None:
        return []
    if isinstance(data, list):
        raw = data
    elif isinstance(data, dict):
        raw = None
        for path in (
            data.get("data"),
            data.get("moments"),
            (data.get("result") or {}).get("data") if isinstance(data.get("result"), dict) else None,
            data.get("items"),
        ):
            if isinstance(path, list):
                raw = path
                break
            if isinstance(path, dict):
                raw = [path]
                break
        if raw is None:
            # Single firestore doc?
            if "fields" in data or "thumbnail_url" in data or "canonical_uid" in data:
                raw = [data]
            else:
                raw = []
    else:
        raw = []

    out: List[Dict[str, Any]] = []
    seen = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        flat = flatten_firestore(item) if "fields" in item else item
        if not isinstance(flat, dict):
            continue
        k = _moment_key(flat)
        if k in seen:
            continue
        seen.add(k)
        out.append(flat)
    return out


def get_moments_http(s: LocketSession, page_token=None, client_target: str = "all",
                      timeout: int = 35) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """HTTP action=getMoments — same payload binhake posts.html uses via requestServerJson.

    Prefer this on serverless (Vercel): outbound WebSocket is flaky and data on WS
    often arrives only after 25–35s of heartbeats. HTTP returns in one request.
    """
    debug: List[Dict[str, Any]] = []
    extra = {
        "id": None,
        "pageToken": page_token,
        "clientTarget": client_target,
        "_client": {"os": "Windows"},
    }
    debug.append(make_debug("send", "binhake:getMoments:http", "POST", BINHAKE_API,
                             {"action": "getMoments", **extra}))
    try:
        data, dbg = binhake_call("getMoments", s, extra=extra, timeout=timeout)
        debug.append(dbg)
        items = _extract_moments_list(data)
        if not items and isinstance(data, dict):
            keys = list(data.keys())
            sample = str(data)[:400]
            logger.warning("getMoments HTTP empty — keys=%s sample=%s", keys, sample)
        else:
            logger.info("getMoments HTTP → %d items", len(items))
        return items, debug
    except Exception as e:
        debug.append(make_debug("error", "binhake:getMoments:http", "POST", BINHAKE_API,
                                 None, None, None, None, e))
        logger.warning("getMoments HTTP failed: %s", e)
        raise


def get_moments_ws(s: LocketSession, page_token=None, client_target="all", timeout: int = 55
                    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """binhake serves moment history over WebSocket.

    Real browser flow (captured HAR 2026-08-14):
      auth → authenticated → getMoments
      server sends keep-alive {"oa":N} every ~10s
      client sends {"action":"ping"} every ~25s
      data arrives as action=getNewMoments ~25–35s after getMoments

    Old timeout of 25s closed the socket before data arrived → empty list.
    """
    if not websocket:
        raise LocketError("websocket-client is not installed (pip install websocket-client)")

    debug: List[Dict[str, Any]] = []
    result = {"frames": [], "done": threading.Event()}
    ws_holder = [None]
    last_app_ping = [0.0]
    opened_at = [0.0]

    def on_open(ws):
        ws_holder[0] = ws
        opened_at[0] = time.time()
        last_app_ping[0] = time.time()
        auth_frame = {"action": "auth", "token": s.id_token, "_client": {"os": "Windows"}}
        debug.append(make_debug("send", "ws:auth", "WS", WS_URL, {"action": "auth", "token": "***"}))
        ws.send(json.dumps(auth_frame))

    def on_message(ws, message):
        try:
            data = json.loads(message)
        except Exception as e:
            debug.append(make_debug("error", "ws:message", "WS", WS_URL, None, None, message[:500], None, e))
            return

        # Heartbeat {"oa": 60} — ignore, do not treat as error / done
        if isinstance(data, dict) and "oa" in data and "action" not in data:
            return

        action = data.get("action")
        debug.append(make_debug("recv", f"ws:{action}", "WS", WS_URL, None, None,
                                 json.dumps(data, ensure_ascii=False)[:1500]))

        if action == "authenticated":
            req = {"action": "getMoments", "id": None, "pageToken": page_token,
                   "clientTarget": client_target, "_client": {"os": "Windows"}}
            debug.append(make_debug("send", "ws:getMoments", "WS", WS_URL, req))
            ws.send(json.dumps(req))
            return

        if action == "pong":
            return

        if action in ("getMoments", "getNewMoments"):
            result["frames"].append(data)
            # Only finish when we got a list payload (even empty). Prefer waiting a
            # little longer if first frame is empty — server sometimes sends an
            # empty getMoments then a filled getNewMoments.
            raw = data.get("data")
            has_list = isinstance(raw, list)
            has_items = has_list and len(raw) > 0
            if has_items or (has_list and action == "getNewMoments"):
                result["done"].set()
                try:
                    ws.close()
                except Exception:
                    pass
            return

        if action == "error" or data.get("error"):
            result["done"].set()
            try:
                ws.close()
            except Exception:
                pass

    def on_error(ws, error):
        debug.append(make_debug("error", "ws:error", "WS", WS_URL, None, None, None, None, error))
        result["done"].set()

    def on_close(ws, code, msg):
        result["done"].set()

    ws = websocket.WebSocketApp(
        WS_URL,
        header=["Origin: https://locket.binhake.dev", f"User-Agent: {s.ua}", f"Cookie: user_id={s.local_id}"],
        on_open=on_open, on_message=on_message, on_error=on_error, on_close=on_close,
    )
    # protocol-level pings + our app-level ping loop (binhake expects action=ping)
    wst = threading.Thread(
        target=lambda: ws.run_forever(ping_interval=20, ping_timeout=10),
        daemon=True,
    )
    wst.start()

    deadline = time.time() + max(15, timeout)
    while time.time() < deadline and not result["done"].is_set():
        result["done"].wait(timeout=1.0)
        # app-level ping every 25s (matches binhake posts.html)
        w = ws_holder[0]
        if w and (time.time() - last_app_ping[0]) >= 25:
            try:
                w.send(json.dumps({"action": "ping", "_client": {"os": "Windows"}}))
                last_app_ping[0] = time.time()
                debug.append(make_debug("send", "ws:ping", "WS", WS_URL, {"action": "ping"}))
            except Exception:
                break

    if ws_holder[0]:
        try:
            ws_holder[0].close()
        except Exception:
            pass
    wst.join(timeout=2)

    # Merge all frames that carried data
    items: List[Dict[str, Any]] = []
    seen = set()
    for frame in result["frames"]:
        raw = frame.get("data")
        if not isinstance(raw, list):
            raw = [raw] if raw else []
        for item in raw:
            if not isinstance(item, dict):
                continue
            flat = flatten_firestore(item)
            k = _moment_key(flat)
            if k in seen:
                continue
            seen.add(k)
            items.append(flat)

    if not items and result["frames"]:
        logger.warning("moments WS frames=%d but no items (timeout=%.0fs)", len(result["frames"]), timeout)
    elif not result["frames"]:
        logger.warning("moments WS returned no frames within %.0fs", timeout)
    else:
        logger.info("moments WS ok: %d items from %d frames", len(items), len(result["frames"]))
    return items, debug


def _moment_key(m: Dict[str, Any]) -> str:
    key = m.get("canonical_uid") or m.get("md5") or m.get("thumbnail_url") or m.get("url") or m.get("video_url")
    if key:
        return str(key)
    # Last-resort deterministic fallback — never id(m): that's a per-process
    # object id that changes on every WS fetch, so it can never match itself
    # again and silently duplicates the moment on every merge/poll.
    d = m.get("date") or {}
    ts = (d.get("_seconds") if isinstance(d, dict) else None) or m.get("timestamp") or m.get("created_at") or ""
    uid = m.get("user") if isinstance(m.get("user"), str) else (m.get("user") or {}).get("uid") or m.get("user_id") or ""
    return f"{uid}:{ts}"


def _merge_moments(existing: List[Dict[str, Any]], incoming: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = {_moment_key(m) for m in existing}
    out = list(existing)
    for m in incoming:
        k = _moment_key(m)
        if k not in seen:
            seen.add(k)
            out.append(m)
    def sort_ts(m):
        d = m.get("date") or {}
        return (d.get("_seconds") if isinstance(d, dict) else 0) or 0
    out.sort(key=sort_ts, reverse=True)
    return out


def _live_moments_loop(s: LocketSession, state: Dict[str, Any]):
    """Long-lived WS: auth once, then keep listening for getNewMoments frames."""
    if not websocket:
        return
    stop: threading.Event = state["stop"]

    def on_open(ws):
        state["ws"] = ws
        ws.send(json.dumps({"action": "auth", "token": s.id_token, "_client": {"os": "Windows"}}))
        logger.info("LIVE WS open for %s", s.local_id[:8])

    def on_message(ws, message):
        try:
            data = json.loads(message)
        except Exception:
            return
        # Keep-alive {"oa": N} from binhake — ignore
        if isinstance(data, dict) and "oa" in data and "action" not in data:
            return
        action = data.get("action")
        if action == "authenticated":
            req = {"action": "getMoments", "id": None, "pageToken": None,
                   "clientTarget": "all", "_client": {"os": "Windows"}}
            ws.send(json.dumps(req))
            state["last_ws_pull"] = time.time()
            state["last_app_ping"] = time.time()
        elif action == "pong":
            return
        elif action in ("getMoments", "getNewMoments"):
            raw = data.get("data")
            if not isinstance(raw, list):
                raw = [raw] if raw else []
            items = [flatten_firestore(x) for x in raw if isinstance(x, dict)]
            if items:
                with state["lock"]:
                    state["items"] = _merge_moments(state.get("items") or [], items)
                    state["updated_at"] = time.time()
                    state["last_fetch_at"] = time.time()
                    state["bootstrapped"] = True
                logger.info("LIVE WS +%d moments for %s (total %d)",
                            len(items), s.local_id[:8], len(state["items"]))
        elif action == "error" or data.get("error"):
            logger.warning("LIVE WS error frame: %s", _snip(str(data), 200))

    def on_error(ws, error):
        logger.warning("LIVE WS error %s: %s", s.local_id[:8], error)

    def on_close(ws, code, msg):
        logger.info("LIVE WS closed %s code=%s", s.local_id[:8], code)
        state["ws"] = None

    while not stop.is_set():
        try:
            # refresh token periodically so long-lived WS can re-auth
            refresh_id_token(s)
            ws = websocket.WebSocketApp(
                WS_URL,
                header=["Origin: https://locket.binhake.dev", f"User-Agent: {s.ua}",
                        f"Cookie: user_id={s.local_id}"],
                on_open=on_open, on_message=on_message, on_error=on_error, on_close=on_close,
            )
            state["ws"] = ws
            wst = threading.Thread(target=lambda: ws.run_forever(ping_interval=25, ping_timeout=8), daemon=True)
            wst.start()
            # stay up until stop or socket dies; every ~45s re-pull getMoments so we
            # recover moments missed when the server skipped a push frame
            while not stop.is_set() and wst.is_alive():
                stop.wait(5)
                try:
                    now = time.time()
                    # App-level ping (binhake posts.html does this every ~25s)
                    last_ping = state.get("last_app_ping") or 0
                    if now - last_ping >= 25 and state.get("ws"):
                        state["last_app_ping"] = now
                        state["ws"].send(json.dumps({"action": "ping", "_client": {"os": "Windows"}}))
                    last_pull = state.get("last_ws_pull") or 0
                    if now - last_pull >= 45 and state.get("ws"):
                        state["last_ws_pull"] = now
                        state["ws"].send(json.dumps({
                            "action": "getMoments", "id": None, "pageToken": None,
                            "clientTarget": "all", "_client": {"os": "Windows"},
                        }))
                except Exception as e:
                    logger.debug("LIVE WS periodic pull skip: %s", e)
            try:
                ws.close()
            except Exception:
                pass
            wst.join(timeout=3)
        except Exception as e:
            logger.warning("LIVE WS loop exception: %s", e)
        if not stop.is_set():
            stop.wait(8)  # reconnect backoff


def _ensure_moments_state(local_id: str) -> Dict[str, Any]:
    with _MOMENTS_LOCK:
        st = _MOMENTS_CACHE.get(local_id)
        if st is None:
            st = {
                "items": [],
                "lock": threading.Lock(),
                "stop": threading.Event(),
                "thread": None,
                "ws": None,
                "updated_at": 0,
                "bootstrapped": False,
                "fetching": False,  # prevent parallel one-shot WS storms
                "last_fetch_at": 0,
            }
            _MOMENTS_CACHE[local_id] = st
        return st


def _fetch_and_store_moments(s: LocketSession, st: Dict[str, Any], timeout: int = 55) -> List[Dict[str, Any]]:
    """One-shot WS fetch and merge into state. Single-flight per user."""
    started_here = False
    with st["lock"]:
        if st.get("fetching"):
            started_here = False
        else:
            st["fetching"] = True
            started_here = True

    if not started_here:
        # Another request is fetching — wait briefly for it, then return whatever is cached
        deadline = time.time() + 10
        while time.time() < deadline:
            with st["lock"]:
                if not st.get("fetching"):
                    return list(st.get("items") or [])
            time.sleep(0.2)
        with st["lock"]:
            return list(st.get("items") or [])

    items: List[Dict[str, Any]] = []
    try:
        # 1) HTTP first — works on Vercel/serverless, matches binhake requestServerJson
        try:
            items, _ = get_moments_http(s, timeout=min(35, max(12, timeout)))
        except Exception as e_http:
            logger.warning("moments HTTP failed (%s) — falling back to WebSocket", e_http)
            items = []
        # 2) WS fallback if HTTP returned nothing (some accounts/servers only push via WS)
        if not items:
            try:
                items, _ = get_moments_ws(s, timeout=timeout)
            except Exception as e_ws:
                logger.error("moments WS fallback failed: %s", e_ws)
                items = []
    except Exception as e:
        logger.error("moments fetch failed: %s", e)
        items = []

    with st["lock"]:
        st["fetching"] = False
        st["last_fetch_at"] = time.time()
        if items:
            st["items"] = _merge_moments(st.get("items") or [], items)
            st["updated_at"] = time.time()
            st["bootstrapped"] = True
        elif not st.get("bootstrapped"):
            # First boot failed with empty — still mark so we don't tight-loop
            st["bootstrapped"] = True
        return list(st.get("items") or [])


def get_moments_cached(s: LocketSession, force: bool = False) -> List[Dict[str, Any]]:
    """Return cached moments; kick off initial fetch + live listener if needed.

    force=True always hits binhake via one-shot WebSocket (used when user re-opens
    the Moments tab). Soft path returns memory cache when warm.
    """
    st = _ensure_moments_state(s.local_id)

    with st["lock"]:
        warm = (
            st.get("bootstrapped")
            and not force
            and st.get("items")
            and (time.time() - (st.get("last_fetch_at") or st.get("updated_at") or 0)) < 25
        )
        if warm:
            return list(st["items"])

    out = _fetch_and_store_moments(s, st, timeout=55)

    # Start long-lived listener if not running (best-effort on long-lived hosts;
    # on serverless the thread dies with the worker — poll/force still work).
    th = st.get("thread")
    if th is None or not th.is_alive():
        st["stop"].clear()
        th = threading.Thread(target=_live_moments_loop, args=(s, st), daemon=True)
        st["thread"] = th
        th.start()

    return out


def poll_new_moments(s: LocketSession, since: float = 0) -> Tuple[List[Dict[str, Any]], float]:
    """Return moments if cache advanced past `since`.

    Avoid force-refresh on every poll: binhake needs ~30s for getNewMoments, so a
    force pull here would make every 8s client poll hang 30s+. Only force when the
    cache is completely empty (first load / cold serverless instance).
    """
    st = _ensure_moments_state(s.local_id)
    now = time.time()
    with st["lock"]:
        last = st.get("last_fetch_at") or st.get("updated_at") or 0
        has_data = bool(st.get("items"))
        fetching = bool(st.get("fetching"))
    # Cold start only — never block a poll for a 30s upstream wait when we already
    # have moments (live WS / previous force will refresh in background).
    if not has_data and not fetching:
        try:
            get_moments_cached(s, force=True)
        except Exception as e:
            logger.warning("poll refresh failed: %s", e)
    elif has_data and (now - last) > 90:
        # Stale but non-empty: kick a background force without blocking this response
        try:
            th = threading.Thread(
                target=lambda: get_moments_cached(s, force=True),
                daemon=True,
            )
            th.start()
        except Exception as e:
            logger.debug("poll background refresh skip: %s", e)
    with st["lock"]:
        updated = st.get("updated_at") or 0
        items = list(st.get("items") or [])
        if updated <= since:
            return [], updated
        return items, updated


def stop_moments_live(local_id: str):
    with _MOMENTS_LOCK:
        st = _MOMENTS_CACHE.pop(local_id, None)
    if not st:
        return
    st["stop"].set()
    ws = st.get("ws")
    if ws:
        try:
            ws.close()
        except Exception:
            pass


def upload_media(s: LocketSession, data: bytes, filename: str, content_type: str,
                  caption: str = "", recipients: str = "all", timeout: int = 90,
                  thumb_data: Optional[bytes] = None, thumb_name: Optional[str] = None,
                  thumb_type: Optional[str] = None, crop_payload: Optional[str] = None,
                  ) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """action=uploadMedia — binhake expects BOTH multipart fields:
    - thumb  (preview / square jpeg)
    - media  (full media; for photos same bytes as thumb)
    Missing either field returns MISSING_FIELDS 400.

    crop_payload: JSON string matching binhake's own web client, e.g. for video
    {"type":"video","crop":{"x":..,"y":..,"w":..,"h":..},"video":{"videoWidth":..,"videoHeight":..},"view":{"scale":1}}
    (captured from a real browser upload — see HAR notes). Falls back to "null"
    when not supplied, which is what photos already used successfully.
    """
    debug = []
    form = {
        "action": "uploadMedia",
        "captionID": "defaultCaption",
        "captionText": caption or "",
        "payload": "null",
        "mediaCropPayload": crop_payload if crop_payload else "null",
        "recipients": recipients,
        "mode": '{"restoreToggle":false,"restoreDate":null,"exceptGroupToggle":false}',
    }
    # Real binhake upload (HAR): sends both "thumb" and "media" as binary parts.
    t_data = thumb_data if thumb_data is not None else data
    t_name = thumb_name or filename
    t_type = thumb_type or content_type
    files = {
        "thumb": (t_name, t_data, t_type),
        "media": (filename, data, content_type),
    }
    h = _web_headers(s.id_token, s.ua)
    h.pop("Content-Type", None)
    cookies = {"user_id": s.local_id}

    debug.append(make_debug("send", "binhake:uploadMedia", "POST", BINHAKE_API,
                             {**form, "thumb": f"<{len(t_data)}b {t_type}>",
                              "media": f"<{len(data)}b {content_type}>"}))
    t0 = time.time()
    r = requests.post(BINHAKE_API, headers=h, data=form, files=files, cookies=cookies, timeout=timeout)
    dt = time.time() - t0
    console_log("LOCK uploadMedia", "POST", "api://lock/uploadMedia",
                {**form, "thumb": t_name, "media": filename}, r.status_code, r.text, dt)
    debug.append(make_debug("recv" if r.ok else "error", "binhake:uploadMedia", "POST", BINHAKE_API,
                             None, r.status_code, r.text, dt))
    r.raise_for_status()
    try:
        return r.json(), debug
    except ValueError:
        raise LocketError("uploadMedia returned non-JSON body")


# Locket-style limits: square ~1080, keep visual quality high, shrink if over size cap
_LOCKET_MAX_SIDE = 1080
_LOCKET_MAX_BYTES = 1_500_000  # ~1.5MB soft limit before quality steps down


def _new_upload_name() -> str:
    return f"{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}.jpg"


def compress_image(raw_bytes: bytes) -> Tuple[bytes, str]:
    """Crop to 1:1, resize to 1080, JPEG with high quality. Step quality down only if over size limit.

    Fast path: the client-side cropper already ships a square 1080 JPEG under the size cap in the
    common case, so we probe the header (cheap — no full decode) and pass those bytes through
    untouched instead of re-decoding/re-encoding an image that's already correct.
    """
    if len(raw_bytes) <= _LOCKET_MAX_BYTES and raw_bytes[:3] == b"\xff\xd8\xff":
        try:
            probe = Image.open(io.BytesIO(raw_bytes))
            if probe.format == "JPEG" and probe.mode == "RGB" and probe.size == (_LOCKET_MAX_SIDE, _LOCKET_MAX_SIDE):
                return raw_bytes, _new_upload_name()
        except Exception:
            pass

    img = Image.open(io.BytesIO(raw_bytes))
    # JPEG draft decode: have libjpeg decode straight to a lower DCT scale instead of full
    # resolution then downsampling in Python — several times faster on large source photos
    # and the exact same end quality once we resize down to _LOCKET_MAX_SIDE anyway.
    if img.format == "JPEG":
        try:
            img.draft("RGB", (_LOCKET_MAX_SIDE, _LOCKET_MAX_SIDE))
        except Exception:
            pass
    if img.mode not in ("RGB",):
        img = img.convert("RGB")
    w, h = img.size
    if w != h:
        side = min(w, h)
        left, top = (w - side) // 2, (h - side) // 2
        img = img.crop((left, top, left + side, top + side))
    if img.size[0] != _LOCKET_MAX_SIDE:
        # Plain LANCZOS, no reducing_gap shortcut — draft decode above already did the
        # heavy lifting for speed; this final resize runs at full quality so the upload
        # doesn't lose sharpness. (reducing_gap pre-shrinks with a cheap box filter before
        # LANCZOS, which is faster but visibly softer — not worth it on the one image the
        # user is actually posting.)
        img = img.resize((_LOCKET_MAX_SIDE, _LOCKET_MAX_SIDE), Image.LANCZOS)
    data = None
    for quality in (92, 88, 84, 80, 76, 72):
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        data = buf.getvalue()
        if len(data) <= _LOCKET_MAX_BYTES:
            break
    return data, _new_upload_name()


_ALLOWED_IMG_HOSTS = (
    "firebasestorage.googleapis.com",
    "storage.googleapis.com",
    "lh3.googleusercontent.com",
    "googleusercontent.com",
    "locket.binhake.dev",
)
# cache key = (url, max_side) → (ts, bytes, mime)
_img_cache: Dict[Tuple[str, int], Tuple[float, bytes, str]] = {}
_IMG_CACHE_TTL = 900
_IMG_CACHE_MAX = 160

def _client_needs_jpeg(request) -> bool:
    """Detect browsers that cannot decode WebP (mainly Safari < 14 / iOS < 14)."""
    ua = (request.headers.get("User-Agent") or "").lower()
    accept = (request.headers.get("Accept") or "").lower()
    if "image/webp" in accept:
        return False
    if "safari/" in ua and "chrome/" not in ua and "crios/" not in ua:
        import re
        m = re.search(r"version/(\d+)", ua)
        if m and int(m.group(1)) >= 14:
            return False
        return True
    if "iphone os " in ua:
        import re
        m = re.search(r"iphone os (\d+)_", ua)
        if m and int(m.group(1)) >= 14:
            return False
        return True
    if "chrome/" in ua or "crios/" in ua or "firefox/" in ua or "edg/" in ua:
        return False
    return True


def fetch_image_as_jpeg(url: str, max_side: int = 720, timeout: int = 15, force_convert: bool = False) -> Tuple[bytes, str]:
    """Download remote media. Smart convert: only re-encode to JPEG when the
    browser cannot display the original format (WebP on old Safari) or when
    resize is needed. Otherwise pass through untouched — saves CPU, bandwidth,
    and preserves original quality."""
    max_side = max(64, min(int(max_side or 720), 1280))
    cache_key = (url, max_side, force_convert)
    now = time.time()
    hit = _img_cache.get(cache_key)
    if hit and now - hit[0] < _IMG_CACHE_TTL:
        return hit[1], hit[2]
    from urllib.parse import urlparse
    host = (urlparse(url).hostname or "").lower()
    if not host or not any(host == h or host.endswith("." + h) for h in _ALLOWED_IMG_HOSTS):
        raise LocketError("image host not allowed")
    r = _http.get(url, timeout=timeout, headers={
        "User-Agent": IOS_UA,
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
    })
    r.raise_for_status()
    raw = r.content
    ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    if ctype.startswith("video/"):
        raise LocketError("video not proxyable as image")

    is_jpeg = ctype in ("image/jpeg", "image/jpg") or url.lower().endswith((".jpg", ".jpeg"))
    is_png = ctype == "image/png" or url.lower().endswith(".png")
    is_webp = ctype == "image/webp" or url.lower().endswith(".webp")

    # Fast path: no resize needed AND format is already JPEG/PNG AND no force → pass through
    if not force_convert and not is_webp:
        try:
            img = Image.open(io.BytesIO(raw))
            w0, h0 = img.size
            needs_resize = max(w0, h0) > max_side
            if not needs_resize:
                _img_cache[cache_key] = (now, raw, ctype)
                return raw, ctype
        except Exception:
            pass

    # Decode and optionally resize + convert
    try:
        img = Image.open(io.BytesIO(raw))
        if getattr(img, "is_animated", False):
            img.seek(0)
        w0, h0 = img.size
        needs_resize = max(w0, h0) > max_side

        if needs_resize and img.format == "JPEG":
            try:
                img.draft("RGB", (max_side, max_side))
            except Exception:
                pass
        img.load()
        if img.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", img.size, (0, 0, 0))
            rgba = img.convert("RGBA")
            bg.paste(rgba, mask=rgba.split()[-1])
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")
        if needs_resize:
            w, h = img.size
            if max(w, h) > max_side:
                if w >= h:
                    img = img.resize((max_side, max(1, int(h * max_side / w))), Image.LANCZOS)
                else:
                    img = img.resize((max(1, int(w * max_side / h)), max_side), Image.LANCZOS)
        quality = 65 if max_side <= 400 else (72 if max_side <= 540 else (78 if max_side <= 800 else 85))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=False)
        data = buf.getvalue()
        out_mime = "image/jpeg"
    except Exception as e:
        logger.warning("JPEG convert fail (%s): %s — serving original", ctype, e)
        if ctype in ("image/jpeg", "image/jpg", "image/png", "image/gif"):
            data, out_mime = raw, ctype
        else:
            raise LocketError(f"cannot convert image ({ctype}): {e}")
    if len(_img_cache) >= _IMG_CACHE_MAX:
        oldest = min(_img_cache.items(), key=lambda kv: kv[1][0])[0]
        _img_cache.pop(oldest, None)
    _img_cache[cache_key] = (now, data, out_mime)
    return data, out_mime


HTML = """\
<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>Locket Mini</title>
<meta name="description" content="Locket Mini — xem và đăng khoảnh khắc với bạn bè, nhanh gọn trên mọi thiết bị.">
<meta name="theme-color" content="#000000">
<meta name="application-name" content="Locket Mini">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Locket Mini">
<meta name="mobile-web-app-capable" content="yes">
<meta property="og:title" content="Locket Mini">
<meta property="og:description" content="Pics from your best friends — web mini client.">
<meta property="og:type" content="website">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="{{ favicon_url }}">
<link rel="apple-touch-icon" href="{{ favicon_url }}">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
<link rel="preconnect" href="https://cdnjs.cloudflare.com">
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<style>
@font-face{
  font-family:'ProximaSoft';
  src:url('{{ font_url }}') format('opentype');
  font-weight:400 900;
  font-display:swap;
}
:root{
  --bg:#000; --bg-bottom:#2B1F00; --surface:#141414; --surface2:#1b1b1b;
  --accent:#FFB800; --glow:rgba(255,199,0,.5);
  --text:rgba(255,255,255,.9); --text2:rgba(255,255,255,.64); --muted:rgba(255,255,255,.4);
  --border:rgba(255,255,255,.08);
  --nav-h:64px;
  --top-h:52px;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
html{height:100%;height:-webkit-fill-available}
html,body{margin:0;padding:0}
body{
  font-family:'ProximaSoft',ui-rounded,-apple-system,'Segoe UI',sans-serif;
  background:linear-gradient(180deg,var(--bg) 0%,var(--bg) 60%,var(--bg-bottom) 100%) fixed;
  color:var(--text);-webkit-font-smoothing:antialiased;overscroll-behavior-y:none;
  min-height:100vh;min-height:-webkit-fill-available;
  overflow-x:hidden;
}
.app{max-width:520px;margin:0 auto;min-height:100vh;min-height:-webkit-fill-available;padding-bottom:calc(var(--nav-h) + env(safe-area-inset-bottom));position:relative}
@media (min-width:768px){
  .app{max-width:560px}
  .dash-greet .name{font-size:24px}
  .btn{font-size:17px;padding:16px}
  .moment-card{border-radius:14px}
  .moments-grid{grid-template-columns:repeat(3,1fr);gap:10px}
}
@media (min-width:1024px){
  .app{max-width:640px}
  .moments-grid{grid-template-columns:repeat(4,1fr)}
}
.topbar{position:-webkit-sticky;position:sticky;top:0;z-index:50;background:rgba(0,0,0,.94);
  padding:calc(10px + env(safe-area-inset-top)) 16px 10px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)}
.topbar .brand{font-weight:800;font-size:16px;letter-spacing:.2px;display:flex;align-items:center}
.topbar .brand img{width:22px;height:22px;border-radius:6px;margin-right:8px}
.pill{background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:500px;padding:7px 14px;
  font-size:13px;font-weight:700;display:inline-flex;align-items:center;cursor:pointer;transition:transform .15s}
.pill > * + *{margin-left:6px}
.pill:active{transform:scale(.95)}
.page{padding:16px;display:none}
.page.active{display:block;animation:fadeIn .25s ease both}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.hidden{display:none !important}
.btn{width:100%;padding:15px;border:none;border-radius:500px;background:var(--accent);color:rgba(0,0,0,.8);
  font-family:inherit;font-weight:800;font-size:16px;cursor:pointer;transition:transform .1s,opacity .2s;
  box-shadow:0 0 30px var(--glow)}
.btn:active{transform:scale(.98)}
.btn:disabled{opacity:.55;box-shadow:none}
.btn-ghost{background:rgba(255,255,255,.08);color:var(--text);box-shadow:none}
.input{width:100%;padding:13px 16px;border:1px solid var(--border);border-radius:16px;background:var(--surface);
  color:var(--text);font-family:inherit;font-size:15px;outline:none;transition:border-color .2s}
.input:focus{border-color:var(--accent)}
.label{font-size:11px;font-weight:800;color:var(--text2);margin:0 0 6px 2px;display:block;text-transform:uppercase;letter-spacing:.6px}
.card{background:var(--surface);border-radius:20px;padding:18px;margin-bottom:12px;border:1px solid var(--border)}

/* ---------- Login ---------- */
.login-hero{text-align:center;padding:56px 0 30px}
.login-hero .icon{width:88px;height:88px;border-radius:24px;margin:0 auto;box-shadow:0 0 60px var(--glow);object-fit:cover}
.login-hero h1{margin:22px 0 6px;font-size:28px;font-weight:800;color:var(--text)}
.login-hero p{color:var(--text2);margin:0;font-size:15px;font-weight:700;max-width:240px;margin:0 auto}

/* ---------- Dash ---------- */
.dash-head{display:flex;align-items:center;margin-bottom:18px}
.dash-greet{flex:1;min-width:0;margin-left:14px}
.dash-greet .hi{font-size:13px;color:var(--text2);font-weight:700;margin:0 0 2px}
.dash-greet .name{font-size:21px;font-weight:800;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.streak-card{display:flex;align-items:center;gap:12px;background:linear-gradient(135deg,rgba(255,184,0,.16),rgba(255,184,0,.04));
  border:1px solid rgba(255,184,0,.25)}
.streak-num{font-size:30px;font-weight:800;color:var(--accent);line-height:1}
.streak-label{font-size:12px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.quick-row{display:flex;margin-top:4px}
.quick-row > * + *{margin-left:10px}
.quick-row .btn{padding:13px}

/* ---------- Moments grid 2x3 ---------- */
/* Moments: desktop = square grid; phone = vertical snap feed (1 per screen) */
.moments-head{display:flex;align-items:center;justify-content:space-between;padding:0 16px 12px}
.moments-head h2{margin:0;font-size:20px;font-weight:800}
.moments-refresh-btn{background:none;border:none;color:var(--text);font-size:19px;padding:7px;
  cursor:pointer;-webkit-tap-highlight-color:transparent;display:flex;align-items:center;
  justify-content:center;border-radius:50%}
.moments-refresh-btn:active{background:rgba(255,255,255,.08)}
.icon-spin{animation:spin .7s linear infinite}
.moments-new-pill{position:fixed;top:64px;left:50%;z-index:85;
  transform:translateX(-50%) translateY(-10px);
  background:#FFB800;color:#111;border:none;border-radius:500px;padding:9px 18px;
  font-size:13px;font-weight:800;display:none;align-items:center;gap:6px;cursor:pointer;
  box-shadow:0 4px 16px rgba(255,184,0,.45);-webkit-tap-highlight-color:transparent;
  opacity:0;transition:opacity .2s,-webkit-transform .2s;transition:opacity .2s,transform .2s}
.moments-new-pill.show{display:-webkit-box;display:-webkit-flex;display:flex;opacity:1;transform:translateX(-50%) translateY(0)}
/* Floating "newest" button — all devices, large hit target (iOS 12 safe) */
.moments-top-btn{position:fixed;right:14px;bottom:78px;z-index:80;
  width:56px;height:56px;border-radius:50%;border:none;background:#FFB800;color:#111;
  display:none;-webkit-box-align:center;-webkit-box-pack:center;
  align-items:center;justify-content:center;cursor:pointer;padding:0;
  box-shadow:0 4px 18px rgba(255,184,0,.45);-webkit-tap-highlight-color:transparent}
.moments-top-btn.show{display:-webkit-box;display:-webkit-flex;display:flex}
.moments-top-btn:active{-webkit-transform:scale(.94);transform:scale(.94)}
.moments-top-btn i{color:#111;pointer-events:none}
.moments-more{text-align:center;padding:14px;color:var(--muted);font-size:13px;font-weight:700}
.feed-skel{padding:12px;display:flex;flex-direction:column;align-items:center}
.feed-skel .skeleton{width:90%;height:0;padding-bottom:90%;border-radius:18px;margin-bottom:10px}
.moments-grid{display:grid;grid-template-columns:repeat(3,1fr);padding:0 12px}
.moments-grid > *{margin:0 4px 8px}
/* Square via padding-bottom — aspect-ratio unsupported on iOS 12 */
.moment-card{position:relative;border-radius:14px;overflow:hidden;background:var(--surface);cursor:pointer;width:100%;height:0;padding-bottom:100%}
.moment-card img,.moment-card video{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.moment-video-badge{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2;
  width:34px;height:34px;border-radius:50%;background:rgba(0,0,0,.45);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);
  display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;pointer-events:none}
.feed-slide .moment-video-badge{width:52px;height:52px;font-size:22px}
.moment-overlay{position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(180deg,rgba(0,0,0,.4) 0%,transparent 30%,transparent 55%,rgba(0,0,0,.72) 100%);pointer-events:none}
.moment-top{position:absolute;top:6px;left:6px;right:6px;z-index:3;display:flex;align-items:center;
  background:rgba(0,0,0,.55);border-radius:500px;padding:3px 8px 3px 3px;max-width:calc(100% - 12px)}
.moment-top .avatar-wrap{margin-right:4px}
.moment-top .mname{font-size:10px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
.moment-top .mtime{font-size:9px;color:rgba(255,255,255,.65);margin-left:auto;flex-shrink:0}
.moment-caption{position:absolute;bottom:10px;left:50%;-webkit-transform:translateX(-50%);transform:translateX(-50%);
  z-index:3;background:rgba(0,0,0,.55);border-radius:500px;padding:7px 16px;font-size:12px;font-weight:700;color:#fff;
  text-align:center;white-space:normal;word-break:break-word;line-height:1.35;max-width:92%;width:auto;
  max-height:4.2em;overflow:hidden;display:inline-block;box-sizing:border-box}
.moments-empty,.friends-empty{text-align:center;padding:50px 20px;color:var(--muted)}
.moments-empty i,.friends-empty i{opacity:.5;margin-bottom:10px;display:inline-block}
.moments-empty-retry{margin-top:14px;padding:8px 20px;border-radius:20px;border:1px solid var(--border);
  background:var(--surface);color:var(--text);font-size:13px;font-weight:700;cursor:pointer}

/* Mobile feed — iOS 12 safe (no aspect-ratio / no flex gap / no inset) */
.moments-feed{display:none;overflow-y:auto;-webkit-overflow-scrolling:touch}
.moments-feed .feed-slide{
  display:block;padding:10px 14px 16px;box-sizing:border-box;text-align:center}
.moments-feed .feed-card{position:relative;display:inline-block;width:88%;max-width:340px;
  height:0;padding-bottom:88%;border-radius:14px;overflow:hidden;background:#111;vertical-align:top}
.moments-feed .feed-card img,.moments-feed .feed-card video{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.moments-feed .feed-meta{width:88%;max-width:340px;margin:10px auto 0;padding:0;text-align:left}
.moments-feed .feed-name{font-size:14px;font-weight:800;display:flex;align-items:center}
.moments-feed .feed-name .avatar-wrap{margin-right:8px}
.moments-feed .feed-card .moment-caption{bottom:10px}
@media (max-width:520px){
  .moments-grid{display:none}
  .moments-feed{display:block}
  .moments-head{padding:6px 12px}
  .moments-head h2{font-size:17px}
  #page-moments.active{
    position:fixed;left:0;right:0;top:0;bottom:0;
    max-width:520px;margin:0 auto;
    padding-top:56px;padding-bottom:70px;
    overflow-y:auto;-webkit-overflow-scrolling:touch;
    z-index:40;background:#000;
  }
  #page-moments.active .moments-feed{display:block}
  #page-moments.active .feed-card{
    width:86%;
    max-width:320px;
    padding-bottom:86%;
  }
  .moments-top-btn{right:14px;bottom:78px;width:52px;height:52px}
  #page-upload.active{padding-bottom:8px}
  .preview-box{max-height:40vh}
}

/* Fullscreen viewer */
.viewer{position:fixed;top:0;left:0;right:0;bottom:0;background:#000;z-index:150;display:none;flex-direction:column;align-items:center;justify-content:center}
.viewer.open,.viewer:not(.hidden){display:flex}
.viewer img,.viewer video{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;background:#000}
.viewer-head{position:absolute;top:0;left:0;right:0;padding:24px 16px 30px;
  z-index:2;background:linear-gradient(180deg,rgba(0,0,0,.7),transparent);display:flex;align-items:center}
.viewer-close{margin-left:auto;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.14);
  border:none;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.viewer-caption{position:absolute;bottom:24px;left:16px;right:16px;z-index:2;
  background:rgba(0,0,0,.6);border-radius:14px;padding:12px 16px;font-size:14px;font-weight:600;text-align:center;
  white-space:normal;word-break:break-word;line-height:1.4;max-height:30vh;overflow-y:auto}

@media (max-width:375px){
  .moment-card,.moments-feed .feed-card{border-radius:10px;box-shadow:none}
  .page.active{animation:none}
  .skeleton{animation:none;background:#1a1a1a}
}

/* ---------- Friends ---------- */
.friends-count{font-size:13px;color:var(--text2);font-weight:700;margin:2px 0 14px}
.friends-count b{color:var(--accent)}
.friend-row{display:flex;align-items:center;padding:12px 0;border-bottom:1px solid var(--border)}
.friend-row:last-child{border-bottom:none}
.friend-row .avatar-wrap{margin-right:14px}
.friend-info{min-width:0;flex:1}
.friend-name{font-weight:800;font-size:16.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.friend-user{font-size:13px;color:var(--text2);font-weight:600;margin-top:2px}
.friend-streak{margin-left:auto;flex-shrink:0;font-size:13px;font-weight:800;color:var(--accent);display:flex;align-items:center}
.friend-streak .bi{margin-left:3px}
.contact-card{margin-top:14px}
.contact-card .label-row{font-size:12px;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
.contact-links{display:block}
.contact-link{display:flex;align-items:center;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.05);
  border:1px solid var(--border);color:var(--text);text-decoration:none;font-weight:700;font-size:14px;margin-bottom:8px}
.contact-link:active{background:rgba(255,255,255,.1)}
.contact-link .bi{margin-right:12px;font-size:22px}
.contact-link span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.contact-link .cl-handle{color:var(--text2);font-weight:600;font-size:12.5px;margin-left:auto}
.switch-row{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:14px;
  background:var(--surface);border:1px solid var(--border);margin-bottom:12px}
.switch-row .sw-text{font-size:13px;font-weight:700;line-height:1.35;padding-right:12px}
.switch-row .sw-sub{font-size:11px;color:var(--text2);font-weight:600;margin-top:2px}
.switch{position:relative;width:46px;height:28px;flex-shrink:0;display:inline-block}
.switch input{position:absolute;opacity:0;width:46px;height:28px;margin:0;z-index:2;cursor:pointer}
.switch .slider{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,.18);border-radius:500px;cursor:pointer}
.switch .slider:before{content:'';position:absolute;width:22px;height:22px;left:3px;top:3px;background:#fff;border-radius:50%;
  -webkit-transition:-webkit-transform .2s;transition:transform .2s}
.switch input:checked+.slider{background:var(--accent)}
.switch input:checked+.slider:before{-webkit-transform:translateX(18px);transform:translateX(18px);background:#111}
.queue-box{margin-top:12px;border-radius:14px;border:1px solid var(--border);background:var(--surface);overflow:hidden}
.queue-box .qb-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border);
  font-size:12px;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:.4px}
.queue-item{display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)}
.queue-item:last-child{border-bottom:none}
.queue-item img{width:44px;height:44px;border-radius:10px;object-fit:cover;background:#222;flex-shrink:0;margin-right:10px}
.queue-item .qi-info{min-width:0;flex:1}
.queue-item .qi-title{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.queue-item .qi-status{font-size:11px;font-weight:600;color:var(--text2);margin-top:2px}
.queue-item .qi-status.pending{color:var(--accent)}
.queue-item .qi-status.uploading{color:#4ea8ff}
.queue-item .qi-status.error{color:#ff6b6b}
.queue-item .qi-status.done{color:#3ddc84}
.offline-banner{display:none;padding:10px 14px;margin-bottom:12px;border-radius:12px;
  background:rgba(255,184,0,.12);border:1px solid rgba(255,184,0,.3);font-size:12.5px;font-weight:700;color:var(--accent)}
.offline-banner.show{display:block}

/* ---------- Avatar — no inset (iOS 12) ---------- */
.avatar-wrap{position:relative;flex-shrink:0;overflow:visible}
.avatar-ring{position:absolute;top:0;left:0;width:100%;height:100%}
.avatar-img{position:absolute;border-radius:50%;overflow:hidden;background:var(--surface2)}
.avatar-img img{width:100%;height:100%;object-fit:cover;display:block}
.avatar-badge{position:absolute;bottom:-1px;right:-1px;pointer-events:none}
.fm-contentPunch{-webkit-mask-image:radial-gradient(circle at 100% 100%,transparent 11px,black 12px);
  mask-image:radial-gradient(circle at 100% 100%,transparent 11px,black 12px)}

/* ---------- Upload ---------- */
.preview-box{width:100%;height:0;padding-bottom:100%;background:var(--surface);border-radius:24px;overflow:hidden;
  position:relative;border:2px dashed var(--border);cursor:pointer}
.preview-box img,.preview-box video{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.preview-hint{position:absolute;top:50%;left:0;right:0;-webkit-transform:translateY(-50%);transform:translateY(-50%);
  text-align:center;color:var(--text2);font-weight:700;font-size:13px;padding:0 20px}
.preview-hint i{opacity:.6;margin-bottom:10px;display:inline-block}
#fileInput,#cameraInput{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0,0,0,0)}
.upload-actions{display:flex;margin-top:10px}
.upload-actions .btn-ghost{flex:1;font-size:13px;padding:10px;margin:0 4px}

/* ---------- Live camera — redesigned, native feel ---------- */
.live-cam{width:100%;margin:0 0 4px}
@media (max-width:520px){
  .live-cam{width:calc(100% + 32px);max-width:none;margin-left:-16px;margin-right:-16px;margin-bottom:4px}
}
.lc-frame{width:100%;position:relative;border-radius:18px;overflow:hidden;background:#0a0a0a;
  -webkit-transform:translateZ(0);transform:translateZ(0);height:0;padding-bottom:100%}
@media (max-width:520px){.lc-frame{border-radius:0}}
.lc-frame.sized{height:auto;padding-bottom:0}
.lc-frame video{position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;
  max-width:none;max-height:none;object-fit:cover;-webkit-object-fit:cover;
  object-position:center center;display:block;background:#0a0a0a;-webkit-transform:translateZ(0)}
.lc-frame video.mirrored{-webkit-transform:scaleX(-1) translateZ(0);transform:scaleX(-1) translateZ(0)}
.lc-hint{position:absolute;top:50%;left:0;right:0;-webkit-transform:translateY(-50%);transform:translateY(-50%);
  text-align:center;color:var(--text2);font-weight:700;font-size:13px;padding:0 20px;z-index:2}
.lc-hint .spinner{margin-bottom:8px}

/* Flash — top right, glass */
.lc-flash-btn{position:absolute;top:12px;right:12px;z-index:3;width:38px;height:38px;border-radius:50%;
  background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);color:#fff;
  display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-appearance:none;
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);font-size:15px;
  transition:background .15s,color .15s,transform .1s}
.lc-flash-btn.on{color:var(--accent);background:rgba(255,184,0,.18);border-color:rgba(255,184,0,.45)}
.lc-flash-btn:active{-webkit-transform:scale(.92);transform:scale(.92)}
.lc-flash-btn.hidden{display:none}
.lc-flash-overlay{position:absolute;top:0;left:0;right:0;bottom:0;background:#fff;opacity:0;pointer-events:none;z-index:4}
.lc-flash-overlay.fire{opacity:.85;transition:opacity .12s ease-out}

/* Zoom pills — clean, even */
.lc-zoom-row{position:absolute;left:0;right:0;bottom:12px;z-index:3;display:none;
  align-items:center;justify-content:center;pointer-events:none}
.lc-zoom-row.show{display:-webkit-box;display:-webkit-flex;display:flex}
.lc-zoom-row > * + *{margin-left:8px}
.lc-zoom-btn{pointer-events:auto;-webkit-appearance:none;border:none;cursor:pointer;
  background:rgba(0,0,0,.5);color:#fff;font-size:12px;font-weight:800;
  min-width:40px;height:30px;border-radius:500px;padding:0 12px;
  display:flex;align-items:center;justify-content:center;
  transition:background .15s,color .15s,transform .1s;
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
  border:1px solid rgba(255,255,255,.1);letter-spacing:.02em}
.lc-zoom-btn.active{background:var(--accent);color:#111;border-color:var(--accent);font-weight:900}
.lc-zoom-btn:active{-webkit-transform:scale(.92);transform:scale(.92)}

/* Focus ring — native iOS */
.lc-focus-ring{position:absolute;width:72px;height:72px;margin:-36px 0 0 -36px;z-index:5;
  border:2px solid #ffd60a;border-radius:4px;pointer-events:none;opacity:0;transform:scale(1.25);
  box-shadow:0 0 0 1px rgba(0,0,0,.35), 0 0 12px rgba(255,214,10,.35)}
.lc-focus-ring.pulse{animation:lcFocusPulse .7s cubic-bezier(.2,.8,.3,1) forwards}
@keyframes lcFocusPulse{
  0%{opacity:0;transform:scale(1.25)}
  12%{opacity:1;transform:scale(1)}
  80%{opacity:1;transform:scale(1)}
  100%{opacity:0;transform:scale(1)}
}

/* Exposure */
.lc-exposure-col{display:none !important} /* removed — unreliable + ugly on most browsers */

/* Bottom bar — 3-column grid keeps shutter perfectly centered */
.lc-bar{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:18px 16px 6px;gap:0}
.lc-bar .lc-side:first-child{justify-self:start}
.lc-bar .lc-side:last-child,.lc-bar .lc-side.flip{justify-self:end}
.lc-side{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.14);
  color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-appearance:none;flex-shrink:0;
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);font-size:17px;
  transition:background .15s,transform .1s,border-color .15s}
.lc-side:active{-webkit-transform:scale(.9);transform:scale(.9);background:rgba(255,255,255,.18)}
.lc-side.spacer{visibility:hidden;pointer-events:none}

/* Shutter — iOS Camera: outer ring + solid inner disc, optical balance */
.lc-shutter{width:76px;height:76px;border-radius:50%;border:3px solid #fff;background:transparent;
  padding:5px;cursor:pointer;-webkit-appearance:none;flex-shrink:0;justify-self:center;
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 0 0 1px rgba(0,0,0,.2),0 4px 16px rgba(0,0,0,.35);transition:transform .12s,opacity .12s;box-sizing:border-box}
.lc-shutter span{display:block;width:100%;height:100%;border-radius:50%;background:#fff;
  transition:background .15s,border-radius .18s,width .15s,height .15s}
.lc-shutter:active{-webkit-transform:scale(.92);transform:scale(.92)}
.lc-shutter:disabled{opacity:.45}

/* Recording state: red ring + red rounded square */
.lc-shutter.recording{border-color:#ff3b30;box-shadow:0 0 0 1px rgba(255,59,48,.25),0 4px 16px rgba(255,59,48,.25)}
.lc-shutter.recording span{border-radius:8px;width:42%;height:42%;background:#ff3b30}

.lc-mode-row{display:flex;align-items:center;justify-content:center;gap:22px;padding:8px 0 0}
.lc-mode-row.hidden{display:none}
.lc-mode-btn{background:none;border:none;cursor:pointer;color:rgba(255,255,255,.55);
  font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:4px 2px;
  border-bottom:2px solid transparent;transition:color .15s,border-color .15s}
.lc-mode-btn.active{color:var(--accent);border-color:var(--accent)}
.lc-record-time{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:4;
  display:none;align-items:center;gap:6px;background:rgba(0,0,0,.5);color:#fff;
  font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px}
.lc-record-time.show{display:-webkit-box;display:-webkit-flex;display:flex}
.lc-record-dot{width:7px;height:7px;border-radius:50%;background:#ff3b30;animation:lcRecDot 1s infinite}
@keyframes lcRecDot{0%,100%{opacity:1}50%{opacity:.25}}

/* ---------- Crop stage ---------- */
.crop-stage{
  position:fixed !important;top:0;left:0;right:0;bottom:0;
  width:100%;height:100%;
  background:#000;z-index:9999;
  display:none;flex-direction:column;
}
.crop-stage.open{display:-webkit-flex !important;display:flex !important}
.crop-header{flex-shrink:0;padding:24px 16px 10px;display:flex;align-items:center;
  justify-content:space-between;border-bottom:1px solid var(--border);background:#000}
.crop-header span{font-weight:800;font-size:15px}
.crop-header button{background:none;border:none;color:var(--accent);font-family:inherit;font-weight:800;font-size:15px;cursor:pointer;padding:8px 10px}
.crop-header button.cancel{color:var(--text2)}
.crop-area{flex:1;min-height:0;overflow:hidden;background:#000;position:relative}
.crop-area img{display:block;max-width:100%}
.cropper-container{max-height:100% !important}
.cropper-view-box,.cropper-face{border-radius:0}
.cropper-point{background:var(--accent);width:8px;height:8px}
.cropper-line{background:var(--accent)}
.crop-footer{flex-shrink:0;padding:12px 16px 20px;background:#000}
.viewer{z-index:10000}

/* ---------- Nav ---------- */
.nav{position:fixed;bottom:0;left:0;right:0;max-width:640px;margin:0 auto;background:rgba(0,0,0,.92);
  border-top:1px solid var(--border);
  display:flex;justify-content:space-around;padding:8px 0 12px;z-index:60}
.nav button{background:none;border:none;font-family:inherit;font-size:10.5px;font-weight:800;color:var(--muted);
  display:flex;flex-direction:column;align-items:center;cursor:pointer;padding:4px 10px}
.nav button svg{width:21px;height:21px;margin-bottom:4px}
.nav button.active{color:var(--accent)}

/* ---------- Toast / spinner ---------- */
.toast{position:fixed;bottom:96px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--surface);
  color:var(--text);padding:11px 20px;border-radius:500px;font-size:13px;font-weight:700;opacity:0;
  transition:all .25s;z-index:300;white-space:nowrap;border:1px solid var(--border);max-width:88vw;
  overflow:hidden;text-overflow:ellipsis}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.spinner{width:17px;height:17px;border:2.5px solid rgba(0,0,0,.25);border-top-color:rgba(0,0,0,.8);
  border-radius:50%;animation:spin .7s linear infinite;display:inline-block;vertical-align:-3px}
.spinner.light{border:2.5px solid rgba(255,255,255,.15);border-top-color:var(--accent)}
@keyframes spin{to{transform:rotate(360deg)}}
.skeleton{border-radius:16px;background:linear-gradient(90deg,#151515 25%,#1f1f1f 50%,#151515 75%);
  background-size:200% 100%;animation:shimmer 1.3s infinite}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* Progress pill — moments / friends load status */
.progress-pill{
  position:fixed;left:50%;bottom:78px;z-index:90;
  -webkit-transform:translateX(-50%) translateY(12px);transform:translateX(-50%) translateY(12px);
  background:rgba(20,20,20,.94);color:var(--text);border:1px solid rgba(255,184,0,.35);
  border-radius:500px;padding:9px 16px 9px 12px;font-size:12.5px;font-weight:700;
  display:none;-webkit-box-align:center;-webkit-box-pack:center;align-items:center;
  box-shadow:0 4px 20px rgba(0,0,0,.45);max-width:92vw;white-space:nowrap;
  opacity:0;transition:opacity .2s,-webkit-transform .2s,transform .2s;
  pointer-events:none;
}
.progress-pill.show{display:-webkit-box;display:-webkit-flex;display:flex;opacity:1;
  -webkit-transform:translateX(-50%) translateY(0);transform:translateX(-50%) translateY(0)}
.progress-pill .pp-spin{width:14px;height:14px;border:2px solid rgba(255,184,0,.25);
  border-top-color:var(--accent);border-radius:50%;-webkit-animation:spin .7s linear infinite;animation:spin .7s linear infinite;
  margin-right:8px;flex-shrink:0}
.progress-pill .pp-text{overflow:hidden;text-overflow:ellipsis;min-width:0}
.progress-pill .pp-bar{display:block;height:3px;background:rgba(255,255,255,.12);border-radius:2px;margin-top:6px;overflow:hidden}
.progress-pill .pp-bar > i{display:block;height:100%;width:0%;background:var(--accent);border-radius:2px;
  -webkit-transition:width .25s ease;transition:width .25s ease}
@media (max-width:520px){
  .progress-pill{bottom:76px;font-size:12px;padding:8px 14px 8px 10px}
}

/* Remember-me row */
.remember-row{display:flex;align-items:center;margin-top:12px;font-size:13px;font-weight:700;color:var(--text2);cursor:pointer;user-select:none}
.remember-row input{width:16px;height:16px;accent-color:var(--accent);margin-right:8px}
</style>
</head>
<body>
<div class="app">
  <div class="topbar">
    <div class="brand"><img src="{{ favicon_url }}" alt=""> Locket Mini</div>
    {% if logged_in %}<div class="pill" onclick="showPage('friends')" title="Bạn bè">
      <i class="bi bi-people-fill" style="font-size:15px"></i>
      <span id="friendCountPill">–</span>
    </div>{% endif %}
  </div>

  {% if not logged_in %}
  <div class="page active" id="page-login">
    <div class="login-hero">
      <img class="icon" src="{{ favicon_url }}" alt="">
      <h1>Locket Mini</h1>
      <p>Pics from your best friends,<br>straight from your login</p>
    </div>
    <div class="card">
      <label class="label">Email</label>
      <input class="input" id="loginEmail" type="email" placeholder="your@email.com" autocomplete="email" inputmode="email">
      <label class="label" style="margin-top:12px">Password</label>
      <input class="input" id="loginPass" type="password" placeholder="Password" autocomplete="current-password">
      <label class="remember-row"><input type="checkbox" id="loginRemember" checked> Ghi nhớ đăng nhập</label>
      <button class="btn" style="margin-top:16px" onclick="doLogin()" id="loginBtn">Log In</button>
    </div>
  </div>
  {% else %}

  <div class="page active" id="page-dash">
    <div class="dash-head">
      <div id="dashAvatar"></div>
      <div class="dash-greet">
        <p class="hi" id="greetLine">Xin chào</p>
        <p class="name" id="dashName">{{ boot_name or '…' }}</p>
      </div>
    </div>
    <div class="card streak-card">
      <div style="display:flex;align-items:center">
        <i class="bi bi-fire" style="font-size:28px;color:#FFB800;margin-right:10px"></i>
        <div>
          <div class="streak-num"><span id="streakNum">–</span></div>
          <div class="streak-label">Locket Streak</div>
        </div>
      </div>
    </div>
    <div class="quick-row">
      <button class="btn" onclick="showPage('upload')">Đăng khoảnh khắc</button>
    </div>
    <div class="quick-row" style="margin-top:8px">
      <button class="btn btn-ghost" onclick="showPage('moments')">Xem Moments</button>
      <button class="btn btn-ghost" onclick="showPage('friends')">Bạn bè</button>
    </div>
    <div class="card contact-card">
      <div class="label-row">Liên hệ chủ web</div>
      <div class="contact-links">
        <a class="contact-link" href="https://www.threads.net/@anhztuan.1710" target="_blank" rel="noopener">
          <i class="bi bi-threads" style="font-size:22px"></i>
          <span>Threads</span>
          <span class="cl-handle">@anhztuan.1710</span>
        </a>
        <a class="contact-link" href="https://www.instagram.com/anhztuan.1710" target="_blank" rel="noopener">
          <i class="bi bi-instagram" style="font-size:22px"></i>
          <span>Instagram</span>
          <span class="cl-handle">@anhztuan.1710</span>
        </a>
      </div>
    </div>
  </div>

  <div class="page" id="page-upload">
    <h2 style="margin:0 0 14px;font-size:20px;font-weight:800">Khoảnh khắc mới</h2>
    <div class="offline-banner" id="offlineBanner">
      <i class="bi bi-wifi-off" style="font-size:16px"></i>
      Đang offline — ảnh sẽ lưu máy và tự đăng khi có mạng
    </div>
    <div class="switch-row">
      <div>
        <div class="sw-text">Camera trực tiếp</div>
        <div class="sw-sub">Thay khung chọn ảnh bằng camera Locket gốc, chụp là xong</div>
      </div>
      <label class="switch"><input type="checkbox" id="liveCameraSwitch" onchange="toggleLiveCamera(this.checked)"><span class="slider"></span></label>
    </div>
    <div class="switch-row">
      <div>
        <div class="sw-text">Tự mở camera khi vào web</div>
        <div class="sw-sub">Vào trang → tab Đăng → mở camera (iPhone hỗ trợ tốt)</div>
      </div>
      <label class="switch"><input type="checkbox" id="autoCameraSwitch" onchange="toggleAutoCamera(this.checked)"><span class="slider"></span></label>
    </div>
    <div class="switch-row">
      <div>
        <div class="sw-text">Chế độ máy yếu</div>
        <div class="sw-sub">Giảm độ phân giải camera & ảnh chụp — mượt hơn trên máy cũ/cam yếu (iPhone 6 trở về sau)</div>
      </div>
      <label class="switch"><input type="checkbox" id="lowPowerSwitch" onchange="toggleLowPower(this.checked)"><span class="slider"></span></label>
    </div>
    <div class="preview-box" id="previewBox" onclick="openCapture()">
      <div class="preview-hint" id="uploadPlaceholder">
        <i class="bi bi-camera" style="font-size:40px"></i><br>
        Chạm để chọn ảnh/video<br><span style="opacity:.7;font-size:11px">hoặc dán ảnh (Ctrl+V)</span>
      </div>
      <img id="previewImg" class="hidden" alt="preview">
      <video id="previewVid" class="hidden" playsinline muted loop autoplay onloadedmetadata="onPreviewVidMeta.call(this)"></video>
    </div>
    <div class="live-cam hidden" id="liveCam">
      <div class="lc-frame">
        <video id="lcVideo" playsinline webkit-playsinline muted autoplay></video>
        <div class="lc-hint hidden" id="lcHint"><span class="spinner light"></span><br>Đang mở camera…</div>
        <div class="lc-flash-overlay" id="lcFlashOverlay"></div>
        <button type="button" class="lc-flash-btn hidden" id="lcFlashBtn" onclick="toggleTorch(event)" aria-label="Đèn flash"><i class="bi bi-lightning-charge-fill"></i></button>
        <div class="lc-zoom-row" id="lcZoomRow"></div>
        <div class="lc-exposure-col" id="lcExposureCol">
          <i class="bi bi-brightness-high-fill"></i>
          <input type="range" class="lc-exposure-range" id="lcExposureRange" min="0" max="1" step="0.01" value="0.5" oninput="onLcExposureInput(this.value)" aria-label="Độ sáng">
          <i class="bi bi-brightness-low"></i>
        </div>
        <div class="lc-record-time" id="lcRecordTime"><span class="lc-record-dot"></span><span id="lcRecordTimeText">0:00</span></div>
      </div>
      <div class="lc-mode-row hidden" id="lcModeRow">
        <button type="button" class="lc-mode-btn active" data-mode="photo" onclick="setLcCaptureMode('photo')">Ảnh</button>
        <button type="button" class="lc-mode-btn" data-mode="video" onclick="setLcCaptureMode('video')">Video</button>
      </div>
      <div class="lc-bar">
        <div class="lc-side spacer" aria-hidden="true"></div>
        <button type="button" class="lc-shutter" id="lcShutterBtn" onclick="onLcShutterTap(event)" aria-label="Chụp"><span></span></button>
        <button type="button" class="lc-side flip" onclick="flipLiveCamera(event)" aria-label="Đổi camera"><i class="bi bi-arrow-repeat"></i></button>
      </div>
    </div>
    <div class="upload-actions hidden" id="uploadActions">
      <button class="btn-ghost btn" onclick="openCapture()">Đổi ảnh</button>
      <button class="btn-ghost btn" onclick="clearUpload()">Xoá</button>
    </div>
    <input type="file" id="fileInput" accept="image/*,video/*" onchange="onFilePick(event)">
    <input type="file" id="cameraInput" accept="image/*" capture="environment" class="hidden" onchange="onFilePick(event)">
    <label class="label" style="margin-top:14px">Chú thích</label>
    <input class="input" id="caption" placeholder="Viết gì đó..." maxlength="200">
    <button class="btn" style="margin-top:14px" onclick="doUpload()" id="uploadBtn">Gửi cho tất cả bạn bè</button>
    <div class="queue-box hidden" id="queueBox">
      <div class="qb-head"><span>Hàng đợi đăng</span><span id="queueCount">0</span></div>
      <div id="queueList"></div>
    </div>
  </div>

  <div class="page" id="page-moments">
    <div class="moments-head">
      <h2>Moments</h2>
      <button type="button" class="moments-refresh-btn" id="momentsRefreshBtn" onclick="refreshMomentsNow();return false;" title="Làm mới Moments" aria-label="Làm mới Moments">
        <i class="bi bi-arrow-clockwise" id="momentsRefreshIcon"></i>
      </button>
    </div>
    <button type="button" class="moments-new-pill" id="momentsNewPill" onclick="applyPendingMoments();return false;"></button>
    <div class="moments-grid" id="momentsGrid"></div>
    <div class="moments-feed" id="momentsFeed"></div>
    <div id="momentsMoreSentinel" style="height:1px"></div>
    <div id="momentsMore" class="moments-more hidden">Đang tải thêm…</div>
    <div class="moments-empty hidden" id="momentsEmpty">
      <i class="bi bi-collection" style="font-size:44px" id="momentsEmptyIcon"></i>
      <div id="momentsEmptyText">Chưa có khoảnh khắc nào</div>
      <button type="button" class="moments-empty-retry hidden" id="momentsEmptyRetry" onclick="loadMoments(true);return false;">Thử lại</button>
    </div>
  </div>
  <button type="button" class="moments-top-btn" id="momentsTopBtn" onclick="scrollMomentsTop();return false;" ontouchend="scrollMomentsTop();return false;" title="Moments mới nhất" aria-label="Lên đầu">
    <i class="bi bi-chevron-up" style="font-size:22px"></i>
  </button>

  <div class="page" id="page-friends">
    <h2 style="margin:0 0 4px;font-size:20px;font-weight:800">Bạn bè</h2>
    <div class="friends-count" id="friendsCountLine">Đang tải...</div>
    <div id="friendsList"></div>
    <div class="friends-empty hidden" id="friendsEmpty">
      <i class="bi bi-people" style="font-size:44px"></i>
      <div>Chưa có bạn bè</div>
    </div>
  </div>

  <div class="nav">
    <button class="active" onclick="showPage('dash')" id="nav-dash">
      <i class="bi bi-house-door-fill" style="font-size:20px;margin-bottom:4px"></i>Trang chủ</button>
    <button onclick="showPage('upload')" id="nav-upload">
      <i class="bi bi-camera-fill" style="font-size:20px;margin-bottom:4px"></i>Đăng</button>
    <button onclick="showPage('moments')" id="nav-moments">
      <i class="bi bi-grid-3x3-gap-fill" style="font-size:20px;margin-bottom:4px"></i>Moments</button>
    <button onclick="showPage('friends')" id="nav-friends">
      <i class="bi bi-people-fill" style="font-size:20px;margin-bottom:4px"></i>Bạn bè</button>
    <button onclick="doLogout()">
      <i class="bi bi-box-arrow-right" style="font-size:20px;margin-bottom:4px"></i>Thoát</button>
  </div>

  <div class="crop-stage" id="cropStage">
    <div class="crop-header">
      <button class="cancel" onclick="cancelCrop()">Huỷ</button>
      <span>Crop ảnh 1:1</span>
      <button onclick="confirmCrop()">Xong</button>
    </div>
    <div class="crop-area"><img id="cropImg" alt=""></div>
    <div class="crop-footer"><div style="text-align:center;color:var(--text2);font-size:12px">Kéo, phóng to/nhỏ để căn ảnh vuông</div></div>
  </div>

  <div class="viewer hidden" id="viewerStage"></div>

  {% endif %}
</div>
<div class="toast" id="toast"></div>
<div class="progress-pill" id="progressPill" aria-live="polite">
  <span class="pp-spin"></span>
  <div style="min-width:0;flex:1">
    <div class="pp-text" id="progressPillText">Đang tải…</div>
    <div class="pp-bar"><i id="progressPillBar"></i></div>
  </div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js"></script>
<script>
const $=id=>document.getElementById(id);
const GOLD_BADGE="{{ gold_badge }}", CELEB_BADGE="{{ celeb_badge }}";
const BOOT_NAME={{ (boot_name or '')|tojson }};
const BOOT_PHOTO={{ (boot_photo or '')|tojson }};
let croppedBlob=null, originalFile=null, isVideo=false, cropper=null;
let videoCropPayload=null;
/* Center-square crop metadata, same shape binhake's own web client sends for video
   uploads (captured from a real browser session). Without this the field was
   previously hardcoded to "null", which is what photos already used successfully,
   but videos need the real dimensions + crop rect. */
function buildVideoCropPayload(vw, vh){
  if(!vw || !vh) return null;
  var side=Math.min(vw, vh);
  var x=Math.round((vw-side)/2), y=Math.round((vh-side)/2);
  return JSON.stringify({type:'video', crop:{x:x,y:y,w:side,h:side}, video:{videoWidth:vw,videoHeight:vh}, view:{scale:1}});
}
function onPreviewVidMeta(){
  videoCropPayload = buildVideoCropPayload(this.videoWidth, this.videoHeight);
}
let friendsCache=null, momentsLoaded=false, meLoaded=false;
let momentsCache=[], momentsUpdatedAt=0, momentsPollTimer=null;

/* ---------- iPhone 6 friendly limits ---------- */
var IS_PHONE = (typeof window !== 'undefined' && window.innerWidth <= 520);
var IMG_CONCURRENCY = IS_PHONE ? 1 : 4;   // iPhone 6: 1 concurrent decode — avoid Safari kill
var MOMENT_BATCH = IS_PHONE ? 2 : 8;      // DOM nodes per paint wave
var PREFETCH_COUNT = IS_PHONE ? 2 : 10;   // eager Image() ahead of scroll
var THUMB_W = IS_PHONE ? 320 : 480;       // feed thumb max side (grid)
var FEED_THUMB_W = IS_PHONE ? 360 : 540;  // vertical feed card
var AVATAR_W = 96;
var LOCAL_MOMENTS_CAP = IS_PHONE ? 30 : 80;
var LOCAL_FRIENDS_CAP = 200;

/* ---------- Low-power mode: manual toggle + auto-detect old iOS ---------- */
var OLD_IOS = (function(){
  var m = navigator.userAgent.match(/OS (\d+)_/);
  return !!(m && parseInt(m[1],10) <= 12 && /iPhone|iPad|iPod/.test(navigator.userAgent));
})();
function isLowPower(){
  try{
    var v = localStorage.getItem('locket_low_power');
    if(v==='1') return true;
    if(v==='0') return false;
  }catch(e){}
  return OLD_IOS; // unset = auto, based on device
}
function setLowPower(on){
  try{ localStorage.setItem('locket_low_power', on?'1':'0'); }catch(e){}
  LOW_POWER = on;
}
var LOW_POWER = isLowPower();
/* Capture/preview sizing driven by LOW_POWER — smaller frames decode/encode much
   faster on iPhone 6-era Safari and avoid the tab getting killed for memory. */
var LC_WIDTH_IDEAL = LOW_POWER ? 960 : 1920;
var LC_HEIGHT_IDEAL = LOW_POWER ? 960 : 1080;
var LC_FRAMERATE_IDEAL = LOW_POWER ? 15 : 30;
var CAPTURE_SIZE = LOW_POWER ? 720 : 1080;
var CAPTURE_JPEG_Q = LOW_POWER ? 0.82 : 0.93;
/* WebP support detection — chỉ convert sang JPEG khi thực sự cần */
var WEBP_SUPPORTED = false;
(function(){
  var img = new Image();
  img.onload = function(){ WEBP_SUPPORTED = true; };
  img.onerror = function(){ WEBP_SUPPORTED = false; };
  img.src = 'data:image/webp;base64,UklGRi4AAABXRUJQVlA4TCEAAAAvAUAAEB8wAiMwAgSSNtse/cXjxyCCmrYNrpwmfXgJzU3f';
})();

/* Khi xây URL ảnh: nếu browser hỗ trợ WebP và ảnh gốc là WebP, 
   bỏ qua proxy JPEG để giữ chất lượng gốc + tiết kiệm CPU */
function mediaSrc(u, w){
  u=normalizeMediaUrl(u);
  if(!u)return'';
  if(u.indexOf('/api/img')===0||u.indexOf('blob:')===0||u.indexOf('data:')===0)return u;
  var isWebp = /\\.webp$/i.test(u);
  // Nếu browser support WebP và ảnh là WebP → serve trực tiếp, không qua proxy JPEG
  if(WEBP_SUPPORTED && isWebp && (!w || w <= 1080)){
    return u;
  }
  var q='/api/img?u='+encodeURIComponent(u);
  if(w) q+='&w='+w;
  // Gửi flag cho server biết browser có hỗ trợ WebP không
  if(WEBP_SUPPORTED) q += '&webp=1';
  return q;
}
var TINY_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/* Image load queue — prevents Safari memory death on iPhone 6 */
var _imgQ = [];
var _imgActive = 0;
var _imgDone = 0;
var _imgTotal = 0;
var _imgProgTimer = null;

function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),2600)}
function esc(s){const d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML}

function showProgress(text, done, total){
  var pill = $('progressPill');
  if(!pill) return;
  var txt = $('progressPillText');
  var bar = $('progressPillBar');
  if(txt) txt.textContent = text || 'Đang tải…';
  if(bar && total > 0){
    var pct = Math.min(100, Math.round((done / total) * 100));
    bar.style.width = pct + '%';
  } else if(bar){
    bar.style.width = '0%';
  }
  pill.classList.add('show');
}
function hideProgress(delay){
  var pill = $('progressPill');
  if(!pill) return;
  clearTimeout(pill._hide);
  pill._hide = setTimeout(function(){ pill.classList.remove('show'); }, delay == null ? 400 : delay);
}
function bumpImgProgress(){
  _imgDone++;
  if(_imgTotal <= 0) return;
  showProgress('Đang tải ảnh ' + Math.min(_imgDone, _imgTotal) + '/' + _imgTotal, _imgDone, _imgTotal);
  if(_imgDone >= _imgTotal && _imgActive === 0 && _imgQ.length === 0){
    showProgress('Xong ' + _imgTotal + ' ảnh', _imgTotal, _imgTotal);
    hideProgress(900);
  }
}
function enqueueImg(imgEl, src){
  if(!imgEl || !src) return;
  // already has real src
  if(imgEl.getAttribute('data-src-loaded') === src) return;
  imgEl.setAttribute('data-src-pending', src);
  _imgQ.push({el: imgEl, src: src});
  _imgTotal++;
  pumpImgQueue();
}
function pumpImgQueue(){
  while(_imgActive < IMG_CONCURRENCY && _imgQ.length){
    var job = _imgQ.shift();
    if(!job || !job.el) continue;
    // element may have been removed / recycled
    if(!job.el.parentNode){ bumpImgProgress(); continue; }
    _imgActive++;
    (function(el, src){
      var done = function(){
        _imgActive = Math.max(0, _imgActive - 1);
        bumpImgProgress();
        pumpImgQueue();
      };
      var tmp = new Image();
      tmp.onload = function(){
        try{
          el.src = src;
          el.setAttribute('data-src-loaded', src);
          el.removeAttribute('data-src-pending');
        }catch(e){}
        done();
      };
      tmp.onerror = function(){
        try{ el.style.opacity = '0.3'; }catch(e){}
        done();
      };
      tmp.src = src;
    })(job.el, job.src);
  }
  if(_imgTotal > 0 && (_imgActive > 0 || _imgQ.length > 0)){
    showProgress('Đang tải ảnh ' + Math.min(_imgDone, _imgTotal) + '/' + _imgTotal, _imgDone, _imgTotal);
  }
}
function resetImgProgress(){
  _imgQ = [];
  _imgActive = 0;
  _imgDone = 0;
  _imgTotal = 0;
}

async function api(url,opts){
  try{
    const r=await fetch(url,opts);
    return await r.json();
  }catch(err){
    console.error('api',url,err);
    throw err;
  }
}
// Same as api(), but aborts after `ms` so a hung request can never permanently wedge a
// single-flight flag (was letting one dead request block every future reload silently).
function apiTimeout(url, opts, ms){
  var ctrl = (typeof AbortController!=='undefined') ? new AbortController() : null;
  var o = Object.assign({}, opts||{});
  if(ctrl) o.signal = ctrl.signal;
  var timer = ctrl ? setTimeout(function(){ ctrl.abort(); }, ms) : null;
  var p = api(url, o);
  if(timer && p.finally) p = p.finally(function(){ clearTimeout(timer); });
  return p;
}

{% if not logged_in %}
/* ===================== Login ===================== */
function doLogin(){
  const e=$('loginEmail').value.trim(),p=$('loginPass').value,btn=$('loginBtn');
  const remember=!!$('loginRemember')&&$('loginRemember').checked;
  if(!e||!p){toast('Nhập email và mật khẩu');return}
  btn.innerHTML='<span class="spinner"></span>';btn.disabled=true;
  api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,password:p,remember:remember})})
  .then(d=>{
    btn.innerHTML='Log In';btn.disabled=false;
    if(d.ok){location.reload()}else{toast(d.error||'Đăng nhập thất bại')}
  }).catch(()=>{btn.innerHTML='Log In';btn.disabled=false;toast('Lỗi mạng')})
}
{% else %}
/* ===================== Nav / paging ===================== */
function showPage(name){
  ['dash','upload','moments','friends'].forEach(p=>{
    $(`page-${p}`).classList.remove('active');
    const nb=$(`nav-${p}`); if(nb)nb.classList.remove('active');
  });
  $(`page-${name}`).classList.add('active');
  const nb=$(`nav-${name}`); if(nb)nb.classList.add('active');
  const topBtn=$('momentsTopBtn');
  if(topBtn) topBtn.classList.toggle('show', name==='moments');
  if(name==='dash'&&!meLoaded) loadMe();
  if(name==='moments'){
    _momentsBootLock = true;
    scrollMomentsTop();
    ensureMomentsFromCache();
    var age = (Date.now()/1000) - (momentsUpdatedAt || 0);
    // Online + cache older than 25s (or never refreshed after offline) → force network
    if(navigator.onLine && (age > 25 || !momentsUpdatedAt)){
      loadMoments(true);
    } else {
      loadMoments(false);
    }
    startMomentsPoll();
    setTimeout(function(){ _momentsBootLock = false; scrollMomentsTop(); }, 280);
  } else {
    stopMomentsPoll();
    if(name !== 'friends') hideProgress(0);
  }
  if(name==='friends') loadFriends();
  if(name==='upload'){
    if(isLiveCamera() && !croppedBlob){
      $('previewBox').classList.add('hidden');
      $('uploadPlaceholder').classList.add('hidden');
      $('liveCam').classList.remove('hidden');
      startLiveCamera();
      // Scroll camera into comfortable view (switches sit above; user should not have to drag)
      setTimeout(function(){ scrollUploadCameraIntoView(); }, 60);
      setTimeout(function(){ scrollUploadCameraIntoView(); }, 280);
    } else {
      // still jump near top of upload form so preview is usable
      setTimeout(function(){
        try{
          var page=$('page-upload');
          if(page) page.scrollIntoView({block:'start'});
          window.scrollTo(0, Math.max(0, (page?page.offsetTop:0) - 8));
        }catch(e){}
      }, 40);
    }
  } else {
    stopLiveCamera();
  }
}

/* ===================== Avatar (ring + notch badge) ===================== */
function getInitials(name){
  if(!name)return'?';
  return name.trim().split(/\\s+/).map(s=>s[0]).join('').toUpperCase().slice(0,2);
}
function stringToHsl(str,s,l){
  let hash=0;
  for(let i=0;i<str.length;i++)hash=str.charCodeAt(i)+((hash<<5)-hash);
  return `hsl(${Math.abs(hash%360)},${s}%,${l}%)`;
}
function renderAvatar(u,size=52){
  u=u||{};
  const uid=(u.uid||u.username||Math.random().toString(36).slice(2)).toString().replace(/[^a-zA-Z0-9]/g,'');
  const hasGold=(u.badge==='locket_gold'||u.badge==='Locket Gold');
  const isCeleb=!!u.celebrity;
  const showBadge=hasGold||isCeleb;
  const ring=showBadge?'#FFB800':'rgba(255,255,255,.18)';
  const badgeSrc=hasGold?GOLD_BADGE:CELEB_BADGE;
  const inset=Math.max(2,Math.round(size*0.06));
  const r=size/2;
  const initials=getInitials(u.first_name||u.username||'?');
  const bg=stringToHsl(uid||initials,60,42);
  const pic=mediaSrc(u.profile_picture_url||'', 128);

  let inner;
  if(pic){
    inner=`<img src="${esc(pic)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
      <div style="display:none;width:100%;height:100%;line-height:${size-inset*2}px;text-align:center;background:${bg};color:#fff;font-weight:800;font-size:${Math.round(size*0.38)}px">${esc(initials)}</div>`;
  }else{
    inner=`<div style="width:100%;height:100%;line-height:${size-inset*2}px;text-align:center;background:${bg};color:#fff;font-weight:800;font-size:${Math.round(size*0.38)}px">${esc(initials)}</div>`;
  }

  return `<div class="avatar-wrap" style="width:${size}px;height:${size}px">
    <svg class="avatar-ring" viewBox="0 0 ${size} ${size}">
      <defs><mask id="m-${uid}-${size}">
        <rect width="${size}" height="${size}" fill="white"/>
        <circle cx="${size/2}" cy="${size/2}" r="${r-inset-2}" fill="black"/>
        ${showBadge?`<circle cx="${size*0.82}" cy="${size*0.82}" r="${size*0.16}" fill="black"/>`:''}
      </mask></defs>
      <circle cx="${size/2}" cy="${size/2}" r="${r-inset}" fill="${ring}" mask="url(#m-${uid}-${size})"/>
    </svg>
    <div class="avatar-img ${showBadge?'fm-contentPunch':''}" style="top:${inset}px;left:${inset}px;right:${inset}px;bottom:${inset}px">${inner}</div>
    ${showBadge?`<img class="avatar-badge" src="${badgeSrc}" style="width:${size*0.34}px;height:${size*0.34}px" alt="">`:''}
  </div>`;
}

/* ===================== Dash ===================== */
function greetingLine(){
  const h=new Date().getHours();
  if(h<11)return'Chào buổi sáng';
  if(h<14)return'Chào buổi trưa';
  if(h<18)return'Chào buổi chiều';
  return'Chào buổi tối';
}
function loadMe(){
  $('greetLine').textContent=greetingLine();
  // Paint immediately from session bootstrap (login already returned displayName + photo)
  if(BOOT_NAME) $('dashName').textContent=BOOT_NAME;
  if(BOOT_PHOTO||BOOT_NAME){
    $('dashAvatar').innerHTML=renderAvatar({first_name:BOOT_NAME,profile_picture_url:mediaSrc(BOOT_PHOTO,128)},56);
  }else{
    $('dashAvatar').innerHTML=renderAvatar({},56);
  }
  api('/api/me').then(d=>{
    if(!d.ok){toast(d.error||'Không tải được thông tin');return}
    meLoaded=true;
    const me=d.me||{};
    const fullName=((me.first_name||'')+' '+(me.last_name||'')).trim()||me.username||BOOT_NAME||'Bạn';
    $('dashName').textContent=fullName;
    $('dashAvatar').innerHTML=renderAvatar(me,56);
    $('streakNum').textContent=(me.streak!=null&&me.streak!=='')?me.streak:'–';
  }).catch(()=>toast('Lỗi mạng khi tải trang chủ'));
}

/* ===================== Friends (progressive render) ===================== */
const FRIENDS_CACHE_KEY='locket_friends_cache_v1';
const FRIENDS_TTL_MS=6*60*60*1000; // 6 hours — avoid re-fetch every visit
const MOMENTS_LS_KEY='locket_moments_cache_v1';
const MOMENTS_TTL_MS=45*1000; // 45s soft TTL — after offline, online handler zeros ts anyway
let friendsFetchedAt=0;
/* friends progressive render — smaller batches on weak devices */
const FRIENDS_BATCH = IS_PHONE ? 8 : 16;

function readFriendsLocal(){
  try{
    const raw=localStorage.getItem(FRIENDS_CACHE_KEY);
    if(!raw) return null;
    const obj=JSON.parse(raw);
    if(!obj||!Array.isArray(obj.friends)) return null;
    return obj;
  }catch(e){return null}
}
function writeFriendsLocal(friends,count){
  try{
    localStorage.setItem(FRIENDS_CACHE_KEY, JSON.stringify({friends,count,ts:Date.now()}));
  }catch(e){}
}
function paintFriends(friends,count){
  friendsCache=friends||[];
  const list=$('friendsList');
  if($('friendCountPill')) $('friendCountPill').textContent=count!=null?count:friendsCache.length;
  if($('friendsCountLine')) $('friendsCountLine').innerHTML=`Tổng cộng <b>${count!=null?count:friendsCache.length}</b> bạn bè`;
  if(!list) return;
  list.innerHTML='';
  if(!friendsCache.length){$('friendsEmpty').classList.remove('hidden');return}
  $('friendsEmpty').classList.add('hidden');
  if(friendsCache.length > 30){
    showProgress('Đang hiện bạn bè 0/' + friendsCache.length, 0, friendsCache.length);
  }
  renderFriendBatch(list,friendsCache,0,FRIENDS_BATCH);
}
function loadFriends(force){
  const list=$('friendsList');
  const local=readFriendsLocal();
  const fresh=local && (Date.now()-(local.ts||0)<FRIENDS_TTL_MS);
  // Instant paint from local cache
  if(local && local.friends && local.friends.length){
    paintFriends(local.friends, local.count);
    friendsFetchedAt=local.ts||0;
    if(!force && fresh) return; // still warm — skip network
  }else if(list){
    $('friendsCountLine').textContent='Đang tải...';
    $('friendsEmpty').classList.add('hidden');
    list.innerHTML=Array(5).fill('<div class="skeleton" style="height:68px;margin-bottom:10px"></div>').join('');
  }
  api('/api/friends').then(d=>{
    if(!d.ok){
      if(!friendsCache||!friendsCache.length){
        toast(d.error||'Không tải được bạn bè');
        if(list) list.innerHTML='';
        $('friendsEmpty').classList.remove('hidden');
        $('friendsCountLine').textContent='';
      }
      return;
    }
    const friends=d.friends||[];
    const count=d.count!=null?d.count:friends.length;
    // Smart skip re-paint if same size and not forced
    const same=friendsCache && friendsCache.length===friends.length && !force;
    writeFriendsLocal(friends, count);
    friendsFetchedAt=Date.now();
    if(!same) paintFriends(friends, count);
    else {
      friendsCache=friends;
      if($('friendCountPill')) $('friendCountPill').textContent=count;
    }
  }).catch(()=>{
    if(!friendsCache||!friendsCache.length){
      toast('Lỗi mạng khi tải bạn bè');
      if(list) list.innerHTML='';
      $('friendsCountLine').textContent='';
    }
  });
}
function preloadFriends(){
  // Background warm on app open — never blocks UI
  const local=readFriendsLocal();
  if(local && local.friends){
    friendsCache=local.friends;
    if($('friendCountPill')) $('friendCountPill').textContent=local.count!=null?local.count:local.friends.length;
  }
  const need=!(local && (Date.now()-(local.ts||0)<FRIENDS_TTL_MS));
  if(need) loadFriends(false);
}
function renderFriendBatch(container,friends,start,batch){
  const end=Math.min(start+batch,friends.length);
  var frag=document.createDocumentFragment();
  for(let i=start;i<end;i++){
    const u=friends[i];
    const row=document.createElement('div');
    row.className='friend-row';
    const streak=(u.streak&&u.streak>0)?`<div class="friend-streak">${u.streak}<i class="bi bi-fire" style="margin-left:3px;color:#FFB800;font-size:14px"></i></div>`:'';
    row.innerHTML=`${renderAvatar(u,60)}<div class="friend-info"><div class="friend-name">${esc(u.first_name||'')} ${esc(u.last_name||'')}</div><div class="friend-user">@${esc(u.username||u.uid||'')}</div></div>${streak}`;
    frag.appendChild(row);
  }
  container.appendChild(frag);
  if(friends.length > 30){
    showProgress('Đang hiện bạn bè ' + end + '/' + friends.length, end, friends.length);
  }
  if(end<friends.length){
    // yield to keep scroll responsive on iPhone 6
    setTimeout(function(){ renderFriendBatch(container,friends,end,batch); }, IS_PHONE ? 32 : 16);
  } else {
    hideProgress(600);
  }
}

/* ===================== Moments (cache + live poll + mobile feed) ===================== */
function normalizeMediaUrl(u){
  if(!u)return'';
  return String(u).replace('firebasestorage.googleapis.com:443','firebasestorage.googleapis.com');
}
/* mediaSrc defined once above with WebP-aware path */
function isPhone(){return window.innerWidth<=520 || IS_PHONE}
function extractCaption(m){
  if(m.caption)return m.caption;
  if(m.overlays&&m.overlays.length){
    const cap=m.overlays.find(o=>o.overlay_id==='caption:standard')
      || m.overlays.find(o=>o.overlay_type==='caption'||(o.overlay_id&&String(o.overlay_id).startsWith('caption:')));
    if(cap)return(cap.data&&cap.data.text)||cap.alt_text||'';
  }
  return'';
}
function timeAgo(seconds){
  if(!seconds)return'';
  const diff=Math.max(0,Math.floor(Date.now()/1000-seconds));
  if(diff<60)return'vừa xong';
  if(diff<3600)return Math.floor(diff/60)+' phút';
  if(diff<86400)return Math.floor(diff/3600)+' giờ';
  return Math.floor(diff/86400)+' ngày';
}
function momentProf(m,friendMap){
  const uidRaw=(typeof m.user==='string')?m.user:((m.user||{}).uid||m.user_id||'');
  const prof=friendMap[uidRaw]||{};
  return {
    uid:uidRaw,
    first_name:m.first_name||prof.first_name||'',
    last_name:m.last_name||prof.last_name||'',
    username:prof.username||'',
    profile_picture_url:mediaSrc(m.profile_picture_url||prof.profile_picture_url||'', 128),
    celebrity:!!(m.from_celebrity||prof.celebrity),
    badge:prof.badge||'',
  };
}
let momentsRendered=0;
var _momentsBootLock = false; // true while opening tab — block scroll-triggered append
var _momentsHiddenAt = 0;
function momentsBatchSize(){ return MOMENT_BATCH; }
// The grid (desktop) and feed (phone) are mutually exclusive per the @media(max-width:520px)
// breakpoint in the CSS — only one is ever visible. Previously both were always built for every
// moment, silently doubling DOM nodes, image decodes and network requests on every device,
// which is a big part of why Moments felt heavy on iPhone 6. IS_PHONE mirrors that same 520px
// cutoff, so we now build only the node that will actually be shown.
var MOMENTS_GRID_MODE = !IS_PHONE;
function buildMomentNode(m, idx, friendMap, eager){
  return MOMENTS_GRID_MODE ? buildMomentCard(m, idx, friendMap, eager) : buildFeedSlide(m, idx, friendMap, eager);
}
function momentsActiveContainer(){
  return $(MOMENTS_GRID_MODE ? 'momentsGrid' : 'momentsFeed');
}
function momentKey(m){ return (m&&(m.thumbnail_url||m.url||m.video_url))||''; }
function bindMomentsClickDelegation(){
  var grid=$('momentsGrid'), feed=$('momentsFeed');
  function onClick(e){
    var el = e.target.closest ? e.target.closest('[data-idx]') : null;
    if(!el) return;
    var idx = parseInt(el.getAttribute('data-idx'), 10);
    if(!isNaN(idx)) openViewer(idx);
  }
  if(grid) grid.addEventListener('click', onClick);
  if(feed) feed.addEventListener('click', onClick);
}

function buildMomentCard(m, idx, friendMap, eager){
  const displayProf=momentProf(m,friendMap);
  const imgUrl=mediaSrc(m.thumbnail_url||m.url||'', THUMB_W);
  const cap=extractCaption(m);
  const t=(m.date&&m.date._seconds)||m.timestamp||m.created_at||0;
  const fullName=((displayProf.first_name||'')+' '+(displayProf.last_name||'')).trim()||displayProf.username||'?';
  const isVid=!!m.video_url;
  const card=document.createElement('div');
  card.className='moment-card';
  card.setAttribute('data-idx', String(idx));
  // placeholder first — real src goes through concurrency queue
  card.innerHTML=
    '<img src="'+TINY_PIXEL+'" data-real="'+esc(imgUrl)+'" alt="" style="background:#1a1a1a">'+
    '<div class="moment-overlay"></div>'+
    (isVid?'<div class="moment-video-badge"><i class="bi bi-play-fill"></i></div>':'')+
    '<div class="moment-top">'+renderAvatar(displayProf,20)+'<span class="mname">'+esc(fullName)+'</span><span class="mtime" data-ts="'+t+'">'+timeAgo(t)+'</span></div>'+
    (cap?'<div class="moment-caption">'+esc(cap)+'</div>':'');
  var imgEl = card.querySelector('img');
  if(imgEl && imgUrl){
    if(eager) enqueueImg(imgEl, imgUrl);
    else imgEl.setAttribute('data-lazy', imgUrl);
  }
  return card;
}
function buildFeedSlide(m, idx, friendMap, eager){
  const displayProf=momentProf(m,friendMap);
  const imgUrl=mediaSrc(m.thumbnail_url||m.url||'', FEED_THUMB_W);
  const cap=extractCaption(m);
  const t=(m.date&&m.date._seconds)||m.timestamp||m.created_at||0;
  const name=((displayProf.first_name||'')+' '+(displayProf.last_name||'')).trim()||displayProf.username||'?';
  const isVid=!!m.video_url;
  const slide=document.createElement('div');
  slide.className='feed-slide';
  slide.setAttribute('data-idx', String(idx));
  slide.innerHTML=
    '<div class="feed-card">'+
      '<img src="'+TINY_PIXEL+'" data-real="'+esc(imgUrl)+'" alt="" style="background:#1a1a1a">'+
      '<div class="moment-overlay"></div>'+
      (isVid?'<div class="moment-video-badge"><i class="bi bi-play-fill"></i></div>':'')+
      (cap?'<div class="moment-caption">'+esc(cap)+'</div>':'')+
    '</div>'+
    '<div class="feed-meta">'+
      '<div class="feed-name">'+renderAvatar(displayProf,28)+'<span>'+esc(name)+'</span><span class="mtime" data-ts="'+t+'" style="margin-left:auto;color:var(--muted);font-size:12px;font-weight:700">'+timeAgo(t)+'</span></div>'+
    '</div>';
  var imgEl = slide.querySelector('img');
  if(imgEl && imgUrl){
    if(eager) enqueueImg(imgEl, imgUrl);
    else imgEl.setAttribute('data-lazy', imgUrl);
  }
  return slide;
}
function appendMomentsBatch(){
  const items=window._momentItems||[];
  if(momentsRendered>=items.length){
    const more=$('momentsMore'); if(more) more.classList.add('hidden');
    if(items.length){
      showProgress('Moments ' + items.length + '/' + items.length, items.length, items.length);
      hideProgress(800);
    }
    return;
  }
  const friendMap={};
  if(friendsCache)friendsCache.forEach(function(f){ friendMap[f.uid]=f; });
  const target=momentsActiveContainer();
  const batch=momentsBatchSize();
  const end=Math.min(momentsRendered+batch, items.length);
  var frag = target ? document.createDocumentFragment() : null;
  for(let idx=momentsRendered; idx<end; idx++){
    // first few: eager so newest shows immediately
    const eager = idx < (IS_PHONE ? 2 : 4);
    if(frag) frag.appendChild(buildMomentNode(items[idx], idx, friendMap, eager));
  }
  if(target && frag) target.appendChild(frag);
  momentsRendered=end;
  showProgress('Moments ' + momentsRendered + '/' + items.length, momentsRendered, items.length);
  const more=$('momentsMore');
  if(more) more.classList.toggle('hidden', momentsRendered>=items.length);
  // kick lazy load for newly painted nodes near viewport
  scheduleLazyLoad();
}
function showMomentsEmpty(isError){
  var box=$('momentsEmpty'); if(!box) return;
  box.classList.remove('hidden');
  var icon=$('momentsEmptyIcon'), text=$('momentsEmptyText'), retry=$('momentsEmptyRetry');
  if(icon) icon.className='bi '+(isError?'bi-wifi-off':'bi-collection');
  if(text) text.textContent=isError?'Không tải được Moments':'Chưa có khoảnh khắc nào';
  if(retry) retry.classList.toggle('hidden', !isError);
}
function renderMomentsUI(items, reset){
  const grid=$('momentsGrid'), feed=$('momentsFeed');
  window._momentItems=items;
  if(reset!==false){
    hideNewMomentsPill();
    if(grid) grid.innerHTML='';
    if(feed) feed.innerHTML='';
    momentsRendered=0;
    resetImgProgress();
    // Force top — clearing content must not keep old scroll position
    _momentsBootLock = true;
    try{
      var page=$('page-moments');
      if(page) page.scrollTop = 0;
      if(feed) feed.scrollTop = 0;
    }catch(e){}
  }
  if(!items.length){showMomentsEmpty(false); hideProgress(0); return}
  $('momentsEmpty').classList.add('hidden');
  showProgress('Moments 0/' + items.length, 0, items.length);
  // Paint ONLY the first batch on open — more loads when user scrolls
  appendMomentsBatch();
  bindMomentsScroll();
  startRelativeTimeTicker();
  // One small follow-up batch for smoother first screen (still at top)
  if(momentsRendered<items.length){
    setTimeout(function(){
      appendMomentsBatch();
      scrollMomentsTop();
      setTimeout(function(){ _momentsBootLock = false; }, 180);
    }, IS_PHONE ? 100 : 50);
  } else {
    hideProgress(700);
    setTimeout(function(){ _momentsBootLock = false; }, 180);
  }
}

/* Count fresh items ahead of the currently-rendered top (contiguous new run) */
function countNewMoments(freshItems){
  var oldItems=window._momentItems||[];
  var oldKeys={};
  for(var i=0;i<oldItems.length;i++) oldKeys[momentKey(oldItems[i])]=true;
  var n=0;
  for(var j=0;j<freshItems.length;j++){
    if(oldKeys[momentKey(freshItems[j])]) break;
    n++;
  }
  return n;
}
/* Insert only the new cards at the top instead of tearing down the whole
   grid/feed — avoids re-decoding already-painted images and keeps scroll
   position untouched. Falls back to caller doing a full render if nothing
   new is found. */
function prependNewMoments(freshItems){
  var n=countNewMoments(freshItems);
  if(n<=0){ window._momentItems=freshItems; return false; }
  var newOnes=freshItems.slice(0, n);
  var friendMap={};
  if(friendsCache)friendsCache.forEach(function(f){ friendMap[f.uid]=f; });
  var target=momentsActiveContainer();
  var nodes=target?target.querySelectorAll('[data-idx]'):[];
  for(var x=0;x<nodes.length;x++){
    var old=parseInt(nodes[x].getAttribute('data-idx'),10);
    nodes[x].setAttribute('data-idx', String(old+n));
  }
  var frag=target?document.createDocumentFragment():null;
  for(var idx=0; idx<n; idx++){
    if(frag) frag.appendChild(buildMomentNode(newOnes[idx], idx, friendMap, true));
  }
  if(target && frag) target.insertBefore(frag, target.firstChild);
  window._momentItems=freshItems;
  momentsRendered+=n;
  scheduleLazyLoad();
  return true;
}
var _pendingMoments=null;
function showNewMomentsPill(freshItems){
  var n=countNewMoments(freshItems);
  var pill=$('momentsNewPill');
  if(n<=0 || !pill){ hideNewMomentsPill(); return; }
  _pendingMoments=freshItems;
  pill.textContent=(n===1?'1 khoảnh khắc mới':n+' khoảnh khắc mới')+' \u2191';
  pill.classList.add('show');
}
function hideNewMomentsPill(){
  _pendingMoments=null;
  var pill=$('momentsNewPill');
  if(pill) pill.classList.remove('show');
}
function applyPendingMoments(){
  if(!_pendingMoments) return;
  var items=_pendingMoments;
  hideNewMomentsPill();
  scrollMomentsTop();
  if(!prependNewMoments(items)) renderMomentsUI(items);
}
function refreshMomentsNow(){
  var icon=$('momentsRefreshIcon');
  if(icon) icon.classList.add('icon-spin');
  api('/api/moments?force=1').then(function(d){
    if(icon) icon.classList.remove('icon-spin');
    if(!d.ok){ toast(d.error||'Không làm mới được Moments'); return; }
    var items=(d.moments||[]).filter(function(m){return m&&(m.thumbnail_url||m.video_url||m.url)});
    if(!items.length && momentsCache.length){
      toast('Không có Moments mới');
      return;
    }
    hideNewMomentsPill();
    scrollMomentsTop();
    applyMomentsNetworkResult(items, d.updated_at, false, {notifyIfNoChange:true});
  }).catch(function(){
    if(icon) icon.classList.remove('icon-spin');
    toast('Lỗi mạng khi làm mới Moments');
  });
}

/* Lazy-load images only when near viewport; unload far ones to free RAM */
function scheduleLazyLoad(){
  if(window._lazyT) return;
  window._lazyT = setTimeout(function(){
    window._lazyT = null;
    runLazyLoad();
  }, 60);
}
function runLazyLoad(){
  var root = momentsScrollEl() || document;
  var viewH = (root === document || root === window) ? window.innerHeight : root.clientHeight;
  var scrollTop = (root === document || root === window) ? (window.pageYOffset || document.documentElement.scrollTop) : root.scrollTop;
  var margin = viewH * 1.5;
  var nodes = document.querySelectorAll('#momentsGrid img[data-lazy], #momentsFeed img[data-lazy], #momentsGrid img[data-src-loaded], #momentsFeed img[data-src-loaded]');
  for(var i=0; i<nodes.length; i++){
    var img = nodes[i];
    var card = img.closest ? (img.closest('.moment-card') || img.closest('.feed-slide')) : img.parentNode;
    if(!card) continue;
    var rect = card.getBoundingClientRect ? card.getBoundingClientRect() : {top:0,bottom:0};
    // relative to viewport is fine even inside fixed page
    var near = rect.bottom > -margin && rect.top < viewH + margin;
    var lazy = img.getAttribute('data-lazy');
    var loaded = img.getAttribute('data-src-loaded');
    if(near){
      if(lazy && !loaded){
        img.removeAttribute('data-lazy');
        enqueueImg(img, lazy);
      }
    } else if(loaded && IS_PHONE){
      // unload far images on weak devices (LinkedIn technique)
      img.src = TINY_PIXEL;
      img.setAttribute('data-lazy', loaded);
      img.removeAttribute('data-src-loaded');
    }
  }
}
function momentsScrollEl(){
  // On phone the fixed #page-moments is the scroller; elsewhere feed or window
  const page=$('page-moments');
  if(page && page.classList.contains('active') && isPhone()) return page;
  const feed=$('momentsFeed');
  if(feed && feed.scrollHeight>feed.clientHeight+20) return feed;
  return null;
}
function bindMomentsScroll(){
  // scroll listeners here only drive lazy-load of images near the viewport — kept
  // per-container since that math only needs "is this near visible", not "at the end".
  const page=$('page-moments');
  if(page && !page._boundScroll){
    page._boundScroll=true;
    page.addEventListener('scroll',function(){
      if(!page.classList.contains('active'))return;
      scheduleLazyLoad();
    },false);
  }
  const feed=$('momentsFeed');
  if(feed && !feed._boundScroll){
    feed._boundScroll=true;
    feed.addEventListener('scroll',function(){ scheduleLazyLoad(); },false);
  }
  if(!window._momentsWinScroll){
    window._momentsWinScroll=true;
    window.addEventListener('scroll',function(){
      const p=$('page-moments');
      if(!p||!p.classList.contains('active'))return;
      scheduleLazyLoad();
    },false);
  }
  // "Load more" trigger: one IntersectionObserver watching a 1px sentinel right above
  // the "Đang tải thêm…" label. IntersectionObserver measures against the real browser
  // viewport regardless of *which* ancestor actually scrolls (window on desktop/tablet,
  // the fixed full-screen #page-moments on phone), so this works everywhere without the
  // scrollHeight/clientHeight/scrollTop bookkeeping above ever getting out of sync —
  // that per-container math was the reason "more" could get stuck forever on non-phone
  // layouts where window, not #page-moments, is the actual scroller.
  const sentinel=$('momentsMoreSentinel');
  if(sentinel){
    if(window._momentsMoreObserver && window._momentsMoreObserver.disconnect){
      window._momentsMoreObserver.disconnect();
    }
    window._momentsMoreObserver=null;
    const tryLoadMore=function(){
      if(_momentsBootLock) return;
      const items=window._momentItems||[];
      if(momentsRendered>=items.length) return;
      appendMomentsBatch();
    };
    if(window.IntersectionObserver){
      window._momentsMoreObserver=new IntersectionObserver(function(entries){
        if(entries.some(function(e){return e.isIntersecting})) tryLoadMore();
      },{root:null, rootMargin:'600px 0px', threshold:0});
      window._momentsMoreObserver.observe(sentinel);
    } else {
      // Very old browsers without IntersectionObserver (pre-iOS 12.2 Safari): fall back
      // to a plain rect check driven off the same scroll listeners already bound above.
      window._momentsMoreObserver = true; // marker so we don't bind this twice
      const rectCheck=function(){
        const r=sentinel.getBoundingClientRect();
        if(r.top < (window.innerHeight || 800) + 600) tryLoadMore();
      };
      if(page) page.addEventListener('scroll', rectCheck, false);
      if(feed) feed.addEventListener('scroll', rectCheck, false);
      window.addEventListener('scroll', rectCheck, false);
    }
  }
}
function scrollMomentsTop(){
  // iOS 12 does not support scrollTo({behavior:'smooth'}) — use scrollTop=0
  function jump(el){
    if(!el) return;
    try{ el.scrollTop=0; }catch(e){}
    try{ if(el.scrollTo) el.scrollTo(0,0); }catch(e){}
  }
  jump(momentsScrollEl());
  jump($('page-moments'));
  jump($('momentsFeed'));
  jump(document.documentElement);
  jump(document.body);
  try{ window.scrollTo(0,0); }catch(e){}
}
let _timeTicker=null;
function startRelativeTimeTicker(){
  if(_timeTicker)return;
  _timeTicker=setInterval(()=>{
    document.querySelectorAll('.mtime[data-ts]').forEach(el=>{
      const ts=Number(el.getAttribute('data-ts'));
      if(ts) el.textContent=timeAgo(ts);
    });
  },30000);
}
function readMomentsLocal(){
  try{
    const raw=localStorage.getItem(MOMENTS_LS_KEY);
    if(!raw) return null;
    const obj=JSON.parse(raw);
    if(!obj||!Array.isArray(obj.moments)) return null;
    return obj;
  }catch(e){return null}
}
function writeMomentsLocal(moments, updatedAt){
  function leanMap(list, cap){
    return (list||[]).slice(0, cap).map(function(m){
      return {
        user:m.user, user_id:m.user_id, thumbnail_url:m.thumbnail_url, url:m.url, video_url:m.video_url,
        date:m.date, timestamp:m.timestamp, created_at:m.created_at, caption:m.caption, overlays:m.overlays,
        first_name:m.first_name, last_name:m.last_name, profile_picture_url:m.profile_picture_url,
        from_celebrity:m.from_celebrity
      };
    });
  }
  var caps = [LOCAL_MOMENTS_CAP, 24, 12, 6];
  for(var i=0;i<caps.length;i++){
    try{
      localStorage.setItem(MOMENTS_LS_KEY, JSON.stringify({
        moments: leanMap(moments, caps[i]),
        updated_at: updatedAt||(Date.now()/1000),
        ts: Date.now()
      }));
      return;
    }catch(e){
      try{ localStorage.removeItem(MOMENTS_LS_KEY); }catch(e2){}
    }
  }
  try{ console.warn('moments local cache unavailable'); }catch(e){}
}
function prefetchMomentImages(items, count){
  // Soft prefetch only a few URLs into the concurrency queue — never flood
  if(!items||!items.length) return;
  var n = Math.min(count || PREFETCH_COUNT, items.length, PREFETCH_COUNT);
  for(var i=0;i<n;i++){
    var m = items[i];
    var u = mediaSrc(m.thumbnail_url||m.url||'', FEED_THUMB_W);
    if(!u) continue;
    // warm browser HTTP cache without attaching to DOM
    var tmp = new Image();
    tmp.src = u;
  }
}
/* Paint memory or localStorage without network. Never clears existing DOM if we have data. */
function ensureMomentsFromCache(){
  if(momentsCache && momentsCache.length){
    // Already in memory — only re-paint if grid/feed is empty (tab was left and DOM wiped)
    var grid=$('momentsGrid'), feed=$('momentsFeed');
    var hasDom = (grid && grid.children.length) || (feed && feed.children.length);
    if(!hasDom){
      renderMomentsUI(momentsCache, true);
      prefetchMomentImages(momentsCache, PREFETCH_COUNT);
    }
    return true;
  }
  var local=readMomentsLocal();
  if(local && local.moments && local.moments.length){
    momentsCache=local.moments;
    momentsUpdatedAt=local.updated_at||(local.ts/1000)||0;
    momentsLoaded=true;
    renderMomentsUI(momentsCache, true);
    prefetchMomentImages(momentsCache, PREFETCH_COUNT);
    return true;
  }
  return false;
}

var _momentsFetchInFlight = false;
var _momentsFetchQueued = false;

function applyMomentsNetworkResult(items, updatedAt, preferPrepend, opts){
  opts = opts || {};
  if(!items || !items.length){
    // Empty network response must NEVER wipe a healthy local cache (binhake glitch / timeout)
    if(momentsCache && momentsCache.length){
      loggerSoft('Moments network returned empty — keeping local cache of ' + momentsCache.length);
      if(opts.notifyIfNoChange) toast('Không có Moments mới');
      return;
    }
    showMomentsEmpty(false);
    hideProgress(0);
    return;
  }
  var hadCache = momentsCache && momentsCache.length > 0;
  momentsCache = items;
  momentsUpdatedAt = updatedAt || (Date.now()/1000);
  momentsLoaded = true;
  writeMomentsLocal(items, momentsUpdatedAt);

  var onMomentsPage = $('page-moments') && $('page-moments').classList.contains('active');
  if(!onMomentsPage){
    prefetchMomentImages(items, PREFETCH_COUNT);
    return;
  }

  // Compare against what's ACTUALLY painted on screen (window._momentItems), not momentsCache —
  // momentsCache can get silently advanced by pollMomentsOnce() while the user is scrolled down
  // (it shows a tappable pill instead of repainting), which used to leave momentsCache pointing
  // at newer data than the DOM. Comparing against momentsCache made this function think "nothing
  // changed" and bail out, so opening the tab again or pressing Reload appeared to do nothing even
  // though a real update was sitting unpainted. window._momentItems is only ever updated when
  // something was actually painted, so it's the correct baseline.
  var painted = window._momentItems || [];
  var prevTop = painted[0] && momentKey(painted[0]);
  var newTop = items[0] && momentKey(items[0]);
  var fullyPainted = momentsRendered >= painted.length;

  if(hadCache && fullyPainted && prevTop && prevTop === newTop && Math.abs(painted.length - items.length) <= 2){
    // Genuinely nothing new and everything visible is already on screen.
    window._momentItems = items;
    prefetchMomentImages(items, PREFETCH_COUNT);
    if(opts.notifyIfNoChange) toast('Đã là Moments mới nhất');
    return;
  }

  if(preferPrepend && hadCache && prependNewMoments(items)){
    prefetchMomentImages(items, PREFETCH_COUNT);
    return;
  }
  // Full paint only when structure actually changed or first load
  renderMomentsUI(items, true);
  prefetchMomentImages(items, PREFETCH_COUNT);
}

function loggerSoft(msg){ try{ console.log('[moments]', msg); }catch(e){} }

function loadMoments(force){
  // 1) Always try to show something immediately
  var painted = ensureMomentsFromCache();

  // Skeleton ONLY when we truly have nothing
  if(!painted && !(momentsCache && momentsCache.length)){
    $('momentsEmpty').classList.add('hidden');
    showProgress('Đang tải Moments…', 0, 1);
    var grid=$('momentsGrid'), feed=$('momentsFeed');
    if(grid && !grid.children.length){
      grid.innerHTML=Array(IS_PHONE?2:4).fill('<div class="skeleton" style="width:100%;height:0;padding-bottom:100%;border-radius:14px"></div>').join('');
    }
    if(feed && !feed.children.length){
      feed.innerHTML='<div class="feed-skel"><div class="skeleton"></div><div class="skeleton" style="height:18px;width:60%;border-radius:8px;padding-bottom:0"></div></div>';
    }
  }

  // Soft memory is fresh (<25s) and caller didn't force → skip network
  if(!force && momentsCache.length && (Date.now()/1000 - (momentsUpdatedAt||0)) < 25){
    return;
  }

  // Single-flight: don't stack parallel force fetches on slow iPhone 6
  if(_momentsFetchInFlight){
    _momentsFetchQueued = true;
    return;
  }
  _momentsFetchInFlight = true;

  var q = '?force=1';
  apiTimeout('/api/moments'+q, null, 65000).then(function(d){
    _momentsFetchInFlight = false;
    var queued = _momentsFetchQueued;
    _momentsFetchQueued = false;
    if(!d.ok){
      if(!momentsCache.length){
        toast(d.error||'Không tải được moments');
        showMomentsEmpty(true);
        hideProgress(0);
      } else {
        // Keep old UI — never clear
        toast(d.error||'Không làm mới được Moments');
      }
      if(queued) loadMoments(true);
      return;
    }
    var items=(d.moments||[]).filter(function(m){return m&&(m.thumbnail_url||m.video_url||m.url)});
    applyMomentsNetworkResult(items, d.updated_at, true);
    if(queued) loadMoments(true);
  }).catch(function(){
    _momentsFetchInFlight = false;
    var queued = _momentsFetchQueued;
    _momentsFetchQueued = false;
    if(!momentsCache.length){
      toast('Lỗi mạng khi tải moments');
      showMomentsEmpty(true);
      hideProgress(0);
    } else {
      toast('Lỗi mạng — đang hiện Moments đã lưu');
    }
    if(queued) setTimeout(function(){ loadMoments(true); }, 1200);
  });
}
function preloadMoments(){
  ensureMomentsFromCache();
  var local=readMomentsLocal();
  var need=!(local && (Date.now()-(local.ts||0)<MOMENTS_TTL_MS) && local.moments && local.moments.length);
  var run = function(){
    if(_momentsFetchInFlight) return;
    api('/api/moments?force=1').then(function(d){
      if(!d.ok) return;
      var items=(d.moments||[]).filter(function(m){return m&&(m.thumbnail_url||m.video_url||m.url)});
      // Silent: only update memory/localStorage; do not force full UI re-render unless on page
      if(!items.length && momentsCache.length) return;
      momentsCache=items.length ? items : momentsCache;
      if(items.length){
        momentsUpdatedAt=d.updated_at||(Date.now()/1000);
        momentsLoaded=true;
        writeMomentsLocal(items, momentsUpdatedAt);
        prefetchMomentImages(items, PREFETCH_COUNT);
        if($('page-moments') && $('page-moments').classList.contains('active')){
          applyMomentsNetworkResult(items, momentsUpdatedAt, true);
        }
      }
    }).catch(function(){});
  };
  if(need || !local){
    run();
  }else{
    setTimeout(run, 2800);
  }
}
function pollMomentsOnce(){
  api('/api/moments/poll?since='+encodeURIComponent(momentsUpdatedAt||0)).then(function(d){
    if(!d.ok||!d.changed)return;
    const items=(d.moments||[]).filter(function(m){return m&&(m.thumbnail_url||m.video_url||m.url)});
    if(!items.length)return;
    // Never accept empty wipe from poll
    momentsCache=items;
    momentsUpdatedAt=d.updated_at||momentsUpdatedAt;
    try{ writeMomentsLocal(items, momentsUpdatedAt); }catch(e){}
    if(!($('page-moments')&&$('page-moments').classList.contains('active'))) return;
    // Near the top: splice the new cards in without tearing down the grid —
    // cheap and doesn't disturb scroll. Scrolled down browsing older moments:
    // surface a tappable pill instead of silently swallowing the update (the
    // old behaviour — user had to reload the page to ever see them).
    var nearTop=true;
    try{
      nearTop = isPhone()
        ? (!$('page-moments') || $('page-moments').scrollTop < 200)
        : ((window.pageYOffset||document.documentElement.scrollTop||0) < 200);
    }catch(e){}
    if(nearTop) prependNewMoments(items);
    else showNewMomentsPill(items);
  }).catch(function(){});
}
function startMomentsPoll(){
  stopMomentsPoll();
  momentsPollTimer=setInterval(pollMomentsOnce, 8000); // 8s — pairs with server poll that refreshes when cache >40s old
}
function stopMomentsPoll(){
  if(momentsPollTimer){clearInterval(momentsPollTimer);momentsPollTimer=null}
  hideNewMomentsPill();
}
function viewerMediaError(el, msg){
  try{
    el.style.display='none';
    if(!el.parentNode.querySelector('.viewer-error')){
      el.insertAdjacentHTML('afterend',
        '<div class="viewer-error moments-empty" style="position:static">'+
        '<i class="bi bi-exclamation-triangle" style="font-size:36px"></i><div>'+esc(msg)+'</div></div>');
    }
  }catch(e){}
}
function openViewer(idx){
  const m=(window._momentItems||[])[idx]; if(!m)return;
  const v=$('viewerStage');
  const isVid=!!m.video_url;
  const raw=normalizeMediaUrl(m.video_url||m.thumbnail_url||m.url);
  const src=isVid?raw:mediaSrc(raw, 1080);
  const poster=(isVid&&m.thumbnail_url)?mediaSrc(m.thumbnail_url,1080):'';
  const cap=extractCaption(m);
  v.innerHTML=`
    <div class="viewer-head"><button class="viewer-close" onclick="closeViewer()" aria-label="Đóng">✕</button></div>
    ${isVid?`<video src="${esc(src)}" ${poster?`poster="${esc(poster)}"`:''} controls autoplay playsinline style="max-width:100%;max-height:100%;object-fit:contain" onerror="viewerMediaError(this,'Không phát được video')"></video>`
           :`<img src="${esc(src)}" alt="" style="max-width:100%;max-height:100%;object-fit:contain" onerror="viewerMediaError(this,'Không tải được ảnh')">`}
    ${cap?`<div class="viewer-caption">${esc(cap)}</div>`:''}
  `;
  v.classList.remove('hidden');
}
function closeViewer(){$('viewerStage').classList.add('hidden');$('viewerStage').innerHTML=''}

/* ===================== Upload: pick / paste / crop ===================== */
function triggerFilePick(){$('fileInput').click()}
function triggerCamera(){const c=$('cameraInput'); if(c) c.click(); else triggerFilePick()}
function onFilePick(e){const f=e.target.files[0];if(f)handleIncomingFile(f); e.target.value=''}
document.addEventListener('paste',(e)=>{
  if(!$('page-upload')||!$('page-upload').classList.contains('active'))return;
  const items=(e.clipboardData||{}).items||[];
  for(const it of items){
    if(it.type&&it.type.startsWith('image/')){
      const f=it.getAsFile(); if(f){handleIncomingFile(f);e.preventDefault();break}
    }
  }
});
function handleIncomingFile(f){
  originalFile=f; isVideo=f.type.startsWith('video');
  const url=URL.createObjectURL(f);
  if(isVideo){
    $('previewImg').classList.add('hidden');
    $('previewVid').classList.remove('hidden'); $('previewVid').src=url;
    $('uploadPlaceholder').classList.add('hidden');
    $('uploadActions').classList.remove('hidden');
    croppedBlob=f; return;
  }
  $('cropImg').src=url;
  const stage=$('cropStage');
  stage.classList.add('open');
  document.body.style.overflow='hidden';
  if(cropper){cropper.destroy()}
  // delay init so layout is fullscreen first (iOS)
  setTimeout(()=>{
    cropper=new Cropper($('cropImg'),{
      aspectRatio:1,viewMode:1,autoCropArea:1,dragMode:'move',
      guides:true,center:true,highlight:false,background:false,responsive:true,toggleDragModeOnDblclick:false,
    });
  },50);
}
function cancelCrop(){
  $('cropStage').classList.remove('open');
  document.body.style.overflow='';
  $('fileInput').value='';
  if($('cameraInput')) $('cameraInput').value='';
  if(!croppedBlob){$('uploadActions').classList.add('hidden')}
  if(cropper){cropper.destroy();cropper=null}
}
function confirmCrop(){
  if(!cropper)return;
  const btn=document.querySelector('#cropStage .crop-header button:last-child');
  if(btn){btn.disabled=true;btn.innerHTML='<span class="spinner light"></span>'}
  const canvas=cropper.getCroppedCanvas({width:CAPTURE_SIZE,height:CAPTURE_SIZE,imageSmoothingQuality:'high'});
  canvas.toBlob(b=>{
    croppedBlob=b;
    $('previewImg').src=URL.createObjectURL(b);
    $('previewImg').classList.remove('hidden');
    $('previewVid').classList.add('hidden');
    $('uploadPlaceholder').classList.add('hidden');
    $('uploadActions').classList.remove('hidden');
    $('cropStage').classList.remove('open');
    document.body.style.overflow='';
    if(btn){btn.disabled=false;btn.textContent='Xong'}
    cropper.destroy();cropper=null;
  },'image/jpeg',CAPTURE_JPEG_Q);
}
function clearUpload(){
  croppedBlob=null;originalFile=null;isVideo=false;videoCropPayload=null;
  $('fileInput').value='';
  if($('cameraInput')) $('cameraInput').value='';
  $('previewImg').classList.add('hidden');$('previewVid').classList.add('hidden');
  $('uploadActions').classList.add('hidden');
  openCapture();
}

/* ===================== Live camera (in-page, giống Locket gốc) ===================== */
let lcStream=null, lcTrack=null, lcFacing='environment', lcTorchOn=false, lcWantActive=false, lcStarting=false;
let lcZoomCaps=null, lcZoomCurrent=1, lcPinchStartDist=0, lcPinchStartZoom=1;
let lcExposureCaps=null;
var _lcTouchStartPt=null, _lcTouchMoved=false, _lcLastTouchTime=0;
let lcCaptureMode='photo', lcRecorder=null, lcRecordedChunks=[], lcRecordTimer=null, lcRecordStartTs=0;
const LC_MAX_RECORD_MS=15000;

function isLiveCamera(){
  try{ return localStorage.getItem('locket_live_camera')==='1'; }catch(e){ return false; }
}
function toggleLiveCamera(on){
  try{ localStorage.setItem('locket_live_camera', on?'1':'0'); }catch(e){}
  if(!croppedBlob) openCapture();
  if(on) setTimeout(function(){ scrollUploadCameraIntoView(); }, 80);
}
/** Force .lc-frame to true 1:1 at full parent width — iPhone 6 / iOS 12 safe.
 *  Always measure #liveCam (parent), NEVER the frame itself — after the first
 *  shrink, frame.clientWidth would be the shrunk value and lock us at ~220px.
 */
function _sizeLcFrame(){
  try{
    var cam = $('liveCam');
    var frame = cam && cam.querySelector ? cam.querySelector('.lc-frame') : document.querySelector('#liveCam .lc-frame');
    if(!frame || !cam || cam.classList.contains('hidden')) return;
    // Parent is full bleed on phone (CSS width calc 100%+32px). Prefer that.
    var w = cam.clientWidth || cam.offsetWidth || 0;
    if(!w){
      // fallback: page content width
      var page = $('page-upload');
      w = (page && (page.clientWidth || page.offsetWidth)) || (window.innerWidth || 320);
      // if still inside padded page and not bleed, approximate screen
      if(w < (window.innerWidth || 0) - 8) w = window.innerWidth || w;
    }
    w = Math.floor(w);
    if(w < 160) return;
    // Full width square — do NOT cap by viewport height (that was making iPhone 6
    // with Safari chrome stick at ~220px). User can scroll; shutter stays below.
    frame.style.width = w + 'px';
    frame.style.height = w + 'px';
    frame.style.maxWidth = '100%';
    frame.style.paddingBottom = '0';
    frame.style.marginLeft = '0';
    frame.style.marginRight = '0';
    frame.classList.add('sized');
  }catch(e){}
}
function scrollUploadCameraIntoView(){
  try{
    _sizeLcFrame();
    var target = $('liveCam');
    if(!target || target.classList.contains('hidden')) target = $('previewBox');
    if(!target) return;
    // Prefer centering the square in the visible area above the bottom nav
    var rect = target.getBoundingClientRect();
    var navH = 64 + 8;
    var viewH = (window.innerHeight || document.documentElement.clientHeight) - navH;
    var idealTop = Math.max(0, (viewH - rect.height) / 2);
    var delta = rect.top - idealTop;
    if(Math.abs(delta) > 12){
      var y = (window.pageYOffset || document.documentElement.scrollTop || 0) + delta;
      try{ window.scrollTo(0, Math.max(0, y)); }catch(e){}
      try{ document.documentElement.scrollTop = Math.max(0, y); }catch(e){}
      try{ document.body.scrollTop = Math.max(0, y); }catch(e){}
    }
  }catch(e){}
}
// Decide what the "upload spot" should show right now: live camera, file-pick box, or leave the
// existing preview/caption alone (a photo is already captured and waiting to be sent).
function openCapture(){
  if(croppedBlob){
    $('previewImg').classList.add('hidden');$('previewVid').classList.add('hidden');
    $('uploadActions').classList.add('hidden');
    croppedBlob=null;originalFile=null;isVideo=false;
  }
  if(isLiveCamera()){
    $('previewBox').classList.add('hidden');
    $('uploadPlaceholder').classList.add('hidden');
    $('liveCam').classList.remove('hidden');
    startLiveCamera();
    setTimeout(function(){ scrollUploadCameraIntoView(); }, 60);
  } else {
    stopLiveCamera();
    $('liveCam').classList.add('hidden');
    $('previewBox').classList.remove('hidden');
    $('uploadPlaceholder').classList.remove('hidden');
    triggerFilePick();
  }
}
function stopLiveCamera(){
  lcWantActive=false;
  if(lcStream){ lcStream.getTracks().forEach(t=>t.stop()); lcStream=null; }
  lcTrack=null; lcTorchOn=false; lcZoomCaps=null; lcZoomCurrent=1; lcExposureCaps=null;
  lcStopRecording(true);
  lcCaptureMode='photo';
  const fb=$('lcFlashBtn'); if(fb){ fb.classList.remove('on'); fb.classList.add('hidden'); }
  const zr=$('lcZoomRow'); if(zr){ zr.classList.remove('show'); zr.innerHTML=''; }
  const ec=$('lcExposureCol'); if(ec) ec.classList.remove('show');
  const mr=$('lcModeRow'); if(mr) mr.classList.add('hidden');
  const v=$('lcVideo'); if(v) v.srcObject=null;
}
function startLiveCamera(){
  if(lcStarting) return;
  stopLiveCamera();
  lcWantActive=true; lcStarting=true;
  const hint=$('lcHint'); if(hint) hint.classList.remove('hidden');
  _sizeLcFrame();

  // Prefer exact facing + highest practical resolution. Many mobile browsers
  // still downscale the preview track — we re-apply max from capabilities after open.
  var constraints = {
    audio:false,
    video:{
      facingMode: { exact: lcFacing },
      width: { ideal: LC_WIDTH_IDEAL },
      height: { ideal: LC_HEIGHT_IDEAL },
      frameRate: { ideal: LC_FRAMERATE_IDEAL }
    }
  };

  function openCam(c){
    return navigator.mediaDevices.getUserMedia(c);
  }

  openCam(constraints).catch(function(){
    // exact facingMode often fails on desktop / some Android — fall back to ideal
    return openCam({
      audio:false,
      video:{
        facingMode: { ideal: lcFacing },
        width: { ideal: LC_WIDTH_IDEAL },
        height: { ideal: LC_HEIGHT_IDEAL },
        frameRate: { ideal: LC_FRAMERATE_IDEAL }
      }
    });
  }).catch(function(){
    return openCam({
      audio:false,
      video:{ facingMode: lcFacing, width: { ideal: LOW_POWER ? 640 : 1280 }, height: { ideal: LOW_POWER ? 640 : 720 } }
    });
  }).then(function(s){
    lcStarting=false;
    if(!lcWantActive){ s.getTracks().forEach(function(t){t.stop()}); return; }
    lcStream=s; lcTrack=s.getVideoTracks()[0];
    const v=$('lcVideo');
    try{ v.setAttribute('playsinline',''); v.setAttribute('webkit-playsinline',''); v.muted=true; v.playsInline=true; }catch(e){}
    v.srcObject=s;
    v.classList.toggle('mirrored', lcFacing==='user');
    var tryPlay = function(){ try{ var p=v.play(); if(p&&p.catch) p.catch(function(){}); }catch(e){} };
    tryPlay();
    v.onloadedmetadata = function(){ tryPlay(); _sizeLcFrame(); scrollUploadCameraIntoView(); };
    if(hint) hint.classList.add('hidden');
    _sizeLcFrame();
    setTimeout(function(){ _sizeLcFrame(); scrollUploadCameraIntoView(); }, 120);

    try{
      const caps=lcTrack.getCapabilities && lcTrack.getCapabilities();
      const settings=lcTrack.getSettings && lcTrack.getSettings();
      const fb=$('lcFlashBtn');
      if(fb) fb.classList.toggle('hidden', !(caps && caps.torch));

      // Push track to sensor max when browser allows (reduces soft upscale on front cam).
      // Skipped entirely in low-power mode — the smaller ideal size above is the point.
      if(!LOW_POWER && caps && caps.width && caps.height && typeof caps.width.max==='number'){
        var wantW = Math.min(caps.width.max, 1920);
        var wantH = Math.min(caps.height.max, 1080);
        var curW = (settings && settings.width) || 0;
        var curH = (settings && settings.height) || 0;
        if(wantW > curW || wantH > curH){
          lcTrack.applyConstraints({
            width: { ideal: wantW },
            height: { ideal: wantH }
          }).catch(function(){});
        }
      }

      // Continuous AF when available (Chrome/Android). iOS WebKit ignores this — OS AF stays on.
      if(caps && caps.focusMode){
        var modes = Array.isArray(caps.focusMode) ? caps.focusMode : [caps.focusMode];
        var want = modes.indexOf('continuous') >= 0 ? 'continuous'
                  : modes.indexOf('single-shot') >= 0 ? 'single-shot' : null;
        if(want){
          lcTrack.applyConstraints({ advanced: [{ focusMode: want }] }).catch(function(){
            try{ lcTrack.applyConstraints({ focusMode: want }); }catch(e2){}
          });
        }
      }

      setupLcZoom(caps);
      setupLcExposure(caps);
      setupLcModeSwitch();
    }catch(e){}
  }).catch(function(err){
    lcStarting=false;
    if(hint) hint.classList.add('hidden');
    toast('Không mở được camera: '+(err&&err.message?err.message:'bị từ chối quyền'));
    $('liveCameraSwitch').checked=false;
    toggleLiveCamera(false);
  });
}
function flipLiveCamera(e){
  if(e)e.preventDefault();
  if(lcRecorder && lcRecorder.state==='recording'){ toast('Không đổi camera được khi đang quay'); return; }
  lcFacing = lcFacing==='environment' ? 'user' : 'environment';
  startLiveCamera();
}
function toggleTorch(e){
  if(e)e.preventDefault();
  if(!lcTrack) return;
  lcTorchOn=!lcTorchOn;
  $('lcFlashBtn').classList.toggle('on', lcTorchOn);
  try{ lcTrack.applyConstraints({advanced:[{torch:lcTorchOn}]}); }catch(err){}
}
/* Zoom: browser zoom units = FOV relative to main lens on most Android Chrome builds
   (0.5 ultrawide, 1.0 main, 2.0 tele). We ALWAYS snap open to main (1.0) and verify
   via getSettings() — otherwise the stream stays on ultrawide while UI says "1x". */
function setupLcZoom(caps){
  const row=$('lcZoomRow');
  lcZoomCaps=null; lcZoomCurrent=1;
  if(row){ row.classList.remove('show'); row.innerHTML=''; }
  if(!caps || typeof caps.zoom!=='object' || caps.zoom===null) return;
  const min=caps.zoom.min, max=caps.zoom.max, step=caps.zoom.step||0.1;
  if(typeof min!=='number' || typeof max!=='number' || max<=min) return;
  // Front camera zoom is usually digital-only and misleading — skip picker
  if(lcFacing==='user') return;

  lcZoomCaps={min:min,max:max,step:step};

  // Main lens = zoom 1.0 when in range; else device default mid/min
  var main = (min <= 1 && max >= 1) ? 1 : (min <= 1.0 ? Math.min(max, Math.max(min, 1)) : min);

  // Discrete levels that match native Camera labels
  var levels=[];
  function addLevel(z){
    z = Math.min(max, Math.max(min, z));
    // snap to step grid lightly
    if(step > 0) z = Math.round(z / step) * step;
    z = Number(z.toFixed(2));
    if(levels.indexOf(z) === -1) levels.push(z);
  }
  if(min < 0.95) addLevel(min);          // ultrawide (0.5x)
  addLevel(main);                         // main (1x)
  if(max >= 1.8) addLevel(Math.min(max, 2));
  if(max >= 2.8) addLevel(Math.min(max, 3));

  if(row && levels.length >= 2){
    row.innerHTML = levels.map(function(z){
      var label;
      if(Math.abs(z - main) < 0.05) label = '1x';
      else if(z < main) label = (Math.round((z / main) * 10) / 10) + 'x';
      else label = (Math.abs(z - Math.round(z)) < 0.05 ? Math.round(z) : z) + 'x';
      // For ultrawide show 0.5x not 0.5 when main is 1
      if(z < main && min < 0.95 && Math.abs(z - min) < 0.08) label = '0.5x';
      return '<button type="button" class="lc-zoom-btn" data-z="'+z+'" onclick="setLcZoom('+z+');return false;">'+label+'</button>';
    }).join('');
    row.classList.add('show');
  }

  // Force main lens, then re-read actual zoom (apply can fail silently)
  applyLcZoom(main, true);
  setTimeout(function(){ syncLcZoomFromTrack(); }, 120);
  setTimeout(function(){ syncLcZoomFromTrack(); }, 400);
}
function syncLcZoomFromTrack(){
  if(!lcTrack || !lcTrack.getSettings) return;
  try{
    var st = lcTrack.getSettings();
    if(typeof st.zoom === 'number'){
      lcZoomCurrent = st.zoom;
      updateLcZoomButtons(st.zoom);
    }
  }catch(e){}
}
function updateLcZoomButtons(actual){
  const row=$('lcZoomRow');
  if(!row) return;
  var btns=row.querySelectorAll('.lc-zoom-btn');
  var best=-1, bestDist=1e9;
  for(var i=0;i<btns.length;i++){
    var z=parseFloat(btns[i].getAttribute('data-z'));
    var d=Math.abs(z-actual);
    if(d<bestDist){ bestDist=d; best=i; }
  }
  for(var j=0;j<btns.length;j++) btns[j].classList.toggle('active', j===best);
}
function applyLcZoom(z, updateUI){
  if(!lcTrack || !lcZoomCaps) return;
  const clamped=Math.min(Math.max(Number(z), lcZoomCaps.min), lcZoomCaps.max);
  lcZoomCurrent=clamped;
  // Prefer plain constraint (Chrome); fall back to advanced (older)
  var applied=false;
  try{
    var p = lcTrack.applyConstraints({ zoom: clamped });
    if(p && p.then){
      p.then(function(){ applied=true; syncLcZoomFromTrack(); })
       .catch(function(){
         lcTrack.applyConstraints({ advanced: [{ zoom: clamped }] })
           .then(function(){ syncLcZoomFromTrack(); })
           .catch(function(){ syncLcZoomFromTrack(); });
       });
    } else {
      applied=true;
    }
  }catch(err){
    try{ lcTrack.applyConstraints({ advanced: [{ zoom: clamped }] }); }catch(e2){}
  }
  if(updateUI!==false) updateLcZoomButtons(clamped);
  // Verify after hardware settles
  setTimeout(function(){ syncLcZoomFromTrack(); }, 180);
}
function setLcZoom(z){ applyLcZoom(z, true); }
function setupLcExposure(caps){
  // Intentionally disabled — vertical range control looked broken and rarely worked on iOS/WebKit.
  lcExposureCaps=null;
  var col=$('lcExposureCol');
  if(col) col.classList.remove('show');
}
function onLcExposureInput(v){ /* no-op */ }
/* Tap-to-focus — shows the same focus square/pulse as a native camera app on every tap,
   and additionally nudges the real focus point when the browser exposes that control
   (mainly Chrome/Android; WebKit doesn't support it, so on iPhone this is visual-only,
   same as iOS's own camera already auto-focusing continuously in the background). */
function lcDoFocusAt(clientX, clientY){
  var frame=document.querySelector('#liveCam .lc-frame');
  if(!frame) return;
  var rect=frame.getBoundingClientRect();
  if(!rect.width || !rect.height) return;
  var relX=Math.min(Math.max((clientX-rect.left)/rect.width,0),1);
  var relY=Math.min(Math.max((clientY-rect.top)/rect.height,0),1);
  showLcFocusRing(clientX-rect.left, clientY-rect.top);

  if(!lcTrack) return;
  try{
    var caps=lcTrack.getCapabilities && lcTrack.getCapabilities();
    if(!caps) return;

    var advanced=[];
    // Ưu tiên: focusMode + pointsOfInterest (Chrome/Android)
    if(caps.focusMode){
      var modes=Array.isArray(caps.focusMode)?caps.focusMode:[caps.focusMode];
      var mode = modes.indexOf('single-shot')>=0 ? 'single-shot'
               : modes.indexOf('continuous')>=0 ? 'continuous' : null;
      if(mode) advanced.push({focusMode: mode});
    }
    if(caps.pointsOfInterest){
      advanced.push({pointsOfInterest: [{x:relX, y:relY}]} );
    }
    // Fallback: exposure compensation theo vùng chạm (nếu có)
    if(caps.exposureCompensation){
      advanced.push({exposureCompensation: 0});
    }

    if(advanced.length){
      lcTrack.applyConstraints({advanced: advanced}).catch(function(){});
    }
  }catch(e){}
}
function showLcFocusRing(x,y){
  var frame=document.querySelector('#liveCam .lc-frame');
  if(!frame) return;
  var ring=frame.querySelector('.lc-focus-ring');
  if(!ring){
    ring=document.createElement('div');
    ring.className='lc-focus-ring';
    frame.appendChild(ring);
  }
  ring.style.left=x+'px'; ring.style.top=y+'px';
  ring.classList.remove('pulse');
  void ring.offsetWidth; // restart the CSS animation
  ring.classList.add('pulse');
}
/* Pinch-to-zoom (two fingers) and tap-to-focus (one finger, minimal movement) share the
   same touch sequence, so they're disambiguated here by touch count + movement threshold.
   Both branches bail out cheaply when the device doesn't support the underlying capability. */
function lcTouchDist(t){
  var dx=t[0].clientX-t[1].clientX, dy=t[0].clientY-t[1].clientY;
  return Math.sqrt(dx*dx+dy*dy);
}
function lcPinchStart(e){
  if(!e.touches) return;
  if(e.touches.length===2 && lcZoomCaps){
    lcPinchStartDist=lcTouchDist(e.touches);
    lcPinchStartZoom=lcZoomCurrent;
    _lcTouchStartPt=null;
  } else if(e.touches.length===1){
    var t=e.target;
    if(t.closest && t.closest('button,input,.lc-zoom-row,.lc-exposure-col')){
      _lcTouchStartPt=null;
      return;
    }
    _lcTouchStartPt={x:e.touches[0].clientX, y:e.touches[0].clientY};
    _lcTouchMoved=false;
  }
}
function lcPinchMove(e){
  if(!e.touches) return;
  if(e.touches.length===2 && lcZoomCaps && lcPinchStartDist){
    e.preventDefault();
    var ratio=lcTouchDist(e.touches)/lcPinchStartDist;
    applyLcZoom(lcPinchStartZoom*ratio, true);
    return;
  }
  if(e.touches.length===1 && _lcTouchStartPt){
    var dx=e.touches[0].clientX-_lcTouchStartPt.x, dy=e.touches[0].clientY-_lcTouchStartPt.y;
    if(Math.sqrt(dx*dx+dy*dy) > 12) _lcTouchMoved=true;
  }
}
function lcPinchEnd(e){
  lcPinchStartDist=0;
  _lcLastTouchTime=Date.now();
  if(_lcTouchStartPt && !_lcTouchMoved){
    lcDoFocusAt(_lcTouchStartPt.x, _lcTouchStartPt.y);
  }
  _lcTouchStartPt=null; _lcTouchMoved=false;
}
function lcFrameClick(e){
  // Ignore the synthetic click that follows a touch tap — already handled in lcPinchEnd.
  if(Date.now() - _lcLastTouchTime < 600) return;
  // Ignore taps on the flash/zoom/exposure controls that live inside the frame —
  // those already have their own handlers and shouldn't also trigger a focus tap.
  if(e.target.closest && e.target.closest('button,input,.lc-zoom-row,.lc-exposure-col')) return;
  lcDoFocusAt(e.clientX, e.clientY);
}
function finishLiveStill(blob){
  var btn=$('lcShutterBtn'); if(btn) btn.disabled=false;
  if(!blob){ toast('Không chụp được ảnh, thử lại'); return; }
  croppedBlob=blob; isVideo=false; originalFile=null;
  $('previewImg').src=URL.createObjectURL(blob);
  $('previewImg').classList.remove('hidden');
  $('previewVid').classList.add('hidden');
  $('uploadActions').classList.remove('hidden');
  stopLiveCamera();
  $('liveCam').classList.add('hidden');
  $('previewBox').classList.remove('hidden');
}
function canvasCaptureFromVideo(v){
  /* Crop the SAME region object-fit:cover shows in the square frame — WYSIWYG.
     Square frame + cover ⇒ center crop of the shorter video axis. */
  var vw=v.videoWidth, vh=v.videoHeight;
  if(!vw || !vh) return null;
  var size=Math.min(vw,vh);
  var sx=(vw-size)/2, sy=(vh-size)/2;
  var out=document.createElement('canvas');
  out.width=CAPTURE_SIZE; out.height=CAPTURE_SIZE;
  var ctx=out.getContext('2d');
  if(lcFacing==='user'){ ctx.translate(CAPTURE_SIZE,0); ctx.scale(-1,1); }
  ctx.imageSmoothingEnabled=true;
  try{ ctx.imageSmoothingQuality='high'; }catch(e){}
  ctx.drawImage(v, sx, sy, size, size, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE);
  return out;
}
function captureLivePhoto(e){
  if(e)e.preventDefault();
  const v=$('lcVideo');
  if(!v || !v.videoWidth) return;
  const btn=$('lcShutterBtn'); btn.disabled=true;
  const overlay=$('lcFlashOverlay');
  if(overlay){ overlay.classList.add('fire'); setTimeout(function(){ overlay.classList.remove('fire'); },120); }

  if(lcTrack && lcTrack.applyConstraints){
    try{
      lcTrack.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] }).catch(function(){
        try{ lcTrack.applyConstraints({ focusMode: 'single-shot' }); }catch(e2){}
      });
    }catch(e){}
  }

  // Always capture from the live video element so the photo matches what the user sees.
  // ImageCapture.takePhoto() often returns a different FOV/lens than the preview track
  // (especially with multi-cam zoom), which caused "preview one way, photo another".
  var settleMs = 160;
  setTimeout(function(){
    try{
      // Prefer grabFrame when available — same track frames as preview, full res
      if(window.ImageCapture && lcTrack){
        try{
          var ic = new ImageCapture(lcTrack);
          if(ic.grabFrame){
            ic.grabFrame().then(function(bmp){
              var side=Math.min(bmp.width, bmp.height);
              var sx=(bmp.width-side)/2, sy=(bmp.height-side)/2;
              var c=document.createElement('canvas');
              c.width=CAPTURE_SIZE; c.height=CAPTURE_SIZE;
              var ctx=c.getContext('2d');
              ctx.imageSmoothingEnabled=true;
              try{ ctx.imageSmoothingQuality='high'; }catch(e){}
              if(lcFacing==='user'){ ctx.translate(CAPTURE_SIZE,0); ctx.scale(-1,1); }
              ctx.drawImage(bmp, sx, sy, side, side, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE);
              try{ bmp.close(); }catch(e){}
              c.toBlob(function(b){ finishLiveStill(b); }, 'image/jpeg', CAPTURE_JPEG_Q);
            }).catch(function(){ fromVideoEl(); });
            return;
          }
        }catch(e){}
      }
      fromVideoEl();
    }catch(err){
      btn.disabled=false;
      toast('Không chụp được ảnh');
    }
  }, settleMs);

  function fromVideoEl(){
    try{
      var canvas=canvasCaptureFromVideo(v);
      if(!canvas){ btn.disabled=false; toast('Camera chưa sẵn sàng'); return; }
      canvas.toBlob(function(b){ finishLiveStill(b); }, 'image/jpeg', CAPTURE_JPEG_Q);
    }catch(err){
      btn.disabled=false;
      toast('Không chụp được ảnh');
    }
  }
}

/* ===================== Live camera: Photo/Video mode switch ===================== */
// MediaRecorder only exists on Safari 14.3+/iOS 14.3+ — iPhone 6 tops out at iOS 12.5.7,
// so it never has it. Hide the Video mode entirely there instead of showing a button that
// would just fail — same "only offer what the device can actually do" approach as zoom/focus.
function setupLcModeSwitch(){
  const row=$('lcModeRow');
  if(!row) return;
  const supported = (typeof MediaRecorder!=='undefined');
  row.classList.toggle('hidden', !supported);
  setLcCaptureMode('photo');
}
function setLcCaptureMode(mode){
  if(lcRecorder && lcRecorder.state==='recording') return; // don't switch mid-recording
  lcCaptureMode = mode;
  const row=$('lcModeRow');
  if(row){
    var btns=row.querySelectorAll('.lc-mode-btn');
    for(var i=0;i<btns.length;i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-mode')===mode);
  }
  const shutter=$('lcShutterBtn');
  if(shutter) shutter.setAttribute('aria-label', mode==='video' ? 'Quay video' : 'Chụp');
}
function onLcShutterTap(e){
  if(e)e.preventDefault();
  if(lcCaptureMode==='video'){
    if(lcRecorder && lcRecorder.state==='recording') lcStopRecording(false);
    else lcStartRecording();
  } else {
    captureLivePhoto(e);
  }
}
function pickLcMimeType(){
  var candidates=['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for(var i=0;i<candidates.length;i++){
    try{ if(MediaRecorder.isTypeSupported(candidates[i])) return candidates[i]; }catch(e){}
  }
  return '';
}
function lcStartRecording(){
  if(!lcStream || lcRecorder) return;
  var mime=pickLcMimeType();
  try{
    lcRecorder = mime ? new MediaRecorder(lcStream, {mimeType:mime}) : new MediaRecorder(lcStream);
  }catch(e){
    toast('Trình duyệt không hỗ trợ quay video'); return;
  }
  lcRecordedChunks=[];
  lcRecorder.ondataavailable=function(ev){ if(ev.data && ev.data.size) lcRecordedChunks.push(ev.data); };
  lcRecorder.onstop=function(){ finishVideoCapture(); };
  lcRecorder.start(250);
  lcRecordStartTs=Date.now();
  const shutter=$('lcShutterBtn'); if(shutter) shutter.classList.add('recording');
  const rt=$('lcRecordTime'); if(rt) rt.classList.add('show');
  lcRecordTimer=setInterval(lcTickRecordTimer, 200);
  lcTickRecordTimer();
}
function lcTickRecordTimer(){
  var ms=Date.now()-lcRecordStartTs;
  var s=Math.floor(ms/1000);
  var txt=$('lcRecordTimeText');
  if(txt) txt.textContent='0:'+(s<10?'0':'')+s;
  if(ms>=LC_MAX_RECORD_MS) lcStopRecording(false);
}
function lcStopRecording(discard){
  if(lcRecordTimer){ clearInterval(lcRecordTimer); lcRecordTimer=null; }
  const shutter=$('lcShutterBtn'); if(shutter) shutter.classList.remove('recording');
  const rt=$('lcRecordTime'); if(rt) rt.classList.remove('show');
  if(!lcRecorder) return;
  if(discard){
    try{ if(lcRecorder.state!=='inactive') lcRecorder.stop(); }catch(e){}
    lcRecordedChunks=[];
    lcRecorder=null;
    return;
  }
  try{
    if(lcRecorder.state!=='inactive') lcRecorder.stop();
  }catch(e){ lcRecorder=null; }
}
function finishVideoCapture(){
  var mime=(lcRecorder && lcRecorder.mimeType) || 'video/webm';
  var blob=new Blob(lcRecordedChunks, {type:mime});
  lcRecordedChunks=[];
  lcRecorder=null;
  if(!blob.size){ toast('Không quay được video, thử lại nhé'); return; }
  const ext = mime.indexOf('mp4')>=0 ? 'mp4' : 'webm';
  croppedBlob=blob;
  isVideo=true;
  originalFile={name:'lc_video_'+Date.now()+'.'+ext};
  $('previewVid').src=URL.createObjectURL(blob);
  $('previewVid').classList.remove('hidden');
  $('previewImg').classList.add('hidden');
  $('uploadActions').classList.remove('hidden');
  stopLiveCamera();
  $('liveCam').classList.add('hidden');
  $('previewBox').classList.remove('hidden');
}

/* ===================== Offline upload queue (IndexedDB) ===================== */
const QDB_NAME='locket_upload_queue_v1', QDB_STORE='jobs';
let _qdb=null, _queueFlushing=false;
function openQdb(){
  return new Promise((resolve,reject)=>{
    if(_qdb){resolve(_qdb);return}
    const req=indexedDB.open(QDB_NAME,1);
    req.onupgradeneeded=()=>{const db=req.result; if(!db.objectStoreNames.contains(QDB_STORE)) db.createObjectStore(QDB_STORE,{keyPath:'id'});};
    req.onsuccess=()=>{_qdb=req.result; resolve(_qdb)};
    req.onerror=()=>reject(req.error);
  });
}
function qAll(){
  return openQdb().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(QDB_STORE,'readonly');
    const req=tx.objectStore(QDB_STORE).getAll();
    req.onsuccess=()=>resolve((req.result||[]).sort((a,b)=>a.created-b.created));
    req.onerror=()=>reject(req.error);
  }));
}
function qPut(job){
  return openQdb().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(QDB_STORE,'readwrite');
    tx.objectStore(QDB_STORE).put(job);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  }));
}
function qDel(id){
  return openQdb().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(QDB_STORE,'readwrite');
    tx.objectStore(QDB_STORE).delete(id);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  }));
}
function blobToDataUrl(blob){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(r.result);
    r.onerror=()=>reject(r.error);
    r.readAsDataURL(blob);
  });
}
function dataUrlToBlob(dataUrl){
  const parts=String(dataUrl).split(',');
  const mime=(parts[0].match(/:(.*?);/)||[])[1]||'image/jpeg';
  const bin=atob(parts[1]);
  const arr=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return new Blob([arr],{type:mime});
}
function statusLabel(st){
  if(st==='pending') return 'Chờ mạng…';
  if(st==='uploading') return 'Đang đăng…';
  if(st==='error') return 'Lỗi — sẽ thử lại';
  if(st==='done') return 'Đã đăng';
  return st||'';
}
async function renderQueue(){
  const box=$('queueBox'), list=$('queueList'), count=$('queueCount');
  if(!box) return;
  let jobs=[];
  try{ jobs=await qAll(); }catch(e){ console.warn(e); }
  // hide completed after a while conceptually — we delete on success
  if(!jobs.length){ box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  if(count) count.textContent=jobs.length;
  list.innerHTML='';
  jobs.forEach(j=>{
    const row=document.createElement('div');
    row.className='queue-item';
    const thumb=j.preview||'';
    row.innerHTML=`
      ${thumb?`<img src="${esc(thumb)}" alt="">`:`<div style="width:44px;height:44px;border-radius:10px;background:#222"></div>`}
      <div class="qi-info">
        <div class="qi-title">${esc(j.caption||'(không chú thích)')}</div>
        <div class="qi-status ${esc(j.status)}">${esc(statusLabel(j.status))}${j.error?': '+esc(j.error):''}</div>
      </div>`;
    list.appendChild(row);
  });
}
async function enqueueUpload(blob, caption, filename, contentType){
  const id='j_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
  let preview='';
  try{ if(blob.type&&blob.type.startsWith('image')) preview=await blobToDataUrl(blob); }catch(e){}
  let dataUrl='';
  try{ dataUrl=await blobToDataUrl(blob); }catch(e){ toast('Không lưu được ảnh offline'); throw e; }
  const job={id, created:Date.now(), caption:caption||'', filename, contentType, dataUrl, preview, status:'pending', error:''};
  await qPut(job);
  await renderQueue();
  return job;
}
/* Backoff schedule for jobs the server actively rejects (not just offline) —
   keeps a flaky connection from hammering /api/upload every tick while the
   page happens to stay open. Network errors (offline mid-request) reset to
   immediate retry since those aren't the server's fault. */
var QUEUE_BACKOFF_MS = [5000, 15000, 30000, 60000, 120000, 300000];
async function postJob(job){
  job.status='uploading'; job.error='';
  await qPut(job); await renderQueue();
  const blob=dataUrlToBlob(job.dataUrl);
  const fd=new FormData();
  fd.append('file', blob, job.filename||'moment.jpg');
  fd.append('caption', job.caption||'');
  try{
    const d=await api('/api/upload',{method:'POST',body:fd});
    if(d&&d.ok){
      await qDel(job.id);
      // Do NOT wipe momentsCache — mark stale so next open merges, old posts stay visible
      momentsUpdatedAt=0;
      momentsLoaded=false;
      await renderQueue();
      return true;
    }
    job.attempts=(job.attempts||0)+1;
    job.status='error'; job.error=(d&&d.error)||'Đăng thất bại';
    job.nextTry=Date.now()+QUEUE_BACKOFF_MS[Math.min(job.attempts-1, QUEUE_BACKOFF_MS.length-1)];
    await qPut(job); await renderQueue();
    return false;
  }catch(err){
    // Request never reached the server (offline mid-flight, DNS, etc) — not the
    // job's fault, so don't burn a backoff step; just wait for real connectivity.
    job.status='pending'; job.error=''; job.nextTry=0;
    await qPut(job); await renderQueue();
    return false;
  }
}
async function flushQueue(){
  if(_queueFlushing) return;
  if(!navigator.onLine) return;
  _queueFlushing=true;
  try{
    const jobs=await qAll();
    const now=Date.now();
    for(const j of jobs){
      if(!navigator.onLine) break;
      if(j.status==='done'){ await qDel(j.id); continue; }
      if(j.nextTry && j.nextTry>now) continue; // still backing off, try next job instead
      const ok=await postJob(j);
      if(!ok && j.status==='error') continue; // try next; errors stay for retry
    }
  }finally{
    _queueFlushing=false;
    await renderQueue();
  }
}
/* There's no true background delivery on iOS Safari (no Background Sync API,
   even in installed/Home-Screen PWAs) — a queued moment can only actually leave
   the device while this tab/app is open and foregrounded. This ticker is the
   closest practical substitute: as long as the person has the tab open (even
   just sitting on another page inside the app), it keeps quietly retrying
   instead of waiting for a single 'online' event that iOS may not always fire
   reliably. Nothing sends while the tab is closed or the phone is locked/off. */
var _queueTicker=null;
function startQueueTicker(){
  if(_queueTicker) return;
  _queueTicker=setInterval(function(){
    if(document.visibilityState==='visible' && navigator.onLine) flushQueue();
  }, 20000);
}
function updateOnlineUI(){
  const b=$('offlineBanner');
  if(b) b.classList.toggle('show', !navigator.onLine);
}
function toggleAutoCamera(on){
  try{ localStorage.setItem('locket_auto_camera', on?'1':'0'); }catch(e){}
  // If user turns it on while already on the site, jump to camera now
  if(on){
    setTimeout(function(){
      showPage('upload');
      if(!isLiveCamera()) setTimeout(function(){ triggerCamera(); }, 280);
      else setTimeout(function(){ scrollUploadCameraIntoView(); }, 200);
    }, 50);
  }
}
function isAutoCamera(){
  try{ return localStorage.getItem('locket_auto_camera')==='1'; }catch(e){ return false; }
}
function toggleLowPower(on){
  setLowPower(on);
  LC_WIDTH_IDEAL = on ? 960 : 1920;
  LC_HEIGHT_IDEAL = on ? 960 : 1080;
  LC_FRAMERATE_IDEAL = on ? 15 : 30;
  CAPTURE_SIZE = on ? 720 : 1080;
  CAPTURE_JPEG_Q = on ? 0.82 : 0.93;
  toast(on ? 'Đã bật chế độ máy yếu' : 'Đã tắt chế độ máy yếu');
  // Re-open the live camera with the new constraints if it's currently running
  if(lcStream) startLiveCamera();
}
function maybeAutoCamera(){
  if(!isAutoCamera()) return;
  // Always switch to Đăng. Live camera mode opens in-page stream;
  // otherwise open the system camera picker (capture=environment).
  setTimeout(function(){
    showPage('upload');
    if(!isLiveCamera()){
      setTimeout(function(){ triggerCamera(); }, 350);
    } else {
      setTimeout(function(){ scrollUploadCameraIntoView(); }, 200);
      setTimeout(function(){ scrollUploadCameraIntoView(); }, 500);
    }
  }, 350);
}

/* ===================== Upload: send ===================== */
function doUpload(){
  if(!croppedBlob){toast('Chọn ảnh hoặc video trước đã');return}
  const cap=$('caption').value,btn=$('uploadBtn');
  const filename=isVideo?(originalFile?originalFile.name:'video.mp4'):'moment.jpg';
  const ct=(croppedBlob.type)||(isVideo?'video/mp4':'image/jpeg');
  btn.innerHTML='<span class="spinner"></span> Đang xử lý...';btn.disabled=true;

  const finishOk=()=>{
    btn.innerHTML='Gửi cho tất cả bạn bè';btn.disabled=false;
    toast(navigator.onLine?'Đã đăng!':'Đã lưu — sẽ tự đăng khi có mạng');
    $('caption').value=''; clearUpload();
  };
  const finishFail=(msg)=>{
    btn.innerHTML='Gửi cho tất cả bạn bè';btn.disabled=false;
    toast(msg||'Đăng thất bại');
  };

  const directUpload=()=>{
    // Videos skip the base64/IndexedDB queue entirely: atob()-ing a multi-MB
    // video into memory is exactly the kind of allocation that kills the tab
    // on an iPhone 6. Photos are already small (compressed before this point)
    // so the offline queue stays safe for them.
    const fd=new FormData();
    fd.append('file',croppedBlob,filename);
    fd.append('caption',cap);
    if(isVideo && videoCropPayload) fd.append('cropPayload', videoCropPayload);
    api('/api/upload',{method:'POST',body:fd}).then(d=>{
      if(d.ok){ finishOk(); momentsLoaded=false; momentsUpdatedAt=0; /* keep momentsCache — avoid empty flash on iPhone 6 */ }
      else finishFail(d.error||'Đăng thất bại');
    }).catch(()=>finishFail('Lỗi mạng khi đăng'));
  };

  if(isVideo){
    if(!navigator.onLine){ finishFail('Mất mạng — video không thể lưu offline, thử lại khi có mạng'); return; }
    directUpload();
    return;
  }

  // Always enqueue for durability; if online, flush immediately in order
  enqueueUpload(croppedBlob, cap, filename, ct).then(job=>{
    if(!navigator.onLine){
      finishOk();
      return;
    }
    return postJob(job).then(ok=>{
      if(ok) finishOk();
      else finishFail(job.error||'Đăng thất bại — đã giữ trong hàng đợi');
    });
  }).catch(err=>{
    console.error(err);
    // fallback: try direct upload if queue failed (e.g. private mode no IDB)
    if(!navigator.onLine){ finishFail('Không lưu offline được trên trình duyệt này'); return; }
    directUpload();
  });
}

function doLogout(){api('/api/logout').then(()=>location.reload())}

/* boot */
loadMe();
preloadFriends();
preloadMoments();
bindMomentsClickDelegation();
(function bindLcPinchZoom(){
  var frame=document.querySelector('#liveCam .lc-frame');
  if(!frame) return;
  frame.addEventListener('touchstart', lcPinchStart, {passive:true});
  frame.addEventListener('touchmove', lcPinchMove, {passive:false});
  frame.addEventListener('touchend', lcPinchEnd, {passive:true});
  frame.addEventListener('touchcancel', lcPinchEnd, {passive:true});
  frame.addEventListener('click', lcFrameClick);
})();
updateOnlineUI();
renderQueue().then(()=>flushQueue());
startQueueTicker();
window.addEventListener('focus',function(){ if(navigator.onLine) flushQueue(); });
window.addEventListener('online',function(){
  updateOnlineUI();
  toast('Đã có mạng — đang đăng hàng đợi');
  flushQueue();
  // Coming back online: soft cache is untrusted (may be hours old while offline).
  // Invalidate timers and force a real fetch so Moments are not stuck on stale local data.
  momentsUpdatedAt = 0;
  try{
    var ml0=readMomentsLocal();
    if(ml0){
      ml0.ts = 0;
      // keep items for instant paint, but mark age expired
      localStorage.setItem(MOMENTS_LS_KEY, JSON.stringify({
        moments: ml0.moments||[],
        updated_at: 0,
        ts: 0
      }));
    }
  }catch(e){}
  preloadMoments();
  if($('page-moments') && $('page-moments').classList.contains('active')){
    ensureMomentsFromCache();
    loadMoments(true);
  }
});
window.addEventListener('offline',function(){ updateOnlineUI(); toast('Mất mạng — ảnh mới sẽ lưu máy'); });
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='visible'){
    if(navigator.onLine) flushQueue();
    const gap = _momentsHiddenAt ? (Date.now() - _momentsHiddenAt) : 0;
    const local=readFriendsLocal();
    if(!local || Date.now()-(local.ts||0)>FRIENDS_TTL_MS) loadFriends(false);

    var ml=readMomentsLocal();
    var cacheAge = ml ? (Date.now()-(ml.ts||0)) : 999999;
    // After long background / offline stretch → force network; keep painting local meanwhile
    if(navigator.onLine && (cacheAge > 30000 || gap > 60000)){
      momentsUpdatedAt = 0;
      preloadMoments();
    } else if(!ml || Date.now()-(ml.ts||0)>MOMENTS_TTL_MS) {
      preloadMoments();
    }

    const momentsActive = $('page-moments') && $('page-moments').classList.contains('active');
    if(momentsActive){
      ensureMomentsFromCache();
      var grid=$('momentsGrid'), feed=$('momentsFeed');
      var hasDom = (grid && grid.children.length) || (feed && feed.children.length);
      if(gap > 15000 || !hasDom || cacheAge > 30000){
        loadMoments(true);
        bindMomentsScroll();
      } else {
        pollMomentsOnce();
      }
    }
    if($('page-upload') && $('page-upload').classList.contains('active') && isLiveCamera() && !croppedBlob && !lcStream){
      startLiveCamera();
    }
  } else {
    _momentsHiddenAt = Date.now();
    stopLiveCamera();
  }
});
window.addEventListener('pageshow', function(e){
  if(e.persisted){
    // BFCache restore: luôn force fetch moments nếu online
    if(navigator.onLine){
      momentsUpdatedAt = 0; // invalidate soft cache
    }
    const momentsActive = $('page-moments') && $('page-moments').classList.contains('active');
    if(momentsActive){
      ensureMomentsFromCache();
      loadMoments(true); // force
      bindMomentsScroll();
    } else {
      ensureMomentsFromCache();
    }
  }
});
window.addEventListener('pagehide', stopLiveCamera);
window.addEventListener('resize', function(){
  if($('liveCam') && !$('liveCam').classList.contains('hidden')) _sizeLcFrame();
});
window.addEventListener('orientationchange', function(){
  setTimeout(function(){
    if($('liveCam') && !$('liveCam').classList.contains('hidden')){
      _sizeLcFrame();
      scrollUploadCameraIntoView();
    }
  }, 200);
});
(function initAutoCamera(){
  const sw=$('autoCameraSwitch');
  if(sw) sw.checked=isAutoCamera();
  maybeAutoCamera();
})();
(function initLiveCamera(){
  const sw=$('liveCameraSwitch');
  if(sw) sw.checked=isLiveCamera();
})();
(function initLowPower(){
  const sw=$('lowPowerSwitch');
  if(sw) sw.checked=isLowPower();
})();
if('serviceWorker' in navigator){
  setTimeout(function(){
    navigator.serviceWorker.register('/sw.js').catch(function(){});
  }, 1500);
}
{% endif %}
</script>
</body>
</html>
"""


# ============================================================
# Flask app + routes
# ============================================================

from datetime import timedelta

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY") or os.urandom(24)
app.config["MAX_CONTENT_LENGTH"] = 60 * 1024 * 1024
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)


def get_session() -> Optional[LocketSession]:
    tok = session.get("token")
    lid = session.get("local_id")
    if not tok or not lid:
        return None
    return LocketSession(
        id_token=tok, refresh_token=session.get("refresh_token"), local_id=lid,
        email=session.get("email", ""), display_name=session.get("display_name", ""),
        photo_url=session.get("photo_url", ""), ua=session.get("ua") or WEB_UA_POOL[0],
    )


@app.route("/")
def index():
    s = get_session()
    return render_template_string(
        HTML,
        logged_in=bool(s),
        gold_badge=GOLD_BADGE, celeb_badge=CELEB_BADGE,
        font_url=FONT_URL, favicon_url=FAVICON_URL,
        boot_name=(s.display_name if s else ""),
        boot_photo=(s.photo_url if s else ""),
        boot_email=(s.email if s else ""),
    )


@app.route("/manifest.webmanifest")
def web_manifest():
    from flask import Response
    import json as _json
    data = {
        "name": "Locket Mini",
        "short_name": "Locket Mini",
        "description": "Xem và đăng khoảnh khắc với bạn bè",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#000000",
        "theme_color": "#000000",
        "orientation": "portrait",
        "icons": [
            {"src": FAVICON_URL, "sizes": "180x180", "type": "image/png", "purpose": "any maskable"},
        ],
    }
    return Response(_json.dumps(data), mimetype="application/manifest+json")


@app.route("/sw.js")
def service_worker():
    from flask import Response
    # Offline shell + cache API images / static CDN for repeat visits
    js = r"""
const CACHE='locket-mini-v1';
const PRE=[
  '/',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js'
];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(PRE)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const req=e.request;
  const url=new URL(req.url);
  if(req.method!=='GET') return;
  // Cache-first for proxied images (offline-friendly after first view)
  if(url.pathname==='/api/img'){
    e.respondWith(
      caches.open(CACHE).then(async c=>{
        const hit=await c.match(req);
        if(hit) return hit;
        try{
          const res=await fetch(req);
          if(res && res.ok) c.put(req, res.clone());
          return res;
        }catch(err){
          return hit || Response.error();
        }
      })
    );
    return;
  }
  // Network-first for app shell / API JSON; fall back to cache offline
  if(url.origin===self.location.origin){
    e.respondWith(
      fetch(req).then(res=>{
        if(res && res.ok && (url.pathname==='/' || url.pathname.endsWith('.css') || url.pathname.endsWith('.js'))){
          const copy=res.clone();
          caches.open(CACHE).then(c=>c.put(req, copy));
        }
        return res;
      }).catch(()=>caches.match(req).then(r=>r||caches.match('/')))
    );
  }
});
"""
    resp = Response(js, mimetype="application/javascript")
    resp.headers["Service-Worker-Allowed"] = "/"
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""
    remember = bool(data.get("remember"))
    if not email or not password:
        return jsonify({"ok": False, "error": "Nhập email và mật khẩu"})
    try:
        s, _dbg = login(email, password)
        session.permanent = remember
        session["token"] = s.id_token
        session["local_id"] = s.local_id
        session["refresh_token"] = s.refresh_token
        session["email"] = s.email
        session["display_name"] = s.display_name
        session["photo_url"] = s.photo_url
        session["ua"] = s.ua
        session["token_issued_at"] = time.time()
        session["remember"] = remember
        return jsonify({
            "ok": True,
            "me": {
                "display_name": s.display_name,
                "photo_url": s.photo_url,
                "email": s.email,
                "local_id": s.local_id,
            },
        })
    except LoginError as e:
        logger.error("LOGIN failed: %s", e.friendly)
        return jsonify({"ok": False, "error": e.friendly})
    except Exception as e:
        logger.error("LOGIN unexpected error: %s", e)
        return jsonify({"ok": False, "error": f"Lỗi không xác định: {e}"})


@app.route("/api/logout", methods=["GET", "POST"])
def api_logout():
    lid = session.get("local_id")
    if lid:
        stop_moments_live(lid)
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/me")
def api_me():
    s = get_session()
    if not s:
        return jsonify({"ok": False, "error": "Not logged in"})
    try:
        s = ensure_fresh_token(s)
        info, _dbg = get_self_info(s)
        info["email"] = s.email
        # Prefer the richer display name we already got at login when getInfo is sparse
        if not info.get("first_name") and s.display_name:
            info["first_name"] = s.display_name
        if not info.get("profile_picture_url") and s.photo_url:
            info["profile_picture_url"] = s.photo_url
        return jsonify({"ok": True, "me": info})
    except Exception as e:
        logger.error("ME error: %s", e)
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/friends")
def api_friends():
    s = get_session()
    if not s:
        return jsonify({"ok": False, "error": "Not logged in"})
    try:
        s = ensure_fresh_token(s)
        friends, _dbg = get_friends(s)
        return jsonify({"ok": True, "friends": friends, "count": len(friends)})
    except Exception as e:
        logger.error("FRIENDS error: %s", e)
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/moments")
def api_moments():
    s = get_session()
    if not s:
        return jsonify({"ok": False, "error": "Not logged in"})
    try:
        s = ensure_fresh_token(s)
        force = request.args.get("force") == "1"
        items = get_moments_cached(s, force=force)
        st = _MOMENTS_CACHE.get(s.local_id) or {}
        return jsonify({
            "ok": True,
            "moments": items,
            "count": len(items),
            "updated_at": st.get("updated_at") or time.time(),
            "cached": not force and bool(st.get("bootstrapped")),
            "force": force,
        })
    except Exception as e:
        logger.error("MOMENTS error: %s", e)
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/moments/poll")
def api_moments_poll():
    """Lightweight live poll — returns full list only when cache was updated after `since`."""
    s = get_session()
    if not s:
        return jsonify({"ok": False, "error": "Not logged in"})
    try:
        s = ensure_fresh_token(s)
        since = float(request.args.get("since") or 0)
        items, updated = poll_new_moments(s, since=since)
        return jsonify({
            "ok": True,
            "moments": items,
            "updated_at": updated,
            "changed": bool(items) and updated > since,
        })
    except Exception as e:
        logger.error("MOMENTS POLL error: %s", e)
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/img")
def api_img():
    from flask import Response
    from urllib.parse import unquote, urlsplit, urlunsplit, quote
    url = (request.args.get("u") or "").strip()
    if "%252F" in url or "%253F" in url or "%2526" in url:
        url = unquote(url)
    if not url.startswith("https://"):
        return jsonify({"ok": False, "error": "bad url"}), 400
    try:
        max_side = int(request.args.get("w") or 720)
    except Exception:
        max_side = 720
    max_side = max(64, min(max_side, 1280))
    try:
        parts = urlsplit(url)
        path = parts.path or ""
        marker = "/o/"
        if marker in path:
            pre, obj = path.split(marker, 1)
            if "/" in obj and "%2F" not in obj.upper():
                obj = quote(obj, safe="")
            path = pre + marker + obj
            url = urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))
    except Exception:
        pass
    
    # Smart convert: chỉ ép JPEG khi browser không hỗ trợ Webp HOẶC cần resize
    client_supports_webp = request.args.get("webp") == "1"
    needs_resize = max_side < 1080  # nếu xin thumb nhỏ thì vẫn resize
    try:
        if client_supports_webp and not needs_resize and (url.lower().endswith(".webp") or "image/webp" in (request.headers.get("Accept") or "")):
            # Pass-through: redirect hoặc proxy gốc
            r = _http.get(url, timeout=15, headers={"User-Agent": IOS_UA, "Accept": "image/webp,image/*,*/*;q=0.8"})
            r.raise_for_status()
            ctype = (r.headers.get("Content-Type") or "image/webp").split(";")[0].strip()
            resp = Response(r.content, mimetype=ctype)
            resp.headers["Cache-Control"] = "public, max-age=900"
            return resp
    except Exception:
        pass

    try:
        force_convert = not client_supports_webp
        data, mime = fetch_image_as_jpeg(url, max_side=max_side, force_convert=force_convert)
        resp = Response(data, mimetype=mime)
        resp.headers["Cache-Control"] = "public, max-age=900"
        return resp
    except Exception as e:
        logger.warning("IMG PROXY fail %s: %s", url[:120], e)
        return jsonify({"ok": False, "error": str(e)}), 502

@app.route("/api/upload", methods=["POST"])
def api_upload():
    s = get_session()
    if not s:
        return jsonify({"ok": False, "error": "Not logged in"})
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file"})
    f = request.files["file"]
    caption = request.form.get("caption", "")
    crop_payload = request.form.get("cropPayload") or None
    if f.filename == "":
        return jsonify({"ok": False, "error": "Empty filename"})
    try:
        s = ensure_fresh_token(s)
        raw = f.read()
        ct = f.content_type or "application/octet-stream"
        is_video = "video" in ct
        if is_video:
            ext = f.filename.rsplit(".", 1)[-1] if "." in f.filename else "mp4"
            filename = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}.{ext}"
            result, _dbg = upload_media(s, raw, filename, ct, caption=caption, crop_payload=crop_payload)
        else:
            data, filename = compress_image(raw)
            result, _dbg = upload_media(s, data, filename, "image/jpeg", caption=caption)
        # Mark cache stale but KEEP items — client paints old posts while force-fetch merges new one
        with _MOMENTS_LOCK:
            st = _MOMENTS_CACHE.get(s.local_id)
            if st:
                st["last_fetch_at"] = 0
                # bootstrapped stays True so soft path can still serve until force merge
        return jsonify({"ok": True, "result": result})
    except requests.HTTPError as e:
        logger.error("UPLOAD http error: %s", e)
        return jsonify({"ok": False, "error": f"Upload bị từ chối ({e})"})
    except Exception as e:
        logger.error("UPLOAD error: %s", e)
        return jsonify({"ok": False, "error": str(e)})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    logger.info("Starting Locket Mini on http://0.0.0.0:%d", port)
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
