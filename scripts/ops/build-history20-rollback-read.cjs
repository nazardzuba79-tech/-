'use strict';
// Compatibility for rollback reads only. All installed writes/public parsing stay intact.
const fs=require('fs'),path=require('path');
module.exports=async({root,dir,out,build,put,hash,manifest})=>{
 const bundled=(await build({entryPoints:[path.join(root,'dist/services/listings/listingConfig.js')],bundle:true,write:false,format:'cjs',platform:'node',target:'es2021',external:['zod','bignumber.js'],minifyWhitespace:true,legalComments:'none'})).outputFiles[0].text;
 const store=fs.readFileSync(path.join(dir,'dist/services/listings/store.js'),'utf8');
 const shim=`
// Read only, unpublished History20 draft compatibility. No write or public schema override.
const rollbackPrivateDraftSchema = require('./history20RollbackReadSchema').listingConfigSchema.refine(c =>
 /^VHX(?:0[1-9]|1[0-9]|20)$/.test(c.symbol) && c.privateTest?.settlement === 'SIMUSDT' &&
 c.tradable === false && c.ownerAllocation === '0' && c.simulationProgram?.growth === 'historical-window');
const rollbackPrivateRecord = exports.adminListingSchema.extend({
 draft: rollbackPrivateDraftSchema, activeVersion: zod_1.z.null(), active: zod_1.z.null(),
 versions: zod_1.z.array(versionSchema).length(0), countdown: zod_1.z.null().optional()
}).refine(l => l.symbol === l.draft.symbol);
const rollbackReadSchema = zod_1.z.object({revision:zod_1.z.string(),serverTime:zod_1.z.number(),
 listings:zod_1.z.array(zod_1.z.union([exports.adminListingSchema,rollbackPrivateRecord]))});
CloudflareListingStore.prototype.list = function() { return this.call('',rollbackReadSchema); };
`;
 put('rollback-api/services/listings/history20RollbackReadSchema.js',bundled);
 put('rollback-api/services/listings/store.js',store+shim);
 manifest.rollbackMode='INSTALLED_API_WITH_UNPUBLISHED_HISTORY20_READ_COMPAT_ONLY';
 manifest.rollbackAfter={...manifest.before};
 for(const p of ['services/listings/store.js','services/listings/history20RollbackReadSchema.js'])manifest.rollbackAfter['api/'+p]=hash(fs.readFileSync(path.join(out,'rollback-api',p)));
 return ['rollback-api/services/listings/store.js','rollback-api/services/listings/history20RollbackReadSchema.js'];
};
