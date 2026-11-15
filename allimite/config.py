"""Rutas y constantes del proyecto. Todo lo configurable está aquí."""
from __future__ import annotations

import os
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("ALLIMITE_DATA", r"C:\Users\anton\data\slayhacks"))
RAW = DATA / "raw"
WORK = DATA / "work"
LOGS = DATA / "logs"
DB = WORK / "contratos.sqlite"
SITE = REPO / "site"
SITE_DATA = SITE / "data"
OUT = REPO / "resultados"

# Fuente: Plataforma de Contratación del Sector Público (PLACSP), datos abiertos,
# conjunto «Contratos menores de perfiles del contratante» (sindicación 1143).
BASE_URL = (
    "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_1143/"
    "contratosMenoresPerfilesContratantes_{periodo}.zip"
)
# Ficheros anuales que se descargan. El de 2026 (incremental) solo se usa para
# recoger correcciones y anulaciones tardías de contratos adjudicados hasta 2025.
PERIODOS = ["2023", "2024", "2025", "2026"]
MAX_BYTES_TOTAL = 4_500_000_000  # tope de descarga (se pidió no pasar de ~5 GB)
PAUSA_S = 5  # pausa entre ficheros

# Periodo de análisis: fecha de adjudicación entre estas dos fechas (inclusive).
FECHA_MIN = "2023-01-01"
FECHA_MAX = "2025-12-31"

# Ley 9/2017, art. 118.1: valor estimado inferior a 40.000 € (obras) o 15.000 €
# (suministros y servicios), IVA excluido.
UMBRAL = {"servicios_suministros": 15_000.0, "obras": 40_000.0}
