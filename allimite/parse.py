"""Lee los ZIP de la PLACSP (ficheros ATOM con CODICE) y deja una tabla SQLite.

Uso:  python -m allimite.parse

Cada contrato puede aparecer varias veces (una por actualización). Se conserva la
versión con fecha `updated` más reciente y se anotan aparte los avisos de borrado
o anulación (`at:deleted-entry`) para descartar esos contratos en el análisis.
"""
from __future__ import annotations

import sqlite3
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from lxml import etree

from . import config

NS = {
    "a": "http://www.w3.org/2005/Atom",
    "cbc": "urn:dgpe:names:draft:codice:schema:xsd:CommonBasicComponents-2",
    "cac": "urn:dgpe:names:draft:codice:schema:xsd:CommonAggregateComponents-2",
    "cace": "urn:dgpe:names:draft:codice-place-ext:schema:xsd:CommonAggregateComponents-2",
    "cbce": "urn:dgpe:names:draft:codice-place-ext:schema:xsd:CommonBasicComponents-2",
    "at": "http://purl.org/atompub/tombstones/1.0",
}
ENTRY = "{%s}entry" % NS["a"]
DELETED = "{%s}deleted-entry" % NS["at"]

COLS = [
    "id", "updated", "link", "expediente", "estado",
    "organo_id", "organo_nif", "organo_nombre", "organo_tipo", "organo_jerarquia",
    "organo_ciudad", "organo_cp", "titulo", "tipo", "cpv", "nuts",
    "presupuesto_sin_iva", "n_resultados", "resultado", "fecha_adj",
    "adj_nif", "adj_nombre", "n_adjudicatarios", "importe_sin_iva", "importe_con_iva",
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS contratos (
  id INTEGER PRIMARY KEY, updated TEXT, link TEXT, expediente TEXT, estado TEXT,
  organo_id TEXT, organo_nif TEXT, organo_nombre TEXT, organo_tipo TEXT, organo_jerarquia TEXT,
  organo_ciudad TEXT, organo_cp TEXT, titulo TEXT, tipo TEXT, cpv TEXT, nuts TEXT,
  presupuesto_sin_iva REAL, n_resultados INTEGER, resultado TEXT, fecha_adj TEXT,
  adj_nif TEXT, adj_nombre TEXT, n_adjudicatarios INTEGER, importe_sin_iva REAL, importe_con_iva REAL
);
CREATE TABLE IF NOT EXISTS borrados (id INTEGER PRIMARY KEY, cuando TEXT, motivo TEXT);
CREATE TABLE IF NOT EXISTS ficheros (zip TEXT, atom TEXT, entradas INTEGER, borrados INTEGER,
  PRIMARY KEY (zip, atom));
"""

UPSERT = (
    "INSERT INTO contratos (" + ",".join(COLS) + ") VALUES (" + ",".join("?" * len(COLS)) + ") "
    "ON CONFLICT(id) DO UPDATE SET "
    + ",".join(c + "=excluded." + c for c in COLS if c != "id")
    + " WHERE excluded.updated > contratos.updated"
)
UPSERT_DEL = (
    "INSERT INTO borrados (id, cuando, motivo) VALUES (?,?,?) "
    "ON CONFLICT(id) DO UPDATE SET cuando=excluded.cuando, motivo=excluded.motivo "
    "WHERE excluded.cuando > borrados.cuando"
)


def _t(node, path):
    """Texto del primer nodo que cumple `path`, o None."""
    if node is None:
        return None
    r = node.find(path, NS)
    if r is None or r.text is None:
        return None
    s = r.text.strip()
    return s or None


def _f(node, path):
    s = _t(node, path)
    if s is None:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _iso(s):
    """Pasa la fecha `updated` a UTC en formato ISO, comparable como texto."""
    if not s:
        return ""
    try:
        return datetime.fromisoformat(s).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")
    except ValueError:
        return s


def _id_num(uri):
    try:
        return int(uri.rstrip("/").rsplit("/", 1)[1])
    except (IndexError, ValueError, AttributeError):
        return None


def limpia_nif(s):
    return "".join(ch for ch in (s or "").upper() if ch.isalnum())


def parse_entry(e):
    """Convierte un <entry> en una tupla con el orden de COLS (o None si no vale)."""
    cid = _id_num(_t(e, "a:id"))
    if cid is None:
        return None
    link = e.find("a:link", NS)
    cfs = e.find("cace:ContractFolderStatus", NS)
    if cfs is None:
        return None
    lcp = cfs.find("cace:LocatedContractingParty", NS)
    party = lcp.find("cac:Party", NS) if lcp is not None else None
    organo_id = organo_nif = None
    if party is not None:
        for pid in party.findall("cac:PartyIdentification/cbc:ID", NS):
            scheme = pid.get("schemeName")
            if scheme == "ID_PLATAFORMA":
                organo_id = (pid.text or "").strip() or None
            elif scheme == "NIF":
                organo_nif = limpia_nif(pid.text) or None
    # Jerarquía administrativa, de lo más general a lo más concreto.
    jer = []
    p = lcp.find("cace:ParentLocatedParty", NS) if lcp is not None else None
    while p is not None:
        n = _t(p, "cac:PartyName/cbc:Name")
        if n:
            jer.append(n)
        p = p.find("cace:ParentLocatedParty", NS)
    jer.reverse()
    pp = cfs.find("cac:ProcurementProject", NS)
    resultados = cfs.findall("cac:TenderResult", NS)
    imp = imp_iva = None
    fechas, nifs, nombres, codigos = [], [], [], []
    for r in resultados:
        v = _f(r, "cac:AwardedTenderedProject/cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount")
        if v is not None:
            imp = (imp or 0.0) + v
        v = _f(r, "cac:AwardedTenderedProject/cac:LegalMonetaryTotal/cbc:PayableAmount")
        if v is not None:
            imp_iva = (imp_iva or 0.0) + v
        d = _t(r, "cbc:AwardDate")
        if d:
            fechas.append(d[:10])
        c = _t(r, "cbc:ResultCode")
        if c:
            codigos.append(c)
        for w in r.findall("cac:WinningParty", NS):
            nif = limpia_nif(_t(w, "cac:PartyIdentification/cbc:ID"))
            nom = _t(w, "cac:PartyName/cbc:Name") or ""
            if nif or nom:
                nifs.append(nif)
                nombres.append(nom)
    unicos = sorted(set(n for n in nifs if n)) or sorted(set(n for n in nombres if n))
    return (
        cid,
        _iso(_t(e, "a:updated")),
        link.get("href") if link is not None else None,
        _t(cfs, "cbc:ContractFolderID"),
        _t(cfs, "cbce:ContractFolderStatusCode"),
        organo_id,
        organo_nif,
        _t(party, "cac:PartyName/cbc:Name"),
        _t(lcp, "cbc:ContractingPartyTypeCode"),
        " > ".join(jer),
        _t(party, "cac:PostalAddress/cbc:CityName"),
        _t(party, "cac:PostalAddress/cbc:PostalZone"),
        _t(pp, "cbc:Name") or _t(e, "a:title"),
        _t(pp, "cbc:TypeCode"),
        _t(pp, "cac:RequiredCommodityClassification/cbc:ItemClassificationCode"),
        _t(pp, "cac:RealizedLocation/cbc:CountrySubentityCode"),
        _f(pp, "cac:BudgetAmount/cbc:TaxExclusiveAmount"),
        len(resultados),
        ",".join(sorted(set(codigos))) or None,
        min(fechas) if fechas else None,
        unicos[0] if len(unicos) == 1 else None,
        nombres[0] if len(unicos) == 1 and nombres else None,
        len(unicos),
        imp,
        imp_iva,
    )


def iter_atom(fobj):
    """Genera ('entry', tupla) y ('deleted', (id, cuando, motivo)) de un fichero ATOM."""
    for _, el in etree.iterparse(fobj, events=("end",), tag=(ENTRY, DELETED), huge_tree=True):
        if el.tag == ENTRY:
            row = parse_entry(el)
            if row is not None:
                yield "entry", row
        else:
            cid = _id_num(el.get("ref"))
            if cid is not None:
                com = el.find("at:comment", NS)
                yield "deleted", (cid, _iso(el.get("when")), com.get("type") if com is not None else None)
        el.clear()
        while el.getprevious() is not None:
            del el.getparent()[0]


def cargar(zips=None) -> None:
    config.WORK.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(config.DB)
    con.executescript(SCHEMA)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=OFF")
    hechos = set(con.execute("SELECT zip, atom FROM ficheros"))
    zips = zips or sorted(config.RAW.glob("contratosMenores_*.zip"))
    for zp in zips:
        with zipfile.ZipFile(zp) as z:
            nombres = sorted(n for n in z.namelist() if n.endswith(".atom"))
            print(f"[{datetime.now():%H:%M:%S}] {zp.name}: {len(nombres)} ficheros ATOM", flush=True)
            for i, name in enumerate(nombres):
                if (zp.name, name) in hechos:
                    continue
                ents, dels = [], []
                with z.open(name) as f:
                    for kind, row in iter_atom(f):
                        (ents if kind == "entry" else dels).append(row)
                con.executemany(UPSERT, ents)
                con.executemany(UPSERT_DEL, dels)
                con.execute("INSERT OR REPLACE INTO ficheros VALUES (?,?,?,?)",
                            (zp.name, name, len(ents), len(dels)))
                con.commit()
                if i % 200 == 0:
                    print(f"[{datetime.now():%H:%M:%S}]   {zp.name} {i}/{len(nombres)}", flush=True)
    n = con.execute("SELECT COUNT(*) FROM contratos").fetchone()[0]
    nb = con.execute("SELECT COUNT(*) FROM borrados").fetchone()[0]
    print(f"[{datetime.now():%H:%M:%S}] Contratos distintos: {n:,}; avisos de borrado: {nb:,}", flush=True)
    con.close()


if __name__ == "__main__":
    cargar([Path(p) for p in sys.argv[1:]] or None)
