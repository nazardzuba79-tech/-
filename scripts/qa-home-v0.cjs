'use strict';
const {fixture}=require('./qa-home-v0-fixture.cjs');
module.exports={fixture};
if(require.main===module)require('./qa-home-v0-svg.cjs').run();
