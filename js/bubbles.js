// Пузыри-субтитры над 3D-точками: каждая фраза дублируется текстом всегда.
// Проекция от canvas.getBoundingClientRect() (в AR холст MindAR шире экрана),
// ограничение безопасной зоной между табло и нижней панелью, раскладка без наложений.
import * as THREE from "three";

const MAX = 3;
const TAIL = 12;          // пузырь поднят над точкой на хвостик (margin-top в CSS)
const v = new THREE.Vector3();

export class Bubbles {
  constructor(root) {
    this.root = root;
    this.items = [];
    this.enabled = true;
    this.rect = null;
    this.rectT = 0;
    addEventListener("resize", () => (this.rectT = 0));
  }
  setStyle(s) { this.root.dataset.style = s; }
  setEnabled(b) { this.enabled = b; if (!b) this.clear(); }

  // anchor: () => THREE.Vector3 (мировые координаты) | null — тогда пузырь в углу с «рацией»
  show({ who, label, text, anchor }) {
    if (!this.enabled) return null;
    while (this.items.length >= MAX) this.remove(this.items[0]);
    const el = document.createElement("div");
    el.className = "bubble";
    el.dataset.who = who.split(".")[0];
    el.innerHTML = `<small></small><span></span>`;
    el.querySelector("small").textContent = label;
    el.querySelector("span").textContent = text;
    this.root.appendChild(el);
    const it = { el, anchor, x: 0, y: 0, w: el.offsetWidth, h: el.offsetHeight, pinned: false, hideT: null };
    this.items.push(it);
    requestAnimationFrame(() => el.classList.add("on"));
    return it;
  }
  hide(it, delay = 0) {
    if (!it) return;
    clearTimeout(it.hideT);
    it.hideT = setTimeout(() => this.remove(it), delay * 1000);
  }
  remove(it) {
    const i = this.items.indexOf(it);
    if (i < 0) return;
    this.items.splice(i, 1);
    clearTimeout(it.hideT);
    it.el.classList.remove("on");
    setTimeout(() => it.el.remove(), 200);
  }
  clear() { for (const it of [...this.items]) this.remove(it); }

  update(camera, canvas, visible = () => true) {
    if (!this.items.length || !camera || !canvas) return;
    const t = performance.now();
    if (!this.rect || t - this.rectT > 500) {
      this.rect = canvas.getBoundingClientRect();
      const hud = document.querySelector("#hud"), bar = document.querySelector("#bar");
      this.top = (hud && !hud.classList.contains("hidden") ? hud.getBoundingClientRect().bottom : 0) + 6;
      this.bottom = (bar && !bar.classList.contains("hidden") ? bar.getBoundingClientRect().top : innerHeight) - 6;
      this.rectT = t;
    }
    const r = this.rect, show = visible();
    const placed = [];
    for (const it of this.items) {
      const p = show && it.anchor ? it.anchor() : null;
      let x, y, hidden = false;
      if (p) {
        v.copy(p).project(camera);
        if (v.z > 1) hidden = true;
        x = r.left + ((v.x + 1) / 2) * r.width;
        y = r.top + ((1 - v.y) / 2) * r.height;
      } else {
        // нет якоря — закрепляем в углу у табло
        x = 12 + it.w / 2;
        y = this.top + it.h + 4;
      }
      it.el.classList.toggle("pinned", !p);
      it.el.style.visibility = hidden ? "hidden" : "";
      if (hidden) continue;
      it.w = it.el.offsetWidth || it.w; it.h = it.el.offsetHeight || it.h;
      x = Math.max(8 + it.w / 2, Math.min(innerWidth - 8 - it.w / 2, x));
      y = Math.max(this.top + it.h + TAIL, Math.min(this.bottom, y));
      placed.push({ it, x, y });
    }
    // жадная раскладка: снизу вверх, при пересечении сдвигаем выше
    placed.sort((a, b) => b.y - a.y);
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i];
      for (let j = 0; j < i; j++) {
        const b = placed[j];
        const overlapX = Math.abs(a.x - b.x) < (a.it.w + b.it.w) / 2 + 4;
        const overlapY = a.y > b.y - b.it.h - 6 && a.y - a.it.h < b.y;
        if (overlapX && overlapY) a.y = b.y - b.it.h - 6;
      }
      a.y = Math.max(this.top + a.it.h + TAIL, a.y);
      a.it.el.style.transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
  }
}
