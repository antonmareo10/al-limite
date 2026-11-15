"""Explicaciones en lenguaje claro, escritas por un modelo abierto en local y verificadas.

Uso:  python -m allimite.explain [N]        (genera lo que falte; necesita llama-server)
      python -m allimite.explain --fusionar (solo vuelca las guardadas en la web)

Reparto del trabajo:
  * El código calcula las cifras y redacta cada hecho como una frase suelta y exacta.
  * El modelo (Qwen3-4B, licencia Apache 2.0, ejecutado con llama.cpp en este portátil)
    decide qué hechos destacan en cada caso, los ordena y escribe con sus palabras las
    cautelas y las comprobaciones que sugiere. Trabaja con una plantilla de tres apartados.
  * `verificar()` rechaza el borrador si alguna frase con cifras no coincide con un hecho
    (mismas cifras y casi el mismo texto), si faltan los tres hechos centrales, si hay
    cifras fuera del primer apartado, si cita un contrato inexistente, si usa lenguaje
    acusatorio o si omite la cautela. Tras tres rechazos se usa un texto fijo, marcado.

Los modelos pequeños se equivocan al parafrasear estadística (confunden franjas o
porcentajes). Por eso no se les deja reescribir las cifras: solo elegirlas y explicarlas.
"""
from __future__ import annotations

import difflib
import json
import re
import sys
import time
from datetime import datetime

import requests

from . import config, stats as st

SERVIDOR = "http://127.0.0.1:8089/v1/chat/completions"
MODELO = "Qwen3-4B (Q4_K_M, llama.cpp)"
CACHE = config.OUT / "explicaciones.json"
MAX_INTENTOS = 3
MIN_REP = 3  # contratos junto al límite para hablar de adjudicatario repetido
PARECIDO_MIN = 0.8  # parecido mínimo entre una frase con cifras y el hecho del que sale
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre",
         "octubre", "noviembre", "diciembre"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]

TITULOS = {
    "es": ["Qué muestran los datos:", "Qué no pueden demostrar:", "Qué se puede revisar:"],
    "en": ["What the data shows:", "What it cannot show:", "What can be checked:"],
}
NOMBRE_REGLA = {
    "es": {"ss": "servicios y suministros", "obras": "obras"},
    "en": {"ss": "services and supplies", "obras": "works"},
}


# ------------------------------------------------------------------ formato numérico

def num(v: float, lang: str, dec: int | None = None) -> str:
    """Número con el formato del idioma: 14.950,5 (es) o 14,950.5 (en)."""
    if dec is None:
        dec = 0 if float(v).is_integer() else 2
    s = f"{v:,.{dec}f}"
    return s if lang == "en" else s.replace(",", "§").replace(".", ",").replace("§", ".")


_RE_NUM = re.compile(r"\d+(?:[.,]\d+)*")


def numeros(texto: str, lang: str) -> list[float] | None:
    """Valores numéricos del texto. Devuelve None si alguno está mal formado para el idioma."""
    mil, dec = (".", ",") if lang == "es" else (",", ".")
    out = []
    for tok in _RE_NUM.findall(texto):
        entero, _, frac = tok.partition(dec)
        if dec in frac or mil in frac:
            return None
        grupos = entero.split(mil)
        if len(grupos) > 1 and (not 1 <= len(grupos[0]) <= 3 or any(len(g) != 3 for g in grupos[1:])):
            return None  # p. ej. «4.2» en español: separador decimal equivocado
        out.append(float("".join(grupos) + ("." + frac if frac else "")))
    return out


# ----------------------------------------------------------------------------- hechos

def regla_principal(ficha: dict) -> str:
    con_senal = [k for k, v in ficha["reglas"].items() if v["nivel"] == "senal"]
    if not con_senal:
        raise ValueError("la ficha no tiene señal")
    return max(con_senal, key=lambda k: ficha["reglas"][k]["ic_inf"])


def hechos(ficha: dict, lang: str) -> dict:
    """Hechos de una ficha como frases sueltas. Los tres primeros son obligatorios."""
    k = regla_principal(ficha)
    r, regla = ficha["reglas"][k], st.REGLAS[k]
    es = lang == "es"
    n = lambda v, d=None: num(v, lang, d)
    a0, a1 = config.FECHA_MIN[:4], config.FECHA_MAX[:4]
    tipo = NOMBRE_REGLA[lang][k]
    dic = r["meses_cerca"][11]
    pct_c = round(100 * dic / r["n_cerca"])
    pct_t = round(100 * r["meses_todos"][11] / r["n"])
    ejemplos = r["contratos"][:3]
    rep = r["repetidos"][0] if r["repetidos"] else None

    def fecha(f):
        return f"{MESES[int(f[5:7]) - 1]} de {f[:4]}" if es else f"{MONTHS[int(f[5:7]) - 1]} {f[:4]}"

    if es:
        f = [
            f"Entre {a0} y {a1}, este organismo adjudicó {n(r['n_cerca'])} contratos menores de {tipo} de más de "
            f"{n(regla.cerca_desde)} y hasta {n(regla.umbral)} euros, justo por debajo del límite legal.",
            f"Si esos importes se repartieran como en la franja inmediatamente inferior, lo esperable serían "
            f"{n(r['esperado'], 1)} contratos.",
            f"La razón entre observados y esperados es {n(r['razon'], 1)}, con un intervalo de confianza del 95 % "
            f"de {n(r['ic_inf'], 1)} a {n(r['ic_sup'], 1)}.",
            f"En diciembre se adjudicó el {pct_c} % de los contratos junto al límite, mientras que diciembre supone "
            f"el {pct_t} % de todos sus contratos de {tipo}.",
            f"Los contratos junto al límite se reparten entre {n(r['n_adj_cerca'])} adjudicatarios distintos.",
            (f"El adjudicatario con más contratos junto al límite, al que aquí se llama adjudicatario {rep['alias']}, "
             f"tiene {n(rep['n_cerca'])}." if rep else
             f"Ningún adjudicatario llega a {MIN_REP} contratos junto al límite."),
        ]
        f += [f"El contrato [{i}], de {n(c['i'])} euros, se adjudicó en {fecha(c['f'])}." for i, c in enumerate(ejemplos, 1)]
    else:
        f = [
            f"Between {a0} and {a1}, this body awarded {n(r['n_cerca'])} minor contracts for {tipo} above "
            f"{n(regla.cerca_desde)} and up to {n(regla.umbral)} euros, just under the legal limit.",
            f"If those amounts were spread as in the band immediately below, {n(r['esperado'], 1)} contracts "
            f"would be expected.",
            f"The observed-to-expected ratio is {n(r['razon'], 1)}, with a 95% confidence interval of "
            f"{n(r['ic_inf'], 1)} to {n(r['ic_sup'], 1)}.",
            f"December accounts for {pct_c}% of the contracts just under the limit, compared with {pct_t}% of all "
            f"its {tipo} contracts.",
            f"The contracts just under the limit are spread across {n(r['n_adj_cerca'])} different awardees.",
            (f"The awardee with the most contracts just under the limit, called awardee {rep['alias']} here, "
             f"has {n(rep['n_cerca'])}." if rep else
             f"No awardee reaches {MIN_REP} contracts just under the limit."),
        ]
        f += [f"Contract [{i}], for {n(c['i'])} euros, was awarded in {fecha(c['f'])}." for i, c in enumerate(ejemplos, 1)]
    return {"regla": k, "frases": f, "n_obligatorias": 3, "n_ejemplos": len(ejemplos), "ejemplos": ejemplos,
            "nombre": ficha["nombre"]}


# ------------------------------------------------------------------------- verificador

ACUSATORIO = {
    "es": r"fraud|corrup|delit|ilegal|ilícit|culpab|malvers|prevaric|amañ|trampa|soborn|estafa|irregular|sospech",
    "en": r"fraud|corrupt|crime|criminal|illegal|unlawful|guilt|embezzl|rigg|brib|scam|irregular|wrongdoing|misconduct|suspicio",
}
TROCEO = {"es": r"fraccion|troce|dividi", "en": r"split|divid|carv|broken up"}
NEGACION = {
    "es": r"\bno\s+(?:\w+\s+){0,3}?(?:demuestra|demuestran|prueba|prueban|permite|permiten|puede|pueden|basta|bastan|implica|implican|significa|significan|indica|indican)",
    "en": r"\b(?:does not|do not|cannot|can not|doesn't|don't|can't|is not|are not)\b",
}


def _norm(s: str) -> list[str]:
    return re.findall(r"[\wáéíóúüñ%\[\]]+", s.lower())


def _frases(s: str) -> list[str]:
    """Parte un párrafo en frases sin romper cifras como 14.000."""
    return [x.strip() for x in re.split(r"(?<=[.;!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡\[\"«])", s.strip()) if x.strip()]


def partir(texto: str, lang: str) -> list[str] | None:
    """Los tres apartados del texto, en orden; None si la estructura no es la pedida."""
    pos = [texto.find(t) for t in TITULOS[lang]]
    if pos[0] != 0 or any(p < 0 for p in pos) or pos != sorted(pos):
        return None
    if any(texto.count(t) != 1 for t in TITULOS[lang]):
        return None
    cortes = pos + [len(texto)]
    partes = [texto[cortes[i] + len(TITULOS[lang][i]):cortes[i + 1]].strip() for i in range(3)]
    return partes if all(partes) else None


def verificar(texto: str, h: dict, lang: str) -> list[str]:
    """Lista de motivos de rechazo; vacía si el texto es coherente con los hechos."""
    partes = partir(texto, lang)
    if partes is None:
        return ["estructura: faltan los tres apartados, están desordenados o vacíos"]
    errores = []
    palabras = len(texto.split())
    if not 90 <= palabras <= 260:
        errores.append(f"longitud: {palabras} palabras")
    if re.search(r"<think>|\*\*|^#|^\s*[-*] |https?://|www\.", texto, flags=re.M):
        errores.append("formato: marcas o enlaces no permitidos")

    # 1) Primer apartado: toda frase con cifras debe ser uno de los hechos.
    hechos_num = [(f, numeros(f, lang)) for f in h["frases"]]
    usados = set()
    for frase in _frases(partes[0]):
        if not re.search(r"\d", frase):
            continue
        vals = numeros(frase, lang)
        if vals is None:
            errores.append("cifras: número mal formado para el idioma")
            continue
        mejor, parecido = None, 0.0
        for i, (f, fv) in enumerate(hechos_num):
            if sorted(fv) != sorted(vals):
                continue
            p = difflib.SequenceMatcher(None, _norm(f), _norm(frase)).ratio()
            if p > parecido:
                mejor, parecido = i, p
        if mejor is None:
            errores.append(f"cifras: la frase «{frase[:60]}…» no coincide en cifras con ningún hecho")
        elif parecido < PARECIDO_MIN:
            errores.append(f"cifras: la frase «{frase[:60]}…» cambia la redacción del hecho ({parecido:.2f})")
        else:
            usados.add(mejor)
    for i in range(h["n_obligatorias"]):
        if i not in usados:
            errores.append(f"cifras: falta el hecho obligatorio {i + 1}")

    # 2) Los otros dos apartados no llevan cifras: solo citas [n].
    for i in (1, 2):
        if re.search(r"\d", re.sub(r"\[\d+\]", "", partes[i])):
            errores.append(f"cifras: hay cifras en el apartado {i + 1}")
    citas = [int(x) for x in re.findall(r"\[(\d+)\]", texto)]
    if any(c < 1 or c > h["n_ejemplos"] for c in citas):
        errores.append("cita: referencia a un contrato que no existe")
    if h["n_ejemplos"] and not citas:
        errores.append("cita: no cita ningún contrato de ejemplo")
    if re.search(r"\[[^\]\d][^\]]*\]", texto):
        errores.append("cita: corchetes no permitidos")

    # 3) Tono y cautela
    for i in (0, 2):
        if re.search(ACUSATORIO[lang], partes[i], flags=re.I):
            errores.append("tono: lenguaje acusatorio fuera del apartado de cautelas")
        if re.search(TROCEO[lang], partes[i], flags=re.I):
            errores.append("tono: habla de fraccionamiento fuera del apartado de cautelas")
    if not re.search(NEGACION[lang], partes[1], flags=re.I):
        errores.append("cautela: el segundo apartado no niega nada")
    return errores


# -------------------------------------------------------------------------- redacción

SISTEMA = {
    "es": (
        "Eres redactor de un proyecto cívico sobre contratación pública en España. Explicas a cualquier vecino, con frases "
        "cortas y tono neutro, lo que dicen unos datos y lo que no dicen.\n"
        "Recibirás una lista de HECHOS. Cada hecho es una frase ya comprobada.\n"
        "Escribe exactamente tres apartados, cada uno en un párrafo que empiece por su rótulo:\n"
        "Qué muestran los datos: copia literalmente los hechos 1, 2 y 3, en ese orden. Después copia literalmente entre uno y "
        "tres hechos más: los que mejor ayuden a entender este caso concreto, incluido al menos un contrato de ejemplo. "
        "No cambies ninguna cifra ni la redacción de los hechos, no los mezcles en una misma frase y no añadas cifras nuevas.\n"
        "Qué no pueden demostrar: con tus palabras y sin cifras, explica que amontonar importes junto al límite es un "
        "indicador estadístico y que no demuestra que se haya partido ningún contrato ni que alguien haya actuado mal; "
        "puede haber razones legítimas, como precios de mercado, presupuestos cerrados o necesidades distintas.\n"
        "Qué se puede revisar: con tus palabras y sin cifras, propón dos comprobaciones concretas para este caso en los "
        "expedientes publicados (por ejemplo, qué se contrató, en qué fechas, si varios contratos atienden una misma "
        "necesidad o, si los hechos lo indican, qué pasó a final de año o con el adjudicatario que más repite). "
        "Puedes señalar un contrato de ejemplo con su referencia, como [1].\n"
        "No nombres a personas ni a empresas. No acuses ni insinúes. No uses listas, negritas ni enlaces. /no_think"
    ),
    "en": (
        "You write for a civic project on public procurement in Spain. You explain to a general reader, in short sentences "
        "and a neutral tone, what some data says and what it does not say.\n"
        "You will receive a list of FACTS. Each fact is a sentence that has already been checked.\n"
        "Write exactly three sections, each one a paragraph starting with its label:\n"
        "What the data shows: copy facts 1, 2 and 3 word for word, in that order. Then copy word for word between one and "
        "three more facts: the ones that best help to understand this particular case, including at least one example "
        "contract. Do not change any figure or the wording of the facts, do not merge them into one sentence and do not add new figures.\n"
        "What it cannot show: in your own words and with no figures, explain that amounts piling up just under the limit is a "
        "statistical indicator and does not prove that any contract was broken up or that anyone acted improperly; there "
        "can be legitimate reasons, such as market prices, fixed budgets or separate needs.\n"
        "What can be checked: in your own words and with no figures, suggest two concrete checks for this case in the "
        "published contract files (for example what was bought, on which dates, whether several contracts meet a single "
        "need or, if the facts point that way, what happened at year end or with the awardee that repeats most). "
        "You may point to an example contract by its reference, such as [1].\n"
        "Do not name people or companies. Do not accuse or insinuate. No lists, bold text or links. /no_think"
    ),
}


def pedir(h: dict, lang: str, intento: int, errores_previos: list[str]) -> str:
    cab = "HECHOS" if lang == "es" else "FACTS"
    user = cab + ":\n" + "\n".join(f"{i}. {x}" for i, x in enumerate(h["frases"], 1))
    if errores_previos:
        aviso = ("\n\nTu borrador anterior se rechazó. Motivos: " if lang == "es"
                 else "\n\nYour previous draft was rejected. Reasons: ")
        user += aviso + "; ".join(errores_previos[:4]) + "."
    r = requests.post(SERVIDOR, json={
        "messages": [{"role": "system", "content": SISTEMA[lang]}, {"role": "user", "content": user}],
        "temperature": 0.3 + 0.2 * intento, "top_p": 0.9, "max_tokens": 480, "seed": 1234 + intento,
    }, timeout=600)
    r.raise_for_status()
    txt = r.json()["choices"][0]["message"]["content"]
    txt = re.sub(r"<think>.*?</think>", "", txt, flags=re.S).strip()
    return re.sub(r"[ \t]*\n\s*", "\n", txt)


def plantilla(h: dict, lang: str) -> str:
    """Texto determinista de reserva: los tres hechos centrales, un ejemplo y cautelas fijas."""
    f = h["frases"]
    datos = " ".join(f[:3] + ([f[6]] if h["n_ejemplos"] else []))
    if lang == "es":
        return (
            f"Qué muestran los datos: {datos}\n"
            "Qué no pueden demostrar: la acumulación de importes junto al límite es un indicador estadístico. No prueba que "
            "se haya partido ningún contrato ni que alguien haya actuado mal; puede deberse a precios de mercado, a "
            "presupuestos cerrados o a necesidades distintas.\n"
            "Qué se puede revisar: en los expedientes enlazados, qué se contrató en cada caso y en qué fechas, y si varios "
            "contratos atienden una misma necesidad que pudo contratarse de una vez."
        )
    return (
        f"What the data shows: {datos}\n"
        "What it cannot show: a pile-up of amounts just under the limit is a statistical indicator. It does not prove "
        "that any contract was broken up or that anyone acted improperly; it may reflect market prices, fixed budgets "
        "or separate needs.\n"
        "What can be checked: in the linked contract files, what was bought in each case and on which dates, and whether "
        "several contracts meet a single need that could have been procured at once."
    )


def explicar(ficha: dict) -> dict:
    out = {"hash": ficha["hash"], "modelo": MODELO, "generado": datetime.now().strftime("%Y-%m-%d"),
           "rechazos": []}
    for lang in ("es", "en"):
        h = hechos(ficha, lang)
        out["regla"] = h["regla"]
        out["citas"] = [c["u"] for c in h["ejemplos"]]
        errores, texto, origen = [], None, "plantilla"
        for intento in range(MAX_INTENTOS):
            cand = pedir(h, lang, intento, errores)
            errores = verificar(cand, h, lang)
            if not errores:
                texto, origen = cand, "modelo"
                break
            out["rechazos"].append({"lang": lang, "intento": intento + 1, "motivos": errores, "texto": cand})
        if texto is None:
            texto = plantilla(h, lang)
            assert not verificar(texto, h, lang), verificar(texto, h, lang)
        out[lang] = texto
        out[f"origen_{lang}"] = origen
    return out


# ------------------------------------------------------------------------------ flujo

def _cache() -> dict:
    return json.loads(CACHE.read_text("utf-8")) if CACHE.exists() else {}


def generar(limite: int | None = None) -> None:
    fichas = json.loads((config.WORK / "fichas_senal.json").read_text("utf-8"))
    cache = _cache()
    pend = [u for u, f in fichas.items() if cache.get(u, {}).get("hash") != f["hash"]]
    pend.sort(key=lambda u: -max(v["ic_inf"] for v in fichas[u]["reglas"].values() if v["nivel"] == "senal"))
    if limite:
        pend = pend[:limite]
    print(f"[{datetime.now():%H:%M:%S}] {len(pend)} explicaciones pendientes de {len(fichas)}", flush=True)
    for i, uid in enumerate(pend, 1):
        t = time.time()
        cache[uid] = explicar(fichas[uid])
        CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True), "utf-8")
        e = cache[uid]
        print(f"[{datetime.now():%H:%M:%S}] {i}/{len(pend)} {uid} es={e['origen_es']} en={e['origen_en']} "
              f"rechazos={len(e['rechazos'])} {time.time() - t:.0f}s", flush=True)
        if i % 50 == 0:
            fusionar()
    fusionar()


def fusionar() -> None:
    """Vuelca en la web las explicaciones vigentes (misma huella de hechos) y sus estadísticas."""
    cache = _cache()
    fpath = config.WORK / "fichas_senal.json"
    if not fpath.exists():
        return
    fichas = json.loads(fpath.read_text("utf-8"))
    n_ok = n_modelo = n_plantilla = n_rech = 0
    for uid, f in fichas.items():
        p = config.SITE_DATA / "u" / f"{uid}.json"
        d = json.loads(p.read_text("utf-8"))
        e = cache.get(uid)
        d.pop("ia", None)
        # Segunda verificación, independiente de la generación: lo guardado debe seguir cuadrando.
        if e and e["hash"] == f["hash"] and all(not verificar(e[lang], hechos(f, lang), lang) for lang in ("es", "en")):
            d["ia"] = {k: e[k] for k in ("es", "en", "origen_es", "origen_en", "modelo", "regla", "citas", "generado")}
            n_ok += 1
            for lang in ("es", "en"):
                n_modelo += e[f"origen_{lang}"] == "modelo"
                n_plantilla += e[f"origen_{lang}"] == "plantilla"
            n_rech += len(e["rechazos"])
        p.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), "utf-8")
    npath = config.SITE_DATA / "nacional.json"
    nac = json.loads(npath.read_text("utf-8"))
    nac["ia"] = {"modelo": MODELO, "fichas_con_senal": len(fichas), "fichas_con_explicacion": n_ok,
                 "textos_del_modelo": n_modelo, "textos_de_plantilla": n_plantilla,
                 "borradores_rechazados": n_rech}
    npath.write_text(json.dumps(nac, ensure_ascii=False, separators=(",", ":")), "utf-8")
    (config.OUT / "cifras.json").write_text(json.dumps(nac, ensure_ascii=False, indent=1), "utf-8")
    print(f"[{datetime.now():%H:%M:%S}] Explicaciones en la web: {n_ok} de {len(fichas)} "
          f"({n_modelo} textos del modelo, {n_plantilla} de plantilla, {n_rech} borradores rechazados)", flush=True)


if __name__ == "__main__":
    if "--fusionar" in sys.argv:
        fusionar()
    else:
        nums = [int(a) for a in sys.argv[1:] if a.isdigit()]
        generar(nums[0] if nums else None)
