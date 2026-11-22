/* The €14,999 wall — gráficos del ensayo. SVG a mano, sin dependencias.
   Los datos vienen de <script id="story-data">, que escribe allimite/historia.py a partir de resultados/:
   aquí no hay ninguna cifra escrita a mano, solo decisiones de dibujo (márgenes, pasos de eje). */
(() => {
  "use strict";
  const D = JSON.parse(document.getElementById("story-data").textContent);
  const tip = document.getElementById("tip");
  const NARROW = () => innerWidth < 640;
  const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NF = {};
  const fmt = (v, dec = 0) => (NF[dec] ||= new Intl.NumberFormat("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })).format(v);
  const eur = v => "€" + fmt(v, Number.isInteger(v) ? 0 : 2);
  const kEur = v => (v % 1000 ? eur(v) : `€${fmt(v / 1000)}k`);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const r2 = v => Math.round(v * 100) / 100;

  // Eje con 4 divisiones de paso «redondo» (mismo criterio que app.js).
  function axis4(v, integer) {
    const raw = Math.max(v, integer ? 4 : 1e-9) / 4;
    const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 && !(integer && p < 10) ? 2.5 : f <= 5 ? 5 : 10) * p;
    if (integer) step = Math.max(1, Math.round(step));
    return { max: step * 4, step, dec: step >= 1 ? (step % 1 ? 1 : 0) : 2 };
  }
  const svgOpen = (W, H, label, cls = "") => `<svg class="chart ${cls}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`;
  const hline = (cls, x1, x2, y) => `<line class="${cls}" x1="${r2(x1)}" x2="${r2(x2)}" y1="${r2(y)}" y2="${r2(y)}"/>`;
  const vline = (cls, x, y1, y2) => `<line class="${cls}" x1="${r2(x)}" x2="${r2(x)}" y1="${r2(y1)}" y2="${r2(y2)}"/>`;
  const text = (x, y, s, o = {}) => `<text x="${r2(x)}" y="${r2(y)}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.cls ? ` class="${o.cls}"` : ""}>${esc(s)}</text>`;
  const hit = (x, y, w, h, t) => `<rect class="hit" x="${r2(x)}" y="${r2(y)}" width="${r2(Math.max(w, 1))}" height="${r2(Math.max(h, 1))}" data-tip="${esc(t)}"/>`;
  // Barra con el extremo superior redondeado y la base recta, anclada al eje.
  function bar(cls, x, y0, w, h, extra = "") {
    if (h <= 0) return "";
    const r = Math.min(3, w / 2, h);
    return `<path class="${cls}" d="M${r2(x)},${r2(y0)}V${r2(y0 - h + r)}Q${r2(x)},${r2(y0 - h)} ${r2(x + r)},${r2(y0 - h)}H${r2(x + w - r)}Q${r2(x + w)},${r2(y0 - h)} ${r2(x + w)},${r2(y0 - h + r)}V${r2(y0)}Z"${extra}/>`;
  }
  function yGrid(m, W, ih, ymax, ax, unit = "") {
    let s = "";
    for (let k = 0; k <= 4; k++) {
      const v = (ymax * k) / 4, yy = m.t + ih - (v / ymax) * ih;
      s += hline(k ? "grid" : "axis", m.l, W - m.r, yy) + text(m.l - 6, yy + 4, fmt(v, ax.dec) + (k === 4 ? unit : ""), { anchor: "end" });
    }
    return s;
  }
  // Corchete bajo el eje x que nombra una franja (identidad sin depender solo del color).
  function bracket(x1, x2, y, label, cls) {
    return `<path class="brk ${cls}" d="M${r2(x1 + 1)},${r2(y)}v5H${r2(x2 - 1)}v-5"/>` + text((x1 + x2) / 2, y + 18, label, { anchor: "middle", cls: "brk-t" });
  }

  // ------------------------------------------------------------------ 1. adivina la última barra
  const G = { guess: null, frozen: null, revealed: false, max: 0 };
  function guessChart(el) {
    const R = D.ss, w = R.bin, i0 = Math.round(R.start / w), il = Math.round(R.lim / w) - 1, iEnd = Math.round((R.lim + 1000) / w);
    const real = R.hist[il];
    if (G.guess == null) {
      G.max = axis4(real * 1.2, true).max;
      G.guess = Math.round(R.hist[il - 1] / 100) * 100;
      const inp = document.getElementById("guess-in");
      inp.max = G.max; inp.value = G.guess;
    }
    const narrow = NARROW(), W = narrow ? 360 : 760, H = narrow ? 320 : 340, m = { l: narrow ? 42 : 48, r: narrow ? 8 : 16, t: 34, b: 30 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b, n = iEnd - i0, bw = iw / n;
    const visMax = Math.max(...R.hist.slice(i0, il));
    const top = G.frozen ?? (G.revealed ? Math.max(real, G.guess) : Math.max(visMax * 1.6, G.guess * 1.08));
    const ax = axis4(top, true), ymax = ax.max;
    const y = v => m.t + ih - (Math.min(v, ymax) / ymax) * ih, base = m.t + ih;
    const xl = m.l + (il + 1 - i0) * bw;
    let s = svgOpen(W, H, G.revealed
      ? `Services and supplies contracts per €${fmt(w)} band. The last band before the €${fmt(R.lim)} limit holds ${fmt(real)} contracts.`
      : `Services and supplies contracts per €${fmt(w)} band from €${fmt(R.start)}. The last band before the limit is hidden: your guess is ${fmt(G.guess)}.`, "guess-svg");
    s += yGrid(m, W, ih, ymax, ax);
    const gap = bw > 4 ? 1 : 0.5;
    for (let i = i0; i < iEnd; i++) {
      const x = m.l + (i - i0) * bw, c = R.hist[i];
      if (i === il) continue;
      if (i > il && !G.revealed) continue;
      const bh = c ? Math.max(1.5, (Math.min(c, ymax) / ymax) * ih) : 0;
      s += bar(i > il ? "bar above" : "bar", x + gap / 2, base, bw - gap, bh);
      s += hit(x, m.t, bw, ih, `€${fmt(i * w)}–${fmt((i + 1) * w)}: ${fmt(c)} contracts`);
    }
    const xb = m.l + (il - i0) * bw;
    if (G.revealed) {
      s += bar("bar near grow", xb + gap / 2, base, bw - gap, (real / ymax) * ih);
      s += hit(xb, m.t, bw, ih, `€${fmt(il * w)}–${fmt(R.lim)}: ${fmt(real)} contracts`);
      s += text(xb - 4, y(real) + 4, fmt(real), { anchor: "end", cls: "lbl big" });
      s += hline("guessline", xb - 14, xb + bw + 6, y(G.guess)) + text(xb - 18, y(G.guess) + 4, `your guess: ${fmt(G.guess)}`, { anchor: "end", cls: "lbl soft" });
    } else {
      const gh = (Math.min(G.guess, ymax) / ymax) * ih;
      s += `<rect class="guessbar" x="${r2(xb + gap / 2)}" y="${r2(base - gh)}" width="${r2(bw - gap)}" height="${r2(Math.max(gh, 1))}"/>`;
      s += text(xb + bw / 2, base - gh - 8, "?", { anchor: "middle", cls: "lbl q" });
      s += text(xb - 6, base - gh + 4, fmt(G.guess), { anchor: "end", cls: "lbl" });
      s += `<rect class="dragzone" x="${r2(xb - bw * 3)}" y="${m.t - 20}" width="${r2(bw * 7)}" height="${ih + 20}"/>`;
    }
    s += vline("limitline", xl, m.t - 22, base) + text(xl - 6, m.t - 14, `Legal limit: ${eur(R.lim)}`, { anchor: "end", cls: "lbl" });
    const step = narrow ? 2000 : 1000;
    for (let v = R.start; v <= R.lim + 1000; v += step) s += text(m.l + (v / w - i0) * bw, base + 16, kEur(v), { anchor: "middle" });
    s += "</svg>";
    el.innerHTML = s;
    if (!G.revealed) bindDrag(el.querySelector("svg"), { base, ih, H }, ymax);
    document.getElementById("guess-out").textContent = fmt(G.guess);
  }
  // Arrastrar la barra discontinua: la escala se congela mientras dura el gesto.
  function bindDrag(svg, g, ymax) {
    const set = e => {
      const cur = document.querySelector('[data-chart="guess"] svg'), r = cur.getBoundingClientRect();
      const yy = ((e.clientY - r.top) / r.height) * g.H;
      const v = Math.max(0, Math.min(G.max, ((g.base - yy) / g.ih) * ymax));
      G.guess = Math.round(v / 100) * 100;
      document.getElementById("guess-in").value = G.guess;
      renderOne("guess");
    };
    svg.addEventListener("pointerdown", e => {
      if (G.revealed || !e.target.closest(".dragzone, .guessbar")) return;
      e.preventDefault(); G.frozen = ymax; set(e);
      const move = ev => { if (!G.revealed) set(ev); };
      const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); G.frozen = null; renderOne("guess"); };
      addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
    });
  }
  function reveal(byScroll) {
    if (G.revealed) return;
    G.revealed = true;
    const R = D.ss, real = R.hist[Math.round(R.lim / R.bin) - 1];
    const box = document.querySelector("[data-guess]");
    box.querySelector("input").disabled = true;
    const btn = box.querySelector("button"); btn.disabled = true; btn.textContent = "Revealed";
    renderOne("guess");
    const out = document.getElementById("guess-result");
    if (!byScroll) {
      const g = G.guess, ratio = g > 0 ? real / g : null;
      out.textContent = Math.abs(g - real) <= real * 0.1 ? `You guessed ${fmt(g)}. Very close.`
        : g > real ? `You guessed ${fmt(g)}: higher than the real number.`
        : ratio ? `You guessed ${fmt(g)}. The real bar is ${fmt(ratio, 1)} times taller.` : `You guessed zero.`;
    }
    document.getElementById("guess-reveal").classList.add("on");
  }

  // ------------------------------------------------------------------ 2. franjas de 1.000 € (scrolly)
  function bandsChart(el) {
    const R = D.ss, B = R.bands, narrow = NARROW();
    const W = narrow ? 360 : 620, H = narrow ? 290 : 380, m = { l: narrow ? 42 : 50, r: narrow ? 58 : 84, t: 28, b: 30 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b, slot = iw / B.length, bw = slot * (narrow ? 0.74 : 0.66);
    const ax = axis4(R.n_cerca * 1.05, true), ymax = ax.max, base = m.t + ih;
    const y = v => base - (v / ymax) * ih;
    let s = svgOpen(W, H, `Contracts per €${fmt(B[0].to - B[0].from)} band. Reference bands: ${B.slice(0, -1).map(b => fmt(b.n)).join(", ")}. Expected in the last band: ${fmt(R.esperado)}. Observed: ${fmt(R.n_cerca)}, ${fmt(R.razon, 2)} times as many.`);
    s += yGrid(m, W, ih, ymax, ax);
    const ye = y(R.esperado);
    let top = "";
    B.forEach((b, i) => {
      const x = m.l + i * slot + (slot - bw) / 2, last = i === B.length - 1;
      const lab = narrow ? `${fmt(b.from / 1000)}–${fmt(b.to / 1000)}k` : `€${fmt(b.from / 1000)}k–${fmt(b.to / 1000)}k`;
      s += text(x + bw / 2, base + 16, lab, { anchor: "middle", cls: last ? "lbl" : "" });
      if (!last) {
        const h = (b.n / ymax) * ih;
        s += bar("bar ref", x, base, bw, h) + text(x + bw / 2, base - h / 2 + 4, narrow ? `${fmt(b.n / 1000, 1)}k` : fmt(b.n), { anchor: "middle", cls: "lbl inv" });
        s += hit(x, m.t, bw, ih, `${eur(b.from)}–${fmt(b.to)}: ${fmt(b.n)} contracts`);
      } else {
        const yo = y(R.n_cerca);
        s += `<g class="s1"><rect class="ghost" x="${r2(x)}" y="${r2(ye)}" width="${r2(bw)}" height="${r2(base - ye)}"/></g>`;
        s += `<g class="s2">${bar("bar near grow", x, base, bw, (R.n_cerca / ymax) * ih)}</g>`;
        s += `<g class="s2">${text(x + bw / 2, yo - 8, fmt(R.n_cerca), { anchor: "middle", cls: "lbl big" })}</g>`;
        // la línea de lo esperable va por encima de las barras; su rótulo, en el margen derecho
        top += `<g class="s1">${hline("exp", m.l, x + bw + 4, ye)}${text(x + bw + 8, ye - 3, "expected", { cls: "lbl soft" })}${text(x + bw + 8, ye + 12, fmt(R.esperado), { cls: "lbl" })}</g>`;
        const xb = x - 5;
        top += `<g class="s3"><path class="brace" d="M${r2(xb)},${r2(ye)}h-5V${r2(yo)}h5"/>${text(xb - 9, (ye + yo) / 2 + 6, `${fmt(R.razon, 2)}×`, { anchor: "end", cls: "lbl big" })}</g>`;
        top += `<g class="s2">${hit(x, m.t, bw, ih, `${eur(b.from)}–${fmt(b.to)}: ${fmt(b.n)} contracts (expected ${fmt(R.esperado)})`)}</g>`;
      }
    });
    s += top + "</svg>";
    el.innerHTML = s;
  }

  // ------------------------------------------------------------------ 3. umbrales ficticios
  function fakeChart(el) {
    const P = D.placebo, narrow = NARROW(), lim = D.ss.lim;
    const W = narrow ? 360 : 760, H = narrow ? 290 : 320, m = { l: 40, r: narrow ? 12 : 20, t: 24, b: 36 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const x0 = P[0].umbral, x1 = P[P.length - 1].umbral;
    const ax = axis4(Math.max(...P.map(p => p.ic_sup)) * 1.02, false), ymax = ax.max;
    const x = v => m.l + ((v - x0) / (x1 - x0)) * iw, y = v => m.t + ih - (v / ymax) * ih;
    const peak = P.find(p => p.umbral === lim), rd = P.find(p => p.umbral === D.round_line);
    let s = svgOpen(W, H, `Ratio observed to expected for fake limits from ${eur(x0)} to ${eur(x1)}. It peaks at the real limit, ${eur(lim)}, at ${fmt(peak.razon, 2)}; at ${eur(D.round_line)} it is ${fmt(rd.razon, 2)}.`);
    s += yGrid(m, W, ih, ymax, ax);
    s += hline("exp", m.l, W - m.r, y(1)) + text(m.l + 4, y(1) - 6, "1 = as many as expected", { cls: "lbl soft" });
    s += `<path class="band" d="M${P.map(p => `${r2(x(p.umbral))},${r2(y(p.ic_sup))}`).join("L")}L${P.slice().reverse().map(p => `${r2(x(p.umbral))},${r2(y(p.ic_inf))}`).join("L")}Z"/>`;
    s += `<path class="line" d="M${P.map(p => `${r2(x(p.umbral))},${r2(y(p.razon))}`).join("L")}"/>`;
    const half = iw / (P.length - 1) / 2;
    P.forEach(p => {
      const hot = p.umbral === lim;
      s += `<circle class="dot${hot ? " hot" : ""}" cx="${r2(x(p.umbral))}" cy="${r2(y(p.razon))}" r="${hot ? 6 : 3.5}"/>`;
      s += hit(x(p.umbral) - half, m.t, half * 2, ih, `Fake limit ${eur(p.umbral)}: ${fmt(p.razon, 2)} (95%: ${fmt(p.ic_inf, 2)}–${fmt(p.ic_sup, 2)}), ${fmt(p.n_cerca)} contracts in the band`);
    });
    s += vline("limitline thin", x(lim), m.t - 10, m.t + ih);
    s += text(x(lim) - 10, y(peak.razon) + 4, `Real limit: ${fmt(peak.razon, 2)}`, { anchor: "end", cls: "lbl" });
    s += `<circle class="dot ring" cx="${r2(x(rd.umbral))}" cy="${r2(y(rd.razon))}" r="6"/>`;
    s += text(x(rd.umbral), y(rd.razon) + (narrow ? 22 : 24), `${eur(rd.umbral)}: ${fmt(rd.razon, 2)}`, { anchor: "middle", cls: "lbl" });
    const step = narrow ? 2000 : 1000;
    for (let v = Math.ceil(x0 / step) * step; v <= x1; v += step) s += text(x(v), H - m.b + 18, kEur(v), { anchor: "middle", cls: v === lim ? "lbl" : "" });
    s += "</svg>";
    el.innerHTML = s;
  }

  // ------------------------------------------------------------------ 4. estabilidad por grupos (forest)
  const RULE = { forest: "ss", months: "ss" };
  const RULE_NAME = { ss: "services and supplies", obras: "works" };
  function forestChart(el) {
    const rows = D[RULE.forest].groups, narrow = NARROW();
    const lab = narrow ? 124 : 210, W = narrow ? 360 : 640, rowH = 30, gapH = 22;
    const m = { l: lab, r: narrow ? 40 : 56, t: 26, b: 30 };
    const groups = [...new Set(rows.map(r => r.g))];
    const H = m.t + m.b + rows.length * rowH + (groups.length - 1) * gapH;
    const xmax = Math.ceil(Math.max(...D.ss.groups.map(r => r.ic_sup), ...D.obras.groups.map(r => r.ic_sup)));
    const iw = W - m.l - m.r, x = v => m.l + (v / xmax) * iw;
    let s = svgOpen(W, H, `Ratio observed to expected, ${RULE_NAME[RULE.forest]}: ` + rows.map(r => `${r.label} ${fmt(r.razon, 2)}`).join("; "));
    for (let v = 0; v <= xmax; v++) {
      s += vline(v ? "grid" : "axis", x(v), m.t - 6, H - m.b) + text(x(v), H - m.b + 16, v === 1 ? "1×" : `${v}×`, { anchor: "middle" });
    }
    s += vline("exp", x(1), m.t - 10, H - m.b);
    let yy = m.t, prev = null;
    rows.forEach(r => {
      if (prev && r.g !== prev) yy += gapH;
      if (r.g !== prev && r.g !== "All") s += text(8, yy - 6, r.g === "Year" ? "By year" : "By type of body", { cls: "grp" });
      prev = r.g;
      const cy = yy + rowH / 2;
      s += text(8, cy + 4, r.label, { cls: r.g === "All" ? "lbl" : "" });
      s += `<line class="ci" x1="${r2(x(r.ic_inf))}" x2="${r2(x(r.ic_sup))}" y1="${r2(cy)}" y2="${r2(cy)}"/>`;
      s += `<circle class="dot hot" cx="${r2(x(r.razon))}" cy="${r2(cy)}" r="5.5"/>`;
      s += text(x(r.ic_sup) + 8, cy + 4, fmt(r.razon, 2), { cls: "val" });
      s += hit(0, yy, W, rowH, `${r.label}${r.sub ? ` (${r.sub})` : ""}: ${fmt(r.razon, 2)}, 95% interval ${fmt(r.ic_inf, 2)}–${fmt(r.ic_sup, 2)}`);
      yy += rowH;
    });
    s += "</svg>";
    el.innerHTML = s;
  }

  function monthsChart(el) {
    const M = D[RULE.months].months, narrow = NARROW();
    const W = narrow ? 360 : 640, H = 250, m = { l: 34, r: 12, t: 20, b: 30 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const ymax = Math.ceil(Math.max(...D.ss.months.map(p => p.ic_sup), ...D.obras.months.map(p => p.ic_sup)));
    const x = i => m.l + (i + 0.5) * (iw / 12), y = v => m.t + ih - (v / ymax) * ih;
    let s = svgOpen(W, H, `Ratio observed to expected by month, ${RULE_NAME[RULE.months]}: ` + M.map(p => `${p.m} ${fmt(p.razon, 2)}`).join(", "));
    for (let v = 0; v <= ymax; v++) s += hline(v ? "grid" : "axis", m.l, W - m.r, y(v)) + text(m.l - 6, y(v) + 4, `${v}×`, { anchor: "end" });
    s += hline("exp", m.l, W - m.r, y(1));
    s += `<path class="band" d="M${M.map((p, i) => `${r2(x(i))},${r2(y(p.ic_sup))}`).join("L")}L${M.map((p, i) => [i, p]).reverse().map(([i, p]) => `${r2(x(i))},${r2(y(p.ic_inf))}`).join("L")}Z"/>`;
    s += `<path class="line" d="M${M.map((p, i) => `${r2(x(i))},${r2(y(p.razon))}`).join("L")}"/>`;
    M.forEach((p, i) => {
      s += `<circle class="dot${i === 11 ? " hot" : ""}" cx="${r2(x(i))}" cy="${r2(y(p.razon))}" r="${i === 11 ? 5.5 : 4}"/>`;
      s += text(x(i), H - 10, narrow ? p.m[0] : p.m, { anchor: "middle", cls: i === 11 ? "lbl" : "" });
      s += hit(x(i) - iw / 24, m.t, iw / 12, ih, `${p.m}: ${fmt(p.razon, 2)} (95%: ${fmt(p.ic_inf, 2)}–${fmt(p.ic_sup, 2)}), ${fmt(p.n_cerca)} contracts near the limit`);
    });
    s += "</svg>";
    el.innerHTML = s;
  }

  // ------------------------------------------------------------------ 5. el muro de las obras
  function worksChart(el) {
    const R = D.obras, w = R.bin, i0 = Math.round(R.start / w), n = R.hist.length - i0, narrow = NARROW();
    const W = narrow ? 360 : 760, H = narrow ? 290 : 330, m = { l: 44, r: narrow ? 10 : 16, t: 30, b: 50 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b, bw = iw / n, base = m.t + ih;
    const iRef = Math.round(R.ref_from / w), iNear = Math.round(R.near_from / w), iLim = Math.round(R.lim / w);
    const expBin = R.n_ref / (iNear - iRef);
    const ax = axis4(Math.max(...R.hist.slice(i0)), true), ymax = ax.max, y = v => base - (v / ymax) * ih;
    let s = svgOpen(W, H, `Works contracts per €${fmt(w)} band from ${eur(R.start)}. ${fmt(R.n_cerca)} in the last €${fmt(R.lim - R.near_from)} before the ${eur(R.lim)} limit, where ${fmt(R.esperado)} would be expected.`);
    s += yGrid(m, W, ih, ymax, ax);
    const gap = bw > 4 ? 1 : 0.5;
    for (let i = i0; i < R.hist.length; i++) {
      const c = R.hist[i], xx = m.l + (i - i0) * bw;
      const cls = i >= iNear && i < iLim ? "bar near" : i >= iRef && i < iNear ? "bar ref" : "bar";
      s += bar(cls, xx + gap / 2, base, bw - gap, c ? Math.max(1.5, (c / ymax) * ih) : 0);
      s += hit(xx, m.t, bw, ih, `€${fmt(i * w)}–${fmt((i + 1) * w)}: ${fmt(c)} contracts`);
    }
    const xl = m.l + (iLim - i0) * bw, xn = m.l + (iNear - i0) * bw, xr = m.l + (iRef - i0) * bw;
    s += hline("exp", xn - 4, xl + 4, y(expBin));
    s += vline("limitline", xl, m.t - 14, base) + text(xl + 6, m.t - 6, `Legal limit: ${eur(R.lim)}`, { cls: "lbl" });
    const last = R.hist[iLim - 1];
    s += text(xl - bw - 6, y(last) + 10, fmt(last), { anchor: "end", cls: "lbl" });
    const step = narrow ? 10000 : 5000;
    for (let v = R.start; v <= R.max; v += step) s += text(m.l + (v / w - i0) * bw, base + 16, kEur(v), { anchor: "middle" });
    s += bracket(xr, xn, base + 24, narrow ? "reference" : "reference band", "ref-b") + bracket(xn, xl, base + 24, narrow ? "last" : `last €${fmt(R.lim - R.near_from)}`, "near-b");
    s += "</svg>";
    el.innerHTML = s;
  }

  // ------------------------------------------------------------------ 6. tres organismos
  function examplesChart(el) {
    const E = D.ejemplos, w = D.ss.bin, lim = D.ss.lim, nf = D.ss.near_from, rf = D.ss.ref_from;
    const cimax = Math.ceil(Math.max(...E.map(e => e.ic_sup)));
    el.innerHTML = E.map(e => {
      const W = 300, H = 170, m = { l: 30, r: 8, t: 14, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b, n = e.hist.length, bw = iw / n, base = m.t + ih;
      const ax = axis4(Math.max(...e.hist, 4), true), ymax = ax.max;
      let s = svgOpen(W, H, `${e.label}: ${fmt(e.n_cerca)} contracts in the last €${fmt(lim - nf)}, ${fmt(e.esperado, 1)} expected; ratio ${fmt(e.razon, 2)}, 95% interval ${fmt(e.ic_inf, 2)}–${fmt(e.ic_sup, 2)}.`, "small");
      for (let k = 0; k <= 4; k += 2) { const v = (ymax * k) / 4, yy = base - (v / ymax) * ih; s += hline(k ? "grid" : "axis", m.l, W - m.r, yy) + text(m.l - 4, yy + 4, fmt(v, ax.dec), { anchor: "end" }); }
      e.hist.forEach((c, i) => {
        const a = e.from + i * w, xx = m.l + i * bw;
        const cls = a >= nf && a < lim ? "bar near" : a >= rf && a < nf ? "bar ref" : "bar";
        s += bar(cls, xx + 0.5, base, bw - 1, c ? Math.max(1.5, (c / ymax) * ih) : 0);
        s += hit(xx, m.t, bw, ih, `€${fmt(a)}–${fmt(a + w)}: ${fmt(c)} contracts`);
      });
      const xl = m.l + ((lim - e.from) / w) * bw;
      s += vline("limitline thin", xl, m.t - 6, base);
      for (const v of [10000, 12000, 14000]) if (v >= e.from) s += text(m.l + ((v - e.from) / w) * bw, H - 6, kEur(v), { anchor: "middle" });
      s += "</svg>";
      // franja del intervalo, en escala común a los tres
      const CW = 300, CH = 44, cm = { l: 10, r: 14 }, ciw = CW - cm.l - cm.r, cx = v => cm.l + (Math.min(v, cimax) / cimax) * ciw;
      let c = svgOpen(CW, CH, `Ratio ${fmt(e.razon, 2)}, 95% interval ${fmt(e.ic_inf, 2)} to ${fmt(e.ic_sup, 2)}`, "small ci-strip");
      c += hline("axis", cm.l, CW - cm.r, 30);
      for (let v = 0; v <= cimax; v += cimax > 6 ? 2 : 1) c += text(cx(v), 42, `${v}×`, { anchor: "middle" });
      c += vline("exp", cx(1), 4, 30);
      c += `<line class="ci" x1="${r2(cx(e.ic_inf))}" x2="${r2(cx(e.ic_sup))}" y1="16" y2="16"/><circle class="dot hot" cx="${r2(cx(e.razon))}" cy="16" r="5"/>`;
      c += "</svg>";
      return `<div class="ex"><p class="ex-h">${esc(e.label)}</p><p class="ex-b"><span class="badge ${esc(e.nivel)}">${esc(e.level)}</span> <span class="num">${fmt(e.razon, 2)}× (${fmt(e.ic_inf, 2)}–${fmt(e.ic_sup, 2)})</span></p>${s}${c}</div>`;
    }).join("");
  }

  function timelineChart(el) {
    const T = D.timeline, narrow = NARROW();
    const W = narrow ? 360 : 760, H = narrow ? 260 : 300, m = { l: 54, r: 12, t: 22, b: 28 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const t0 = Date.UTC(T.y0, 0, 1), t1 = Date.UTC(T.y1 + 1, 0, 1);
    const x = f => m.l + ((Date.parse(f) - t0) / (t1 - t0)) * iw, y = v => m.t + ih - ((v - T.from) / (T.to - T.from)) * ih;
    let s = svgOpen(W, H, `${T.items.length} contracts between ${eur(T.from)} and ${eur(T.to)}, by award date. ${T.items.filter(i => i.r).length} of them went to companies with three or more.`);
    const stepY = (T.to - T.from) / 4;
    for (let k = 0; k <= 4; k++) { const v = T.from + k * stepY; s += hline(k ? "grid" : "axis", m.l, W - m.r, y(v)) + text(m.l - 6, y(v) + 4, eur(v), { anchor: "end" }); }
    for (let yr = T.y0; yr <= T.y1 + 1; yr++) {
      const xx = m.l + ((Date.UTC(yr, 0, 1) - t0) / (t1 - t0)) * iw;
      if (yr > T.y0 && yr <= T.y1) s += vline("grid", xx, m.t, m.t + ih);
      if (yr <= T.y1) s += text(xx + (iw / (T.y1 - T.y0 + 1)) / 2, H - 8, String(yr), { anchor: "middle" });
    }
    s += hline("limitline", m.l, W - m.r, y(T.to));
    const items = T.items.slice().sort((a, b) => a.r - b.r);
    items.forEach(it => {
      const dot = `<circle class="tdot${it.r ? " rep" : ""}" cx="${r2(x(it.f))}" cy="${r2(y(it.i))}" r="${narrow ? 4 : 4.5}" data-tip="${esc(`${it.f} · ${eur(it.i)} · awardee ${it.a ?? "unknown"}${it.u ? " · click to open the official record" : ""}`)}"/>`;
      s += it.u ? `<a href="https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&amp;idEvl=${esc(it.u)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${dot}</a>` : dot;
    });
    s += "</svg>";
    el.innerHTML = s;
  }

  // ------------------------------------------------------------------ 7. familias CPV
  let cpvAll = false;
  function cpvChart(el) {
    const C = D.cpv, narrow = NARROW(), show = cpvAll ? C : C.slice(0, 10);
    const W = narrow ? 360 : 640, rowH = 38, m = { l: 8, r: 48, t: 20, b: 26 }, H = m.t + m.b + show.length * rowH;
    const xmax = Math.ceil(Math.max(...C.map(c => c.ic_sup))), iw = W - m.l - m.r, x = v => m.l + (v / xmax) * iw;
    let s = svgOpen(W, H, `Ratio observed to expected by CPV division, highest first: ` + show.map(c => `${c.name} ${fmt(c.razon, 2)}`).join("; "));
    for (let v = 0; v <= xmax; v++) s += vline(v ? "grid" : "axis", x(v), m.t - 4, H - m.b) + text(x(v), H - m.b + 16, `${v}×`, { anchor: "middle" }) + text(x(v), m.t - 8, `${v}×`, { anchor: "middle" });
    s += vline("exp", x(1), m.t - 4, H - m.b);
    const maxCh = narrow ? 50 : 96;
    show.forEach((c, i) => {
      const yy = m.t + i * rowH, cy = yy + 26;
      const name = c.name.length > maxCh ? c.name.slice(0, maxCh - 1) + "…" : c.name;
      s += `<rect class="rowbg" x="${m.l}" y="${yy + 2}" width="${W - m.l - m.r}" height="${rowH - 4}"/>`;
      s += text(m.l + 4, yy + 14, name, { cls: "rowlbl" });
      s += `<line class="ci" x1="${r2(x(c.ic_inf))}" x2="${r2(x(c.ic_sup))}" y1="${cy}" y2="${cy}"/><circle class="dot hot" cx="${r2(x(c.razon))}" cy="${cy}" r="4.5"/>`;
      s += text(x(c.ic_sup) + 6, cy + 4, fmt(c.razon, 2), { cls: "val" });
      s += hit(0, yy, W, rowH, `${c.name}: ${fmt(c.razon, 2)} (95%: ${fmt(c.ic_inf, 2)}–${fmt(c.ic_sup, 2)}), ${fmt(c.n)} contracts`);
    });
    s += "</svg>";
    const more = C.length > 10 ? `<button type="button" class="more" data-cpv-more aria-expanded="${cpvAll}">${cpvAll ? "Show the top 10 only" : `Show all ${C.length} families`}</button>` : "";
    el.innerHTML = s + more;
    el.querySelector("[data-cpv-more]")?.addEventListener("click", () => {
      cpvAll = !cpvAll; renderOne("cpv"); el.querySelector("[data-cpv-more]").focus();
    });
  }

  // ------------------------------------------------------------------ montaje
  const CHARTS = { guess: guessChart, bands: bandsChart, fake: fakeChart, forest: forestChart, months: monthsChart, works: worksChart, examples: examplesChart, timeline: timelineChart, cpv: cpvChart };
  function renderOne(k) {
    const el = document.querySelector(`[data-chart="${k}"]`);
    if (!el) return;
    try { CHARTS[k](el); } catch (e) { console.error(e); el.innerHTML = '<p class="fsub">This chart could not be drawn. The data table below has every number.</p>'; }
  }
  const renderAll = () => Object.keys(CHARTS).forEach(renderOne);

  // tooltip compartido (puntero); con teclado, las tablas
  document.addEventListener("pointerover", e => {
    const el = e.target.closest?.("[data-tip]");
    if (!el) return;
    tip.textContent = el.dataset.tip; tip.hidden = false;
  });
  document.addEventListener("pointermove", e => {
    if (tip.hidden) return;
    const el = e.target.closest?.("[data-tip]");
    if (!el) { tip.hidden = true; return; }
    if (tip.textContent !== el.dataset.tip) tip.textContent = el.dataset.tip;
    const w = tip.offsetWidth;
    tip.style.left = Math.max(6, Math.min(innerWidth - w - 6, e.clientX - w / 2)) + "px";
    tip.style.top = Math.max(6, e.clientY - tip.offsetHeight - 14) + "px";
  });
  document.addEventListener("pointerout", e => { if (!e.relatedTarget?.closest?.("[data-tip]")) tip.hidden = true; });
  addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });

  // adivinanza
  const inp = document.getElementById("guess-in");
  inp.addEventListener("input", () => { G.guess = +inp.value; renderOne("guess"); });
  document.getElementById("guess-go").addEventListener("click", () => reveal(false));
  // quien sigue bajando sin adivinar también ve la respuesta (cuando el gráfico ya ha pasado de largo)
  const fig = document.getElementById("fig-guess");
  const autoReveal = () => {
    if (G.revealed) return removeEventListener("scroll", autoReveal);
    if (fig.getBoundingClientRect().bottom < innerHeight * 0.35) reveal(true);
  };
  addEventListener("scroll", autoReveal, { passive: true });

  // conmutadores servicios / obras
  document.querySelectorAll("[data-rule-fig]").forEach(f => {
    const k = f.querySelector("[data-chart]").dataset.chart;
    f.querySelectorAll("[data-rule]").forEach(b => b.addEventListener("click", () => {
      RULE[k] = b.dataset.rule;
      f.querySelectorAll("[data-rule]").forEach(o => o.setAttribute("aria-pressed", String(o === b)));
      renderOne(k);
    }));
  });

  // scrolly: el paso activo decide qué capas del gráfico se ven
  const scrolly = document.querySelector("[data-scrolly]");
  const bandsEl = document.querySelector('[data-chart="bands"]');
  const steps = [...scrolly.querySelectorAll(".step")];
  const setStep = i => { bandsEl.dataset.state = i; steps.forEach((s, j) => s.classList.toggle("active", j === i)); };
  if ("IntersectionObserver" in window) {
    scrolly.classList.add("live");
    setStep(0);
    let io = null;
    const observe = () => {
      io?.disconnect();
      const line = NARROW() ? "-62% 0px -37% 0px" : "-48% 0px -51% 0px";
      io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) setStep(steps.indexOf(en.target)); }), { rootMargin: line });
      steps.forEach(s => io.observe(s));
    };
    observe();
    let wasNarrowIO = NARROW();
    addEventListener("resize", () => { if (NARROW() !== wasNarrowIO) { wasNarrowIO = NARROW(); observe(); } });
  } else setStep(steps.length - 1);

  if (REDUCE) document.documentElement.classList.add("reduce");
  renderAll();
  let wasNarrow = NARROW();
  addEventListener("resize", () => { if (NARROW() !== wasNarrow) { wasNarrow = NARROW(); renderAll(); } });
})();
