import io
import sqlite3

from allimite import analyze, parse

ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
 xmlns:cbc="urn:dgpe:names:draft:codice:schema:xsd:CommonBasicComponents-2"
 xmlns:cac="urn:dgpe:names:draft:codice:schema:xsd:CommonAggregateComponents-2"
 xmlns:cac-place-ext="urn:dgpe:names:draft:codice-place-ext:schema:xsd:CommonAggregateComponents-2"
 xmlns:cbc-place-ext="urn:dgpe:names:draft:codice-place-ext:schema:xsd:CommonBasicComponents-2"
 xmlns:at="http://purl.org/atompub/tombstones/1.0">
 <at:deleted-entry ref="https://contrataciondelestado.es/sindicacion/datosAbiertosMenores/77" when="2024-05-02T10:00:00.000+02:00">
  <at:comment type="ANULADA"/>
 </at:deleted-entry>
 <entry>
  <id>https://contrataciondelestado.es/sindicacion/datosAbiertosMenores/42</id>
  <link href="https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&amp;idEvl=abc%3D%3D"/>
  <title>Suministro de prueba</title>
  <updated>{updated}</updated>
  <cac-place-ext:ContractFolderStatus>
   <cbc:ContractFolderID>EXP/1</cbc:ContractFolderID>
   <cbc-place-ext:ContractFolderStatusCode>RES</cbc-place-ext:ContractFolderStatusCode>
   <cac-place-ext:LocatedContractingParty>
    <cbc:ContractingPartyTypeCode>3</cbc:ContractingPartyTypeCode>
    <cac:Party>
     <cac:PartyIdentification><cbc:ID schemeName="NIF">p-0200100f</cbc:ID></cac:PartyIdentification>
     <cac:PartyIdentification><cbc:ID schemeName="ID_PLATAFORMA">310</cbc:ID></cac:PartyIdentification>
     <cac:PartyName><cbc:Name>Alcaldía de Ejemplo</cbc:Name></cac:PartyName>
    </cac:Party>
    <cac-place-ext:ParentLocatedParty><cac:PartyName><cbc:Name>Ejemplo</cbc:Name></cac:PartyName>
     <cac-place-ext:ParentLocatedParty><cac:PartyName><cbc:Name>Ayuntamientos</cbc:Name></cac:PartyName>
      <cac-place-ext:ParentLocatedParty><cac:PartyName><cbc:Name>Sector Público</cbc:Name></cac:PartyName>
      </cac-place-ext:ParentLocatedParty></cac-place-ext:ParentLocatedParty></cac-place-ext:ParentLocatedParty>
   </cac-place-ext:LocatedContractingParty>
   <cac:ProcurementProject>
    <cbc:Name>Suministro de prueba</cbc:Name><cbc:TypeCode>1</cbc:TypeCode>
    <cac:BudgetAmount><cbc:TaxExclusiveAmount currencyID="EUR">15000</cbc:TaxExclusiveAmount></cac:BudgetAmount>
    <cac:RequiredCommodityClassification><cbc:ItemClassificationCode>30192000</cbc:ItemClassificationCode></cac:RequiredCommodityClassification>
   </cac:ProcurementProject>
   <cac:TenderResult>
    <cbc:ResultCode>8</cbc:ResultCode><cbc:AwardDate>2024-03-07</cbc:AwardDate>
    <cac:WinningParty><cac:PartyIdentification><cbc:ID schemeName="NIF">b-123 456 78</cbc:ID></cac:PartyIdentification>
     <cac:PartyName><cbc:Name>Proveedor</cbc:Name></cac:PartyName></cac:WinningParty>
    <cac:AwardedTenderedProject><cac:LegalMonetaryTotal>
     <cbc:TaxExclusiveAmount currencyID="EUR">{importe}</cbc:TaxExclusiveAmount>
     <cbc:PayableAmount currencyID="EUR">18137.9</cbc:PayableAmount></cac:LegalMonetaryTotal></cac:AwardedTenderedProject>
   </cac:TenderResult>
  </cac-place-ext:ContractFolderStatus>
 </entry>
</feed>"""


def leer(updated="2024-03-08T09:00:00.000+01:00", importe="14990"):
    xml = ATOM.format(updated=updated, importe=importe).encode("utf-8")
    return list(parse.iter_atom(io.BytesIO(xml)))


def test_lee_entrada_y_aviso_de_borrado():
    filas = leer()
    tipos = [k for k, _ in filas]
    assert sorted(tipos) == ["deleted", "entry"]
    borrado = dict(filas)["deleted"]
    assert borrado[0] == 77 and borrado[2] == "ANULADA" and borrado[1].startswith("2024-05-02T08:00:00")
    r = dict(zip(parse.COLS, dict(filas)["entry"]))
    assert r["id"] == 42 and r["expediente"] == "EXP/1" and r["estado"] == "RES"
    assert r["organo_id"] == "310" and r["organo_nif"] == "P0200100F"
    assert r["organo_jerarquia"] == "Sector Público > Ayuntamientos > Ejemplo"
    assert r["tipo"] == "1" and r["cpv"] == "30192000"
    assert r["fecha_adj"] == "2024-03-07" and r["resultado"] == "8"
    assert r["adj_nif"] == "B12345678" and r["n_adjudicatarios"] == 1
    assert r["importe_sin_iva"] == 14990.0 and r["presupuesto_sin_iva"] == 15000.0
    assert r["updated"].startswith("2024-03-08T08:00:00")  # normalizada a UTC
    assert r["link"].endswith("idEvl=abc%3D%3D")


def test_se_conserva_la_version_mas_reciente():
    con = sqlite3.connect(":memory:")
    con.executescript(parse.SCHEMA)
    nueva = dict(leer("2024-06-01T09:00:00.000+02:00", "14000"))["entry"]
    vieja = dict(leer("2024-03-08T09:00:00.000+01:00", "14990"))["entry"]
    for fila in (nueva, vieja, nueva):  # el orden de llegada no debe importar
        con.execute(parse.UPSERT, fila)
    assert con.execute("SELECT COUNT(*), MAX(importe_sin_iva) FROM contratos").fetchone() == (1, 14000.0)


def test_nombre_de_entidad():
    r = "Sector Público > ENTIDADES LOCALES > Aragón > Teruel > Ayuntamientos > Codoñera, La"
    assert analyze.nombre_entidad([r, r], ["Alcaldía", "Pleno"])[0] == "Ayuntamiento de La Codoñera"
    a = "Sector Público > COMUNIDADES Y CIUDADES AUTÓNOMAS > Comunidad Valenciana > Conselleria de Sanidad"
    b = "Sector Público > COMUNIDADES Y CIUDADES AUTÓNOMAS > Comunidad Valenciana"
    assert analyze.nombre_entidad([a, b], ["x", "y"])[0] == "Comunidad Valenciana"
    # rutas que no coinciden: decide la mayoritaria si es un ayuntamiento
    c = "Sector Público > ENTIDADES LOCALES > Castilla La Mancha > Ciudad Real > Ayuntamientos > Alcubillas"
    d = "Sector Público > ENTIDADES LOCALES > Castilla - La Mancha > Ciudad Real > Ayuntamientos > Alcubillas"
    assert analyze.nombre_entidad([c, c, d], ["x", "y", "z"])[0] == "Ayuntamiento de Alcubillas"


def test_alias_de_adjudicatarios():
    assert [analyze._alias(i) for i in (0, 25, 26, 27, 701, 702)] == ["A", "Z", "AA", "AB", "ZZ", "AAA"]
