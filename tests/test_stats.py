import math

import numpy as np
import pytest
from scipy import stats as sps

from allimite import stats as st


def test_reglas_k():
    assert st.REGLAS["ss"].k == 5
    assert st.REGLAS["obras"].k == 5


def test_centimos_y_bordes():
    c = st.a_centimos([14000.00, 14000.01, 14999.99, 15000.00, 15000.01, 9000.0, 9000.01])
    # (14.000, 15.000]: el borde inferior queda fuera y el superior dentro
    assert st.contar_franja(c, 14000, 15000) == 3
    # (9.000, 14.000]
    assert st.contar_franja(c, 9000, 14000) == 2


def test_centimos_redondeo_flotante():
    # 14999.99 no es exacto en coma flotante; debe quedar en 1499999 céntimos
    assert st.a_centimos([14999.99, 0.1 + 0.2]).tolist() == [1499999, 30]


def test_histograma_bordes_superiores_incluidos():
    c = st.a_centimos([0.0, 0.01, 200.0, 200.01, 400.0, 1000.0, 1000.01, -5])
    h = st.histograma(c, 200.0, 1000.0)
    assert h == [2, 2, 0, 0, 1]
    assert sum(h) == 5  # 0, negativos y > máximo no cuentan


def test_histograma_coherente_con_franjas():
    rng = np.random.default_rng(1)
    c = st.a_centimos(rng.uniform(0, 18400, 5000).round(2))
    r = st.REGLAS["ss"]
    h = st.histograma(c, r.ancho_tramo, r.max_grafico)
    i0, i1, i2 = (int(x / r.ancho_tramo) for x in (r.ref_desde, r.cerca_desde, r.umbral))
    assert sum(h[i1:i2]) == st.contar_franja(c, r.cerca_desde, r.umbral)
    assert sum(h[i0:i1]) == st.contar_franja(c, r.ref_desde, r.cerca_desde)


def test_acumulacion_basica():
    a = st.acumulacion(60, 100, 5)
    assert a.esperado == 20
    assert a.razon == 3
    assert a.ic_inf < 3 < a.ic_sup
    # comprobación independiente del intervalo con la F de Fisher
    n1, n0, k = 60, 100, 5
    lo = k * n1 / ((n0 + 1) * sps.f.ppf(0.975, 2 * (n0 + 1), 2 * n1))
    hi = k * (n1 + 1) * sps.f.ppf(0.975, 2 * (n1 + 1), 2 * n0) / n0
    assert a.ic_inf == pytest.approx(lo, rel=1e-6)
    assert a.ic_sup == pytest.approx(hi, rel=1e-6)


def test_acumulacion_pvalor_es_test_binomial():
    a = st.acumulacion(12, 30, 5)
    esperado = sps.binomtest(12, 42, 1 / 6, alternative="greater").pvalue
    assert a.p == pytest.approx(esperado, rel=1e-9)


def test_acumulacion_sin_exceso_no_es_significativa():
    a = st.acumulacion(20, 100, 5)
    assert a.razon == 1
    assert a.p > 0.4
    assert a.ic_inf < 1 < a.ic_sup


def test_acumulacion_casos_limite():
    vacio = st.acumulacion(0, 0, 5)
    assert vacio.razon is None and vacio.p == 1.0
    sin_ref = st.acumulacion(8, 0, 5)
    assert sin_ref.razon is None and sin_ref.ic_sup is None and sin_ref.ic_inf > 1
    sin_cerca = st.acumulacion(0, 50, 5)
    assert sin_cerca.razon == 0 and sin_cerca.ic_inf == 0 and sin_cerca.p == 1.0
    with pytest.raises(ValueError):
        st.acumulacion(-1, 3, 5)


def test_cobertura_del_intervalo():
    """El intervalo del 95 % debe contener la razón verdadera al menos el 95 % de las veces."""
    rng = np.random.default_rng(7)
    k, razon, lam_ref = 5, 2.5, 60
    dentro = 0
    reps = 2000
    for _ in range(reps):
        n_ref = rng.poisson(lam_ref)
        n_cerca = rng.poisson(razon * lam_ref / k)
        a = st.acumulacion(int(n_cerca), int(n_ref), k)
        sup = math.inf if a.ic_sup is None else a.ic_sup
        dentro += a.ic_inf <= razon <= sup
    assert dentro / reps >= 0.95


def test_falsos_positivos_controlados():
    """Sin efecto real, el test no debe rechazar más del 5 % de las veces."""
    rng = np.random.default_rng(11)
    rechazos = 0
    reps = 3000
    for _ in range(reps):
        a = st.acumulacion(int(rng.poisson(12)), int(rng.poisson(60)), 5)
        rechazos += a.p < 0.05
    assert rechazos / reps <= 0.05


def test_benjamini_hochberg():
    p = [0.01, 0.04, 0.03, 0.005]
    q = st.benjamini_hochberg(p)
    assert q.tolist() == pytest.approx([0.02, 0.04, 0.04, 0.02])
    assert st.benjamini_hochberg([]).size == 0
    assert (st.benjamini_hochberg([0.9, 0.8]) <= 1).all()


def test_niveles():
    fuerte = st.acumulacion(80, 60, 5)
    assert st.nivel(fuerte, 1e-9) == "senal"
    assert st.nivel(fuerte, None) == "insuficiente"
    pocos = st.acumulacion(9, 5, 5)
    assert st.nivel(pocos, 1e-6) == "insuficiente"  # ventana < 30
    plano = st.acumulacion(10, 50, 5)
    assert st.nivel(plano, 0.6) == "sin_senal"
    medio = st.acumulacion(20, 50, 5)
    assert st.nivel(medio, 0.02) == "indicio"
    # significativo pero con menos de 10 contratos junto al límite: no llega a señal
    raro = st.acumulacion(9, 21, 5)
    assert st.nivel(raro, 0.001) != "senal"
