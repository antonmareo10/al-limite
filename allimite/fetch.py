"""Descarga educada de los ZIP de contratos menores de la PLACSP.

Uso:  python -m allimite.fetch
Deja un manifiesto (raw/manifest.json) con URL, bytes, SHA-256, Last-Modified y
fecha de descarga de cada fichero. No vuelve a descargar lo que ya está completo.
"""
from __future__ import annotations

import hashlib
import json
import sys
import time
from datetime import datetime, timezone

import requests

from . import config

UA = "al-limite/0.1 (proyecto estudiantil de datos abiertos; descarga puntual)"


def _log(msg: str) -> None:
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


def descargar(periodos=None) -> dict:
    config.RAW.mkdir(parents=True, exist_ok=True)
    mpath = config.RAW / "manifest.json"
    manifest = json.loads(mpath.read_text("utf-8")) if mpath.exists() else {}
    total = sum(v["bytes"] for v in manifest.values())
    for periodo in periodos or config.PERIODOS:
        url = config.BASE_URL.format(periodo=periodo)
        dest = config.RAW / f"contratosMenores_{periodo}.zip"
        if periodo in manifest and dest.exists() and dest.stat().st_size == manifest[periodo]["bytes"]:
            _log(f"{periodo}: ya descargado ({manifest[periodo]['bytes']:,} bytes)")
            continue
        _log(f"{periodo}: descargando {url}")
        tmp = dest.with_suffix(".part")
        h = hashlib.sha256()
        n = 0
        with requests.get(url, headers={"User-Agent": UA}, stream=True, timeout=120) as r:
            r.raise_for_status()
            ctype = r.headers.get("Content-Type", "")
            if "zip" not in ctype:
                raise RuntimeError(f"{periodo}: respuesta inesperada ({ctype})")
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
                    h.update(chunk)
                    n += len(chunk)
                    if total + n > config.MAX_BYTES_TOTAL:
                        raise RuntimeError("Se superaría el tope de descarga; se detiene.")
                    if n // (200 << 20) > (n - len(chunk)) // (200 << 20):
                        _log(f"  {periodo}: {n / 1e6:,.0f} MB")
            last_mod = r.headers.get("Last-Modified")
        tmp.replace(dest)
        total += n
        manifest[periodo] = {
            "url": url,
            "fichero": dest.name,
            "bytes": n,
            "sha256": h.hexdigest(),
            "last_modified": last_mod,
            "descargado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        mpath.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), "utf-8")
        _log(f"{periodo}: hecho, {n:,} bytes, sha256 {h.hexdigest()[:16]}")
        time.sleep(config.PAUSA_S)
    _log(f"Total descargado: {total / 1e9:.2f} GB")
    return manifest


if __name__ == "__main__":
    descargar(sys.argv[1:] or None)
