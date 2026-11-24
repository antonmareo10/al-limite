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


def test_fallos_de_la_ia_salen_de_explicaciones():
    # «How I made this»: recuento independiente de resultados/explicaciones.json (borradores, no motivos)
    expl = json.loads((REPO / "resultados" / "explicaciones.json").read_text("utf-8"))
    rech = [r for e in expl.values() for r in e["rechazos"]]
    en = sum(r["lang"] == "en" for r in rech)
    es = sum(r["lang"] == "es" for r in rech)
    cifras = sum(any(m.startswith("cifras: hay cifras en el apartado") for m in r["motivos"]) for r in rech)
    cita = sum(any("contrato que no existe" in m for m in r["motivos"]) for r in rech)
    tpl_en = sum(e["origen_en"] == "plantilla" for e in expl.values())
    primera = sum(not e["rechazos"] for e in expl.values())
    assert len(rech) == en + es == CIFRAS["ia"]["borradores_rechazados"]
    t = re.sub(r"\s+([,.;:])", r"\1", texto(STORY.read_text("utf-8")))
    for frase in (f"it failed {len(rech):,} times", f"threw out {en:,} in English and {es:,} in Spanish",
                  f"Most of them, {cifras:,}, had slipped a number", f"{cita:,} cited a contract that doesn't exist",
                  f"{tpl_en:,} of them in English", f"Only {primera:,} of the {len(expl):,} flagged bodies"):
        assert frase in t, frase


def test_enlaces_a_los_datos_en_bruto():
    hrefs = set(re.findall(r'href="([^"]+)"', STORY.read_text("utf-8")))
    for f in ("resultados/cifras.json", "resultados/explicaciones.json"):
        assert any(h.endswith(f) for h in hrefs), f
    assert historia.REPO_RAMA in hrefs
    # todo enlace al repo apunta a la rama del ensayo y a una ruta que existe en ella
    for h in hrefs:
        if h.startswith(historia.REPO):
            assert h == historia.REPO_RAMA or h.startswith(historia.REPO_RAMA + "/") or h.startswith(historia.FICHERO), h
        for pref in (historia.FICHERO, historia.CRUDO, historia.REPO_RAMA + "/"):
            if h.startswith(pref):
                assert (REPO / h[len(pref):]).exists(), h


def test_voz_del_autor_en_singular():
    # entrada individual: el autor dice «I»; ni «we» ni «our» en el texto visible
    t = texto(historia.PLANTILLA.read_text("utf-8"))
    assert not re.findall(r"\b(?:we|we'd|we're|we've|our|ours)\b", t, re.I)


def test_pagina_ligera_sin_cargar_data():
    for f in ("story.html", "story.js"):
        s = (REPO / "site" / f).read_text("utf-8")
        assert not re.search(r"data/(u/|indice|nacional)", s), f
    assert len(STORY.read_bytes()) < 400_000
