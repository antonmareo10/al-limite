"""El verificador debe aceptar textos fieles a los hechos y rechazar todo lo demás."""
import pytest

from allimite import explain as ex


def ficha():
    regla = {
        "n": 812, "n_cerca": 96, "n_ref": 120, "esperado": 24.0, "razon": 4.0, "ic_inf": 3.03, "ic_sup": 5.27,
        "nivel": "senal", "meses_cerca": [5, 6, 7, 8, 8, 9, 7, 3, 8, 9, 10, 16],
        "meses_todos": [50, 60, 70, 70, 70, 70, 60, 30, 70, 80, 82, 100],
        "n_adj_cerca": 41, "sobre_umbral": 2,
        "repetidos": [{"alias": "A", "n_cerca": 11, "importe_cerca": 163_900.0, "anios": [2023, 2024],
                       "max_en_un_anio": 6, "n_total": 14}],
        "contratos": [
            {"f": "2025-11-20", "i": 14990.0, "e": "X/1", "a": "A", "u": "aaa", "c": "79"},
            {"f": "2025-10-02", "i": 14876.03, "e": "X/2", "a": "B", "u": "bbb", "c": None},
            {"f": "2025-06-30", "i": 15000.0, "e": "X/3", "a": None, "u": "ccc", "c": "72"},
        ],
    }
    return {"id": "1", "nombre": "Ayuntamiento de Ejemplo", "reglas": {"ss": regla}, "hash": "abc"}


def bueno(lang):
    """Un texto como el que se pide al modelo: hechos copiados y dos apartados propios."""
    f = ex.hechos(ficha(), lang)["frases"]
    datos = " ".join([f[0], f[1], f[2], f[5], f[6]])
    if lang == "es":
        return (f"Qué muestran los datos: {datos}\n"
                "Qué no pueden demostrar: que haya muchos importes pegados al límite es un indicador estadístico. "
                "No demuestra que se haya partido ningún contrato ni que alguien haya actuado mal, porque puede haber "
                "razones legítimas, como los precios de mercado o unas necesidades distintas entre sí.\n"
                "Qué se puede revisar: conviene mirar en los expedientes qué se contrató al adjudicatario que más repite "
                "y si esos encargos atienden una misma necesidad. También ayuda comparar las fechas, empezando por el "
                "contrato [1].")
    return (f"What the data shows: {datos}\n"
            "What it cannot show: many amounts sitting right under the limit is a statistical indicator. It does not "
            "prove that any contract was broken up or that anyone acted improperly, because there can be legitimate "
            "reasons such as market prices or needs that are separate from each other.\n"
            "What can be checked: it is worth looking in the files at what was bought from the awardee that repeats "
            "most and whether those jobs meet a single need. Comparing the dates also helps, starting with contract [1].")


def test_formato_numerico():
    assert ex.num(14990.0, "es") == "14.990"
    assert ex.num(14876.03, "es") == "14.876,03"
    assert ex.num(14876.03, "en") == "14,876.03"
    assert ex.num(4.0, "es", 1) == "4,0"
    assert ex.numeros("de 14.000 a 15.000 euros, razón 4,0 y 95 %.", "es") == [14000, 15000, 4.0, 95]
    assert ex.numeros("14,876.03 euros in 2025", "en") == [14876.03, 2025]
    assert ex.numeros("la razón es 4.2", "es") is None  # separador decimal equivocado
    assert ex.numeros("the ratio is 4,2", "en") is None


def test_frases_no_rompen_cifras():
    s = "Hubo 14.000 casos. La razón es 4,0, con un intervalo del 95 % de 3,0 a 5,3. El contrato [1] es de 2025."
    assert len(ex._frases(s)) == 3


def test_los_hechos_llevan_las_cifras_calculadas():
    f = ex.hechos(ficha(), "es")["frases"]
    assert "96 contratos" in f[0] and "14.000" in f[0] and "15.000" in f[0]
    assert "24,0" in f[1]
    assert "4,0" in f[2] and "de 3,0 a 5,3" in f[2]
    assert "17 %" in f[3] and "12 %" in f[3]  # 16 de 96 y 100 de 812
    assert "[1]" in f[6] and "14.990 euros" in f[6] and "noviembre de 2025" in f[6]


def test_acepta_texto_fiel():
    for lang in ("es", "en"):
        assert ex.verificar(bueno(lang), ex.hechos(ficha(), lang), lang) == []


def test_la_plantilla_de_reserva_pasa_el_verificador():
    for lang in ("es", "en"):
        h = ex.hechos(ficha(), lang)
        assert ex.verificar(ex.plantilla(h, lang), h, lang) == []


@pytest.mark.parametrize("cambio, motivo", [
    (("adjudicó 96 contratos", "adjudicó 98 contratos"), "cifras"),             # cifra inventada
    (("es 4,0, con", "es 4,5, con"), "cifras"),                                # razón alterada
    (("de 3,0 a 5,3", "de 3,0 a 6,3"), "cifras"),                              # intervalo alterado
    (("de más de 14.000 y hasta", "de más de 9.000 y hasta"), "cifras"),       # franja equivocada
    (("lo esperable serían 24,0 contratos", "lo esperable serían 4,0 contratos"), "cifras"),  # cifra de otro hecho
    (("La razón entre observados y esperados es 4,0, con un intervalo de confianza del 95 % de 3,0 a 5,3.",
      "El 4,0 % de los contratos supera el intervalo de confianza del 95 %, que va de 3,0 a 5,3."), "redacción"),
    (("La razón entre observados y esperados es 4,0, con un intervalo de confianza del 95 % de 3,0 a 5,3. ", ""),
     "falta el hecho obligatorio 3"),
    (("Qué no pueden demostrar: que haya", "Qué no pueden demostrar: que haya 96 o"), "apartado 2"),
    (("empezando por el contrato [1]", "empezando por el contrato [7]"), "cita"),
    (("conviene mirar", "hay fraude; conviene mirar"), "tono"),
    (("conviene mirar", "conviene mirar si se fraccionó algo,"), "fraccionamiento"),
    (("No demuestra que", "Demuestra que"), "cautela"),
    (("Qué se puede revisar:", "Recomendaciones:"), "estructura"),
    (("es 4,0, con", "es 4.0, con"), "mal formado"),
    (("conviene mirar", "véase https://ejemplo.es y conviene mirar"), "formato"),
])
def test_rechaza_textos_alterados(cambio, motivo):
    h = ex.hechos(ficha(), "es")
    texto = bueno("es")
    assert cambio[0] in texto
    errores = ex.verificar(texto.replace(*cambio), h, "es")
    assert any(motivo in e for e in errores), errores


def test_rechaza_ingles_alterado():
    h = ex.hechos(ficha(), "en")
    t = bueno("en")
    assert ex.verificar(t.replace("ratio is 4.0", "ratio is 40"), h, "en")
    assert ex.verificar(t.replace("awarded 96", "awarded 9"), h, "en")
    assert ex.verificar(t.replace("does not prove", "proves"), h, "en")
    assert ex.verificar(t.replace("it is worth looking", "this is illegal; look"), h, "en")
    assert ex.verificar(t.replace("contract [1].", "contract [1], one of 96."), h, "en")


def test_los_hechos_no_llevan_nombres_de_adjudicatarios():
    f = ficha()
    f["reglas"]["ss"]["contratos"][0]["nombre_secreto"] = "Fulano de Tal SL"
    for lang in ("es", "en"):
        assert "Fulano" not in "\n".join(ex.hechos(f, lang)["frases"])


import json

RESPUESTA = {
    "hechos_elegidos": [6, 7],
    "no_demuestran": "Que haya muchos importes pegados al límite es un indicador estadístico. No demuestra que se haya "
                     "partido ningún contrato ni que alguien haya actuado mal, porque puede haber razones legítimas, "
                     "como los precios de mercado.",
    "revisar": "Conviene mirar qué se contrató al adjudicatario que más repite y si esos encargos atienden una misma "
               "necesidad. También ayuda comparar las fechas, empezando por el contrato [1].",
}


def resp(**cambios):
    return json.dumps({**RESPUESTA, **cambios}, ensure_ascii=False)


def test_montar_compone_con_los_hechos_exactos():
    h = ex.hechos(ficha(), "es")
    texto, errores = ex.montar(resp(), h, "es")
    assert errores == []
    for i in (0, 1, 2, 5, 6):
        assert h["frases"][i] in texto
    assert h["frases"][3] not in texto
    assert ex.verificar(texto, h, "es") == []


@pytest.mark.parametrize("respuesta, motivo", [
    (resp(hechos_elegidos=[6, 12]), "no existe"),
    (resp(hechos_elegidos=[4, 5, 6, 7]), "entre uno y tres"),
    (resp(hechos_elegidos=[1, 2]), "entre uno y tres"),
    ("Hechos elegidos: 6, 7", "estructura"),
    (json.dumps({"hechos_elegidos": [6, 7]}), "estructura"),
    (resp(revisar="Qué se puede revisar: mirar los expedientes con calma y comparar las fechas."), "rótulos"),
])
def test_montar_rechaza_respuestas_mal_formadas(respuesta, motivo):
    h = ex.hechos(ficha(), "es")
    texto, errores = ex.montar(respuesta, h, "es")
    assert texto is None and any(motivo in e for e in errores), errores


def test_cifras_del_modelo_en_sus_apartados_se_rechazan():
    h = ex.hechos(ficha(), "es")
    texto, _ = ex.montar(resp(revisar=RESPUESTA["revisar"] + " Hay 96 contratos así."), h, "es")
    assert any("apartado 3" in e for e in ex.verificar(texto, h, "es"))


def test_esquema_limita_la_eleccion():
    e = ex.esquema(ex.hechos(ficha(), "es"))
    assert e["properties"]["hechos_elegidos"]["items"]["enum"] == [4, 5, 6, 7, 8, 9]


def test_si_el_modelo_no_elige_ejemplo_se_anade_el_primero():
    h = ex.hechos(ficha(), "es")
    texto, errores = ex.montar(resp(hechos_elegidos=[4, 5, 6]), h, "es")
    assert errores == [] and h["frases"][6] in texto and h["frases"][5] not in texto
    assert ex.verificar(texto, h, "es") == []
