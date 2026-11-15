/* Al límite — web estática. Sin dependencias: datos JSON precalculados + SVG a mano. */
(() => {
  "use strict";

  const EVL = "https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl=";
  const MIN_X = { ss: 6000, obras: 15000 }; // primer importe que se dibuja en el histograma
  const NARROW = () => innerWidth < 600;
  const PAGE = 20; // filas visibles antes de «mostrar más»
  const main = document.getElementById("main");
  const tip = document.getElementById("tip");
  let lang = (() => { try { return localStorage.getItem("lang"); } catch { return null; } })()
    || ((navigator.language || "es").startsWith("es") ? "es" : "en");
  let NAC = null, IDX = null, CPV = null;
  const cache = new Map();

  // ------------------------------------------------------------------ textos
  const T = {
    es: {
      skip: "Saltar al contenido", nav_home: "Inicio", nav_rank: "Ranking", nav_method: "Método", loading: "Cargando datos…",
      foot_1: "Fuente: Plataforma de Contratación del Sector Público (Ministerio de Hacienda), conjunto de datos abiertos «Contratos menores de perfiles del contratante». Elaboración propia.",
      foot_2: "La acumulación de importes junto al límite es un indicador estadístico. No prueba que un contrato se haya fraccionado ni que nadie haya actuado mal.",
      foot_3: "Proyecto de Antonio González Fernández para SLAY HACKS 2026. Código con licencia MIT.",
      gen: d => `Datos generados el ${d}.`,
      kicker: p => `Contratos menores en España · ${p}`,
      h1: "¿Cuántos contratos públicos se quedan <em>justo debajo</em> del límite?",
      lead: (n, org) => `Un contrato menor se adjudica directamente, sin concurso, si cuesta menos de 15.000 € (40.000 € en obras). Hemos analizado ${n} contratos menores de ${org} órganos de contratación. Busca el tuyo y mira cuántos de sus contratos se quedan pegados al límite, comparado con lo que cabría esperar.`,
      s_label: "Busca un organismo", s_ph: "Ayuntamiento de…, Diputación de…, Universidad de…, Ministerio de…",
      s_hint: n => `${n} órganos y entidades. Escribe al menos 3 letras.`, s_none: "Ningún organismo coincide. Prueba con menos palabras.",
      s_cover: "Solo aparecen los organismos que publican su perfil del contratante en la Plataforma estatal. Faltan los que usan plataformas autonómicas propias (por ejemplo, las de Cataluña, Euskadi, Madrid, Andalucía o Galicia).",
      contracts: "contratos", organo: "Órgano de contratación", entidad: "Entidad (todos sus órganos)",
      nivel: { senal: "Señal de acumulación", indicio: "Indicio débil", sin_senal: "Sin señal", insuficiente: "Muestra insuficiente" },
      regla: { ss: "Servicios y suministros", obras: "Obras" },
      nat_h2: "El muro, en toda España",
      nat_tile1: (a, b) => `contratos entre ${a} y ${b} €`, nat_tile2: "esperables según la franja de referencia",
      nat_tile3: "veces lo esperable", ic: (a, b) => `IC 95 %: ${a}–${b}`,
      wall_title: (u) => `Los importes se amontonan contra los ${u} €`,
      wall_sub: (w, a, b, c) => `Número de contratos por tramos de ${w} € (sin IVA). En rojo, la franja pegada al límite (de ${b} a ${c} €). En azul, la franja de referencia (de ${a} a ${b} €), de la que sale lo esperable.`,
      wall_cap: "Cada tramo incluye su borde superior. Importe de adjudicación sin impuestos.",
      wall_from: a => `El gráfico empieza en ${a} €; los importes menores están en la tabla.`, show_all: n => `Mostrar los ${n}`,
      lg_all: "Resto de tramos", lg_ref: "Franja de referencia", lg_near: "Junto al límite", lg_exp: "Lo esperable por tramo",
      limit_lbl: u => `Límite legal: ${u} €`, exp_lbl: "esperable",
      tip_bin: (a, b, n) => `De ${a} a ${b} €: ${n} contratos`,
      table_view: "Ver los datos en tabla", th_from: "Desde (€)", th_to: "Hasta (€)", th_n: "Contratos",
      plc_title: "Solo pasa en el límite legal: ningún otro importe atrae tantos contratos",
      plc_sub: "La misma cuenta moviendo un «límite» ficticio de 7.000 a 18.000 €. Si la causa fuera la querencia por los números redondos, también habría picos en 10.000 o 12.000 €. La banda es el intervalo de confianza del 95 %.",
      plc_y: "Razón observado / esperable", plc_x: "«Límite» ficticio (€)", plc_tip: (u, r, a, b) => `${u} €: razón ${r} (${a}–${b})`,
      mon_title_nat: "Diciembre no explica el muro: la acumulación aparece todos los meses",
      mon_sub_nat: "Razón observado / esperable de los contratos de servicios y suministros según el mes de adjudicación.",
      months: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
      cpv_h2: "Por tipo de compra (familias CPV)",
      cpv_p: pct => `Solo el ${pct} % de los contratos de servicios y suministros indica su código CPV, así que esta tabla describe una parte de los datos. Ordenada por la cota inferior del intervalo.`,
      th_family: "Familia", th_near: "Junto al límite", th_expd: "Esperables", th_ratio: "Razón (IC 95 %)", th_body: "Organismo", th_level: "Nivel",
      rank_h2: "Dónde es más intensa la señal", rank_h1: "Ranking de organismos con señal de acumulación",
      rank_p: (n) => `Organismos con al menos ${n.min_ventana} contratos en la ventana analizada, al menos ${n.min_cerca} junto al límite y una razón cuyo intervalo queda entero por encima de ${n.ic_inf_min} tras corregir por comparaciones múltiples. Ordenados por la cota inferior del intervalo, la lectura más prudente. Es una lista para saber dónde mirar, no una lista de infractores.`,
      rank_count: (n, t) => `${n} con señal, de ${t} evaluables.`, see_all: "Ver el ranking completo", more: "Mostrar más",
      f_org: "Órganos", f_ent: "Entidades",
      u_back: "Inicio", u_n: "contratos menores analizados", u_total: "importe total sin impuestos",
      u_part_of: "Forma parte de", u_organs: "Órganos de contratación de esta entidad",
      u_obs: "contratos junto al límite", u_exp: "esperables", u_ratio: "veces lo esperable",
      u_none: r => `Este organismo no tiene contratos menores de ${r} en el periodo.`,
      u_small: (n, m) => `Muestra insuficiente: solo hay ${n} contratos en la ventana analizada (hacen falta ${m}). Con tan pocos datos no calculamos el nivel; el gráfico se muestra solo como referencia.`,
      u_wide: "Intervalo amplio: con pocos contratos la razón es muy incierta. Fíjate en el intervalo, no en el valor central.",
      u_noref: "No hay contratos en la franja de referencia, así que no se puede calcular la razón.",
      ci_title: "Observado frente a esperable", ci_one: "1 = lo esperable",
      ci_sub: (r, a, b) => `La razón es ${r}. Con los datos disponibles, el valor real está entre ${a} y ${b} con una confianza del 95 %.`,
      ci_sub_open: (a) => `Sin contratos en la franja de referencia no hay valor central; el intervalo empieza en ${a}.`,
      ai_h: "Explicación en lenguaje claro",
      ai_prov: (m, o) => `${o === "modelo" ? `Un modelo de IA abierto (${m}), ejecutado en un portátil y sin servicios de pago, eligió qué datos destacar y escribió los dos últimos apartados` : "Texto de plantilla: el borrador del modelo de IA no superó la verificación"}. Las frases con cifras las redacta el programa y se comprueban una a una; si algo no cuadra, el texto se descarta. Los números entre corchetes enlazan con el contrato en la Plataforma.`,
      ai_none: "Solo generamos explicación para los organismos con señal de acumulación.",
      ai_pending: "La explicación en lenguaje claro de este organismo todavía no se ha generado.",
      caveat_h: "Cómo leer esta ficha",
      caveat: "Que muchos importes queden junto al límite es una señal para mirar los expedientes, no una prueba. Puede deberse a precios de mercado, a presupuestos cerrados o a necesidades distintas. Esta página no nombra a personas ni a empresas: cada contrato enlaza con su publicación oficial.",
      mon_title: "¿Se concentran a final de año?", mon_sub: "Porcentaje de contratos adjudicados cada mes: junto al límite (barras) y todos los del organismo de este tipo (marca).",
      lg_mnear: "Junto al límite", lg_mall: "Todos los contratos", mon_tip: (m, a, b, n) => `${m}: ${a} % de los contratos junto al límite (${n}); ${b} % de todos`,
      rep_h: "Adjudicatarios que se repiten junto al límite",
      rep_p: n => `Adjudicatarios con ${n} o más contratos junto al límite. Se muestran con una letra, sin nombre; el nombre figura en la publicación oficial de cada contrato.`,
      rep_none: n => `Ningún adjudicatario tiene ${n} o más contratos junto al límite.`,
      th_aw: "Adjudicatario", th_nnear: "Junto al límite", th_amt: "Importe", th_years: "Años", th_maxy: "Máx. en un año", th_all: "Total con el organismo",
      aw: a => `Adjudicatario ${a}`, aw_multi: "Varios o sin identificar",
      ct_h: "Contratos junto al límite", ct_p: (n, t) => n < t ? `Los ${n} más recientes de ${t}.` : `${t} contratos.`,
      th_date: "Adjudicación", th_exp: "Expediente", th_link: "Publicación oficial", open: "Abrir", years_h: "Por año",
      th_year: "Año", th_ref: "Referencia", over: (n, u) => `${n} contratos figuran con un importe superior a ${u} €. Pueden ser errores de grabación (por ejemplo, importes con IVA) o regímenes con otro límite; no entran en el cálculo.`,
      notfound: "No encontramos ese organismo.", err: "No se pudieron cargar los datos.",
    },
    en: {
      skip: "Skip to content", nav_home: "Home", nav_rank: "Ranking", nav_method: "Method", loading: "Loading data…",
      foot_1: "Source: Plataforma de Contratación del Sector Público (Spanish Ministry of Finance), open dataset “Contratos menores de perfiles del contratante”. Own analysis.",
      foot_2: "A pile-up of amounts just under the limit is a statistical indicator. It does not prove that a contract was split or that anyone acted improperly.",
      foot_3: "A project by Antonio González Fernández for SLAY HACKS 2026. MIT-licensed code.",
      gen: d => `Data generated on ${d}.`,
      kicker: p => `Minor contracts in Spain · ${p}`,
      h1: "How many public contracts land <em>just under</em> the legal limit?",
      lead: (n, org) => `In Spain a “minor contract” can be awarded directly, with no tender, if it costs less than €15,000 (€40,000 for works). We analysed ${n} minor contracts from ${org} contracting bodies. Search for yours and see how many of its contracts sit right against the limit, compared with what you would expect.`,
      s_label: "Search for a public body", s_ph: "Ayuntamiento de…, Diputación de…, Universidad de…, Ministerio de…",
      s_hint: n => `${n} bodies and entities. Type at least 3 letters (names are in Spanish).`, s_none: "No body matches. Try fewer words.",
      s_cover: "Only bodies that publish their buyer profile on the national platform appear. Those using their own regional platforms (for example Catalonia, the Basque Country, Madrid, Andalusia or Galicia) are missing.",
      contracts: "contracts", organo: "Contracting body", entidad: "Entity (all its bodies)",
      nivel: { senal: "Bunching signal", indicio: "Weak hint", sin_senal: "No signal", insuficiente: "Sample too small" },
      regla: { ss: "Services and supplies", obras: "Works" },
      nat_h2: "The wall, across Spain",
      nat_tile1: (a, b) => `contracts between €${a} and €${b}`, nat_tile2: "expected from the reference band",
      nat_tile3: "times the expected number", ic: (a, b) => `95% CI: ${a}–${b}`,
      wall_title: (u) => `Amounts pile up against €${u}`,
      wall_sub: (w, a, b, c) => `Number of contracts in €${w} bins (excluding VAT). Red: the band right under the limit (€${b} to €${c}). Blue: the reference band (€${a} to €${b}) used to work out what is expected.`,
      wall_cap: "Each bin includes its upper edge. Award amount excluding taxes.",
      wall_from: a => `The chart starts at €${a}; smaller amounts are in the table.`, show_all: n => `Show all ${n}`,
      lg_all: "Other bins", lg_ref: "Reference band", lg_near: "Just under the limit", lg_exp: "Expected per bin",
      limit_lbl: u => `Legal limit: €${u}`, exp_lbl: "expected",
      tip_bin: (a, b, n) => `€${a} to €${b}: ${n} contracts`,
      table_view: "View the data as a table", th_from: "From (€)", th_to: "To (€)", th_n: "Contracts",
      plc_title: "It only happens at the legal limit: no other amount attracts so many contracts",
      plc_sub: "The same calculation with a fake “limit” moved from €7,000 to €18,000. If a taste for round numbers were the cause, there would also be peaks at €10,000 or €12,000. The band is the 95% confidence interval.",
      plc_y: "Observed / expected ratio", plc_x: "Fake “limit” (€)", plc_tip: (u, r, a, b) => `€${u}: ratio ${r} (${a}–${b})`,
      mon_title_nat: "December does not explain the wall: the pile-up shows up every month",
      mon_sub_nat: "Observed / expected ratio for services and supplies contracts by month of award.",
      months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      cpv_h2: "By type of purchase (CPV families)",
      cpv_p: pct => `Only ${pct}% of services and supplies contracts state a CPV code, so this table describes part of the data. Sorted by the lower bound of the interval.`,
      th_family: "Family", th_near: "Just under limit", th_expd: "Expected", th_ratio: "Ratio (95% CI)", th_body: "Body", th_level: "Level",
      rank_h2: "Where the signal is strongest", rank_h1: "Ranking of bodies with a bunching signal",
      rank_p: (n) => `Bodies with at least ${n.min_ventana} contracts in the analysed window, at least ${n.min_cerca} just under the limit, and a ratio whose whole interval lies above ${n.ic_inf_min} after correcting for multiple comparisons. Sorted by the lower bound of the interval, the most cautious reading. It is a list of where to look, not a list of offenders.`,
      rank_count: (n, t) => `${n} with a signal, out of ${t} that could be assessed.`, see_all: "See the full ranking", more: "Show more",
      f_org: "Bodies", f_ent: "Entities",
      u_back: "Home", u_n: "minor contracts analysed", u_total: "total amount excluding taxes",
      u_part_of: "Part of", u_organs: "Contracting bodies of this entity",
      u_obs: "contracts just under the limit", u_exp: "expected", u_ratio: "times the expected number",
      u_none: r => `This body has no minor contracts for ${r} in the period.`,
      u_small: (n, m) => `Sample too small: only ${n} contracts in the analysed window (${m} needed). With so little data we do not assign a level; the chart is shown for reference only.`,
      u_wide: "Wide interval: with few contracts the ratio is very uncertain. Look at the interval, not the central value.",
      u_noref: "There are no contracts in the reference band, so the ratio cannot be computed.",
      ci_title: "Observed versus expected", ci_one: "1 = as expected",
      ci_sub: (r, a, b) => `The ratio is ${r}. Given the data, the true value lies between ${a} and ${b} with 95% confidence.`,
      ci_sub_open: (a) => `With no contracts in the reference band there is no central value; the interval starts at ${a}.`,
      ai_h: "Plain-language explanation",
      ai_prov: (m, o) => `${o === "modelo" ? `An open AI model (${m}), run on a laptop with no paid services, chose which facts to highlight and wrote the last two sections` : "Template text: the AI model's draft failed verification"}. Sentences with figures are written by the program and checked one by one; if anything does not match, the text is discarded. Bracketed numbers link to the contract on the official platform.`,
      ai_none: "We only generate an explanation for bodies with a bunching signal.",
      ai_pending: "The plain-language explanation for this body has not been generated yet.",
      caveat_h: "How to read this page",
      caveat: "Many amounts sitting just under the limit is a reason to look at the files, not proof of anything. It may reflect market prices, fixed budgets or separate needs. This page names no people or companies: each contract links to its official publication.",
      mon_title: "Do they cluster at year end?", mon_sub: "Share of contracts awarded each month: just under the limit (bars) and all the body's contracts of this type (mark).",
      lg_mnear: "Just under the limit", lg_mall: "All contracts", mon_tip: (m, a, b, n) => `${m}: ${a}% of contracts just under the limit (${n}); ${b}% of all`,
      rep_h: "Awardees that repeat just under the limit",
      rep_p: n => `Awardees with ${n} or more contracts just under the limit. They are shown as a letter, unnamed; the name appears in each contract's official publication.`,
      rep_none: n => `No awardee has ${n} or more contracts just under the limit.`,
      th_aw: "Awardee", th_nnear: "Just under limit", th_amt: "Amount", th_years: "Years", th_maxy: "Max in one year", th_all: "Total with this body",
      aw: a => `Awardee ${a}`, aw_multi: "Several or unidentified",
      ct_h: "Contracts just under the limit", ct_p: (n, t) => n < t ? `The ${n} most recent of ${t}.` : `${t} contracts.`,
      th_date: "Awarded", th_exp: "File no.", th_link: "Official publication", open: "Open", years_h: "By year",
      th_year: "Year", th_ref: "Reference", over: (n, u) => `${n} contracts are recorded above €${u}. They may be data-entry errors (for example, amounts including VAT) or regimes with a different limit; they are left out of the calculation.`,
      notfound: "We could not find that body.", err: "The data could not be loaded.",
    },
  };
  const t = () => T[lang];

  // ------------------------------------------------------------------ utilidades
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const loc = () => (lang === "es" ? "es-ES" : "en-GB");
  const fmt = (v, d = 0) => v == null ? "–" : new Intl.NumberFormat(loc(), { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: "always" }).format(v);
  const fmtEur = v => fmt(v, Number.isInteger(v) ? 0 : 2);
  const fmtDate = s => { const [y, m, d] = s.split("-"); return lang === "es" ? `${d}/${m}/${y}` : `${d} ${T.en.months[+m - 1]} ${y}`; };
  const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]+/g, " ");
  const getJSON = async url => {
    if (cache.has(url)) return cache.get(url);
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + " " + r.status);
    const j = await r.json();
    cache.set(url, j);
    return j;
  };
  const shortPath = r => { const p = r.split(" > "); return p.length > 2 ? p[0] + " › … › " + p[p.length - 1] : p.join(" › "); };
  const badge = n => `<span class="badge ${n}">${esc(t().nivel[n])}</span>`;
  const ratioTxt = (r, a, b) => r == null ? `– (≥ ${fmt(a, 1)})` : `${fmt(r, 1)} <span class="sub">${fmt(a, 1)}–${b == null ? "∞" : fmt(b, 1)}</span>`;

  // tablas largas: solo las primeras filas, con un botón para ver todas
  const fold = (rows, n = PAGE) => rows.map((r, i) => (i < n ? r : r.replace("<tr>", "<tr hidden>"))).join("");
  const foldBtn = (total, n = PAGE) => (total > n ? `<button class="more" type="button" data-fold>${esc(t().show_all(fmt(total)))}</button>` : "");
  function bindFold(root) {
    root.querySelectorAll("[data-fold]").forEach(b => b.addEventListener("click", () => {
      b.previousElementSibling.querySelectorAll("tr[hidden]").forEach(tr => (tr.hidden = false)); b.remove();
    }));
  }

  // tooltip compartido (ratón y teclado)
  function bindTips(root) {
    root.querySelectorAll("[data-tip]").forEach(el => {
      const show = e => {
        tip.textContent = el.dataset.tip; tip.hidden = false;
        const r = el.getBoundingClientRect();
        const x = e.clientX ?? r.left + r.width / 2, y = e.clientY ?? r.top;
        const w = tip.offsetWidth;
        tip.style.left = Math.max(6, Math.min(innerWidth - w - 6, x - w / 2)) + "px";
        tip.style.top = Math.max(6, y - tip.offsetHeight - 12) + "px";
      };
      el.addEventListener("pointermove", show); el.addEventListener("focus", show);
      el.addEventListener("pointerleave", () => (tip.hidden = true)); el.addEventListener("blur", () => (tip.hidden = true));
    });
  }

  // ------------------------------------------------------------------ gráficos
  function niceMax(v) {
    if (v <= 5) return 5;
    const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  // Eje con 4 divisiones de paso «redondo», para que ninguna etiqueta salga redondeada (1,25 → «1,3»).
  // integer: el eje cuenta cosas enteras (contratos, %), así que el paso nunca baja de 1.
  function axis4(v, integer) {
    const raw = Math.max(v, integer ? 4 : 1e-9) / 4;
    const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 && !(integer && p < 10) ? 2.5 : f <= 5 ? 5 : 10) * p;
    if (integer) step = Math.max(1, Math.round(step));
    const dec = step >= 1 ? (step % 1 ? 1 : 0) : (Math.round(step * 10) === step * 10 ? 1 : 2);
    return { max: step * 4, dec };
  }
  const eur = s => (lang === "en" ? `€${s}` : `${s} €`);
  const flatModel = m => String(m || "").replace(/\s*\(([^()]*)\)\s*$/, ", $1");

  function wallChart(d, rule) {
    // El gráfico empieza en MIN_X: por debajo hay muchísimos contratos pequeños que aplastarían la escala.
    const R = NAC.criterios.reglas[rule], w = R.ancho_tramo, i0 = Math.round(MIN_X[rule] / w), h = d.hist.slice(i0), n = h.length;
    const W = NARROW() ? 400 : 720, H = 300, m = { l: 44, r: 12, t: 30, b: 34 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b, bw = iw / n;
    const iRef = Math.round(R.ref_desde / w) - i0, iNear = Math.round(R.cerca_desde / w) - i0, iLim = Math.round(R.umbral / w) - i0;
    const expBin = d.n_ref / (iNear - iRef);
    const ax = axis4(Math.max(...h, expBin, 1), true), ymax = ax.max;
    const y = v => m.t + ih - (v / ymax) * ih;
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t().wall_title(fmt(R.umbral)))}. ${esc(`${fmt(d.n_cerca)} ${t().u_obs}; ${fmt(d.esperado, 1)} ${t().u_exp}.`)}">`;
    for (let k = 0; k <= 4; k++) {
      const v = (ymax * k) / 4, yy = y(v);
      s += `<line class="${k ? "grid" : "axis"}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/><text x="${m.l - 6}" y="${yy + 4}" text-anchor="end">${fmt(v, ax.dec)}</text>`;
    }
    const gap = bw > 4 ? 1 : 0.4;
    h.forEach((c, i) => {
      const cls = i >= iNear && i < iLim ? "bar near" : i >= iRef && i < iNear ? "bar ref" : "bar";
      const x = m.l + i * bw, bh = c ? Math.max(1.5, (c / ymax) * ih) : 0;
      const tipTxt = t().tip_bin(fmt((i + i0) * w), fmt((i + i0 + 1) * w), fmt(c));
      s += `<rect class="${cls}" x="${(x + gap / 2).toFixed(2)}" y="${(m.t + ih - bh).toFixed(2)}" width="${(bw - gap).toFixed(2)}" height="${bh.toFixed(2)}" rx="${bw > 5 ? 1.5 : 0}"/>`;
      s += `<rect x="${x.toFixed(2)}" y="${m.t}" width="${bw.toFixed(2)}" height="${ih}" fill="transparent" data-tip="${esc(tipTxt)}"/>`;
    });
    const step = rule === "ss" ? 3000 : 5000;
    for (let v = MIN_X[rule]; v <= R.max_grafico; v += step) {
      const x = m.l + (v / w - i0) * bw;
      s += `<text x="${x}" y="${H - m.b + 16}" text-anchor="middle">${fmt(v)}</text>`;
    }
    s += `<text x="${W - m.r}" y="${H - 2}" text-anchor="end">€</text>`;
    const xl = m.l + iLim * bw;
    s += `<line class="limitline" x1="${xl}" x2="${xl}" y1="${m.t - 12}" y2="${m.t + ih}"/>`;
    s += `<text class="lbl" x="${xl - 6}" y="${m.t - 16}" text-anchor="end">${esc(t().limit_lbl(fmt(R.umbral)))}</text>`;
    if (d.n_ref > 0) {
      const x1 = m.l + iNear * bw, ye = y(expBin);
      s += `<line class="exp" x1="${x1 - 4}" x2="${xl + 4}" y1="${ye}" y2="${ye}"/>`;
      s += `<text class="lbl" x="${xl + 8}" y="${ye + 4}">${esc(t().exp_lbl)}</text>`;
    }
    s += "</svg>";
    const rows = d.hist.map((c, i) => `<tr><td class="n">${fmt(i * w)}</td><td class="n">${fmt((i + 1) * w)}</td><td class="n">${fmt(c)}</td></tr>`).join("");
    return `<figure><p class="ftitle">${esc(t().wall_title(fmt(R.umbral)))}</p>
      <p class="fsub">${esc(t().wall_sub(fmt(w), fmt(R.ref_desde), fmt(R.cerca_desde), fmt(R.umbral)))} ${esc(t().wall_from(fmt(MIN_X[rule])))}</p>
      <ul class="legend"><li><i class="near"></i>${esc(t().lg_near)}</li><li><i class="ref"></i>${esc(t().lg_ref)}</li><li><i></i>${esc(t().lg_all)}</li><li><i class="dash"></i>${esc(t().lg_exp)}</li></ul>
      ${s}<figcaption>${esc(t().wall_cap)}</figcaption>
      <details class="data"><summary>${esc(t().table_view)}</summary><div class="tablewrap"><table><thead><tr><th class="n">${esc(t().th_from)}</th><th class="n">${esc(t().th_to)}</th><th class="n">${esc(t().th_n)}</th></tr></thead><tbody>${rows}</tbody></table></div></details></figure>`;
  }

  function ciChart(d) {
    const hi = d.ic_sup ?? Math.max(d.ic_inf * 2, 4);
    const ax = axis4(Math.max(hi, 2) * 1.05, false), xmax = ax.max;
    const W = NARROW() ? 380 : 520, H = 78, m = { l: 12, r: 18, t: 26, b: 24 }, iw = W - m.l - m.r;
    const x = v => m.l + (Math.min(v, xmax) / xmax) * iw, yy = m.t + 12;
    let s = `<svg class="chart ci" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.razon == null ? t().ci_sub_open(fmt(d.ic_inf, 1)) : t().ci_sub(fmt(d.razon, 1), fmt(d.ic_inf, 1), fmt(d.ic_sup, 1)))}">`;
    s += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
    for (let k = 0; k <= 4; k++) { const v = (xmax * k) / 4; s += `<text x="${x(v)}" y="${H - 6}" text-anchor="middle">${fmt(v, ax.dec)}</text>`; }
    s += `<line class="exp" x1="${x(1)}" x2="${x(1)}" y1="${m.t - 6}" y2="${H - m.b}"/><text class="lbl" x="${x(1) + 5}" y="${m.t - 10}">${esc(t().ci_one)}</text>`;
    s += `<line x1="${x(d.ic_inf)}" x2="${x(hi)}" y1="${yy}" y2="${yy}" stroke="var(--limit)" stroke-width="4" stroke-linecap="round"${d.ic_sup == null ? ' stroke-dasharray="1 7"' : ""}/>`;
    if (d.razon != null) s += `<circle class="dot hot" cx="${x(d.razon)}" cy="${yy}" r="6"/>`;
    return s + "</svg>";
  }

  function monthChart(d) {
    const tn = d.meses_cerca.reduce((a, b) => a + b, 0), ta = d.meses_todos.reduce((a, b) => a + b, 0);
    if (!tn) return "";
    const pn = d.meses_cerca.map(v => (100 * v) / tn), pa = d.meses_todos.map(v => (100 * v) / ta);
    const W = NARROW() ? 400 : 520, H = 210, m = { l: 34, r: 8, t: 10, b: 26 }, iw = W - m.l - m.r, ih = H - m.t - m.b, bw = iw / 12;
    const ax = axis4(Math.max(...pn, ...pa, 10), true), ymax = ax.max;
    const y = v => m.t + ih - (v / ymax) * ih;
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t().mon_title)}">`;
    for (let k = 0; k <= 4; k++) { const v = (ymax * k) / 4; s += `<line class="${k ? "grid" : "axis"}" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 5}" y="${y(v) + 4}" text-anchor="end">${fmt(v, ax.dec)}${k === 4 ? " %" : ""}</text>`; }
    pn.forEach((v, i) => {
      const x = m.l + i * bw;
      s += `<rect class="bar near" x="${x + bw * 0.2}" y="${y(v)}" width="${bw * 0.6}" height="${m.t + ih - y(v)}" rx="2"/>`;
      s += `<line class="tickmark" x1="${x + bw * 0.1}" x2="${x + bw * 0.9}" y1="${y(pa[i])}" y2="${y(pa[i])}"/>`;
      s += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${t().months[i]}</text>`;
      s += `<rect x="${x}" y="${m.t}" width="${bw}" height="${ih}" fill="transparent" data-tip="${esc(t().mon_tip(t().months[i], fmt(v), fmt(pa[i]), fmt(d.meses_cerca[i])))}"/>`;
    });
    s += "</svg>";
    return `<figure><p class="ftitle">${esc(t().mon_title)}</p><p class="fsub">${esc(t().mon_sub)}</p>
      <ul class="legend"><li><i class="near"></i>${esc(t().lg_mnear)}</li><li><i class="tick"></i>${esc(t().lg_mall)}</li></ul>${s}</figure>`;
  }

  function lineChart(pts, o) {
    // pts: [{x, y, lo, hi, label, tip, hot}]
    const W = NARROW() ? 400 : 720, H = 260, m = { l: 44, r: 16, t: 16, b: 40 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const ax = axis4(Math.max(...pts.map(p => p.hi ?? p.y)) * 1.02, false), ymax = ax.max;
    const xs = pts.map(p => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
    const x = v => m.l + ((v - x0) / (x1 - x0)) * iw, y = v => m.t + ih - (v / ymax) * ih;
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title)}">`;
    for (let k = 0; k <= 4; k++) { const v = (ymax * k) / 4; s += `<line class="${k ? "grid" : "axis"}" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v, ax.dec)}</text>`; }
    s += `<line class="exp" x1="${m.l}" x2="${W - m.r}" y1="${y(1)}" y2="${y(1)}"/><text class="lbl" x="${W - m.r}" y="${y(1) - 6}" text-anchor="end">${esc(t().ci_one)}</text>`;
    s += `<path class="band" d="M${pts.map(p => `${x(p.x)},${y(p.hi)}`).join("L")}L${pts.slice().reverse().map(p => `${x(p.x)},${y(p.lo)}`).join("L")}Z"/>`;
    s += `<path class="line" d="M${pts.map(p => `${x(p.x)},${y(p.y)}`).join("L")}"/>`;
    pts.forEach((p, i) => {
      if (p.hot) s += `<circle class="dot hot" cx="${x(p.x)}" cy="${y(p.y)}" r="5"/><text class="lbl" x="${x(p.x) - 10}" y="${y(p.y) + 4}" text-anchor="end">${esc(p.label)}</text>`;
      if (p.tick) s += `<text x="${x(p.x)}" y="${H - m.b + 16}" text-anchor="middle">${esc(p.tick)}</text>`;
      const half = iw / (pts.length - 1) / 2;
      s += `<rect x="${x(p.x) - half}" y="${m.t}" width="${half * 2}" height="${ih}" fill="transparent" data-tip="${esc(p.tip)}"/>`;
    });
    s += `<text x="${m.l + iw / 2}" y="${H - 4}" text-anchor="middle">${esc(o.xlabel)}</text></svg>`;
    return `<figure><p class="ftitle">${esc(o.title)}</p><p class="fsub">${esc(o.sub)}</p>${s}</figure>`;
  }

  // ------------------------------------------------------------------ buscador
  const SYN = { ayto: "ayuntamiento", aytos: "ayuntamiento", ajuntament: "ayuntamiento", dipu: "diputacion", uni: "universidad", univ: "universidad", council: "ayuntamiento", university: "universidad", ministry: "ministerio", hospital: "hospital" };
  const STOP = new Set(["de", "del", "la", "el", "los", "las", "mi", "my", "the", "of", "y", "en"]);
  let SEARCH = null;
  function buildSearch() {
    SEARCH = IDX.filas.map((f, i) => ({ i, name: norm(f[2]), all: norm(f[2] + " " + f[3]) }));
  }
  function search(q) {
    const toks = norm(q).split(/\s+/).filter(x => x && !STOP.has(x)).map(x => SYN[x] || x);
    if (!toks.length || toks.join("").length < 3) return null;
    const out = [];
    for (const s of SEARCH) {
      let score = 0, ok = true;
      for (const k of toks) {
        const inName = s.name.includes(k);
        if (!inName && !s.all.includes(k)) { ok = false; break; }
        score += inName ? 3 : 1;
        if (inName && (s.name.startsWith(k) || s.name.includes(" " + k))) score += 1;
      }
      if (!ok) continue;
      const f = IDX.filas[s.i];
      score += Math.min(3, Math.log10(1 + f[4]) / 1.5) + (f[1] === 1 ? 1.5 : 0) - s.name.length / 400;
      // Quien escribe el nombre de un municipio suele buscar su ayuntamiento, no la diputación de la provincia.
      if (/(^| )(ayuntamiento|ajuntament|concello|udala|ayto) /.test(s.name) && toks.some(k => s.name.includes(" de " + k) || s.name.endsWith(" " + k))) score += 1.5;
      out.push([score, s.i]);
    }
    out.sort((a, b) => b[0] - a[0]);
    return out.slice(0, 12).map(x => IDX.filas[x[1]]);
  }
  const bestLevel = f => { const o = ["insuficiente", "sin_senal", "indicio", "senal"]; const a = f[5] || "insuficiente", b = f[10] || "insuficiente"; return o.indexOf(a) >= o.indexOf(b) ? a : b; };
  function searchBox() {
    return `<div class="search" role="search"><label for="q">${esc(t().s_label)}</label>
      <input id="q" type="search" autocomplete="off" spellcheck="false" placeholder="${esc(t().s_ph)}" aria-controls="res" aria-describedby="qh">
      <p class="hint" id="qh">${esc(t().s_hint(fmt(IDX.filas.length)))}</p>
      <ul class="results" id="res" aria-live="polite"></ul></div>`;
  }
  function bindSearch() {
    const q = document.getElementById("q"), res = document.getElementById("res");
    if (!q) return;
    const run = () => {
      const r = search(q.value);
      if (r == null) { res.innerHTML = ""; return; }
      res.innerHTML = r.length ? r.map(f => `<li><a href="#/u/${esc(f[0])}"><span class="r-name">${esc(f[2])}</span>${badge(bestLevel(f))}<span class="r-path">${esc(f[1] ? t().entidad : t().organo)} · ${fmt(f[4])} ${esc(t().contracts)} · ${esc(f[3])}</span></a></li>`).join("")
        : `<li class="none">${esc(t().s_none)}</li>`;
    };
    q.addEventListener("input", run);
    const saved = sessionStorage.getItem("q");
    if (saved) { q.value = saved; run(); }
    q.addEventListener("change", () => sessionStorage.setItem("q", q.value));
  }

  // ------------------------------------------------------------------ ranking
  const rankState = { rule: "ss", cls: 0, n: 15 };
  function rankRows(rule, cls) {
    const o = rule === "ss" ? 5 : 10;
    return IDX.filas.filter(f => f[1] === cls && f[o] === "senal").sort((a, b) => b[o + 2] - a[o + 2]).map(f => ({ f, o }));
  }
  function rankTable(limit) {
    const rows = rankRows(rankState.rule, rankState.cls);
    const o = rankState.rule === "ss" ? 5 : 10;
    const evalN = IDX.filas.filter(f => f[1] === rankState.cls && f[o] && f[o] !== "insuficiente").length;
    const body = rows.slice(0, limit).map(({ f }, i) => `<tr><td class="n">${i + 1}</td><td><a href="#/u/${esc(f[0])}">${esc(f[2])}</a><span class="sub">${esc(shortPath(f[3]))}</span></td>
      <td class="n">${fmt(f[o + 4])}</td><td class="n">${ratioTxt(f[o + 1], f[o + 2], f[o + 3])}</td></tr>`).join("");
    const seg = (key, val, label) => `<button type="button" data-k="${key}" data-v="${val}" aria-pressed="${String(rankState[key]) === String(val)}">${esc(label)}</button>`;
    return `<div><div class="seg" role="group" aria-label="${esc(t().th_level)}">${seg("rule", "ss", t().regla.ss)}${seg("rule", "obras", t().regla.obras)}</div>
      <div class="seg" role="group">${seg("cls", 0, t().f_org)}${seg("cls", 1, t().f_ent)}</div></div>
      <p class="num">${esc(t().rank_count(fmt(rows.length), fmt(evalN)))}</p>
      <div class="tablewrap"><table><thead><tr><th class="n">#</th><th>${esc(t().th_body)}</th><th class="n">${esc(t().th_near)}</th><th class="n">${esc(t().th_ratio)}</th></tr></thead><tbody>${body}</tbody></table></div>
      ${rows.length > limit ? `<button class="more" type="button" id="more">${esc(t().more)}</button>` : ""}`;
  }
  function bindRank(el, full) {
    const draw = () => { el.innerHTML = rankTable(rankState.n); bind(); };
    const bind = () => {
      el.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
        rankState[b.dataset.k] = b.dataset.k === "cls" ? +b.dataset.v : b.dataset.v; rankState.n = full ? 50 : 15; draw();
      }));
      const m = el.querySelector("#more");
      if (m) m.addEventListener("click", () => { if (full) { rankState.n += 100; draw(); } else location.hash = "#/ranking"; });
      if (m && !full) m.textContent = t().see_all;
    };
    rankState.n = full ? 50 : 15;
    draw();
  }

  // ------------------------------------------------------------------ páginas
  function natBlock(rule) {
    const d = NAC.reglas[rule], R = NAC.criterios.reglas[rule];
    return `<div class="tiles">
      <div class="tile hot"><div class="v num">${fmt(d.n_cerca)}</div><div class="l">${esc(t().nat_tile1(fmt(R.cerca_desde), fmt(R.umbral)))}</div></div>
      <div class="tile"><div class="v num">${fmt(d.esperado)}</div><div class="l">${esc(t().nat_tile2)}</div></div>
      <div class="tile"><div class="v num">× ${fmt(d.razon, 1)}</div><div class="l">${esc(t().nat_tile3)} · ${esc(t().ic(fmt(d.ic_inf, 2), fmt(d.ic_sup, 2)))}</div></div></div>
      ${wallChart(d, rule)}`;
  }

  function home() {
    const per = NAC.periodo.map(x => x.slice(0, 4)).join("–");
    const total = NAC.embudo.servicios_suministros + NAC.embudo.obras;
    main.innerHTML = `<section class="hero"><p class="kicker">${esc(t().kicker(per))}</p><h1>${t().h1}</h1>
      <p class="lead">${esc(t().lead(fmt(total), fmt(NAC.n_organos)))}</p>${searchBox()}
      <p class="hint" style="max-width:72ch;color:var(--ink3);font-size:.85rem">${esc(t().s_cover)}</p></section>
      <section><h2>${esc(t().nat_h2)}</h2><div class="seg" role="group" id="natseg">
        <button type="button" data-r="ss" aria-pressed="true">${esc(t().regla.ss)}</button><button type="button" data-r="obras" aria-pressed="false">${esc(t().regla.obras)}</button></div>
        <div id="nat">${natBlock("ss")}</div>
        <div class="note limit"><p>${esc(t().foot_2)}</p></div></section>
      <section>${lineChart(NAC.placebo_ss.map(p => ({ x: p.umbral, y: p.razon, lo: p.ic_inf, hi: p.ic_sup, hot: p.umbral === 15000, label: `${eur(fmt(15000))}: × ${fmt(p.razon, 1)}`,
        tick: p.umbral % (NARROW() ? 4000 : 2000) === (NARROW() ? 3000 : 1000) ? fmt(p.umbral) : "", tip: t().plc_tip(fmt(p.umbral), fmt(p.razon, 2), fmt(p.ic_inf, 2), fmt(p.ic_sup, 2)) })), { title: t().plc_title, sub: t().plc_sub, xlabel: t().plc_x })}</section>
      <section>${lineChart(NAC.reglas.ss.meses.map(p => ({ x: p.mes, y: p.razon, lo: p.ic_inf, hi: p.ic_sup, tick: t().months[p.mes - 1], tip: `${t().months[p.mes - 1]}: × ${fmt(p.razon, 2)} (${fmt(p.ic_inf, 2)}–${fmt(p.ic_sup, 2)})` })), { title: t().mon_title_nat, sub: t().mon_sub_nat, xlabel: "" })}</section>
      <section><h2>${esc(t().rank_h2)}</h2><p>${esc(t().rank_p(NAC.criterios))}</p><div id="rank"></div></section>
      <section><h2>${esc(t().cpv_h2)}</h2><p>${esc(t().cpv_p(fmt(NAC.cpv_cobertura_pct)))}</p>${cpvTable()}</section>`;
    bindSearch();
    document.querySelectorAll("#natseg button").forEach(b => b.addEventListener("click", () => {
      document.querySelectorAll("#natseg button").forEach(x => x.setAttribute("aria-pressed", x === b));
      const el = document.getElementById("nat"); el.innerHTML = natBlock(b.dataset.r); bindTips(el);
    }));
    bindRank(document.getElementById("rank"), false);
  }

  function cpvTable() {
    const rows = NAC.cpv.filter(c => c.nivel !== "insuficiente").map(c => `<tr><td><span class="chip num">${esc(c.cpv)}</span> ${esc(lang === "es" ? c.nombre : c.nombre_en)}</td>
      <td class="n">${fmt(c.n_cerca)}</td><td class="n">${fmt(c.esperado)}</td><td class="n">${ratioTxt(c.razon, c.ic_inf, c.ic_sup)}</td></tr>`);
    return `<div class="tablewrap"><table><thead><tr><th>${esc(t().th_family)}</th><th class="n">${esc(t().th_near)}</th><th class="n">${esc(t().th_expd)}</th><th class="n">${esc(t().th_ratio)}</th></tr></thead><tbody>${fold(rows, 10)}</tbody></table></div>${foldBtn(rows.length, 10)}`;
  }

  function ranking() {
    main.innerHTML = `<section class="hero"><h1 style="font-size:clamp(1.6rem,4.6vw,2.4rem)">${esc(t().rank_h1)}</h1><p class="lead">${esc(t().rank_p(NAC.criterios))}</p></section><div id="rank"></div>
      <div class="note limit"><p>${esc(t().foot_2)}</p></div>`;
    bindRank(document.getElementById("rank"), true);
  }

  function aiBlock(u) {
    if (!u.ia) return "";
    const txt = u.ia[lang];
    const paras = txt.split("\n").map(p => {
      let h = esc(p).replace(/\[(\d+)\]/g, (m0, n) => {
        const e = u.ia.citas[+n - 1];
        return e ? `<a class="cite" href="${EVL}${esc(e)}" target="_blank" rel="noopener noreferrer">[${n}]</a>` : m0;
      });
      h = h.replace(/^([^:]{5,40}:)\s*/, "<b>$1</b>");
      return `<p class="ai-p">${h}</p>`;
    }).join("");
    return `<section class="ai" aria-labelledby="aih"><h3 id="aih">${esc(t().ai_h)} <span class="chip">${esc(t().regla[u.ia.regla])}</span></h3>${paras}
      <p class="prov">${esc(t().ai_prov(flatModel(u.ia.modelo), u.ia["origen_" + lang]))}</p></section>`;
  }

  function ruleBlock(u, rule) {
    const d = u.reglas[rule], R = NAC.criterios.reglas[rule], C = NAC.criterios;
    if (!d) return `<p>${esc(t().u_none(t().regla[rule].toLowerCase()))}</p>`;
    const win = d.n_cerca + d.n_ref;
    let h = `<div class="meta">${badge(d.nivel)}<span class="chip num">${fmt(d.n)} ${esc(t().contracts)}</span></div>`;
    if (d.nivel === "insuficiente") h += `<div class="note warn"><p>${esc(t().u_small(fmt(win), C.min_ventana))}</p></div>`;
    h += `<div class="tiles"><div class="tile ${d.nivel === "senal" ? "hot" : ""}"><div class="v num">${fmt(d.n_cerca)}</div><div class="l">${esc(t().u_obs)} (${eur(`${fmt(R.cerca_desde)}–${fmt(R.umbral)}`)})</div></div>
      <div class="tile"><div class="v num">${fmt(d.esperado, 1)}</div><div class="l">${esc(t().u_exp)}</div></div>
      <div class="tile"><div class="v num">${d.razon == null ? "–" : "× " + fmt(d.razon, 1)}</div><div class="l">${esc(t().u_ratio)} · ${esc(t().ic(fmt(d.ic_inf, 1), d.ic_sup == null ? "∞" : fmt(d.ic_sup, 1)))}</div></div></div>`;
    if (win > 0) {
      h += `<figure class="ci"><p class="ftitle">${esc(t().ci_title)}</p><p class="fsub">${esc(d.razon == null ? t().ci_sub_open(fmt(d.ic_inf, 1)) : t().ci_sub(fmt(d.razon, 1), fmt(d.ic_inf, 1), fmt(d.ic_sup, 1)))}</p>${ciChart(d)}</figure>`;
      if (d.nivel !== "insuficiente" && d.ic_sup != null && d.ic_sup / Math.max(d.ic_inf, 0.1) > 4) h += `<div class="note warn"><p>${esc(t().u_wide)}</p></div>`;
    }
    h += wallChart(d, rule);
    if (d.sobre_umbral) h += `<p class="hint" style="font-size:.85rem;color:var(--ink3)">${esc(t().over(fmt(d.sobre_umbral), fmt(R.umbral)))}</p>`;
    if (u.ia && u.ia.regla === rule) h += aiBlock(u);
    else if (!u.ia && d.nivel === "senal") h += `<p class="hint" style="font-size:.85rem;color:var(--ink3)">${esc(t().ai_pending)}</p>`;
    h += `<div class="note"><strong>${esc(t().caveat_h)}</strong><p>${esc(t().caveat)}</p></div>`;
    if (!d.n_cerca) return h;
    h += `<div class="cols"><div>${monthChart(d)}</div><div><h3>${esc(t().years_h)}</h3><div class="tablewrap"><table><thead><tr><th>${esc(t().th_year)}</th><th class="n">${esc(t().th_n)}</th><th class="n">${esc(t().th_near)}</th><th class="n">${esc(t().th_ref)}</th></tr></thead><tbody>
      ${Object.entries(d.anios).map(([y, a]) => `<tr><td class="num">${y}</td><td class="n">${fmt(a.n)}</td><td class="n">${fmt(a.n_cerca)}</td><td class="n">${fmt(a.n_ref)}</td></tr>`).join("")}</tbody></table></div></div></div>`;
    h += `<h3>${esc(t().rep_h)}</h3>`;
    if (d.repetidos.length) {
      h += `<p>${esc(t().rep_p(3))}</p><div class="tablewrap"><table><thead><tr><th>${esc(t().th_aw)}</th><th class="n">${esc(t().th_nnear)}</th><th class="n">${esc(t().th_amt)} (€)</th><th>${esc(t().th_years)}</th><th class="n">${esc(t().th_maxy)}</th><th class="n">${esc(t().th_all)}</th></tr></thead><tbody>
        ${fold(d.repetidos.map(a => `<tr><td>${esc(t().aw(a.alias))}</td><td class="n">${fmt(a.n_cerca)}</td><td class="n">${fmt(a.importe_cerca)}</td><td class="num">${a.anios.join(", ")}</td><td class="n">${fmt(a.max_en_un_anio)}</td><td class="n">${fmt(a.n_total)}</td></tr>`), 10)}</tbody></table></div>${foldBtn(d.repetidos.length, 10)}`;
    } else h += `<p>${esc(t().rep_none(3))}</p>`;
    h += `<h3>${esc(t().ct_h)}</h3><p class="num">${esc(t().ct_p(fmt(d.contratos.length), fmt(d.n_cerca)))}</p><div class="tablewrap"><table><thead><tr><th>${esc(t().th_date)}</th><th class="n">${esc(t().th_amt)} (€)</th><th>${esc(t().th_exp)}</th><th>${esc(t().th_aw)}</th><th>${esc(t().th_family)}</th><th>${esc(t().th_link)}</th></tr></thead><tbody>
      ${fold(d.contratos.map(c => `<tr><td class="num">${fmtDate(c.f)}</td><td class="n">${fmt(c.i, 2)}</td><td>${esc(c.e)}</td><td>${c.a ? esc(t().aw(c.a)) : `<span class="sub">${esc(t().aw_multi)}</span>`}</td>
        <td>${c.c ? `<span class="chip num" title="${esc((CPV[c.c] || {})[lang] || "")}">${esc(c.c)}</span> <span class="sub">${esc((CPV[c.c] || {})[lang] || "")}</span>` : "–"}</td>
        <td>${c.u ? `<a href="${EVL}${esc(c.u)}" target="_blank" rel="noopener noreferrer">${esc(t().open)}<span aria-hidden="true"> ↗</span></a>` : "–"}</td></tr>`))}</tbody></table></div>${foldBtn(d.contratos.length)}`;
    return h;
  }

  async function unit(id) {
    let u;
    try { u = await getJSON(`data/u/${encodeURIComponent(id)}.json`); } catch { main.innerHTML = `<p class="loading">${esc(t().notfound)}</p>`; return; }
    const rules = ["ss", "obras"].filter(r => u.reglas[r]);
    const order = ["insuficiente", "sin_senal", "indicio", "senal"];
    let cur = u.ia ? u.ia.regla : rules.slice().sort((a, b) => order.indexOf(u.reglas[b].nivel) - order.indexOf(u.reglas[a].nivel) || u.reglas[b].n - u.reglas[a].n)[0];
    document.title = `${u.nombre} · Al límite`;
    const draw = () => {
      main.innerHTML = `<article class="unit"><p class="crumb"><a href="#/">${esc(t().u_back)}</a> › ${esc(u.ruta)}</p>
        <p class="kicker">${esc(u.clase === "entidad" ? t().entidad : t().organo)}${u.nif ? ` · NIF ${esc(u.nif)}` : ""}</p><h1>${esc(u.nombre)}</h1>
        <p class="lead num">${fmt(u.n)} ${esc(t().u_n)} · ${eur(fmt(Math.round(u.importe_total)))} ${esc(t().u_total)}</p>
        ${u.entidad ? `<p>${esc(t().u_part_of)}: <a href="#/u/${esc(u.entidad.id)}">${esc(u.entidad.nombre)}</a></p>` : ""}
        ${rules.length > 1 ? `<div class="seg" role="group" id="useg">${rules.map(r => `<button type="button" data-r="${r}" aria-pressed="${r === cur}">${esc(t().regla[r])}</button>`).join("")}</div>` : `<p><span class="chip">${esc(t().regla[cur] || "")}</span></p>`}
        <div id="rule">${cur ? ruleBlock(u, cur) : ""}</div>
        ${u.organos ? `<h2>${esc(t().u_organs)}</h2><div class="tablewrap"><table><thead><tr><th>${esc(t().th_body)}</th><th class="n">${esc(t().th_n)}</th><th>${esc(t().th_level)}</th></tr></thead><tbody>
          ${fold(u.organos.map(o => `<tr><td><a href="#/u/${esc(o.id)}">${esc(o.nombre)}</a></td><td class="n">${fmt(o.n)}</td><td>${badge(o.nivel)}</td></tr>`))}</tbody></table></div>${foldBtn(u.organos.length)}` : ""}
        </article>`;
      bindTips(main); bindFold(main);
      document.querySelectorAll("#useg button").forEach(b => b.addEventListener("click", () => { cur = b.dataset.r; draw(); }));
    };
    draw();
  }

  async function metodo() {
    const html = await (await fetch(`metodo.${lang}.html`)).text();
    const C = NAC.criterios, d = NAC.reglas.ss, o = NAC.reglas.obras, e = NAC.embudo, ia = NAC.ia || {};
    const vars = {
      n_ss: fmt(e.servicios_suministros), n_obras: fmt(e.obras), n_otros: fmt(e.otros_tipos_excluidos), n_org: fmt(NAC.n_organos), n_ent: fmt(NAC.n_entidades),
      leidas: fmt(e.entradas_leidas), distintos: fmt(e.contratos_distintos), periodo: NAC.periodo.map(fmtDate).join(" – "),
      min_ventana: C.min_ventana, min_cerca: C.min_cerca, q_max: fmt(C.q_max, 2), ic_inf_min: fmt(C.ic_inf_min),
      ss_cerca: fmt(d.n_cerca), ss_esp: fmt(d.esperado), ss_razon: fmt(d.razon, 1), ss_ic: `${fmt(d.ic_inf, 2)}–${fmt(d.ic_sup, 2)}`,
      ob_cerca: fmt(o.n_cerca), ob_esp: fmt(o.esperado), ob_razon: fmt(o.razon, 1), ob_ic: `${fmt(o.ic_inf, 2)}–${fmt(o.ic_sup, 2)}`,
      cpv_pct: fmt(NAC.cpv_cobertura_pct), ss_sobre: fmt(d.sobre_umbral), dic_todos: fmt(d.pct_dic_todos, 1), dic_cerca: fmt(d.pct_dic_cerca, 1),
      senal_org_ss: fmt((d.niveles_organo || {}).senal || 0), senal_ent_ss: fmt((d.niveles_entidad || {}).senal || 0),
      senal_org_ob: fmt((o.niveles_organo || {}).senal || 0), senal_ent_ob: fmt((o.niveles_entidad || {}).senal || 0),
      ia_modelo: ia.modelo || "–", ia_fichas: fmt(ia.fichas_con_explicacion || 0), ia_senal: fmt(ia.fichas_con_senal || 0), ia_modelo_n: fmt(ia.textos_del_modelo || 0),
      ia_plantilla: fmt(ia.textos_de_plantilla || 0), ia_rech: fmt(ia.borradores_rechazados || 0), generado: NAC.generado,
      fuentes: NAC.fuente.map(f => `<tr><td class="num">${esc(f.periodo)}</td><td class="n">${fmt(f.bytes)}</td><td class="num">${esc(f.sha256.slice(0, 16))}…</td><td class="num">${esc(f.descargado.slice(0, 10))}</td></tr>`).join(""),
    };
    main.innerHTML = `<article class="prose">${html.replace(/\{\{(\w+)\}\}/g, (m0, k) => vars[k] ?? m0)}</article>`;
  }

  // ------------------------------------------------------------------ arranque
  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-t]").forEach(el => { el.textContent = t()[el.dataset.t]; });
    const b = document.getElementById("lang");
    b.textContent = lang === "es" ? "EN" : "ES";
    b.setAttribute("aria-label", lang === "es" ? "Switch to English" : "Cambiar a español");
    if (NAC) document.getElementById("gen").textContent = t().gen(NAC.generado);
  }
  async function route() {
    const h = location.hash.replace(/^#\/?/, "");
    document.querySelectorAll(".top nav a").forEach(a => {
      const k = a.getAttribute("href").replace(/^#\/?/, "");
      a.toggleAttribute("aria-current", k === h.split("/")[0]); if (a.hasAttribute("aria-current")) a.setAttribute("aria-current", "page");
    });
    document.title = "Al límite · " + (lang === "es" ? "contratos menores junto al umbral legal" : "minor contracts just under the legal limit");
    tip.hidden = true;
    try {
      if (h.startsWith("u/")) await unit(decodeURIComponent(h.slice(2)));
      else if (h === "ranking") ranking();
      else if (h === "metodo") await metodo();
      else home();
    } catch (e) { console.error(e); main.innerHTML = `<p class="loading">${esc(t().err)}</p>`; }
    bindTips(main); if (!h.startsWith("u/")) bindFold(main);
  }
  async function start() {
    applyLang();
    try {
      [NAC, IDX] = await Promise.all([getJSON("data/nacional.json"), getJSON("data/indice.json")]);
    } catch (e) { main.innerHTML = `<p class="loading">${esc(t().err)}</p>`; return; }
    CPV = Object.fromEntries(NAC.cpv_nombres.map(c => [c[0], { es: c[1], en: c[2] }]));
    buildSearch();
    applyLang();
    await route();
  }
  document.getElementById("lang").addEventListener("click", () => {
    lang = lang === "es" ? "en" : "es";
    try { localStorage.setItem("lang", lang); } catch {}
    applyLang(); route();
  });
  addEventListener("hashchange", () => { route().then(() => { scrollTo({ top: 0, left: 0, behavior: "instant" }); main.focus({ preventScroll: true }); }); });
  let wasNarrow = NARROW();
  addEventListener("resize", () => { if (NARROW() !== wasNarrow) { wasNarrow = NARROW(); route(); } });
  start();
})();
