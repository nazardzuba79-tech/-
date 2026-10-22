import { readFileSync } from 'fs';
import { resolve } from 'path';
import cities from '../cities.json';
import { cityFor } from '../geography';
import { COUNTRY_CODES } from '../../../frontend/src/pages/otc/otcConfig';
import { OTC_POLICY, createSchema } from '../policy';

test('all 108 countries preserved, server and lazy frontend use identical verified IDs',()=>{
  expect(Object.keys(cities).sort()).toEqual([...COUNTRY_CODES].sort());
  expect(COUNTRY_CODES).toHaveLength(108);
  expect(readFileSync(resolve(__dirname,'../cities.json'),'utf8')).toBe(readFileSync(resolve(__dirname,'../../../frontend/src/pages/otc/cities.json'),'utf8'));
  const ids=new Set<string>();
  for(const [country,rows] of Object.entries(cities)){
    expect(rows.length).toBe(({SG:1,MC:1,HK:1,SC:1,BN:4,KW:3} as Record<string,number>)[country]??5);
    for(const city of rows){
      expect(city.id).toMatch(/^geonames-\d+$/);expect(ids.has(city.id)).toBe(false);ids.add(city.id);
      expect(city.name).toMatch(/[А-Яа-яЁё]/);expect(()=>new Intl.DateTimeFormat('ru',{timeZone:city.timezone})).not.toThrow();
      expect(cityFor(country,city.id)).toEqual(city);
    }
  }
});
test('requested city sets, country boundaries and no prototype key',()=>{
  for(const [country,names] of Object.entries({RU:['Москва','Санкт-Петербург','Новосибирск','Екатеринбург','Казань'],KZ:['Алматы','Астана','Шымкент','Актобе','Караганда'],UA:['Киев','Львов','Одесса','Днепр','Харьков'],BY:['Минск','Гомель','Могилёв','Витебск','Гродно'],CH:['Цюрих','Женева','Базель','Лозанна','Берн']}))
    expect((cities as Record<string,{name:string}[]>)[country].map(c=>c.name)).toEqual(names);
  expect(cityFor('UA',cities.RU[0].id)).toBeFalsy();expect(cityFor('__proto__','anything')).toBeFalsy();
  expect(cities.US[4]).toMatchObject({id:'geonames-5308655',name:'Финикс'});
});
test('default policy admits no real cash reserve and client cannot inject trusted fields',()=>{
  expect(OTC_POLICY).toMatchObject({enabled:false,routes:[],approvedUserIds:[]});
  const payload={country:'RU',cityId:cities.RU[0].id,asset:'USDT',quantity:'10000',fiat:'USD',tier:'otc-convert',idempotencyKey:'0e997edf-1b9a-47d2-aaed-ef2c3c287f97'};
  expect(createSchema.safeParse(payload).success).toBe(true);
  for(const extra of [{userId:'victim'},{status:'COMPLETED'},{reservedAmount:'1'},{adminId:'admin'}])expect(createSchema.safeParse({...payload,...extra}).success).toBe(false);
});
