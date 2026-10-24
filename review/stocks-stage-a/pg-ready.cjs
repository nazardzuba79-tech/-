'use strict';
// The postgres entrypoint briefly exposes an init-only UNIX socket before the
// requested database exists. pg_isready on that socket is NOT startup proof.
function ready(docker,name){try{return docker(['exec',name,'psql','-h','127.0.0.1','-U','neondb_owner','-d','voltex_stage','-Atc','SELECT current_database()'])==='voltex_stage';}catch{return false;}}
module.exports={ready};
