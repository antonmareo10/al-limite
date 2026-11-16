"""Comprobación independiente de las cifras nacionales.

Uso:  python -m allimite.check

Vuelve a contar las franjas con una consulta SQL escrita aparte (sin pandas ni el
código de `analyze.py`) y compara con `resultados/cifras.json`. Sale con error si
los recuentos junto al límite o de referencia no coinciden.
"""
from __future__ import annotations

import json
import sqlite3
import sys

from . import config

SQL = """
WITH base AS (
  SELECT c.organo_id, c.expediente, c.fecha_adj, c.adj_nif, c.tipo,
         CASE WHEN c.importe_sin_iva > 0 THEN c.importe_sin_iva ELSE c.presupuesto_sin_iva END AS imp
  FROM contratos c LEFT JOIN borrados b ON b.id = c.id
  WHERE (b.id IS NULL OR b.cuando < c.updated) AND c.estado <> 'ANUL'
    AND (c.resultado LIKE '%8%' OR c.resultado LIKE '%9%' OR c.resultado = '2')
    AND c.fecha_adj BETWEEN ? AND ?
), d AS (
  SELECT DISTINCT organo_id, expediente, fecha_adj, adj_nif, tipo,
         CAST(ROUND(imp * 100) AS INTEGER) AS cent
  FROM base WHERE imp > 0
)
SELECT CASE WHEN tipo = '3' THEN 'obras' ELSE 'ss' END AS regla,
  SUM(CASE WHEN tipo = '3' THEN cent > 3750000 AND cent <= 4000000 ELSE cent > 1400000 AND cent <= 1500000 END),
  SUM(CASE WHEN tipo = '3' THEN cent > 2500000 AND cent <= 3750000 ELSE cent > 900000 AND cent <= 1400000 END)
FROM d WHERE tipo IN ('1', '2', '3') GROUP BY 1
"""


def comprobar() -> bool:
    cifras = json.loads((config.OUT / "cifras.json").read_text("utf-8"))["reglas"]
    if not config.DB.exists():
        sys.exit(f"No encuentro la base de datos ({config.DB}). Esta comprobación recuenta los datos brutos: "
                 "ejecuta antes `python -m allimite todo` (o `descargar` y `leer`).\n"
                 f"Database not found ({config.DB}). This check recounts the raw data: "
                 "run `python -m allimite todo` first (or `descargar` and `leer`).")
    con = sqlite3.connect(f"file:{config.DB}?mode=ro", uri=True)
    ok = True
    for regla, cerca, ref in con.execute(SQL, (config.FECHA_MIN, config.FECHA_MAX)):
        c = cifras[regla]
        razon = round(cerca / (ref / 5), 2)
        igual = (cerca, ref, razon) == (c["n_cerca"], c["n_ref"], c["razon"])
        ok &= igual
        print(f"{regla}: junto al límite {cerca} (web {c['n_cerca']}), referencia {ref} (web {c['n_ref']}), "
              f"razón {razon} (web {c['razon']}) -> {'coincide' if igual else 'NO COINCIDE'}")
    return ok


if __name__ == "__main__":
    sys.exit(0 if comprobar() else 1)
