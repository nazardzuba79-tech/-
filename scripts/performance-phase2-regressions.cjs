/** Existing behavioral suites, without disabling assertions or changing fixtures. */
const {spawnSync}=require('node:child_process');
const scopes=[
 'src/private-trading/__tests__',
 'src/api/routes/__tests__/nativeDemoAccess.test.ts','src/api/routes/__tests__/privateTrading.test.ts',
 ...['futures','native','chart','priceChartMarketOrders.test.ts','private','customerFacingErrors.test.ts','copyMarketplace','copyTrading',
 'depositAllWallets.test.ts','walletUnifiedAccount.test.ts','adminDepositRails.test.ts','adminConsoleInteractions.test.ts'].map(p=>'frontend/src/lib/__tests__/'+p),
 'src/services/copyTrading/__tests__','src/services/__tests__/DepositService.test.ts',
 ...['adminDeposits','deposits','adminOverview'].map(p=>`src/api/routes/__tests__/${p}.test.ts`),
 'src/config/__tests__/chains.test.ts','src/services/deposit-verifiers/__tests__',
];
const result=spawnSync(process.execPath,['node_modules/jest/bin/jest.js','--runInBand','--silent','--json','--outputFile=output/performance-phase2/regressions.json',...scopes],{stdio:'inherit',windowsHide:true});
process.exitCode=result.status??1;
