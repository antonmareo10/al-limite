"""Ensayo visual en inglés («The €14,999 wall»): site/story.html a partir de los resultados.

    python -m allimite historia

Ninguna cifra del ensayo está escrita a mano. La plantilla (allimite/historia.html) solo lleva
marcadores {{clave}}; este módulo los rellena con lo que lee de resultados/cifras.json y de las
fichas de site/data/u/ de los tres ejemplos, genera las tablas de datos que acompañan a cada
gráfico y embebe en la página el JSON pequeño que dibuja los gráficos (story.js). La página no
carga site/data/: pesa unos pocos KB.

Cada afirmación cualitativa del texto («los picos están en precios redondos», «todos los años»,
«por debajo de 1»…) tiene aquí una comprobación: si los datos cambian y deja de ser cierta, la
construcción falla en vez de publicar una frase falsa. tests/test_story.py comprueba que la
página publicada es idéntica a una reconstrucción y que la plantilla no lleva cifras a mano.
"""
from __future__ import annotations

import html
import json
import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from . import config

PLANTILLA = Path(__file__).with_name("historia.html")
SALIDA = config.SITE / "story.html"

TOOL = "https://al-limite-two.vercel.app/"
METHOD = TOOL + "#/metodo"
REPO = "https://github.com/antonmareo10/al-limite"
RAMA = "story"  # rama pública con el ensayo, historia.py y los mismos resultados/
REPO_RAMA = f"{REPO}/tree/{RAMA}"
FICHERO = f"{REPO}/blob/{RAMA}/"  # + ruta dentro del repo (vista de GitHub)
CRUDO = f"https://raw.githubusercontent.com/antonmareo10/al-limite/{RAMA}/"  # + ruta (el fichero tal cual)
EVL = "https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl="

IVA = 21  # tipo general del IVA en España, en %
DESDE = {"ss": 6000, "obras": 15000}  # primer importe dibujado en los histogramas (como en la web)
PICOS = (10_000, 12_000)  # precios redondos que el texto cita como «picos»
EJ_DESDE, EJ_HASTA = 9000, 15400  # tramo dibujado en los histogramas de los ejemplos

# Los tres ejemplos de la portada de la herramienta (señal, indicio, sin señal). El ensayo no los
# nombra: los describe por tipo y región, y cada descripción se comprueba contra la ruta oficial.
EJEMPLOS = [
    ("30985210142281", "A city council in Galicia", ("ENTIDADES LOCALES", "Galicia", "Ayuntamientos"), "senal"),
    ("51362990180059", "A university in the Basque Country", ("UNIVERSIDADES", "País Vasco"), "indicio"),
    ("40000370000093", "A university in the Valencian Community", ("UNIVERSIDADES", "Comunidad Valenciana"), "sin_senal"),
]
NIVEL = {"senal": "Bunching signal", "indicio": "Weak hint", "sin_senal": "No signal", "insuficiente": "Sample too small"}
AMBITO = {
    "local": "Local government",
    "autonomico": "Regional governments",
    "estado": "Central government",
    "otras": "Other public bodies",
}
AMBITO_SUB = {
    "local": "town halls, provincial councils…",
    "autonomico": "regional ministries and agencies",
    "estado": "ministries and state agencies",
    "otras": "universities, public companies…",
}
MESES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
PALABRAS = {2: "two", 3: "three", 4: "four", 5: "five", 8: "eight"}
VECES = {2: "twice", 3: "three times", 4: "four times"}
MILES = {15_000: "fifteen thousand euros", 40_000: "forty thousand euros"}


class HistoriaError(RuntimeError):
    """Los datos ya no sostienen una frase del ensayo."""


def exige(cond: bool, msg: str) -> None:
    if not cond:
        raise HistoriaError(msg)


# ------------------------------------------------------------------ formato (inglés)

def _q(x: float, dec: int) -> Decimal:
    return Decimal(str(x)).quantize(Decimal(1).scaleb(-dec), rounding=ROUND_HALF_UP)


def n(x: float) -> str:
    """Entero con separador de miles: 68251 -> «68,251» (redondeo al entero, mitades hacia arriba)."""
    return f"{int(_q(x, 0)):,}"


def d(x: float, dec: int = 2) -> str:
    """Decimal fijo: 3.59 -> «3.59»."""
    return f"{_q(x, dec):,.{dec}f}"


def eur(x: float) -> str:
    """Euros: 15000 -> «€15,000»; 39669.42 -> «€39,669.42»."""
    return f"€{n(x)}" if float(x).is_integer() else f"€{d(x, 2)}"


def fecha(iso: str) -> str:
    y, m, dd = (int(p) for p in iso.split("-"))
    return f"{dd} {date(y, m, dd):%B} {y}"


def esc(s: str) -> str:
    return html.escape(str(s), quote=True)


# ------------------------------------------------------------------ tablas (HTML estático)

def tabla(cabeza: list[tuple[str, bool]], filas: list[list[str]], caption: str) -> str:
    """Tabla dentro de <details>: (texto, numérica) por columna; las celdas ya vienen escapadas."""
    th = "".join(f'<th scope="col"{" class=n" if num else ""}>{esc(t)}</th>' for t, num in cabeza)
    tr = "".join(
        "<tr>" + "".join(f'<td{" class=n" if cabeza[i][1] else ""}>{c}</td>' for i, c in enumerate(f)) + "</tr>"
        for f in filas
    )
    return (f'<details class="data"><summary>Show the data as a table</summary><div class="tablewrap">'
            f"<table><caption>{esc(caption)}</caption><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table></div></details>")


def tabla_hist(R: dict, C: dict, desde: float, caption: str) -> str:
    w = C["ancho_tramo"]
    filas = []
    for i, c in enumerate(R["hist"]):
        a, b = i * w, (i + 1) * w
        if b <= desde:
            continue
        zona = ("just under the limit" if C["cerca_desde"] <= a < C["umbral"]
                else "reference band" if C["ref_desde"] <= a < C["cerca_desde"] else "")
        filas.append([esc(eur(a)), esc(eur(b)), esc(n(c)), esc(zona)])
    return tabla([("Above", True), ("Up to", True), ("Contracts", True), ("Band", False)], filas, caption)


def ic(x: dict) -> str:
    return f"{d(x['ic_inf'])}–{d(x['ic_sup'])}"


# ------------------------------------------------------------------ hechos

def leer() -> tuple[dict, dict, dict]:
    cifras = json.loads((config.OUT / "cifras.json").read_text("utf-8"))
    fichas = {i: json.loads((config.SITE_DATA / "u" / f"{i}.json").read_text("utf-8")) for i, *_ in EJEMPLOS}
    expl = json.loads((config.OUT / "explicaciones.json").read_text("utf-8"))
    return cifras, fichas, expl


def borradores(expl: dict, ia: dict) -> dict:
    """Recuento de borradores rechazados y plantillas a partir de resultados/explicaciones.json.

    Cuenta borradores, no motivos: un borrador con cifras en dos apartados cuenta una vez.
    """
    from .explain import MAX_INTENTOS
    rech = [r for e in expl.values() for r in e["rechazos"]]
    out = {
        "total": len(rech),
        "en": sum(r["lang"] == "en" for r in rech), "es": sum(r["lang"] == "es" for r in rech),
        "cifras": sum(any(m.startswith("cifras: hay cifras en el apartado") for m in r["motivos"]) for r in rech),
        "cita_falsa": sum("cita: referencia a un contrato que no existe" in r["motivos"] for r in rech),
        "tpl_en": sum(e["origen_en"] == "plantilla" for e in expl.values()),
        "tpl_es": sum(e["origen_es"] == "plantilla" for e in expl.values()),
        "modelo": sum((e["origen_en"] == "modelo") + (e["origen_es"] == "modelo") for e in expl.values()),
        "a_la_primera": sum(not e["rechazos"] for e in expl.values()),
        "intentos": MAX_INTENTOS,
    }
    exige(out["total"] == ia["borradores_rechazados"], "explicaciones.json no cuadra con los rechazos de cifras.json")
    exige(out["tpl_en"] + out["tpl_es"] == ia["textos_de_plantilla"], "las plantillas no cuadran con cifras.json")
    exige(out["modelo"] == ia["textos_del_modelo"], "los textos del modelo no cuadran con cifras.json")
    exige(len(expl) == ia["fichas_con_explicacion"], "fichas con explicación ≠ cifras.json")
    # «tras N borradores fallidos, plantilla»: una plantilla lleva exactamente N rechazos en su idioma
    for e in expl.values():
        for lang in ("es", "en"):
            k = sum(r["lang"] == lang for r in e["rechazos"])
            exige(k <= MAX_INTENTOS and (k == MAX_INTENTOS) == (e[f"origen_{lang}"] == "plantilla"),
                  "una plantilla no viene de agotar los intentos")
    exige(out["cifras"] > out["total"] / 2, "las cifras fuera de su apartado ya no son el fallo más común")
    exige(out["en"] > out["es"] and out["tpl_en"] > out["tpl_es"], "el inglés ya no es el idioma que más falla")
    exige(out["intentos"] in PALABRAS, "intentos sin palabra")
    return out


def bandas(R: dict, C: dict) -> list[dict]:
    """Recuento por franjas del ancho de la franja «cerca», desde ref_desde hasta el límite."""
    w, paso = C["ancho_tramo"], C["umbral"] - C["cerca_desde"]
    por = round(paso / w)
    out = []
    a = C["ref_desde"]
    while a < C["umbral"]:
        i0 = round(a / w)
        out.append({"from": a, "to": a + paso, "n": sum(R["hist"][i0:i0 + por])})
        a += paso
    return out


def construir(cifras: dict, fichas: dict, expl: dict) -> tuple[dict, dict]:
    """Devuelve (hechos para la plantilla, datos para los gráficos)."""
    H: dict[str, str] = {}
    C = cifras["criterios"]
    ss, ob = cifras["reglas"]["ss"], cifras["reglas"]["obras"]
    Css, Cob = C["reglas"]["ss"], C["reglas"]["obras"]
    y0, y1 = cifras["periodo"][0][:4], cifras["periodo"][1][:4]
    e = cifras["embudo"]

    H.update(y0=y0, y1=y1, generado=fecha(cifras["generado"]))
    H["n_years"] = PALABRAS[int(y1) - int(y0) + 1]
    exige(Css["umbral"] in MILES, "límite sin palabras")
    H["lim_ss_words"] = MILES[int(Css["umbral"])]
    exige(C["ic_inf_min"] in VECES, "cota mínima sin palabras")
    H["ic_inf_min_w"] = VECES[int(C["ic_inf_min"])]
    from .analyze import MIN_REPETIDOS  # umbral de «adjudicatario repetido» de las fichas
    H["min_rep"] = PALABRAS[MIN_REPETIDOS]
    for k, R, Cr in (("ss", ss, Css), ("ob", ob, Cob)):
        H[f"lim_{k}"] = eur(Cr["umbral"])
        H[f"near_from_{k}"] = eur(Cr["cerca_desde"])
        H[f"ref_from_{k}"] = eur(Cr["ref_desde"])
        H[f"near_w_{k}"] = eur(Cr["umbral"] - Cr["cerca_desde"])
        H[f"bin_{k}"] = eur(Cr["ancho_tramo"])
        kk = (Cr["cerca_desde"] - Cr["ref_desde"]) / (Cr["umbral"] - Cr["cerca_desde"])
        exige(kk in PALABRAS, "anchura de referencia sin palabra")
        H[f"k_{k}"] = PALABRAS[int(kk)]
        exige(R["n_cerca"] == sum(b["n"] for b in bandas(R, Cr)[-1:]), "franja cerca ≠ histograma")
        exige(R["n_ref"] == sum(b["n"] for b in bandas(R, Cr)[:-1]), "franja de referencia ≠ histograma")

    H.update(n_ss=n(e["servicios_suministros"]), n_obras=n(e["obras"]),
             n_total=n(e["servicios_suministros"] + e["obras"]),
             n_total_m=d((e["servicios_suministros"] + e["obras"]) / 1e6, 2) + " million",
             n_org=n(cifras["n_organos"]), n_ent=n(cifras["n_entidades"]))

    # gancho: los precios más repetidos en la franja pegada al límite
    frec = ss["importes_frecuentes"]
    p14999 = [f for f in frec if f["importe"] == Css["umbral"] - 1]
    exige(len(p14999) == 1, "14.999 € ya no está entre los importes más repetidos")
    exige(frec[0] is not p14999[0], "14.999 € pasó a ser el importe más repetido: el texto dice que no lo es")
    H["price_hook"] = eur(p14999[0]["importe"])
    H["n_hook"] = n(p14999[0]["n"])
    H["n_tags"] = PALABRAS.get(len(frec), n(len(frec)))
    top = max(f["n"] for f in frec)
    tags = []
    for f in frec:
        hot = " hot" if f is p14999[0] else ""
        tags.append(f'<li class="tag{hot}"><span class="tag-p">{esc(eur(f["importe"]))}</span>'
                    f'<span class="tag-n"><b>{esc(n(f["n"]))}</b> contracts</span>'
                    f'<span class="tag-bar" style="--w:{100 * f["n"] / top:.1f}%" aria-hidden="true"></span></li>')
    H["tags"] = "".join(tags)
    H["top_price"], H["top_price_n"] = eur(frec[0]["importe"]), n(frec[0]["n"])

    # el muro: histograma de servicios y suministros
    h, w = ss["hist"], Css["ancho_tramo"]
    il = round(Css["umbral"] / w) - 1  # último tramo antes del límite (incluye el límite)
    H["last_bin_from"] = eur(il * w)
    H["last_bin"] = n(h[il])
    media_ref = ss["n_ref"] / ((Css["cerca_desde"] - Css["ref_desde"]) / w)
    H["last_vs_ref"] = d(h[il] / media_ref, 1)
    exige(h[il] / media_ref > 5, "el último tramo ya no destaca")
    H["first_above"], H["first_above_to"] = n(h[il + 1]), eur((il + 2) * w)
    exige(h[il + 1] < h[il] / 20, "el primer tramo por encima del límite ya no es pequeño")
    for i, p in enumerate(PICOS, 1):
        j = round(p / w) - 1
        exige(h[j] > 1.5 * max(h[j - 1], h[j + 1]), f"{p} ya no es un pico")
        H[f"spike{i}"] = eur(p)
    i0 = round(DESDE["ss"] / w)
    exige(sum(h[i0:i0 + 5]) > sum(h[round(Css["cerca_desde"] / w) - 5:round(Css["cerca_desde"] / w)]),
          "los tramos ya no bajan al subir el precio")
    H["chart_from_ss"] = eur(DESDE["ss"])

    # observado frente a esperado
    H.update(n_ref=n(ss["n_ref"]), esperado=n(ss["esperado"]), n_cerca=n(ss["n_cerca"]),
             razon=d(ss["razon"]), razon1=d(ss["razon"], 1), ic_inf=d(ss["ic_inf"]), ic_sup=d(ss["ic_sup"]),
             excess=n(ss["n_cerca"] - ss["esperado"]),
             importe_cerca="€" + d(ss["importe_cerca"] / 1e9, 2) + " billion")
    exige(ss["ic_inf"] > 1, "el intervalo nacional ya no excluye 1")

    # umbrales ficticios
    pl = cifras["placebo_ss"]
    lim = Css["umbral"]
    bajos = [p for p in pl if p["umbral"] <= lim - 1500]
    altos = [p for p in pl if p["umbral"] >= lim + 1000]
    exige(all(p["razon"] < 1 for p in bajos), "algún umbral ficticio bajo supera 1")
    exige(max(pl, key=lambda p: p["razon"])["umbral"] == lim, "el máximo ya no está en el límite real")
    exige([p["n_cerca"] for p in pl if p["umbral"] == lim] == [ss["n_cerca"]], "la ventana ficticia ya no es la franja real")
    r_round = [p for p in pl if p["umbral"] == PICOS[0]]
    exige(len(r_round) == 1, "falta el umbral ficticio de 10.000")
    H.update(fake_from=eur(pl[0]["umbral"]), fake_to=eur(pl[-1]["umbral"]),
             fake_step=eur(pl[1]["umbral"] - pl[0]["umbral"]),
             fake_low_to=eur(bajos[-1]["umbral"]),
             fake_low_min=d(min(p["razon"] for p in bajos)), fake_low_max=d(max(p["razon"] for p in bajos)),
             r_round=d(r_round[0]["razon"]), round_line=eur(PICOS[0]),
             fake_high_from=eur(altos[0]["umbral"]), fake_high_max=d(max(p["razon"] for p in altos)),
             fake_overlap=eur(pl[1]["umbral"] - pl[0]["umbral"]))

    # estabilidad: años, ámbitos, meses
    anios = ss["anios"]
    exige(sorted(anios) == [str(y) for y in range(int(y0), int(y1) + 1)], "años inesperados")
    exige(all(a["ic_inf"] > 2 for a in anios.values()), "algún año sin señal clara")
    H["years_list"] = ", ".join(d(anios[y]["razon"]) for y in sorted(anios)[:-1]) + " and " + d(anios[sorted(anios)[-1]]["razon"])
    am = ss["ambitos"]
    exige(set(am) == set(AMBITO), "ámbitos inesperados")
    exige(all(a["ic_inf"] > 2 for a in am.values()), "algún ámbito sin señal clara")
    H["amb_min"], H["amb_max"] = d(min(a["razon"] for a in am.values())), d(max(a["razon"] for a in am.values()))
    me = ss["meses"]
    exige(all(m["ic_inf"] > 2 for m in me) and all(m["ic_inf"] > 2 for m in ob["meses"]), "algún mes sin señal")
    H["mes_min"], H["mes_max"] = d(min(m["razon"] for m in me)), d(max(m["razon"] for m in me))
    H["dic_todos"], H["dic_cerca"] = d(ss["pct_dic_todos"], 1), d(ss["pct_dic_cerca"], 1)
    exige(abs(ss["pct_dic_todos"] - ss["pct_dic_cerca"]) < 3, "diciembre ya no se parece al resto")
    H["ob_mes_min"], H["ob_mes_max"] = d(min(m["razon"] for m in ob["meses"])), d(max(m["razon"] for m in ob["meses"]))
    H["ob_amb_min"] = d(min(a["razon"] for a in ob["ambitos"].values()))
    exige(all(a["ic_inf"] > 2 for a in ob["ambitos"].values()), "algún ámbito de obras sin señal")

    # obras
    H.update(o_cerca=n(ob["n_cerca"]), o_esp=n(ob["esperado"]), o_razon=d(ob["razon"]),
             o_inf=d(ob["ic_inf"]), o_sup=d(ob["ic_sup"]), chart_from_ob=eur(DESDE["obras"]))
    fo = ob["importes_frecuentes"][0]
    con_iva = (Decimal(str(fo["importe"])) * (100 + IVA) / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    exige(con_iva == con_iva.to_integral_value() and int(con_iva) % 1000 == 0, "el precio de obras más repetido ya no es redondo con IVA")
    H.update(o_top=eur(fo["importe"]), o_top_n=n(fo["n"]), iva=str(IVA), o_top_iva=f"€{n(float(con_iva))}")
    io = round(Cob["umbral"] / Cob["ancho_tramo"]) - 1
    H["o_last_bin"], H["o_last_from"] = n(ob["hist"][io]), eur(io * Cob["ancho_tramo"])

    # ejemplos
    ejemplos, timeline = [], None
    for k, (uid, etiqueta, ruta, nivel) in enumerate(EJEMPLOS, 1):
        f = fichas[uid]
        exige(all(r in f["ruta"] for r in ruta), f"la ruta de {uid} ya no encaja con «{etiqueta}»")
        R = f["reglas"]["ss"]
        exige(R["nivel"] == nivel, f"el nivel de {uid} cambió")
        if nivel == "sin_senal":
            exige(R["ic_inf"] <= 1 <= R["ic_sup"], "el intervalo del ejemplo sin señal ya no incluye 1")
            j = round(Css["umbral"] / w) - 1
            exige(R["hist"][j] > max(R["hist"][j - 5:j]), "el ejemplo sin señal ya no tiene un repunte en el último tramo")
        H[f"e{k}_label"] = etiqueta
        H[f"e{k}_n"], H[f"e{k}_cerca"], H[f"e{k}_esp"] = n(R["n"]), n(R["n_cerca"]), d(R["esperado"], 1)
        H[f"e{k}_razon"], H[f"e{k}_inf"], H[f"e{k}_sup"] = d(R["razon"]), d(R["ic_inf"]), d(R["ic_sup"])
        H[f"e{k}_level"] = NIVEL[nivel]
        i0, i1 = round(EJ_DESDE / w), round(EJ_HASTA / w)
        ejemplos.append({"label": etiqueta, "nivel": nivel, "level": NIVEL[nivel], "n": R["n"],
                         "n_cerca": R["n_cerca"], "esperado": R["esperado"], "razon": R["razon"],
                         "ic_inf": R["ic_inf"], "ic_sup": R["ic_sup"], "from": EJ_DESDE, "hist": R["hist"][i0:i1]})
        if k == 1:
            rep = R["repetidos"]
            exige(len(rep) >= 2 and rep[0]["n_cerca"] == rep[1]["n_cerca"], "A y B ya no empatan")
            todos = [int(y) for y in range(int(y0), int(y1) + 1)]
            exige(all(r["anios"] == todos for r in rep[:2]), "A o B ya no aparecen todos los años")
            letras = {r["alias"] for r in rep}
            cs = R["contratos"]
            exige(all(Css["cerca_desde"] < c["i"] <= Css["umbral"] for c in cs), "contrato fuera de la franja")
            H.update(e1_listed=n(len(cs)), e1_adj=n(R["n_adj_cerca"]), e1_nrep=n(len(rep)),
                     e1_rep_cerca=n(R["n_cerca_repetidos"]), e1_ab=n(rep[0]["n_cerca"]),
                     e1_first=fecha(min(c["f"] for c in cs)), e1_last=fecha(max(c["f"] for c in cs)),
                     )
            exige(len(cs) < R["n_cerca"] or len(cs) == R["n_cerca"], "lista de contratos incoherente")
            H["e1_listed_note"] = ("all" if len(cs) == R["n_cerca"] else f"the {n(len(cs))} most recent")
            timeline = {"from": Css["cerca_desde"], "to": Css["umbral"], "y0": int(y0), "y1": int(y1),
                        "items": [{"f": c["f"], "i": c["i"], "a": c["a"], "u": c["u"], "r": c["a"] in letras} for c in cs]}
            filas = [[esc(c["f"]), esc(eur(c["i"])), esc(c["a"] or "–") + (" (3+ near the limit)" if c["a"] in letras else ""),
                      (f'<a href="{esc(EVL + c["u"])}" rel="noopener">record {esc(c["e"] or "")}</a>' if c["u"] else "–")]
                     for c in cs]
            H["table_timeline"] = tabla([("Award date", False), ("Amount (ex. VAT)", True), ("Awardee", False),
                                         ("Official publication", False)], filas,
                                        f"{etiqueta}: {H['e1_listed_note']} of its contracts in the last {H['near_w_ss']}")
    H["table_examples"] = tabla(
        [("Body", False), ("Contracts", True), ("Last " + H["near_w_ss"], True), ("Expected", True),
         ("Ratio", True), ("95% interval", True), ("Label", False)],
        [[esc(x["label"]), esc(n(x["n"])), esc(n(x["n_cerca"])), esc(d(x["esperado"], 1)), esc(d(x["razon"])),
          esc(ic(x)), esc(x["level"])] for x in ejemplos],
        "Three contracting bodies, services and supplies")

    # niveles
    nv = ss["niveles_organo"]
    evaluados = nv["senal"] + nv["indicio"] + nv["sin_senal"]
    H.update(n_org_ss=n(sum(nv.values())), n_insuf=n(nv["insuficiente"]), n_eval=n(evaluados),
             n_senal=n(nv["senal"]), pct_senal=n(100 * nv["senal"] / evaluados), n_indicio=n(nv["indicio"]),
             n_sin=n(nv["sin_senal"]), o_senal=n(ob["niveles_organo"]["senal"]),
             o_eval=n(sum(v for k, v in ob["niveles_organo"].items() if k != "insuficiente")))
    exige(nv["senal"] > evaluados / 2, "ya no son más de la mitad")
    ks = ("senal", "indicio", "sin_senal")
    lab = ", ".join(f"{n(nv[k])} {NIVEL[k].lower()}" for k in ks)
    H["levels_bar"] = (f'<div class="lvbar" role="img" aria-label="{esc(lab)}">'
                       + "".join(f'<span class="lv {k}" style="--w:{100 * nv[k] / evaluados:.2f}%"></span>' for k in ks)
                       + '</div><ul class="legend lvleg">'
                       + "".join(f'<li><i class="{k}"></i><b>{esc(n(nv[k]))}</b>&nbsp;{esc(NIVEL[k].lower())} '
                                 f'({esc(n(100 * nv[k] / evaluados))}%)</li>' for k in ks)
                       + "</ul>")
    H["table_levels"] = tabla([("Label", False), ("Contracting bodies", True)],
                              [[esc(NIVEL[k]), esc(n(nv[k]))] for k in ("senal", "indicio", "sin_senal", "insuficiente")],
                              "Contracting bodies by label, services and supplies")

    # familias CPV
    cpv = [c for c in cifras["cpv"] if c["nivel"] != "insuficiente"]
    exige(all(c["ic_inf"] > 1 for c in cpv), "alguna familia CPV ya no supera 1")
    top_c = max(cpv, key=lambda c: c["razon"])
    H.update(cpv_eval=n(len(cpv)), cpv_top=top_c["nombre_en"], cpv_top_razon=d(top_c["razon"]),
             cpv_pct=d(cifras["cpv_cobertura_pct"], 1), cpv_low=d(min(c["ic_inf"] for c in cpv)))
    H["table_cpv"] = tabla([("What is bought (CPV division)", False), ("Contracts", True), ("Last " + H["near_w_ss"], True),
                            ("Ratio", True), ("95% interval", True)],
                           [[esc(c["nombre_en"]), esc(n(c["n"])), esc(n(c["n_cerca"])), esc(d(c["razon"])), esc(ic(c))]
                            for c in cpv], "Services and supplies by CPV division, sorted by the lower bound")

    # método, datos e IA
    H.update(ss_sobre=n(ss["sobre_umbral"]), min_ventana=n(C["min_ventana"]), min_cerca=n(C["min_cerca"]),
             q_max=d(C["q_max"]), ic_inf_min=n(C["ic_inf_min"]))
    fu = cifras["fuente"]
    H.update(n_files=PALABRAS.get(len(fu), n(len(fu))), file_from=fu[0]["periodo"], file_to=fu[-1]["periodo"],
             gb=d(sum(f["bytes"] for f in fu) / 1e9, 2), atom=n(e["ficheros_atom"]),
             leidas=n(e["entradas_leidas"]), distintos=n(e["contratos_distintos"]))
    H["sources"] = "".join(f'<li><a href="{esc(f["url"])}">{esc(f["periodo"])} file</a> '
                           f'<span class="num">({esc(d(f["bytes"] / 1e6, 0))} MB, SHA-256 {esc(f["sha256"][:12])}…)</span></li>'
                           for f in fu)
    ia = cifras["ia"]
    exige(ia["fichas_con_explicacion"] == ia["fichas_con_senal"], "faltan explicaciones")
    H.update(ia_modelo=ia["modelo"].split(" (")[0], ia_runtime="llama.cpp" if "llama.cpp" in ia["modelo"] else ia["modelo"],
             ia_fichas=n(ia["fichas_con_explicacion"]), ia_textos=n(ia["textos_del_modelo"] + ia["textos_de_plantilla"]),
             ia_modelo_n=n(ia["textos_del_modelo"]), ia_plantilla=n(ia["textos_de_plantilla"]),
             ia_rech=n(ia["borradores_rechazados"]))
    b = borradores(expl, ia)
    H.update(rech_en=n(b["en"]), rech_es=n(b["es"]), rech_cifras=n(b["cifras"]), rech_cita=n(b["cita_falsa"]),
             tpl_en=n(b["tpl_en"]), first_try=n(b["a_la_primera"]), max_intentos=PALABRAS[b["intentos"]])
    H.update(tool=TOOL, method=METHOD, repo=REPO_RAMA,
             f_cifras=FICHERO + "resultados/cifras.json", f_expl=CRUDO + "resultados/explicaciones.json",
             f_res=f"{REPO_RAMA}/resultados",
             expl_mb=d((config.OUT / "explicaciones.json").stat().st_size / 1e6, 1))

    # tablas de los gráficos
    H["table_wall"] = tabla_hist(ss, Css, DESDE["ss"], f"Services and supplies contracts per {H['bin_ss']} band")
    H["table_works"] = tabla_hist(ob, Cob, DESDE["obras"], f"Works contracts per {H['bin_ob']} band")
    bs = bandas(ss, Css)
    H["table_bands"] = tabla([("Above", True), ("Up to", True), ("Contracts", True)],
                             [[esc(eur(b["from"])), esc(eur(b["to"])), esc(n(b["n"]))] for b in bs]
                             + [["Expected in the last band", "", esc(n(ss["esperado"]))]],
                             f"Services and supplies contracts per {H['near_w_ss']} band")
    H["table_fake"] = tabla([("Fake limit", True), (f"Contracts in the {H['near_w_ss']} below", True), ("Ratio", True), ("95% interval", True)],
                            [[esc(eur(p["umbral"])), esc(n(p["n_cerca"])), esc(d(p["razon"])), esc(ic(p))] for p in pl],
                            "Ratio observed / expected for each fake limit")
    filas = [["All years", esc(d(ss["razon"])), esc(ic(ss)), esc(d(ob["razon"])), esc(ic(ob))]]
    filas += [[esc(y), esc(d(ss["anios"][y]["razon"])), esc(ic(ss["anios"][y])), esc(d(ob["anios"][y]["razon"])), esc(ic(ob["anios"][y]))]
              for y in sorted(ss["anios"])]
    filas += [[esc(AMBITO[a]), esc(d(ss["ambitos"][a]["razon"])), esc(ic(ss["ambitos"][a])),
               esc(d(ob["ambitos"][a]["razon"])), esc(ic(ob["ambitos"][a]))] for a in AMBITO]
    H["table_forest"] = tabla([("Group", False), ("Services & supplies", True), ("95% interval", True), ("Works", True), ("95% interval", True)],
                              filas, "Ratio observed / expected by year and type of body")
    H["table_months"] = tabla([("Month", False), ("Services & supplies", True), ("95% interval", True), ("Works", True), ("95% interval", True)],
                              [[MESES[i], esc(d(a["razon"])), esc(ic(a)), esc(d(b["razon"])), esc(ic(b))]
                               for i, (a, b) in enumerate(zip(ss["meses"], ob["meses"]))],
                              "Ratio observed / expected by month of award, all years")

    # datos de los gráficos (story.js)
    def regla(R, Cr, clave):
        return {"lim": Cr["umbral"], "near_from": Cr["cerca_desde"], "ref_from": Cr["ref_desde"], "bin": Cr["ancho_tramo"],
                "start": DESDE[clave], "max": Cr["max_grafico"], "hist": R["hist"], "n_cerca": R["n_cerca"],
                "n_ref": R["n_ref"], "esperado": R["esperado"], "razon": R["razon"], "ic_inf": R["ic_inf"], "ic_sup": R["ic_sup"],
                "bands": bandas(R, Cr),
                "groups": ([{"g": "All", "label": f"All, {y0}–{y1}", "razon": R["razon"], "ic_inf": R["ic_inf"], "ic_sup": R["ic_sup"]}]
                           + [{"g": "Year", "label": y, **{c: R["anios"][y][c] for c in ("razon", "ic_inf", "ic_sup")}} for y in sorted(R["anios"])]
                           + [{"g": "Type of body", "label": AMBITO[a], "sub": AMBITO_SUB[a],
                               **{c: R["ambitos"][a][c] for c in ("razon", "ic_inf", "ic_sup")}} for a in AMBITO]),
                "months": [{"m": MESES[i], **{c: x[c] for c in ("razon", "ic_inf", "ic_sup", "n_cerca")}} for i, x in enumerate(R["meses"])]}

    D = {"ss": regla(ss, Css, "ss"), "obras": regla(ob, Cob, "obras"),
         "obras_top": {"price": fo["importe"], "n": fo["n"]},
         "placebo": [{c: p[c] for c in ("umbral", "n_cerca", "razon", "ic_inf", "ic_sup")} for p in pl],
         "round_line": PICOS[0], "spikes": list(PICOS),
         "cpv": [{"name": c["nombre_en"], "n": c["n"], "n_cerca": c["n_cerca"], "razon": c["razon"],
                  "ic_inf": c["ic_inf"], "ic_sup": c["ic_sup"], "nivel": c["nivel"]} for c in cpv],
         "ejemplos": ejemplos, "timeline": timeline}
    H["data_json"] = json.dumps(D, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return H, D


MARCA = re.compile(r"\{\{(\w+)\}\}")


def rellenar(plantilla: str, H: dict) -> str:
    faltan = sorted({m for m in MARCA.findall(plantilla) if m not in H})
    exige(not faltan, f"marcadores sin valor: {faltan}")
    return MARCA.sub(lambda m: H[m.group(1)], plantilla)


def pagina() -> str:
    cifras, fichas, expl = leer()
    H, _ = construir(cifras, fichas, expl)
    return rellenar(PLANTILLA.read_text("utf-8"), H)


def escribir() -> Path:
    SALIDA.write_text(pagina(), "utf-8", newline="\n")
    print(f"Ensayo: {SALIDA}")
    return SALIDA


if __name__ == "__main__":
    escribir()
