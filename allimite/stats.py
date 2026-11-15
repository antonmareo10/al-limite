"""Estadística del indicador de acumulación bajo el umbral.

Idea: si el límite legal no influyera en el precio, el número de contratos en la
franja pegada al límite («cerca») sería parecido al de las franjas inmediatamente
inferiores («referencia»), a igualdad de anchura. Como los contratos suelen ser
menos frecuentes cuanto más caros, esa hipótesis es conservadora.

    esperado = n_referencia / k          (k = anchura referencia / anchura cerca)
    razón    = n_cerca / esperado

Incertidumbre: si los recuentos son Poisson, condicionando al total
n = n_cerca + n_referencia se tiene n_cerca ~ Binomial(n, p) con
p = R / (R + k). El intervalo exacto de Clopper-Pearson para p se transforma en
un intervalo para R. El contraste unilateral de R = 1 es un test binomial con
p0 = 1 / (1 + k). Con muchos organismos se corrige por comparaciones múltiples
(Benjamini-Hochberg).

Todo trabaja con importes en céntimos enteros para que los bordes sean exactos.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import numpy as np
from scipy import stats as sps


@dataclass(frozen=True)
class Regla:
    """Franjas de un umbral, en euros sin IVA. Los tramos incluyen su borde superior."""

    clave: str
    umbral: float
    cerca_desde: float  # la franja «cerca» es (cerca_desde, umbral]
    ref_desde: float  # la franja de referencia es (ref_desde, cerca_desde]
    ancho_tramo: float  # tramos del histograma
    max_grafico: float  # hasta dónde se dibuja el histograma

    @property
    def k(self) -> float:
        return (self.cerca_desde - self.ref_desde) / (self.umbral - self.cerca_desde)


REGLAS = {
    "ss": Regla("ss", 15_000.0, 14_000.0, 9_000.0, 200.0, 18_400.0),
    "obras": Regla("obras", 40_000.0, 37_500.0, 25_000.0, 500.0, 49_000.0),
}


def a_centimos(importes) -> np.ndarray:
    """Euros (float) a céntimos enteros, redondeando al céntimo."""
    return np.rint(np.asarray(importes, dtype=float) * 100).astype(np.int64)


def contar_franja(cent: np.ndarray, desde: float, hasta: float) -> int:
    """Número de importes en (desde, hasta], con los bordes en euros."""
    lo, hi = round(desde * 100), round(hasta * 100)
    return int(np.count_nonzero((cent > lo) & (cent <= hi)))


def histograma(cent: np.ndarray, ancho: float, maximo: float) -> list[int]:
    """Recuento por tramos (0, ancho], (ancho, 2·ancho], … hasta `maximo`.

    El tramo i cubre (i·ancho, (i+1)·ancho]. Los importes ≤ 0 o > maximo no se cuentan.
    """
    w = round(ancho * 100)
    n = int(round(maximo / ancho))
    c = cent[(cent > 0) & (cent <= n * w)]
    idx = (c + w - 1) // w - 1  # ceil(c / w) - 1
    return np.bincount(idx, minlength=n).astype(int).tolist()


@dataclass(frozen=True)
class Acumulacion:
    n_cerca: int
    n_ref: int
    k: float
    esperado: float
    razon: float | None  # None si no hay referencia
    ic_inf: float  # intervalo de confianza del 95 % de la razón
    ic_sup: float | None  # None = sin cota superior (referencia vacía)
    p: float  # p-valor unilateral de H0: razón <= 1

    def dict(self) -> dict:
        return asdict(self)


def acumulacion(n_cerca: int, n_ref: int, k: float, conf: float = 0.95) -> Acumulacion:
    """Razón observado/esperado con intervalo exacto y p-valor (ver cabecera)."""
    if n_cerca < 0 or n_ref < 0 or k <= 0:
        raise ValueError("recuentos negativos o k no positivo")
    n = n_cerca + n_ref
    esperado = n_ref / k
    if n == 0:
        return Acumulacion(0, 0, k, 0.0, None, 0.0, None, 1.0)
    alpha = 1 - conf
    # Clopper-Pearson para p = P(un contrato de la ventana cae en la franja «cerca»)
    p_lo = 0.0 if n_cerca == 0 else float(sps.beta.ppf(alpha / 2, n_cerca, n_ref + 1))
    p_hi = 1.0 if n_ref == 0 else float(sps.beta.ppf(1 - alpha / 2, n_cerca + 1, n_ref))
    ic_inf = k * p_lo / (1 - p_lo) if p_lo < 1 else math.inf
    ic_sup = None if p_hi >= 1 else k * p_hi / (1 - p_hi)
    razon = None if n_ref == 0 else n_cerca / esperado
    p0 = 1 / (1 + k)
    pval = float(sps.binom.sf(n_cerca - 1, n, p0))  # P(X >= n_cerca)
    return Acumulacion(n_cerca, n_ref, k, esperado, razon, ic_inf, ic_sup, pval)


def benjamini_hochberg(pvals) -> np.ndarray:
    """Valores q (p ajustados por tasa de falsos descubrimientos), en el orden de entrada."""
    p = np.asarray(pvals, dtype=float)
    m = p.size
    if m == 0:
        return p
    orden = np.argsort(p)
    q = p[orden] * m / np.arange(1, m + 1)
    q = np.minimum.accumulate(q[::-1])[::-1]
    out = np.empty(m)
    out[orden] = np.minimum(q, 1.0)
    return out


# Criterios de clasificación (documentados en la página de método).
MIN_VENTANA = 30  # contratos mínimos en la ventana (cerca + referencia) para evaluar
MIN_CERCA = 10  # contratos mínimos junto al límite para hablar de señal
Q_MAX = 0.01  # tasa de falsos descubrimientos admitida
IC_INF_MIN = 2.0  # la cota inferior del intervalo debe superar el doble de lo esperado


def nivel(a: Acumulacion, q: float | None) -> str:
    """'insuficiente' | 'senal' | 'indicio' | 'sin_senal'."""
    if a.n_cerca + a.n_ref < MIN_VENTANA or q is None:
        return "insuficiente"
    if q < Q_MAX and a.ic_inf >= IC_INF_MIN and a.n_cerca >= MIN_CERCA:
        return "senal"
    if q < 0.05 and a.ic_inf > 1.0:
        return "indicio"
    return "sin_senal"
