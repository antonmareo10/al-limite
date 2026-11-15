"""Análisis completo: de la tabla SQLite a los JSON de la web y a `resultados/`.

Uso:  python -m allimite.analyze

Todas las cifras de la web, del README y de las explicaciones salen de aquí.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import shutil
import sqlite3
from collections import Counter
from datetime import datetime

import numpy as np
import pandas as pd

from . import config, cpv, stats as st

MAX_CONTRATOS_FICHA = 150  # contratos junto al límite que se listan por ficha
MIN_REPETIDOS = 3  # contratos junto al límite a un mismo adjudicatario para listarlo
ENLACE_PREFIJO = "https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl="

AMBITOS = {
    "ADMINISTRACIÓN GENERAL DEL ESTADO": "estado",
    "COMUNIDADES Y CIUDADES AUTÓNOMAS": "autonomico",
    "ENTIDADES LOCALES": "local",
    "OTRAS ENTIDADES DEL SECTOR PÚBLICO": "otras",
}


# --------------------------------------------------------------------------- carga

def cargar() -> tuple[pd.DataFrame, dict]:
    """Lee los contratos, aplica los filtros y devuelve (tabla, embudo de filtros)."""
    con = sqlite3.connect(f"file:{config.DB}?mode=ro", uri=True)
    df = pd.read_sql_query(
        "SELECT c.id, c.updated, c.link, c.expediente, c.estado, c.organo_id, c.organo_nif, "
        "c.organo_nombre, c.organo_jerarquia, c.organo_ciudad, c.tipo, c.cpv, "
        "c.presupuesto_sin_iva, c.resultado, c.fecha_adj, c.adj_nif, c.adj_nombre, "
        "c.n_adjudicatarios, c.importe_sin_iva, b.cuando AS borrado "
        "FROM contratos c LEFT JOIN borrados b ON b.id = c.id",
        con,
    )
    ficheros = con.execute("SELECT COUNT(*), SUM(entradas) FROM ficheros").fetchone()
    con.close()
    embudo = {"entradas_leidas": int(ficheros[1] or 0), "ficheros_atom": int(ficheros[0]),
              "contratos_distintos": len(df)}

    borrado = df["borrado"].notna() & (df["borrado"] >= df["updated"])
    df = df[~borrado & (df["estado"] != "ANUL")]
    embudo["tras_quitar_anulados"] = len(df)

    res = df["resultado"].fillna("")
    adjudicado = res.str.split(",").map(lambda xs: any(x in ("2", "8", "9") for x in xs))
    df = df[adjudicado]
    embudo["adjudicados"] = len(df)

    df = df[df["fecha_adj"].between(config.FECHA_MIN, config.FECHA_MAX)]
    embudo["adjudicados_en_periodo"] = len(df)

    imp = df["importe_sin_iva"].where(df["importe_sin_iva"] > 0, df["presupuesto_sin_iva"])
    df = df.assign(importe=imp)
    df = df[df["importe"] > 0]
    embudo["con_importe"] = len(df)

    df = df.sort_values("updated").drop_duplicates(
        ["organo_id", "expediente", "fecha_adj", "importe", "adj_nif"], keep="last")
    embudo["sin_duplicados"] = len(df)

    df["regla"] = df["tipo"].map({"1": "ss", "2": "ss", "3": "obras"}).fillna("otros")
    embudo["servicios_suministros"] = int((df["regla"] == "ss").sum())
    embudo["obras"] = int((df["regla"] == "obras").sum())
    embudo["otros_tipos_excluidos"] = int((df["regla"] == "otros").sum())
    df = df[df["regla"] != "otros"].copy()

    df["cent"] = st.a_centimos(df["importe"])
    df["anio"] = df["fecha_adj"].str[:4].astype(int)
    df["mes"] = df["fecha_adj"].str[5:7].astype(int)
    df["cpv2"] = df["cpv"].str[:2]
    df.loc[~df["cpv2"].isin(cpv.DIVISIONES), "cpv2"] = None
    # Clave del adjudicatario: NIF si lo hay; si no, el nombre normalizado.
    clave = df["adj_nif"].where(df["adj_nif"].notna() & (df["adj_nif"] != ""),
                                df["adj_nombre"].fillna("").str.upper().str.strip())
    df["adj"] = clave.where((df["n_adjudicatarios"] == 1) & (clave != ""), None)
    df["evl"] = df["link"].fillna("").str.extract(r"idEvl=(.+)$")[0]
    for r in st.REGLAS.values():
        m = df["regla"] == r.clave
        lo, mid, hi = (round(x * 100) for x in (r.ref_desde, r.cerca_desde, r.umbral))
        df.loc[m, "cerca"] = (df.loc[m, "cent"] > mid) & (df.loc[m, "cent"] <= hi)
        df.loc[m, "ref"] = (df.loc[m, "cent"] > lo) & (df.loc[m, "cent"] <= mid)
        df.loc[m, "sobre"] = df.loc[m, "cent"] > hi
    for c in ("cerca", "ref", "sobre"):
        df[c] = df[c].astype(bool)
    return df, embudo


# ------------------------------------------------------------------------ unidades

def _articulo(nombre: str) -> str:
    """'Valdecolmenas, Los' -> 'Los Valdecolmenas'."""
    m = re.match(r"^(.*), (El|La|Los|Las|L'|Els|Les|Es|Sa|O|A|Os|As)$", nombre)
    return f"{m.group(2)} {m.group(1)}" if m else nombre


def nombre_entidad(rutas: list[str], nombres: list[str]) -> tuple[str, str]:
    """Nombre legible y ruta común de una entidad (conjunto de órganos con el mismo NIF)."""
    partes = [r.split(" > ") for r in rutas if r]
    comun = []
    if partes:
        for trozos in zip(*partes):
            if len(set(trozos)) == 1:
                comun.append(trozos[0])
            else:
                break
    ruta = " > ".join(comun)
    if len(comun) >= 2 and comun[-2] == "Ayuntamientos":
        return f"Ayuntamiento de {_articulo(comun[-1])}", ruta
    if len(comun) >= 3 and comun[-1].upper() != comun[-1]:
        return comun[-1], ruta
    # Sin tronco común útil: prefijo común de los nombres de órgano, o el más frecuente.
    return Counter(nombres).most_common(1)[0][0] + " y otros órganos del mismo NIF", ruta


def construir_unidades(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Añade df['entidad'] y devuelve los metadatos de cada unidad (órgano o entidad)."""
    ult = df.sort_values("updated").groupby("organo_id").tail(1).set_index("organo_id")
    meta = {}
    for oid, r in ult.iterrows():
        meta[oid] = {
            "id": oid, "clase": "organo", "nombre": r["organo_nombre"] or "(sin nombre)",
            "ruta": (r["organo_jerarquia"] or "").removeprefix("Sector Público > "),
            "nif": r["organo_nif"], "ciudad": r["organo_ciudad"],
        }
    por_nif = ult.reset_index().groupby("organo_nif")
    df["entidad"] = None
    for nif, g in por_nif:
        if len(g) < 2 or not nif:
            continue
        eid = "E" + nif
        nombre, ruta = nombre_entidad(g["organo_jerarquia"].fillna("").tolist(),
                                      g["organo_nombre"].fillna("").tolist())
        meta[eid] = {
            "id": eid, "clase": "entidad", "nombre": nombre,
            "ruta": ruta.removeprefix("Sector Público > ").removeprefix("Sector Público"),
            "nif": nif, "ciudad": None, "organos": g["organo_id"].tolist(),
        }
        for oid in g["organo_id"]:
            meta[oid]["entidad"] = eid
    ent = {oid: m.get("entidad") for oid, m in meta.items() if m["clase"] == "organo"}
    df["entidad"] = df["organo_id"].map(ent)
    for m in meta.values():
        top = (m["ruta"] or "").split(" > ")[0]
        m["ambito"] = AMBITOS.get(top, "otras")
    return df, meta


# ----------------------------------------------------------------- cálculo por grupo

def resumen_regla(g: pd.DataFrame, r: st.Regla) -> dict:
    """Cifras de un grupo de contratos (ya filtrado a una regla)."""
    a = st.acumulacion(int(g["cerca"].sum()), int(g["ref"].sum()), r.k)
    d = {
        "n": len(g), "n_cerca": a.n_cerca, "n_ref": a.n_ref,
        "esperado": round(a.esperado, 1),
        "razon": None if a.razon is None else round(a.razon, 2),
        "ic_inf": round(a.ic_inf, 2),
        "ic_sup": None if a.ic_sup is None else round(a.ic_sup, 2),
        "p": a.p,
    }
    return d


def ficha_regla(g: pd.DataFrame, r: st.Regla) -> dict:
    """Detalle de una unidad para una regla: histograma, meses, adjudicatarios, contratos."""
    d = resumen_regla(g, r)
    d["hist"] = st.histograma(g["cent"].to_numpy(), r.ancho_tramo, r.max_grafico)
    d["sobre_umbral"] = int(g["sobre"].sum())
    d["importe_total"] = round(float(g["importe"].sum()), 2)
    cerca = g[g["cerca"]]
    d["importe_cerca"] = round(float(cerca["importe"].sum()), 2)
    d["meses_todos"] = np.bincount(g["mes"], minlength=13)[1:].tolist()
    d["meses_cerca"] = np.bincount(cerca["mes"], minlength=13)[1:].tolist()
    d["anios"] = {
        str(y): {"n": int((g["anio"] == y).sum()),
                 "n_cerca": int(((g["anio"] == y) & g["cerca"]).sum()),
                 "n_ref": int(((g["anio"] == y) & g["ref"]).sum())}
        for y in sorted(g["anio"].unique())
    }
    # Adjudicatarios con seudónimo: A es el que más contratos tiene junto al límite.
    cuenta = cerca["adj"].dropna().value_counts()
    orden = sorted(cuenta.index, key=lambda k: (-cuenta[k], k))
    alias = {k: _alias(i) for i, k in enumerate(orden)}
    d["n_adj_cerca"] = len(orden)
    rep = []
    for k in orden:
        if cuenta[k] < MIN_REPETIDOS:
            break
        ck = cerca[cerca["adj"] == k]
        por_anio = ck["anio"].value_counts()
        rep.append({
            "alias": alias[k], "n_cerca": int(cuenta[k]),
            "importe_cerca": round(float(ck["importe"].sum()), 2),
            "anios": sorted(int(y) for y in por_anio.index),
            "max_en_un_anio": int(por_anio.max()),
            "n_total": int((g["adj"] == k).sum()),
        })
    d["repetidos"] = rep
    d["n_cerca_repetidos"] = int(sum(x["n_cerca"] for x in rep))
    orden_c = cerca.sort_values(["fecha_adj", "id"], ascending=[False, False])
    d["contratos"] = [
        {"f": row.fecha_adj, "i": round(row.importe, 2), "e": (row.expediente or "")[:40],
         "a": alias.get(row.adj), "u": row.evl if isinstance(row.evl, str) else None,
         "c": row.cpv2 if isinstance(row.cpv2, str) else None}
        for row in orden_c.head(MAX_CONTRATOS_FICHA).itertuples()
    ]
    return d


def _alias(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def tabla_grupos(df: pd.DataFrame, col: str, r: st.Regla) -> pd.DataFrame:
    """Recuentos y estadístico por grupo, con valores q (BH) entre los evaluables."""
    g = df[df["regla"] == r.clave].groupby(col)
    t = pd.DataFrame({"n": g.size(), "n_cerca": g["cerca"].sum(), "n_ref": g["ref"].sum()})
    t = t.astype(int)
    acs = [st.acumulacion(a, b, r.k) for a, b in zip(t["n_cerca"], t["n_ref"])]
    t["esperado"] = [round(a.esperado, 1) for a in acs]
    t["razon"] = [None if a.razon is None else round(a.razon, 2) for a in acs]
    t["ic_inf"] = [round(a.ic_inf, 2) for a in acs]
    t["ic_sup"] = [None if a.ic_sup is None else round(a.ic_sup, 2) for a in acs]
    t["p"] = [a.p for a in acs]
    eval_ = (t["n_cerca"] + t["n_ref"]) >= st.MIN_VENTANA
    t["q"] = np.nan
    t.loc[eval_, "q"] = st.benjamini_hochberg(t.loc[eval_, "p"])
    t["nivel"] = [st.nivel(a, None if np.isnan(q) else q) for a, q in zip(acs, t["q"])]
    return t


# ------------------------------------------------------------------------ nacional

def nacional(df: pd.DataFrame, embudo: dict, meta: dict, tablas: dict) -> dict:
    out = {"embudo": embudo, "periodo": [config.FECHA_MIN, config.FECHA_MAX]}
    out["n_organos"] = sum(1 for m in meta.values() if m["clase"] == "organo")
    out["n_entidades"] = sum(1 for m in meta.values() if m["clase"] == "entidad")
    out["reglas"] = {}
    for r in st.REGLAS.values():
        g = df[df["regla"] == r.clave]
        d = resumen_regla(g, r)
        d["hist"] = st.histograma(g["cent"].to_numpy(), r.ancho_tramo, r.max_grafico)
        d["sobre_umbral"] = int(g["sobre"].sum())
        d["importe_total"] = round(float(g["importe"].sum()), 2)
        d["importe_cerca"] = round(float(g.loc[g["cerca"], "importe"].sum()), 2)
        d["pct_cerca"] = round(100 * d["n_cerca"] / len(g), 2)
        top = g.loc[g["cerca"], "importe"].round(2).value_counts().head(8)
        d["importes_frecuentes"] = [{"importe": float(k), "n": int(v)} for k, v in top.items()]
        d["anios"] = {}
        for y, gy in g.groupby("anio"):
            d["anios"][str(y)] = resumen_regla(gy, r)
        d["meses"] = []
        for m in range(1, 13):
            gm = g[g["mes"] == m]
            x = resumen_regla(gm, r)
            d["meses"].append({"mes": m, "n": x["n"], "n_cerca": x["n_cerca"], "razon": x["razon"],
                               "ic_inf": x["ic_inf"], "ic_sup": x["ic_sup"]})
        d["pct_dic_todos"] = round(100 * float((g["mes"] == 12).mean()), 1)
        d["pct_dic_cerca"] = round(100 * float((g.loc[g["cerca"], "mes"] == 12).mean()), 1)
        d["ambitos"] = {}
        amb = g["organo_id"].map(lambda o: meta[o]["ambito"])
        for a, ga in g.groupby(amb):
            d["ambitos"][a] = resumen_regla(ga, r)
        for clase in ("organo", "entidad"):
            t = tablas[(clase, r.clave)]
            d[f"niveles_{clase}"] = {k: int(v) for k, v in t["nivel"].value_counts().items()}
        out["reglas"][r.clave] = d

    # Umbrales ficticios (placebo): la misma cuenta moviendo el «límite» de 7.000 a 18.000 €.
    ss = df.loc[df["regla"] == "ss", "cent"].to_numpy()
    curva = []
    for t in range(7000, 18001, 500):
        a = st.acumulacion(st.contar_franja(ss, t - 1000, t), st.contar_franja(ss, t - 6000, t - 1000), 5)
        curva.append({"umbral": t, "n_cerca": a.n_cerca, "razon": round(a.razon, 2),
                      "ic_inf": round(a.ic_inf, 2), "ic_sup": round(a.ic_sup, 2)})
    out["placebo_ss"] = curva

    # Familias CPV (división, dos primeros dígitos), servicios y suministros.
    g = df[df["regla"] == "ss"]
    out["cpv_cobertura_pct"] = round(100 * float(g["cpv2"].notna().mean()), 1)
    t = tabla_grupos(df[df["cpv2"].notna()], "cpv2", st.REGLAS["ss"])
    t = t.sort_values("ic_inf", ascending=False)
    out["cpv_nombres"] = [[k, v, cpv.DIVISIONS_EN[k]] for k, v in cpv.DIVISIONES.items()]
    out["cpv"] = [
        {"cpv": k, "nombre": cpv.DIVISIONES[k], "nombre_en": cpv.DIVISIONS_EN[k],
         **{c: _limpio(row[c]) for c in ("n", "n_cerca", "n_ref", "esperado", "razon", "ic_inf", "ic_sup", "q", "nivel")}}
        for k, row in t.iterrows()
    ]
    return out


def _limpio(v):
    if v is None:
        return None
    if isinstance(v, (float, np.floating)):
        if np.isnan(v):
            return None
        return float(v) if abs(v) >= 1e-4 or v == 0 else float(f"{v:.2e}")
    if isinstance(v, np.integer):
        return int(v)
    return v


# --------------------------------------------------------------------------- salida

def hechos_hash(ficha: dict) -> str:
    """Huella de las cifras de una ficha; si cambian, la explicación guardada caduca."""
    base = {k: {c: v[c] for c in ("n", "n_cerca", "n_ref", "razon", "ic_inf", "ic_sup", "nivel",
                                  "meses_cerca", "repetidos", "sobre_umbral")}
            for k, v in ficha["reglas"].items()}
    base["contratos"] = {k: [c["u"] for c in v["contratos"][:5]] for k, v in ficha["reglas"].items()}
    s = json.dumps(base, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(s.encode()).hexdigest()[:16]


def _json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False), "utf-8")


def ejecutar() -> None:
    t0 = datetime.now()
    print(f"[{t0:%H:%M:%S}] Cargando contratos…", flush=True)
    df, embudo = cargar()
    df, meta = construir_unidades(df)
    print(f"[{datetime.now():%H:%M:%S}] {len(df):,} contratos, {len(meta):,} unidades", flush=True)

    tablas = {}
    for r in st.REGLAS.values():
        tablas[("organo", r.clave)] = tabla_grupos(df, "organo_id", r)
        tablas[("entidad", r.clave)] = tabla_grupos(df[df["entidad"].notna()], "entidad", r)

    nac = nacional(df, embudo, meta, tablas)
    manifest = json.loads((config.RAW / "manifest.json").read_text("utf-8"))
    nac["fuente"] = [{"periodo": k, "url": v["url"], "bytes": v["bytes"], "sha256": v["sha256"],
                      "last_modified": v["last_modified"], "descargado": v["descargado"]}
                     for k, v in sorted(manifest.items())]
    nac["criterios"] = {"min_ventana": st.MIN_VENTANA, "min_cerca": st.MIN_CERCA, "q_max": st.Q_MAX,
                        "ic_inf_min": st.IC_INF_MIN,
                        "reglas": {r.clave: {"umbral": r.umbral, "cerca_desde": r.cerca_desde,
                                             "ref_desde": r.ref_desde, "ancho_tramo": r.ancho_tramo,
                                             "max_grafico": r.max_grafico} for r in st.REGLAS.values()}}

    # Fichas por unidad
    datos = config.SITE_DATA
    if (datos / "u").exists():
        shutil.rmtree(datos / "u")
    (datos / "u").mkdir(parents=True)
    indice, fichas_senal = [], {}
    grupos = {"organo": {k: g for k, g in df.groupby("organo_id")},
              "entidad": {k: g for k, g in df[df["entidad"].notna()].groupby("entidad")}}
    for uid, m in meta.items():
        g = grupos[m["clase"]].get(uid)
        if g is None:
            continue
        ficha = {**{k: m.get(k) for k in ("id", "clase", "nombre", "ruta", "nif", "ciudad", "ambito")},
                 "n": len(g), "importe_total": round(float(g["importe"].sum()), 2), "reglas": {}}
        if m["clase"] == "organo" and m.get("entidad"):
            ficha["entidad"] = {"id": m["entidad"], "nombre": meta[m["entidad"]]["nombre"]}
        fila = [uid, 0 if m["clase"] == "organo" else 1, m["nombre"], m["ruta"], len(g)]
        for r in st.REGLAS.values():
            gr = g[g["regla"] == r.clave]
            t = tablas[(m["clase"], r.clave)]
            if len(gr) == 0 or uid not in t.index:
                fila += [None, None, None, None, 0]
                continue
            fr = ficha_regla(gr, r)
            fr["q"] = _limpio(t.at[uid, "q"])
            fr["p"] = _limpio(fr["p"])
            fr["nivel"] = t.at[uid, "nivel"]
            ficha["reglas"][r.clave] = fr
            fila += [fr["nivel"], fr["razon"], fr["ic_inf"], fr["ic_sup"], fr["n_cerca"]]
        if m["clase"] == "entidad":
            ficha["organos"] = sorted(
                ({"id": o, "nombre": meta[o]["nombre"], "n": len(grupos["organo"][o]),
                  "nivel": _nivel_max(tablas, o)} for o in m["organos"] if o in grupos["organo"]),
                key=lambda x: -x["n"])
        ficha["hash"] = hechos_hash(ficha)
        indice.append(fila)
        if any(v["nivel"] == "senal" for v in ficha["reglas"].values()):
            fichas_senal[uid] = ficha
        _json(datos / "u" / f"{uid}.json", ficha)

    indice.sort(key=lambda f: -f[4])
    _json(datos / "indice.json", {"cols": ["id", "clase", "nombre", "ruta", "n", "nivel_ss", "razon_ss",
                                           "ic_inf_ss", "ic_sup_ss", "n_cerca_ss", "nivel_obras",
                                           "razon_obras", "ic_inf_obras", "ic_sup_obras", "n_cerca_obras"], "filas": indice})
    nac["generado"] = datetime.now().strftime("%Y-%m-%d")
    nac["n_fichas"] = len(indice)
    nac["n_con_senal"] = len(fichas_senal)
    _json(datos / "nacional.json", nac)

    # resultados/: cifras y rankings legibles
    config.OUT.mkdir(exist_ok=True)
    (config.OUT / "cifras.json").write_text(
        json.dumps({k: v for k, v in nac.items()}, ensure_ascii=False, indent=1), "utf-8")
    for (clase, regla), t in tablas.items():
        tt = t[t["nivel"] != "insuficiente"].sort_values("ic_inf", ascending=False)
        with open(config.OUT / f"ranking_{clase}_{regla}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["id", "nombre", "ruta", "contratos", "junto_al_limite", "referencia", "esperado",
                        "razon", "ic95_inf", "ic95_sup", "q", "nivel"])
            for uid, row in tt.iterrows():
                w.writerow([uid, meta[uid]["nombre"], meta[uid]["ruta"], row["n"], row["n_cerca"],
                            row["n_ref"], row["esperado"], row["razon"], row["ic_inf"], row["ic_sup"],
                            f"{row['q']:.3g}", row["nivel"]])
    _json(config.WORK / "fichas_senal.json", fichas_senal)
    from . import explain
    explain.fusionar()
    print(f"[{datetime.now():%H:%M:%S}] Hecho en {(datetime.now() - t0).seconds} s: "
          f"{len(indice):,} fichas, {len(fichas_senal):,} con señal", flush=True)


def _nivel_max(tablas, oid) -> str:
    orden = ["insuficiente", "sin_senal", "indicio", "senal"]
    niveles = [tablas[("organo", k)].at[oid, "nivel"] for k in st.REGLAS if oid in tablas[("organo", k)].index]
    return max(niveles, key=orden.index) if niveles else "insuficiente"


if __name__ == "__main__":
    ejecutar()
