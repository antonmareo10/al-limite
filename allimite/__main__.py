"""Orden única del proyecto.

    python -m allimite todo        descarga, lee, analiza y (si hay servidor local) explica
    python -m allimite descargar   solo la descarga de la PLACSP
    python -m allimite leer        ZIP -> SQLite
    python -m allimite analizar    SQLite -> site/data y resultados/
    python -m allimite explicar    explicaciones con el modelo local (necesita llama-server)
    python -m allimite servir      sirve la web en http://127.0.0.1:8000
"""
from __future__ import annotations

import sys


def main(argv: list[str]) -> int:
    orden = argv[0] if argv else "ayuda"
    if orden in ("descargar", "todo"):
        from . import fetch
        fetch.descargar()
    if orden in ("leer", "todo"):
        from . import parse
        parse.cargar()
    if orden in ("analizar", "todo"):
        from . import analyze
        analyze.ejecutar()
    if orden in ("explicar", "todo"):
        from . import explain
        try:
            explain.generar(int(argv[1]) if len(argv) > 1 and argv[1].isdigit() else None)
        except explain.requests.ConnectionError:
            print("No hay servidor llama.cpp en 127.0.0.1:8089: se conservan las explicaciones guardadas "
                  "(ver README, apartado «IA»).")
            explain.fusionar()
    if orden == "servir":
        import functools
        import http.server
        from . import config
        h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(config.SITE))
        print("http://127.0.0.1:8000  (Ctrl+C para salir)")
        http.server.ThreadingHTTPServer(("127.0.0.1", 8000), h).serve_forever()
    if orden not in ("descargar", "leer", "analizar", "explicar", "servir", "todo"):
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
