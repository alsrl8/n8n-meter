import pg from 'pg';
import {readFileSync} from 'node:fs';
import {identifier} from './core.mjs';
const e=process.env;
const pool=new pg.Pool({host:e.PGHOST,port:Number(e.PGPORT||5432),database:e.PGDATABASE,user:e.PGUSER,password:readFileSync(e.PGPASSWORD_FILE,'utf8').trim(),connectionTimeoutMillis:5000,options:'-c default_transaction_read_only=on -c statement_timeout=5000'});
try {
  const table=identifier(e.PGSCHEMA||'public')+'.'+identifier((e.N8N_TABLE_PREFIX||'')+'workflow_statistics');
  const {rows}=await pool.query("SELECT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser, has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE') AS writable",[table]);
  if(rows[0].superuser||rows[0].writable)throw new Error('READ_ONLY_ROLE_REQUIRED');
  await pool.query(`SELECT id,name,"workflowId","workflowName",count,"rootCount" FROM ${table} LIMIT 0`);
  console.log('DB_READ_ONLY_CHECK_PASSED');
} catch {console.error('DB_READ_ONLY_CHECK_FAILED');process.exitCode=1;}
finally {await pool.end();}
