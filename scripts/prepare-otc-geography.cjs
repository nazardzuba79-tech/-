// Development-only GeoNames CC-BY-4.0 extraction. Never imported by the app.
// Keep all existing countries; no API/geolocation calls at runtime.
const fs = require('node:fs');
const path = require('node:path');
const { inflateRawSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { createInterface } = require('node:readline');
const { createInflateRaw } = require('node:zlib');
const root = path.resolve(__dirname, '..');
function unzipText(zip, name) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw Error('Invalid ZIP');
  let offset = zip.readUInt32LE(end + 16);
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    const len = zip.readUInt16LE(offset + 28), extra = zip.readUInt16LE(offset + 30), comment = zip.readUInt16LE(offset + 32);
    if (zip.subarray(offset + 46, offset + 46 + len).toString() === name) {
      const start = zip.readUInt32LE(offset + 42), size = zip.readUInt32LE(offset + 20);
      const data = start + 30 + zip.readUInt16LE(start + 26) + zip.readUInt16LE(start + 28);
      const raw = zip.subarray(data, data + size), method = zip.readUInt16LE(offset + 10);
      if (method !== 0 && method !== 8) throw Error('Unsupported ZIP compression');
      return (method === 8 ? inflateRawSync(raw) : raw).toString('utf8');
    }
    offset += 46 + len + extra + comment;
  }
  throw Error('Missing ZIP entry');
}
async function main() {
  const config = fs.readFileSync(path.join(root, 'frontend/src/pages/otc/otcConfig.ts'), 'utf8');
  const codes = [...config.match(/COUNTRY_CODES[^=]*= \[([\s\S]*?)\];/)[1].matchAll(/'([A-Z]{2})'/g)].map(m => m[1]);
  const url = 'https://download.geonames.org/export/dump/cities500.zip';
  const cached = path.join(root,'node_modules/.cache/otc-cities500.zip');
  let zip;
  if (fs.existsSync(cached)) zip = fs.readFileSync(cached);
  else {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error(`GeoNames HTTP ${response.status}`);
    zip = Buffer.from(await response.arrayBuffer()); fs.writeFileSync(cached,zip);
  }
  const rows = unzipText(zip, 'cities500.txt').trim().split('\n').map(line => line.split('\t'));
  const approved = {
    RU: ['Moscow','Saint Petersburg','Novosibirsk','Yekaterinburg','Kazan'],
    KZ: ['Almaty','Astana','Shymkent','Aktobe','Karagandy'],
    UA: ['Kyiv','Lviv','Odesa','Dnipro','Kharkiv'],
    BY: ['Minsk','Gomel','Mogilev','Vitebsk','Grodno'],
    CH: ['Zurich','Geneva','Basel','Lausanne','Bern'],
    MN: ['Ulan Bator','Erdenet','Darhan','Choibalsan','Moeroen'],
    BN: ['Bandar Seri Begawan','Kuala Belait','Seria','Tutong'],
    QA: ['Doha','Ar Rayyan','Lusail','Al Wakrah','Al Khawr'],
    IS: ['Reykjavik','Kopavogur','Hafnarfjoerdur','Akureyri','Keflavik'],
    LU: ['Luxembourg','Esch-sur-Alzette','Differdange','Dudelange','Diekirch'],
    US: ['New York City','Los Angeles','Chicago','Houston','Phoenix'],
    LA: ['Vientiane','Savannakhet','Thakhek','Pakse','Luang Prabang'],
    MM: ['Yangon','Mandalay','Nay Pyi Taw','Mawlamyine','Bago'],
    JO: ['Amman','Zarqa','Irbid','Russeifa','Aqaba'],
    SK: ['Bratislava','Kosice','Presov','Nitra','Zilina'],
    RS: ['Belgrade','Novi Sad','Nis','Kragujevac','Subotica'],
    MK: ['Skopje','Kumanovo','Prilep','Bitola','Tetovo'],
    MX: ['Mexico City','Tijuana','Guadalajara','Puebla','Monterrey'],
    CL: ['Santiago','Valparaiso','Concepcion','Antofagasta','La Serena'],
    PA: ['Panama','San Miguelito','David','Colon','Santiago de Veraguas'],
    NZ: ['Auckland','Christchurch','Wellington','Hamilton','Tauranga'],
    ZA: ['Johannesburg','Cape Town','Durban','Pretoria','Gqeberha'],
    MY: ['Kuala Lumpur','Johor Bahru','Ipoh','George Town','Shah Alam'],
    IE: ['Dublin','Cork','Limerick','Galway','Waterford'],
    OM: ['Muscat','Salalah','Sohar','Nizwa','Sur'],
    KW: ['Kuwait City','Al Ahmadi',"Al Jahra'"],
    TN: ['Tunis','Sfax','Sousse','Kairouan','Bizerte'],
    TJ: ['Dushanbe','Khujand','Kulob','Bokhtar','Istaravshan'],
    NL: ['Amsterdam','Rotterdam','The Hague','Utrecht','Eindhoven'],
    SG: ['Singapore'], MC: ['Monaco'], HK: ['Hong Kong'], SC: ['Victoria'],
  };
  const overrides = { Moscow:'Москва', 'Saint Petersburg':'Санкт-Петербург', Novosibirsk:'Новосибирск', Yekaterinburg:'Екатеринбург', Kazan:'Казань',
    Almaty:'Алматы', Astana:'Астана', Shymkent:'Шымкент', Aktobe:'Актобе', Karagandy:'Караганда',
    Kyiv:'Киев', Lviv:'Львов', Odesa:'Одесса', Dnipro:'Днепр', Kharkiv:'Харьков',
    Minsk:'Минск', Gomel:'Гомель', Mogilev:'Могилёв', Vitebsk:'Витебск', Grodno:'Гродно',
    Zurich:'Цюрих', Geneva:'Женева', Basel:'Базель', Lausanne:'Лозанна', Bern:'Берн', Singapore:'Сингапур', Monaco:'Монако', 'Hong Kong':'Гонконг',
    'Ulan Bator':'Улан-Батор', Erdenet:'Эрдэнэт', Darhan:'Дархан', Choibalsan:'Чойбалсан', Moeroen:'Мурэн',
    'Quatre Bornes':'Катр-Борн', Paraiso:'Параисо', 'Al Fahahil':'Эль-Фахахиль',
    Phoenix:'Финикс', Sfax:'Сфакс', Gqeberha:'Гкеберха', Bender:'Бендеры',
    Bago:'Баго', Bokhtar:'Бохтар', Kakamega:'Какамега' };
  const directory = {}, missing = [], wanted = new Set();
  for (const country of codes) {
    // PPLX is a section of a populated place, not an independent city.
    const candidates = rows.filter(r => r[8] === country && ['PPL','PPLA','PPLA2','PPLA3','PPLA4','PPLC','PPLG'].includes(r[7]));
    let selected;
    if (approved[country]) selected = approved[country].map(name => {
      // Exact current name wins over another city's ambiguous alias (Phoenix
      // vs Phenix City was an actual collision in the upstream alternate set).
      const row = candidates.filter(r => r[2] === name || r[1] === name).sort((a,b)=>Number(b[14])-Number(a[14]))[0]
        || candidates.filter(r=>r[3].split(',').includes(name)).sort((a,b)=>Number(b[14])-Number(a[14]))[0];
      if (!row) throw Error(`Missing verified city ${country}:${name}`);
      return { row, preferred: overrides[name] };
    });
    else selected = candidates.sort((a,b) => Number(b[14]) - Number(a[14])).filter((r,i,a) => a.findIndex(x => x[1] === r[1]) === i).slice(0,5).map(row => ({ row }));
    if (!selected.length) throw Error(`No city candidates for ${country}`);
    directory[country] = selected.map(({ row:r, preferred }) => {
      const name = preferred || overrides[r[2]];
      wanted.add(r[0]);
      return { id: `geonames-${r[0]}`, name, timezone: r[17], sourceName: r[2] };
    });
  }
  // GeoNames alternatenames in cities500 mixes languages and historical names.
  // Read actual ru entries, explicitly excluding historical/colloquial names.
  const altFile = path.join(root, 'node_modules/.cache/otc-alternateNamesV2.zip');
  if (!fs.existsSync(altFile)) {
    const r = await fetch('https://download.geonames.org/export/dump/alternateNamesV2.zip', { redirect:'error', signal:AbortSignal.timeout(180000) });
    if (!r.ok) throw Error(`Alternate names HTTP ${r.status}`);
    fs.writeFileSync(altFile,Buffer.from(await r.arrayBuffer()));
  }
  const alt = fs.readFileSync(altFile);
  let end = alt.length - 22;
  while (end >= 0 && alt.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw Error('Invalid alternate name ZIP');
  let pos = alt.readUInt32LE(end + 16), payload;
  for (let i=0; i<alt.readUInt16LE(end+10); i++) {
    const len=alt.readUInt16LE(pos+28), extra=alt.readUInt16LE(pos+30), comment=alt.readUInt16LE(pos+32);
    if (alt.subarray(pos+46,pos+46+len).toString()==='alternateNamesV2.txt') {
      const start=alt.readUInt32LE(pos+42), offset=start+30+alt.readUInt16LE(start+26)+alt.readUInt16LE(start+28);
      payload=alt.subarray(offset,offset+alt.readUInt32LE(pos+20)); break;
    }
    pos+=46+len+extra+comment;
  }
  if (!payload) throw Error('Alternate names entry missing');
  const russian = new Map();
  for await (const line of createInterface({ input:Readable.from([payload]).pipe(createInflateRaw()), crlfDelay:Infinity })) {
    if (!line.includes('\tru\t')) continue;
    const r=line.split('\t');
    if (r[2]!=='ru'||!wanted.has(r[1])||r[6]==='1'||r[7]==='1'||r[9]) continue;
    const old=russian.get(r[1]);
    if (!old || r[4]==='1') russian.set(r[1],r[3]);
  }
  for (const [country,cities] of Object.entries(directory)) for (const city of cities) {
    city.name ||= russian.get(city.id.replace('geonames-',''));
    if (!city.name) missing.push(`${country}:${city.id}:${city.sourceName}`);
    delete city.sourceName;
  }
  if (missing.length) throw Error(`Russian labels require review:\n${missing.join('\n')}`);
  const json = JSON.stringify(directory, null, 2) + '\n';
  for (const file of ['src/otc/cities.json', 'frontend/src/pages/otc/cities.json']) fs.writeFileSync(path.join(root,file), json);
  console.log(JSON.stringify({ source:url, sha256:createHash('sha256').update(zip).digest('hex'), alternateNamesSha256:createHash('sha256').update(alt).digest('hex'), preparedAt:new Date().toISOString(), countries:codes.length }));
  for (const [c, cities] of Object.entries(directory)) console.log(c, cities.map(x => `${x.name} (${x.id})`).join('; '));
}
module.exports = { unzipText };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
