import { memo, useId, type CSSProperties } from 'react';

// Stylized silhouettes from the existing homepage world map. Orthographic
// projection adds globe depth without a 3D runtime or bitmap download.
const LAND = [
  [33,95,63,59,124,44,158,53,187,42,234,70,281,77,316,108,284,127,271,155,255,163,239,193,208,201,195,229,177,222,169,199,145,189,129,173,116,147,88,125,63,130],
  [233,231,259,226,281,236,306,259,323,271,315,293,299,313,291,346,276,376,261,399,248,390,244,354,231,325,218,296,218,261],
  [299,26,335,13,360,38,343,71,313,79,299,53],
  [425,83,447,78,451,55,466,43,479,66,472,90,493,82,508,95,527,91,546,102,534,126,510,135,490,132,479,142,459,130,438,136,419,122],
  [423,150,448,139,480,141,504,158,527,185,540,202,522,224,511,264,488,297,471,309,456,287,451,258,433,238,417,213,402,188],
  [506,75,548,50,598,44,634,39,688,47,728,58,758,64,802,72,836,96,819,114,791,109,768,124,760,142,734,154,711,152,695,174,677,191,662,224,648,237,634,209,618,192,602,186,586,198,568,191,553,165,527,152,533,129,514,114],
  [540,172,565,172,589,193,579,211,560,217,547,202],
  [684,215,696,231,713,249,726,259,717,267,700,253,692,235],
  [720,256,748,263,760,276,744,281,721,270],
  [746,305,776,286,808,287,825,309,843,327,836,354,810,365,784,352,760,355,744,337],
  [796,118,805,137,796,155,783,165,781,156,790,143],
  [529,277,537,285,533,311,524,319,523,294],
];
const RAD = Math.PI / 180, LAT = 38 * RAD;
function project(lon: number, lat: number) {
  const a = (lon - 30) * RAD, b = lat * RAD;
  return { x: 500 + 427 * Math.cos(b) * Math.sin(a),
    y: 500 - 427 * (Math.cos(LAT) * Math.sin(b) - Math.sin(LAT) * Math.cos(b) * Math.cos(a)),
    z: Math.sin(LAT) * Math.sin(b) + Math.cos(LAT) * Math.cos(b) * Math.cos(a) };
}
const HUBS = [
  { name: 'New York', lon: -74.006, lat: 40.713, dx: -4, dy: 29 },
  { name: 'London', lon: -.128, lat: 51.507, dx: -38, dy: -20 },
  { name: 'Frankfurt', lon: 8.682, lat: 50.111, dx: 4, dy: -35 },
  { name: 'Dubai', lon: 55.270, lat: 25.205, dx: 12, dy: -15 },
  { name: 'Singapore', lon: 103.820, lat: 1.352, dx: -83, dy: 29 },
  { name: 'Tokyo', lon: 139.692, lat: 35.690, dx: 13, dy: -6 },
].map(hub => ({ ...hub, ...project(hub.lon, hub.lat) }));
function inside(x: number, y: number, polygon: number[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
    const xi = polygon[i], yi = polygon[i + 1], xj = polygon[j], yj = polygon[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result;
  }
  return result;
}
const dot = (x: number, y: number, r: number) => `M${(x-r).toFixed(1)} ${y.toFixed(1)}a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(r*2).toFixed(1)} 0a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(-r*2).toFixed(1)} 0`;
// Static compound paths instead of thousands of animated DOM nodes.
let landDots = '', cityLights = '';
for (let lat = -60; lat < 82; lat += 2) for (let lon = -180; lon < 180; lon += 2) {
  const p = project(lon, lat);
  if (p.z < .025 || !LAND.some(polygon => inside((lon+180)*2.5, (85-lat)*2.5, polygon))) continue;
  landDots += dot(p.x, p.y, .8 + p.z * .6);
  if (HUBS.some(hub => Math.hypot(p.x-hub.x, p.y-hub.y) < 47 + 10 * Math.sin(lon*lat))) cityLights += dot(p.x, p.y, .7 + p.z * .35);
}
function mesh(lon: number | null, lat: number | null) {
  let path = '', previous = false;
  for (let t = -180; t <= 180; t += 2) {
    if (lon !== null && Math.abs(t) > 90) continue;
    const p = project(lon ?? t, lat ?? t);
    if (p.z < 0) { previous = false; continue; }
    path += `${previous ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`; previous = true;
  }
  return path;
}
const MESH = [...[-120,-90,-60,-30,0,30,60,90,120,150].map(lon => mesh(lon, null)), ...[-60,-30,0,30,60].map(lat => mesh(null, lat))].join('');
const ROUTES = [[0,1],[1,3],[2,5],[3,4],[4,5],[0,5]].map(([a,b], i) => {
  const p = HUBS[a], q = HUBS[b], height = 55 + Math.abs(p.x-q.x)*.20;
  return `M${p.x} ${p.y}Q${(p.x+q.x)/2} ${Math.min(p.y,q.y)-height-i*6} ${q.x} ${q.y}`;
});

/** Decorative geography/signals, never live executions or exchange activity. */
export const HomeMarketGlobe = memo(function HomeMarketGlobe() {
  const id = useId().replace(/:/g, '');
  return <svg className="vx-global-globe-svg" viewBox="0 0 1000 1000" aria-hidden="true">
    <defs>
      <radialGradient id={`${id}-ocean`} cx="63%" cy="18%" r="82%"><stop stopColor="#173c5f"/><stop offset=".47" stopColor="#0b2039"/><stop offset=".87" stopColor="#060e1a"/><stop offset="1" stopColor="#040810"/></radialGradient>
      <radialGradient id={`${id}-shade`} cx="67%" cy="22%" r="78%"><stop offset=".22" stopColor="#020810" stopOpacity="0"/><stop offset="1" stopColor="#020810" stopOpacity=".85"/></radialGradient>
      <linearGradient id={`${id}-rim`} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#193955" stopOpacity="0"/><stop offset=".5" stopColor="#528dc1"/><stop offset=".9" stopColor="#b6d4f2"/><stop offset="1" stopColor="#4786af"/></linearGradient>
      <radialGradient id={`${id}-halo`}><stop offset=".8" stopColor="#2260a8" stopOpacity="0"/><stop offset=".88" stopColor="#589bdb" stopOpacity=".15"/><stop offset="1" stopColor="#407bb3" stopOpacity="0"/></radialGradient>
      <filter id={`${id}-light`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3"/></filter>
    </defs>
    <circle cx="500" cy="500" r="477" fill={`url(#${id}-halo)`}/>
    <circle cx="500" cy="500" r="428" fill={`url(#${id}-ocean)`} stroke={`url(#${id}-rim)`} strokeWidth="2"/>
    <path d={MESH} fill="none" stroke="#789abb" strokeWidth=".6" opacity=".19"/>
    <path d={landDots} fill="#5792bb" opacity=".58"/>
    <path d={cityLights} fill="#e5ba75" opacity=".8"/>
    <path d={cityLights} fill="#e6ab56" filter={`url(#${id}-light)`} opacity=".32"/>
    <circle cx="500" cy="500" r="427" fill={`url(#${id}-shade)`}/>
    {ROUTES.map((d,i) => <g key={d} style={{ '--route-delay': `${-i*3.3}s` } as CSSProperties}>
      <path d={d} fill="none" stroke="#dcb46c" strokeWidth=".8" opacity=".35"/>
      <path d={d} pathLength="1000" fill="none" stroke="#efd297" strokeWidth="2" strokeLinecap="round" strokeDasharray="9 991" className="vx-global-signal"/>
    </g>)}
    {HUBS.map((hub, i) => <g key={hub.name} className="vx-global-hub" style={{ '--route-delay': `${-i*1.4}s` } as CSSProperties}>
      <circle className="vx-global-node-halo" cx={hub.x} cy={hub.y} r="12" fill="#e3b877" opacity=".11"/>
      <circle cx={hub.x} cy={hub.y} r="3.1" fill="#ffe0a4"/>
      <circle cx={hub.x} cy={hub.y} r="6" fill="#ecc782" filter={`url(#${id}-light)`}/>
      <text x={hub.x+hub.dx} y={hub.y+hub.dy} fill="#b4c4d6" fontSize="12" letterSpacing="1">{hub.name.toUpperCase()}</text>
    </g>)}
  </svg>;
});
