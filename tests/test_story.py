"""El ensayo (site/story.html) dice exactamente lo que dicen resultados/ y no inventa cifras."""
import json
import re
from html.parser import HTMLParser
from pathlib import Path

from allimite import historia

REPO = Path(__file__).resolve().parents[1]
STORY = REPO / "site" / "story.html"
CIFRAS = json.loads((REPO / "resultados" / "cifras.json").read_text("utf-8"))


class Texto(HTMLParser):
    """Texto visible y atributos legibles (aria-label, title, alt, content), sin <script> ni <style>."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.partes, self._salta = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._salta += 1
        for k, v in attrs:
            if k in ("aria-label", "title", "alt", "content") and v:
                self.partes.append(v)

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._salta -= 1

    def handle_data(self, data):
        if not self._salta:
            self.partes.append(data)


def texto(html: str) -> str:
    p = Texto()
    p.feed(html)
    return re.sub(r"\s+", " ", " ".join(p.partes))


def datos_embebidos(html: str) -> dict:
    m = re.search(r'<script type="application/json" id="story-data">(.*?)</script>', html, re.S)
    return json.loads(m.group(1).replace("<\\/", "</"))


def test_pagina_publicada_al_dia_con_resultados():
    # si cambia resultados/ y no se reconstruye el ensayo, este test falla: python -m allimite historia
    assert STORY.read_text("utf-8") == historia.pagina()


def test_cifras_clave_salen_de_resultados():
    ss, ob = CIFRAS["reglas"]["ss"], CIFRAS["reglas"]["obras"]
    t = texto(STORY.read_text("utf-8"))
    esperadas = [
        f"{ss['n_cerca']:,}", f"{round(ss['esperado']):,}", f"{ss['razon']:.2f}",
        f"{ss['ic_inf']:.2f}", f"{ss['ic_sup']:.2f}", f"{ss['n_ref']:,}",
        f"{ob['n_cerca']:,}", f"{round(ob['esperado']):,}", f"{ob['razon']:.2f}", f"{ob['ic_inf']:.2f}", f"{ob['ic_sup']:.2f}",
        f"{CIFRAS['embudo']['servicios_suministros']:,}", f"{CIFRAS['embudo']['obras']:,}",
        f"{CIFRAS['n_organos']:,}", f"{ss['niveles_organo']['senal']:,}",
        f"{CIFRAS['ia']['textos_del_modelo']:,}", f"{CIFRAS['ia']['borradores_rechazados']:,}",
        f"{ss['hist'][round(15000 / 200) - 1]:,}",
    ]
    faltan = [x for x in esperadas if x not in t]
    assert not faltan, faltan
    # el gancho: 14.999 € y su recuento real
    n14999 = next(f["n"] for f in ss["importes_frecuentes"] if f["importe"] == 14999.0)
    assert "€14,999" in t and f"{n14999:,} contracts for exactly that amount" in t
    # 68.251 frente a 19.009: 3,59 veces, como en DEVPOST
    assert f"{ss['n_cerca']:,} contracts in the last €1,000" in t


def test_graficos_usan_los_datos_de_resultados():
    D = datos_embebidos(STORY.read_text("utf-8"))
    ss, ob = CIFRAS["reglas"]["ss"], CIFRAS["reglas"]["obras"]
    assert D["ss"]["hist"] == ss["hist"] and D["obras"]["hist"] == ob["hist"]
    assert [p["razon"] for p in D["placebo"]] == [p["razon"] for p in CIFRAS["placebo_ss"]]
    assert [m["razon"] for m in D["ss"]["months"]] == [m["razon"] for m in ss["meses"]]
    assert sum(b["n"] for b in D["ss"]["bands"][:-1]) == ss["n_ref"]
    assert D["ss"]["bands"][-1]["n"] == ss["n_cerca"]
    for e, (uid, *_rest) in zip(D["ejemplos"], historia.EJEMPLOS):
        f = json.loads((REPO / "site" / "data" / "u" / f"{uid}.json").read_text("utf-8"))["reglas"]["ss"]
        assert (e["n_cerca"], e["razon"], e["ic_inf"], e["ic_sup"]) == (f["n_cerca"], f["razon"], f["ic_inf"], f["ic_sup"])


def test_plantilla_sin_cifras_escritas_a_mano():
    # Solo se permiten referencias legales, el nivel de confianza y el 1 de «razón neutra» (tantos como lo
    # esperable), que es una definición y no un dato; todo lo demás va por {{marcador}}.
    permitidas = {"9/2017", "118", "99.2", "54th", "95%", "1"}
    t = texto(re.sub(r"\{\{\w+\}\}", " ", historia.PLANTILLA.read_text("utf-8")))
    sueltas = {m.rstrip(".,") for m in re.findall(r"[\d][\d.,/%]*(?:st|nd|rd|th)?", t)} - permitidas
    assert not sueltas, sueltas


def test_ejemplos_anonimos_y_enlazados_a_la_fuente_oficial():
    html = STORY.read_text("utf-8")
    D = datos_embebidos(html)
    for uid, *_rest in historia.EJEMPLOS:
        nombre = json.loads((REPO / "site" / "data" / "u" / f"{uid}.json").read_text("utf-8"))["nombre"]
        assert nombre not in html and uid not in html
    items = D["timeline"]["items"]
    assert items and all(re.fullmatch(r"[A-Z]{1,3}", i["a"] or "A") for i in items)
    enlaces = re.findall(r'href="(https://contrataciondelestado\.es/[^"]+)"', html)
    assert len(enlaces) == sum(1 for i in items if i["u"])
    assert all(u.startswith(historia.EVL.replace("&", "&amp;")) for u in enlaces)


def test_pagina_ligera_sin_cargar_data():
    for f in ("story.html", "story.js"):
        s = (REPO / "site" / f).read_text("utf-8")
        assert not re.search(r"data/(u/|indice|nacional)", s), f
    assert len(STORY.read_bytes()) < 400_000
