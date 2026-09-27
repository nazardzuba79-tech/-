// Classify statements for one database in a time window of the PostgreSQL log.
const fs=require('fs');const [db,from,to]=process.argv.slice(2);
const lines=fs.readFileSync('/var/log/postgresql/postgresql-16-main.log','utf8').split('\n');
const re=new RegExp(`^(\\S+ \\S+) UTC \\[\\d+\\] db=${db} LOG:  (?:statement|execute [^:]*): (.*)$`);
const out={SELECT:0,INSERT:0,UPDATE:0,DELETE:0,BEGIN:0,COMMIT:0,OTHER:0};let cur=null;const stmts=[];
for(const l of lines){const m=l.match(re);if(m){cur={at:m[1],sql:m[2]};stmts.push(cur);continue;}if(/^\d{4}-\d\d-\d\d /.test(l)){cur=null;continue;}if(cur&&cur.sql.trim()==='')cur.sql=l.trim();}
const t0=Date.parse(from+'Z'),t1=Date.parse(to+'Z');
for(const s of stmts){const t=Date.parse(s.at.replace(' ','T')+'Z');if(t<t0||t>=t1)continue;const k=s.sql.trim().split(/\s+/)[0].toUpperCase();out[k in out?k:(k==='WITH'?'SELECT':'OTHER')]++;}
const hours=(t1-t0)/3600000;const reads=out.SELECT,writes=out.INSERT+out.UPDATE+out.DELETE;
console.log(JSON.stringify({db,from,to,minutes:(t1-t0)/60000,...out,reads,writes,readsPerHour:+(reads/hours).toFixed(1),writesPerHour:+(writes/hours).toFixed(1),statementsPerHour:+(Object.values(out).reduce((a,b)=>a+b,0)/hours).toFixed(1)}));
