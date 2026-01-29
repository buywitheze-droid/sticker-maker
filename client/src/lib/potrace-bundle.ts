// Bundled Potrace algorithm for web worker use
// Ported from potrace-js (https://github.com/nicecui/potrace-js)
// Original Potrace algorithm by Peter Selinger

interface PotracePoint {
  x: number;
  y: number;
}

interface PotraceOptions {
  turnpolicy: 'right' | 'black' | 'white' | 'majority' | 'minority';
  turdsize: number;
  optcurve: boolean;
  alphamax: number;
  opttolerance: number;
}

const DEFAULT_OPTIONS: PotraceOptions = {
  turnpolicy: 'minority',
  turdsize: 2,
  optcurve: true,
  alphamax: 1,
  opttolerance: 0.2
};

function sign(i: number): number {
  return i > 0 ? 1 : i < 0 ? -1 : 0;
}

class Point {
  x: number;
  y: number;
  
  constructor(x: number = 0, y: number = 0) {
    this.x = x;
    this.y = y;
  }
  
  copy(): Point {
    return new Point(this.x, this.y);
  }
  
  toIndex(width: number, height: number): number | null {
    if (this.x < 0 || this.y < 0 || this.x >= width || this.y >= height) return null;
    return width * this.y + this.x;
  }
  
  lerp(point: Point, lambda: number): Point {
    const x = this.x + lambda * (point.x - this.x);
    const y = this.y + lambda * (point.y - this.y);
    return new Point(x, y);
  }
  
  dorthInfty(point: Point): Point {
    const x = -sign(point.y - this.y);
    const y = sign(point.x - this.x);
    return new Point(x, y);
  }
  
  ddenom(point: Point): number {
    const r = this.dorthInfty(point);
    return r.y * (point.x - this.x) - r.x * (point.y - this.y);
  }
}

class Bitmap {
  width: number;
  height: number;
  size: number;
  data: Int8Array;
  
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.data = new Int8Array(this.size);
  }
  
  at(x: number, y: number): boolean {
    return (x >= 0 && x < this.width && y >= 0 && y < this.height) &&
        this.data[this.width * y + x] === 1;
  }
  
  flip(x: number, y: number): void {
    if (this.at(x, y)) {
      this.data[this.width * y + x] = 0;
    } else {
      this.data[this.width * y + x] = 1;
    }
  }
  
  copy(): Bitmap {
    const bitmap = new Bitmap(this.width, this.height);
    for (let i = 0; i < this.size; i++) {
      bitmap.data[i] = this.data[i];
    }
    return bitmap;
  }
  
  index(i: number): Point {
    const x = i % this.width;
    const y = Math.floor(i / this.width);
    return new Point(x, y);
  }
  
  xOrPath(path: Path): void {
    let y1 = path.points[0].y;
    
    for (let i = 1; i < path.points.length; i++) {
      const x = path.points[i].x;
      const y = path.points[i].y;
      
      if (y !== y1) {
        const minY = Math.min(y1, y);
        const maxX = path.maxX;
        for (let j = x; j < maxX; j++) {
          this.flip(j, minY);
        }
        y1 = y;
      }
    }
  }
}

class Sum {
  x: number;
  y: number;
  xy: number;
  x2: number;
  y2: number;
  
  constructor(x: number, y: number, xy: number, x2: number, y2: number) {
    this.x = x;
    this.y = y;
    this.xy = xy;
    this.x2 = x2;
    this.y2 = y2;
  }
}

class Quad {
  data: number[];
  
  constructor() {
    this.data = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  
  at(x: number, y: number): number {
    return this.data[x * 3 + y];
  }
}

class Curve {
  n: number;
  tag: string[];
  c: Point[];
  alphaCurve: number;
  vertex: Point[];
  alpha: number[];
  alpha0: number[];
  beta: number[];
  
  constructor(n: number) {
    this.n = n;
    this.tag = new Array(n);
    this.c = new Array(n * 3);
    this.alphaCurve = 0;
    this.vertex = new Array(n);
    this.alpha = new Array(n);
    this.alpha0 = new Array(n);
    this.beta = new Array(n);
  }
}

class Path {
  points: Point[];
  area: number;
  isHole: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  curve: Curve;
  x0: number = 0;
  y0: number = 0;
  sums: Sum[] = [];
  lon: number[] = [];
  po: number[] = [];
  m: number = 0;
  
  constructor(points: Point[], area: number, isHole: boolean) {
    this.points = points;
    this.area = area;
    this.isHole = isHole;
    
    const xValues = this.points.map(({ x }) => x);
    const yValues = this.points.map(({ y }) => y);
    
    this.minX = Math.min(...xValues);
    this.minY = Math.min(...yValues);
    this.maxX = Math.max(...xValues);
    this.maxY = Math.max(...yValues);
    
    this.curve = new Curve(0);
  }
  
  reverse(): void {
    this.curve.vertex.reverse();
  }
}

class Opti {
  pen: number = 0;
  c: Point[] = [new Point(), new Point()];
  t: number = 0;
  s: number = 0;
  alpha: number = 0;
}

function mod(a: number, n: number): number {
  return a >= n ? a % n : a >= 0 ? a : n - 1 - (-1 - a) % n;
}

function xprod(p1: Point, p2: Point): number {
  return p1.x * p2.y - p1.y * p2.x;
}

function cyclic(a: number, b: number, c: number): boolean {
  if (a <= c) {
    return (a <= b && b < c);
  } else {
    return (a <= b || b < c);
  }
}

function quadform(Q: Quad, w: Point): number {
  const v = [w.x, w.y, 1];
  let sum = 0.0;
  
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      sum += v[i] * Q.at(i, j) * v[j];
    }
  }
  return sum;
}

function dpara(p0: Point, p1: Point, p2: Point): number {
  const x1 = p1.x - p0.x;
  const y1 = p1.y - p0.y;
  const x2 = p2.x - p0.x;
  const y2 = p2.y - p0.y;
  return x1 * y2 - x2 * y1;
}

function cprod(p0: Point, p1: Point, p2: Point, p3: Point): number {
  const x1 = p1.x - p0.x;
  const y1 = p1.y - p0.y;
  const x2 = p3.x - p2.x;
  const y2 = p3.y - p2.y;
  return x1 * y2 - x2 * y1;
}

function iprod(p0: Point, p1: Point, p2: Point): number {
  const x1 = p1.x - p0.x;
  const y1 = p1.y - p0.y;
  const x2 = p2.x - p0.x;
  const y2 = p2.y - p0.y;
  return x1 * x2 + y1 * y2;
}

function iprod1(p0: Point, p1: Point, p2: Point, p3: Point): number {
  const x1 = p1.x - p0.x;
  const y1 = p1.y - p0.y;
  const x2 = p3.x - p2.x;
  const y2 = p3.y - p2.y;
  return x1 * x2 + y1 * y2;
}

function ddist(p: Point, q: Point): number {
  return Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y));
}

function bezier(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const s = 1 - t;
  const res = new Point();
  res.x = s*s*s*p0.x + 3*(s*s*t)*p1.x + 3*(t*t*s)*p2.x + t*t*t*p3.x;
  res.y = s*s*s*p0.y + 3*(s*s*t)*p1.y + 3*(t*t*s)*p2.y + t*t*t*p3.y;
  return res;
}

function tangent(p0: Point, p1: Point, p2: Point, p3: Point, q0: Point, q1: Point): number {
  const A = cprod(p0, p1, q0, q1);
  const B = cprod(p1, p2, q0, q1);
  const C = cprod(p2, p3, q0, q1);
  
  const a = A - 2 * B + C;
  const b = -2 * A + 2 * B;
  const c = A;
  
  const d = b * b - 4 * a * c;
  
  if (a === 0 || d < 0) {
    return -1.0;
  }
  
  const s = Math.sqrt(d);
  const r1 = (-b + s) / (2 * a);
  const r2 = (-b - s) / (2 * a);
  
  if (r1 >= 0 && r1 <= 1) {
    return r1;
  } else if (r2 >= 0 && r2 <= 1) {
    return r2;
  } else {
    return -1.0;
  }
}

function calcSums(path: Path): void {
  path.x0 = path.points[0].x;
  path.y0 = path.points[0].y;
  
  path.sums = [];
  const s = path.sums;
  s.push(new Sum(0, 0, 0, 0, 0));
  
  for (let i = 0; i < path.points.length; i++) {
    const x = path.points[i].x - path.x0;
    const y = path.points[i].y - path.y0;
    s.push(new Sum(s[i].x + x, s[i].y + y, s[i].xy + x * y, s[i].x2 + x * x, s[i].y2 + y * y));
  }
}

function calcLon(path: Path): void {
  const n = path.points.length;
  const pt = path.points;
  const pivk = new Array(n);
  const nc = new Array(n);
  const ct = [0, 0, 0, 0];
  path.lon = new Array(n);
  
  const constraint = [new Point(), new Point()];
  const cur = new Point();
  const off = new Point();
  const dk = new Point();
  
  let k = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (pt[i].x !== pt[k].x && pt[i].y !== pt[k].y) {
      k = i + 1;
    }
    nc[i] = k;
  }
  
  for (let i = n - 1; i >= 0; i--) {
    ct[0] = ct[1] = ct[2] = ct[3] = 0;
    let dir = Math.floor((3 + 3 * (pt[mod(i + 1, n)].x - pt[i].x) + (pt[mod(i + 1, n)].y - pt[i].y)) / 2);
    ct[dir]++;
    
    constraint[0].x = 0;
    constraint[0].y = 0;
    constraint[1].x = 0;
    constraint[1].y = 0;
    
    k = nc[i];
    let k1 = i;
    let foundk = false;
    
    while (true) {
      foundk = false;
      dir = Math.floor((3 + 3 * sign(pt[k].x - pt[k1].x) + sign(pt[k].y - pt[k1].y)) / 2);
      ct[dir]++;
      
      if (ct[0] && ct[1] && ct[2] && ct[3]) {
        pivk[i] = k1;
        foundk = true;
        break;
      }
      
      cur.x = pt[k].x - pt[i].x;
      cur.y = pt[k].y - pt[i].y;
      
      if (xprod(constraint[0], cur) < 0 || xprod(constraint[1], cur) > 0) {
        break;
      }
      
      if (Math.abs(cur.x) <= 1 && Math.abs(cur.y) <= 1) {
        // continue
      } else {
        off.x = cur.x + ((cur.y >= 0 && (cur.y > 0 || cur.x < 0)) ? 1 : -1);
        off.y = cur.y + ((cur.x <= 0 && (cur.x < 0 || cur.y < 0)) ? 1 : -1);
        if (xprod(constraint[0], off) >= 0) {
          constraint[0].x = off.x;
          constraint[0].y = off.y;
        }
        off.x = cur.x + ((cur.y <= 0 && (cur.y < 0 || cur.x < 0)) ? 1 : -1);
        off.y = cur.y + ((cur.x >= 0 && (cur.x > 0 || cur.y < 0)) ? 1 : -1);
        if (xprod(constraint[1], off) <= 0) {
          constraint[1].x = off.x;
          constraint[1].y = off.y;
        }
      }
      k1 = k;
      k = nc[k1];
      if (!cyclic(k, i, k1)) {
        break;
      }
    }
    
    if (!foundk) {
      dk.x = sign(pt[k].x - pt[k1].x);
      dk.y = sign(pt[k].y - pt[k1].y);
      cur.x = pt[k1].x - pt[i].x;
      cur.y = pt[k1].y - pt[i].y;
      
      const a = xprod(constraint[0], cur);
      const b = xprod(constraint[0], dk);
      const c = xprod(constraint[1], cur);
      const d = xprod(constraint[1], dk);
      
      let j = 10000000;
      if (b < 0) {
        j = Math.floor(a / -b);
      }
      if (d > 0) {
        j = Math.min(j, Math.floor(-c / d));
      }
      pivk[i] = mod(k1 + j, n);
    }
  }
  
  let j = pivk[n - 1];
  path.lon[n - 1] = j;
  for (let i = n - 2; i >= 0; i--) {
    if (cyclic(i + 1, pivk[i], j)) {
      j = pivk[i];
    }
    path.lon[i] = j;
  }
  
  for (let i = n - 1; cyclic(mod(i + 1, n), j, path.lon[i]); i--) {
    path.lon[i] = j;
  }
}

function penalty3(path: Path, i: number, j: number): number {
  const n = path.points.length;
  const pt = path.points;
  const sums = path.sums;
  
  let r = 0;
  if (j >= n) {
    j -= n;
    r = 1;
  }
  
  let x, y, x2, xy, y2, k;
  
  if (r === 0) {
    x = sums[j + 1].x - sums[i].x;
    y = sums[j + 1].y - sums[i].y;
    x2 = sums[j + 1].x2 - sums[i].x2;
    xy = sums[j + 1].xy - sums[i].xy;
    y2 = sums[j + 1].y2 - sums[i].y2;
    k = j + 1 - i;
  } else {
    x = sums[j + 1].x - sums[i].x + sums[n].x;
    y = sums[j + 1].y - sums[i].y + sums[n].y;
    x2 = sums[j + 1].x2 - sums[i].x2 + sums[n].x2;
    xy = sums[j + 1].xy - sums[i].xy + sums[n].xy;
    y2 = sums[j + 1].y2 - sums[i].y2 + sums[n].y2;
    k = j + 1 - i + n;
  }
  
  const px = (pt[i].x + pt[j].x) / 2.0 - pt[0].x;
  const py = (pt[i].y + pt[j].y) / 2.0 - pt[0].y;
  const ey = (pt[j].x - pt[i].x);
  const ex = -(pt[j].y - pt[i].y);
  
  const a = ((x2 - 2 * x * px) / k + px * px);
  const b = ((xy - x * py - y * px) / k + px * py);
  const c = ((y2 - 2 * y * py) / k + py * py);
  
  const s = ex * ex * a + 2 * ex * ey * b + ey * ey * c;
  
  return Math.sqrt(s);
}

function bestPolygon(path: Path): void {
  const n = path.points.length;
  const pen = new Array(n + 1);
  const prev = new Array(n + 1);
  const clip0 = new Array(n);
  const clip1 = new Array(n + 1);
  const seg0 = new Array(n + 1);
  const seg1 = new Array(n + 1);
  
  for (let i = 0; i < n; i++) {
    const c = mod(path.lon[mod(i - 1, n)] - 1, n);
    if (c === i) {
      c === mod(i + 1, n);
    }
    if (c < i) {
      clip0[i] = n;
    } else {
      clip0[i] = c;
    }
  }
  
  let j = 1;
  for (let i = 0; i < n; i++) {
    while (j <= clip0[i]) {
      clip1[j] = i;
      j++;
    }
  }
  
  let i = 0;
  for (j = 0; i < n; j++) {
    seg0[j] = i;
    i = clip0[i];
  }
  seg0[j] = n;
  const m = j;
  
  i = n;
  for (j = m; j > 0; j--) {
    seg1[j] = i;
    i = clip1[i];
  }
  seg1[0] = 0;
  
  pen[0] = 0;
  for (j = 1; j <= m; j++) {
    for (i = seg1[j]; i <= seg0[j]; i++) {
      let best = -1;
      for (let k = seg0[j - 1]; k >= clip1[i]; k--) {
        const thispen = penalty3(path, k, i) + pen[k];
        if (best < 0 || thispen < best) {
          prev[i] = k;
          best = thispen;
        }
      }
      pen[i] = best;
    }
  }
  
  path.m = m;
  path.po = new Array(m);
  
  for (i = n, j = m - 1; i > 0; j--) {
    i = prev[i];
    path.po[j] = i;
  }
}

function adjustVertices(path: Path): void {
  const m = path.m;
  const po = path.po;
  const n = path.points.length;
  const pt = path.points;
  const x0 = path.x0;
  const y0 = path.y0;
  
  const ctr = new Array(m);
  const dir = new Array(m);
  const q = new Array(m);
  
  const v = new Array(3);
  let s = new Point();
  
  path.curve = new Curve(m);
  
  for (let i = 0; i < m; i++) {
    let j = po[mod(i + 1, m)];
    j = mod(j - po[i], n) + po[i];
    ctr[i] = new Point();
    dir[i] = new Point();
    
    let l, denom, x, y;
    denom = j - po[i];
    
    for (let k = po[i]; k < j; k++) {
      if (k < n) {
        x = pt[k].x + x0;
        y = pt[k].y + y0;
      } else {
        x = pt[k - n].x + x0;
        y = pt[k - n].y + y0;
      }
      ctr[i].x += x;
      ctr[i].y += y;
    }
    ctr[i].x /= denom;
    ctr[i].y /= denom;
    
    dir[i].x = pt[j >= n ? j - n : j].x - pt[po[i]].x;
    dir[i].y = pt[j >= n ? j - n : j].y - pt[po[i]].y;
    
    q[i] = new Quad();
    
    l = Math.sqrt(dir[i].x * dir[i].x + dir[i].y * dir[i].y);
    if (l !== 0.0) {
      dir[i].x /= l;
      dir[i].y /= l;
    }
    
    const vx = -dir[i].y;
    const vy = dir[i].x;
    
    q[i].data[0] = vx * vx;
    q[i].data[1] = vx * vy;
    q[i].data[2] = vx * ctr[i].x + vy * ctr[i].y;
    q[i].data[3] = vx * vy;
    q[i].data[4] = vy * vy;
    q[i].data[5] = vx * ctr[i].x + vy * ctr[i].y;
    q[i].data[6] = ctr[i].x;
    q[i].data[7] = ctr[i].y;
    q[i].data[8] = 1;
  }
  
  for (let i = 0; i < m; i++) {
    const Q = new Quad();
    const w = new Point();
    const dx = Math.abs(dir[i].x);
    const dy = Math.abs(dir[i].y);
    
    let j = mod(i - 1, m);
    
    for (let l = 0; l < 9; l++) {
      Q.data[l] = q[j].data[l] + q[i].data[l];
    }
    
    while (true) {
      const det = Q.at(0, 0) * Q.at(1, 1) - Q.at(0, 1) * Q.at(1, 0);
      if (det !== 0.0) {
        w.x = (-Q.at(0, 2) * Q.at(1, 1) + Q.at(1, 2) * Q.at(0, 1)) / det;
        w.y = (Q.at(0, 2) * Q.at(1, 0) - Q.at(1, 2) * Q.at(0, 0)) / det;
        break;
      }
      
      if (Q.at(0, 0) > Q.at(1, 1)) {
        v[0] = -Q.at(0, 2);
        v[1] = 0;
      } else if (Q.at(1, 1) !== 0.0) {
        v[0] = 0;
        v[1] = -Q.at(1, 2);
      } else {
        v[0] = 1;
        v[1] = 0;
      }
      
      const d = v[0] * v[0] + v[1] * v[1];
      v[2] = d === 0 ? 0 : -1;
      
      for (let l = 0; l < 9; l++) {
        Q.data[l] += v[Math.floor(l / 3)] * v[l % 3];
      }
    }
    
    let dmin, cand;
    
    const z = ctr[i].lerp(ctr[j], 0.5);
    s = new Point();
    
    s.x = (dx >= dy) ? (w.y - z.y) / dx : (w.x - z.x) / -dy;
    s.y = (dx >= dy) ? (z.x - w.x) / dx : (z.y - w.y) / -dy;
    
    if (0 <= s.x && s.x <= 1 && 0 <= s.y && s.y <= 1) {
      path.curve.vertex[i] = w;
    } else {
      let min = quadform(Q, z);
      path.curve.vertex[i] = z.copy();
      
      if (dx >= dy) {
        for (let k = 0; k < 2; k++) {
          cand = new Point();
          cand.y = z.y - s.y + k;
          cand.x = (cand.y - ctr[i].y + (dx >= dy ? (z.x - ctr[i].x) * dir[i].y / dir[i].x : 0)) * 
                   (dx >= dy ? dir[i].x / dir[i].y : 1) + ctr[i].x;
          dmin = quadform(Q, cand);
          if (dmin < min) {
            min = dmin;
            path.curve.vertex[i] = cand;
          }
        }
      } else {
        for (let k = 0; k < 2; k++) {
          cand = new Point();
          cand.x = z.x - s.x + k;
          cand.y = (cand.x - ctr[i].x + (dy >= dx ? (z.y - ctr[i].y) * dir[i].x / dir[i].y : 0)) *
                   (dy >= dx ? dir[i].y / dir[i].x : 1) + ctr[i].y;
          dmin = quadform(Q, cand);
          if (dmin < min) {
            min = dmin;
            path.curve.vertex[i] = cand;
          }
        }
      }
    }
  }
}

function smooth(path: Path, options: PotraceOptions): void {
  const m = path.m;
  const curve = path.curve;
  
  for (let i = 0; i < m; i++) {
    const j = mod(i + 1, m);
    const k = mod(i + 2, m);
    const p4 = curve.vertex[j].lerp(curve.vertex[k], 0.5);
    
    let denom = ddist(curve.vertex[i], curve.vertex[j]);
    let alpha: number;
    
    if (denom === 0.0) {
      alpha = 4 / 3.0;
    } else {
      const dd = Math.abs(dpara(curve.vertex[i], curve.vertex[j], p4));
      const dp = ddist(curve.vertex[i], curve.vertex[j]);
      alpha = dd > 1.0 ? (1 - 1.0 / dd) : 0;
      alpha = alpha / 0.75;
    }
    
    curve.alpha0[j] = alpha;
    
    if (alpha >= options.alphamax) {
      curve.tag[j] = 'CORNER';
      curve.c[j * 3 + 1] = curve.vertex[j];
      curve.c[j * 3 + 2] = p4;
    } else {
      if (alpha < 0.55) {
        alpha = 0.55;
      } else if (alpha > 1) {
        alpha = 1;
      }
      const p2 = curve.vertex[i].lerp(curve.vertex[j], 0.5 + 0.5 * alpha);
      const p3 = curve.vertex[j].lerp(curve.vertex[k], 0.5 - 0.5 * alpha);
      curve.tag[j] = 'CURVE';
      curve.c[j * 3 + 0] = p2;
      curve.c[j * 3 + 1] = p3;
      curve.c[j * 3 + 2] = p4;
    }
    
    curve.alpha[j] = alpha;
    curve.beta[j] = 0.5;
  }
  
  curve.alphaCurve = 1;
}

function optiCurve(path: Path, options: PotraceOptions): void {
  const m = path.m;
  const curve = path.curve;
  const vert = curve.vertex;
  const pt = new Array(m + 1);
  const pen = new Array(m + 1);
  const len = new Array(m + 1);
  const opt = new Array(m + 1);
  
  const convc = new Array(m);
  const areac = new Array(m + 1);
  
  for (let i = 0; i < m; i++) {
    if (curve.tag[i] === 'CURVE') {
      convc[i] = sign(dpara(vert[mod(i - 1, m)], vert[i], vert[mod(i + 1, m)]));
    } else {
      convc[i] = 0;
    }
  }
  
  let area = 0.0;
  areac[0] = 0.0;
  const p0 = curve.vertex[0];
  for (let i = 0; i < m; i++) {
    const i1 = mod(i + 1, m);
    if (curve.tag[i1] === 'CURVE') {
      const alpha = curve.alpha[i1];
      area += 0.3 * alpha * (4 - alpha) *
          dpara(curve.c[i * 3 + 2], vert[i1], curve.c[i1 * 3 + 2]) / 2;
      area += dpara(p0, curve.c[i * 3 + 2], curve.c[i1 * 3 + 2]) / 2;
    }
    areac[i + 1] = area;
  }
  
  pt[0] = -1;
  pen[0] = 0;
  len[0] = 0;
  
  let o = new Opti();
  
  for (let j = 1; j <= m; j++) {
    pt[j] = j - 1;
    pen[j] = pen[j - 1];
    len[j] = len[j - 1] + 1;
    
    for (let i = j - 2; i >= 0; i--) {
      const r = optiPenalty(path, i, mod(j, m), o, options.opttolerance, convc, areac);
      if (r) {
        break;
      }
      if (len[j] > len[i] + 1 ||
          (len[j] === len[i] + 1 && pen[j] > pen[i] + o.pen)) {
        pt[j] = i;
        pen[j] = pen[i] + o.pen;
        len[j] = len[i] + 1;
        opt[j] = o;
        o = new Opti();
      }
    }
  }
  
  const om = len[m];
  const ocurve = new Curve(om);
  const s = new Array(om);
  const t = new Array(om);
  
  let j = m;
  for (let i = om - 1; i >= 0; i--) {
    if (pt[j] === j - 1) {
      ocurve.tag[i] = curve.tag[mod(j, m)];
      ocurve.c[i * 3 + 0] = curve.c[mod(j, m) * 3 + 0];
      ocurve.c[i * 3 + 1] = curve.c[mod(j, m) * 3 + 1];
      ocurve.c[i * 3 + 2] = curve.c[mod(j, m) * 3 + 2];
      ocurve.vertex[i] = curve.vertex[mod(j, m)];
      ocurve.alpha[i] = curve.alpha[mod(j, m)];
      ocurve.alpha0[i] = curve.alpha0[mod(j, m)];
      ocurve.beta[i] = curve.beta[mod(j, m)];
      s[i] = t[i] = 1.0;
    } else {
      ocurve.tag[i] = 'CURVE';
      ocurve.c[i * 3 + 0] = opt[j].c[0];
      ocurve.c[i * 3 + 1] = opt[j].c[1];
      ocurve.c[i * 3 + 2] = curve.c[mod(j, m) * 3 + 2];
      ocurve.vertex[i] = curve.c[mod(j, m) * 3 + 2].lerp(vert[mod(j, m)], opt[j].s);
      ocurve.alpha[i] = opt[j].alpha;
      ocurve.alpha0[i] = opt[j].alpha;
      s[i] = opt[j].s;
      t[i] = opt[j].t;
    }
    j = pt[j];
  }
  
  for (let i = 0; i < om; i++) {
    const i1 = mod(i + 1, om);
    ocurve.beta[i] = s[i] / (s[i] + t[i1]);
  }
  
  ocurve.alphaCurve = 1;
  path.curve = ocurve;
}

function optiPenalty(path: Path, i: number, j: number, res: Opti, opttolerance: number, convc: number[], areac: number[]): boolean {
  const m = path.m;
  const curve = path.curve;
  const vertex = curve.vertex;
  
  if (i === j) {
    return true;
  }
  
  let k = i;
  let i1 = mod(i + 1, m);
  let k1 = mod(k + 1, m);
  let conv = convc[k1];
  if (conv === 0) {
    return true;
  }
  
  const d = ddist(vertex[i], vertex[j]);
  for (k = k1; k !== j; k = k1) {
    k1 = mod(k + 1, m);
    const k2 = mod(k + 2, m);
    if (convc[k1] !== conv) {
      return true;
    }
    if (sign(cprod(vertex[i], vertex[i1], vertex[k1], vertex[k2])) !==
        conv) {
      return true;
    }
    if (iprod1(vertex[i], vertex[i1], vertex[k1], vertex[k2]) <
        d * ddist(vertex[k1], vertex[k2]) * -0.999847695156) {
      return true;
    }
  }
  
  const p0 = curve.c[mod(i, m) * 3 + 2].copy();
  let p1 = vertex[mod(i + 1, m)].copy();
  let p2 = vertex[mod(j, m)].copy();
  const p3 = curve.c[mod(j, m) * 3 + 2].copy();
  
  let area = areac[j] - areac[i];
  area -= dpara(vertex[0], curve.c[i * 3 + 2], curve.c[j * 3 + 2]) / 2;
  if (i >= j) {
    area += areac[m];
  }
  
  const A1 = dpara(p0, p1, p2);
  const A2 = dpara(p0, p1, p3);
  const A3 = dpara(p0, p2, p3);
  const A4 = A1 + A3 - A2;
  
  if (A2 === A1) {
    return true;
  }
  
  const t = A3 / (A3 - A4);
  const s = A2 / (A2 - A1);
  const A = A2 * t / 2.0;
  
  if (A === 0.0) {
    return true;
  }
  
  const R = area / A;
  const alpha = 2 - Math.sqrt(4 - R / 0.3);
  
  res.c[0] = p0.lerp(p1, s);
  res.c[1] = p3.lerp(p2, t);
  res.alpha = alpha;
  res.t = t;
  res.s = s;
  
  p1 = res.c[0].copy();
  p2 = res.c[1].copy();
  
  res.pen = 0;
  
  for (k = mod(i + 1, m); k !== j; k = k1) {
    k1 = mod(k + 1, m);
    const t = tangent(p0, p1, p2, p3, vertex[k], vertex[k1]);
    if (t < -0.5) {
      return true;
    }
    const pt = bezier(t, p0, p1, p2, p3);
    const d = ddist(vertex[k], vertex[k1]);
    if (d === 0.0) {
      return true;
    }
    const d1 = dpara(vertex[k], vertex[k1], pt) / d;
    if (Math.abs(d1) > opttolerance) {
      return true;
    }
    if (iprod(vertex[k], vertex[k1], pt) < 0 ||
        iprod(vertex[k1], vertex[k], pt) < 0) {
      return true;
    }
    res.pen += d1 * d1;
  }
  
  for (k = i; k !== j; k = k1) {
    k1 = mod(k + 1, m);
    const t = tangent(p0, p1, p2, p3, curve.c[k * 3 + 2], curve.c[k1 * 3 + 2]);
    if (t < -0.5) {
      return true;
    }
    const pt = bezier(t, p0, p1, p2, p3);
    const d = ddist(curve.c[k * 3 + 2], curve.c[k1 * 3 + 2]);
    if (d === 0.0) {
      return true;
    }
    const d1 = dpara(curve.c[k * 3 + 2], curve.c[k1 * 3 + 2], pt) / d;
    const d2 = dpara(curve.c[k * 3 + 2], curve.c[k1 * 3 + 2],
        vertex[k1]) / d;
    d2 * d2;
    res.pen += d1 * d1;
  }
  
  return false;
}

function findNext(point: Point, bitmapTarget: Bitmap): Point | false {
  const idx = point.toIndex(bitmapTarget.width, bitmapTarget.height);
  if (idx === null) return false;
  
  for (let i = idx; i < bitmapTarget.size; i++) {
    if (bitmapTarget.data[i]) return bitmapTarget.index(i);
  }
  return false;
}

function turn(turnpolicy: string, isHole: boolean, bitmap: Bitmap, x: number, y: number): boolean {
  switch (turnpolicy) {
    case 'right':
      return true;
    case 'black':
      return !isHole;
    case 'white':
      return isHole;
    case 'majority':
      return majority(x, y, bitmap);
    case 'minority':
      return !majority(x, y, bitmap);
    default:
      return true;
  }
}

function majority(x: number, y: number, bitmap: Bitmap): boolean {
  for (let i = 2; i < 5; i++) {
    let ct = 0;
    for (let a = -i + 1; a <= i - 1; a++) {
      ct += bitmap.at(x + a, y + i - 1) ? 1 : -1;
      ct += bitmap.at(x + i - 1, y + a - 1) ? 1 : -1;
      ct += bitmap.at(x + a - 1, y - i) ? 1 : -1;
      ct += bitmap.at(x - i, y + a) ? 1 : -1;
    }
    if (ct > 0) return true;
    else if (ct < 0) return false;
  }
  return false;
}

function findPath(point: Point, bitmap: Bitmap, bitmapTarget: Bitmap, options: PotraceOptions): Path {
  let { x, y } = point;
  let dirX = 0;
  let dirY = 1;
  
  const points: Point[] = [];
  let area = 0;
  const isHole = !bitmap.at(x, y);
  
  while (true) {
    points.push(new Point(x, y));
    
    x += dirX;
    y += dirY;
    area -= x * dirY;
    
    if (x === point.x && y === point.y) break;
    
    const left = bitmapTarget.at(x + (dirX + dirY - 1) / 2, y + (dirY - dirX - 1) / 2);
    const right = bitmapTarget.at(x + (dirX - dirY - 1) / 2, y + (dirY + dirX - 1) / 2);
    
    if (right && !left) {
      if (turn(options.turnpolicy, isHole, bitmapTarget, x, y)) {
        const tmp = dirX;
        dirX = -dirY;
        dirY = tmp;
      } else {
        const tmp = dirX;
        dirX = dirY;
        dirY = -tmp;
      }
    } else if (right) {
      const tmp = dirX;
      dirX = -dirY;
      dirY = tmp;
    } else if (!left) {
      const tmp = dirX;
      dirX = dirY;
      dirY = -tmp;
    }
  }
  
  return new Path(points, area, isHole);
}

function bitmapToPathList(bitmap: Bitmap, options: PotraceOptions): Path[] {
  const bitmapTarget = bitmap.copy();
  const pathList: Path[] = [];
  
  let point: Point | false = findNext(new Point(0, 0), bitmapTarget);
  while (point) {
    const path = findPath(point, bitmap, bitmapTarget, options);
    if (path.area > options.turdsize) {
      pathList.push(path);
    }
    bitmapTarget.xOrPath(path);
    point = findNext(point, bitmapTarget);
  }
  
  return pathList;
}

function processPath(pathList: Path[], options: PotraceOptions): void {
  for (const path of pathList) {
    calcSums(path);
    calcLon(path);
    bestPolygon(path);
    adjustVertices(path);
    
    if (path.isHole) path.reverse();
    
    smooth(path, options);
    
    if (options.optcurve) optiCurve(path, options);
  }
}

export interface PotraceResult {
  points: Array<{x: number; y: number}>;
  curves: Array<{
    type: 'curve' | 'corner';
    x: number;
    y: number;
    c1x?: number;
    c1y?: number;
    c2x?: number;
    c2y?: number;
  }>;
  area: number;
  isHole: boolean;
}

export function traceBitmapToPoints(
  maskData: Uint8Array | Int8Array,
  width: number,
  height: number,
  options: Partial<PotraceOptions> = {}
): PotraceResult[] {
  const opts: PotraceOptions = { ...DEFAULT_OPTIONS, ...options };
  
  const bitmap = new Bitmap(width, height);
  for (let i = 0; i < maskData.length; i++) {
    bitmap.data[i] = maskData[i] as 0 | 1;
  }
  
  const pathList = bitmapToPathList(bitmap, opts);
  processPath(pathList, opts);
  
  const results: PotraceResult[] = [];
  
  for (const path of pathList) {
    const curve = path.curve;
    const n = curve.n;
    const points: Array<{x: number; y: number}> = [];
    const curves: PotraceResult['curves'] = [];
    
    for (let i = 0; i < n; i++) {
      const tag = curve.tag[i];
      const c0 = curve.c[i * 3 + 0];
      const c1 = curve.c[i * 3 + 1];
      const c2 = curve.c[i * 3 + 2];
      
      if (tag === 'CURVE') {
        curves.push({
          type: 'curve',
          x: c2.x,
          y: c2.y,
          c1x: c0.x,
          c1y: c0.y,
          c2x: c1.x,
          c2y: c1.y
        });
        
        for (let t = 0; t <= 1; t += 0.1) {
          const prevC2 = i > 0 ? curve.c[(i - 1) * 3 + 2] : curve.c[(n - 1) * 3 + 2];
          const pt = bezier(t, prevC2, c0, c1, c2);
          points.push({ x: pt.x, y: pt.y });
        }
      } else {
        curves.push({
          type: 'corner',
          x: c2.x,
          y: c2.y
        });
        points.push({ x: c1.x, y: c1.y });
        points.push({ x: c2.x, y: c2.y });
      }
    }
    
    results.push({ points, curves, area: Math.abs(path.area), isHole: path.isHole });
  }
  
  // Sort by area descending so the largest (outer) contour is first
  results.sort((a, b) => b.area - a.area);
  
  return results;
}

export function sampleBezierCurve(
  p0: {x: number; y: number},
  c1: {x: number; y: number},
  c2: {x: number; y: number},
  p1: {x: number; y: number},
  numSamples: number = 10
): Array<{x: number; y: number}> {
  const points: Array<{x: number; y: number}> = [];
  
  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples;
    const s = 1 - t;
    
    const x = s*s*s*p0.x + 3*s*s*t*c1.x + 3*s*t*t*c2.x + t*t*t*p1.x;
    const y = s*s*s*p0.y + 3*s*s*t*c1.y + 3*s*t*t*c2.y + t*t*t*p1.y;
    
    points.push({ x, y });
  }
  
  return points;
}
