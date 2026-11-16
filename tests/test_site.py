"""La portada enlaza ejemplos: deben existir en el índice y cubrir los tres niveles que anuncia."""
import json
import re
from pathlib import Path

SITE = Path(__file__).resolve().parents[1] / "site"


def test_ejemplos_de_portada_existen_y_cubren_tres_niveles():
    js = (SITE / "app.js").read_text("utf-8")
    ids = re.findall(r'"(\d+)"', re.search(r"const EXAMPLES = \[(.*?)\];", js).group(1))
    filas = {f[0]: f for f in json.loads((SITE / "data" / "indice.json").read_text("utf-8"))["filas"]}
    assert len(ids) == 3 and all(i in filas for i in ids)
    assert [filas[i][5] for i in ids] == ["senal", "indicio", "sin_senal"]
    assert all((SITE / "data" / "u" / f"{i}.json").exists() for i in ids)


def test_textos_de_interfaz_en_los_dos_idiomas():
    js = (SITE / "app.js").read_text("utf-8")
    usados = set(re.findall(r'data-t="(\w+)"', (SITE / "index.html").read_text("utf-8")))
    for clave in usados | {"ex_label"}:
        assert len(re.findall(rf"\b{clave}: ", js)) == 2, clave
