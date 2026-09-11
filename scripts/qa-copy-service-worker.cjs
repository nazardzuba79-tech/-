// Keep canonical CPU work off the static asset server's event loop, matching
// independently served frontend assets. This is only the QA persistence layer.
const { parentPort } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');
const { CopyPerformanceService } = require('../dist/services/copyTrading/CopyPerformanceService');
const scenarios = new Map();
const services = new Map();
const db = {copyPerformanceScenario:{
  async findUnique({where}) {return scenarios.get(where.id) || null;},
  async create({data}) {const row={...data,revision:0};scenarios.set(data.id,row);return row;},
  async updateMany({where,data}) {
    const row=scenarios.get(where.id);if(!row || row.revision!==where.revision)return {count:0};
    scenarios.set(where.id,{...row,...data,revision:row.revision+1});return {count:1};
  },
}};
parentPort.on('message',async ({id,run,strategy}) => {
  if(!services.has(run))services.set(run,new CopyPerformanceService(db,()=>new Date('2026-09-11T12:00:00Z')));
  const start=performance.now();
  try {const data=await services.get(run).get(strategy);parentPort.postMessage({id,data,ms:performance.now()-start});}
  catch(error) {parentPort.postMessage({id,error:String(error)});}
});
