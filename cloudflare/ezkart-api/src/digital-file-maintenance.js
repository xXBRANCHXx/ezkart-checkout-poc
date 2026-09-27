const validTime=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||new Date(value).toISOString()!==value)throw Error('Digital maintenance time is invalid');
  return value;
};
// Published history is retained even after catalog deletion. A mutable catalog
// pointer, an expired grant or a refund request cannot authorize file deletion.
export const digitalCleanupEligible=`u.retained_at IS NULL AND
  ((u.state IN ('preparing','uploading','completing') AND u.expires_at<=?1)
    OR u.state='deleting' OR (u.state='ready' AND u.ready_at<=strftime('%Y-%m-%dT%H:%M:%fZ',?1,'-7 days')))
  AND NOT EXISTS (SELECT 1 FROM digital_product_versions v WHERE v.upload_id=u.id)`;

export async function runDigitalFileMaintenance(env,purge,now=new Date().toISOString()){
  validTime(now);
  const wall=Date.now(),finished=()=>new Date(Date.parse(now)+Math.max(0,Date.now()-wall)).toISOString();
  const run=crypto.randomUUID(),lease=new Date(Date.parse(now)+20*60000).toISOString(),retry=new Date(Date.parse(now)+3600000).toISOString();
  const claimed=await env.DB.prepare(`INSERT INTO digital_file_maintenance(singleton,run_id,started_at,lease_until,state)
    VALUES(1,?,?,?,'running') ON CONFLICT(singleton) DO UPDATE SET run_id=excluded.run_id,started_at=excluded.started_at,
      finished_at=NULL,lease_until=excluded.lease_until,state='running',selected_count=0,removed_count=0,failed_count=0,error_code=NULL
    WHERE digital_file_maintenance.lease_until<=excluded.started_at RETURNING run_id`).bind(run,now,lease).first();
  if(!claimed)return {removed:0,failed:0,skipped:true};
  let removed=0,failed=0;
  try{
    const rows=(await env.DB.prepare(`SELECT u.* FROM digital_file_uploads u WHERE ${digitalCleanupEligible}
      AND (u.cleanup_retry_after IS NULL OR u.cleanup_retry_after<=?1)
      ORDER BY COALESCE(u.cleanup_attempted_at,u.expires_at),u.id LIMIT 5`).bind(now).all()).results;
    await env.DB.prepare('UPDATE digital_file_maintenance SET selected_count=? WHERE singleton=1 AND run_id=?').bind(rows.length,run).run();
    for(const row of rows){
      // Fence publication and save the retry time before touching R2. A crash or
      // lost storage reply retains this attempt and cannot resurrect the file.
      const attempt=await env.DB.prepare(`UPDATE digital_file_uploads AS u SET state='deleting',cleanup_attempts=cleanup_attempts+1,
        cleanup_attempted_at=?1,cleanup_retry_after=?2,cleanup_error_code=NULL WHERE id=?3 AND ${digitalCleanupEligible}
        AND (cleanup_retry_after IS NULL OR cleanup_retry_after<=?1)
        AND EXISTS (SELECT 1 FROM digital_file_maintenance WHERE singleton=1 AND run_id=?4 AND state='running')`).bind(now,retry,row.id,run).run();
      if(!attempt.meta.changes)continue;
      try{
        await purge(env,row);
        await env.DB.prepare(`UPDATE digital_file_uploads SET cleanup_retry_after=NULL,cleanup_error_code=NULL
          WHERE id=? AND state='deleted' AND cleanup_attempted_at=?`).bind(row.id,now).run();
        removed++;
      }catch{
        // Provider messages can contain private storage details. Record a fixed
        // operational code and keep working through the remaining bounded batch.
        await env.DB.prepare(`UPDATE digital_file_uploads SET cleanup_error_code='cleanup_unconfirmed'
          WHERE id=? AND state!='deleted' AND cleanup_attempted_at=?`).bind(row.id,now).run();
        failed++;
      }
    }
    await env.DB.prepare(`UPDATE digital_file_maintenance SET state=?,finished_at=?,lease_until=?,removed_count=?,failed_count=?
      WHERE singleton=1 AND run_id=?`).bind(failed?'partial':'completed',finished(),now,removed,failed,run).run();
    return {removed,failed,skipped:false};
  }catch{
    try{await env.DB.prepare(`UPDATE digital_file_maintenance SET state='failed',finished_at=?,lease_until=?,
      removed_count=?,failed_count=?,error_code='cleanup_unconfirmed' WHERE singleton=1 AND run_id=?`)
      .bind(finished(),now,removed,failed,run).run();}catch{}
    throw Error('Digital file maintenance did not complete; inspect its saved heartbeat and retry state.');
  }
}

// Aggregate operational evidence only. No filenames, object keys, provider
// identifiers, seller identities, buyer identities or grants leave this query.
export const digitalStorageReportSql=`WITH eligible AS (
  SELECT u.* FROM digital_file_uploads u WHERE ${digitalCleanupEligible}
) SELECT json_object('observedAt',?1,
  'uploads',(SELECT COUNT(*) FROM digital_file_uploads),
  'retainedFiles',(SELECT COUNT(*) FROM digital_file_uploads WHERE retained_at IS NOT NULL AND state='ready'),
  'retainedBytes',(SELECT CAST(COALESCE(SUM(size_bytes),0) AS TEXT) FROM digital_file_uploads WHERE retained_at IS NOT NULL AND state='ready'),
  'unpublishedFiles',(SELECT COUNT(*) FROM digital_file_uploads WHERE retained_at IS NULL AND state='ready'),
  'unpublishedBytes',(SELECT CAST(COALESCE(SUM(size_bytes),0) AS TEXT) FROM digital_file_uploads WHERE retained_at IS NULL AND state='ready'),
  'inProgress',(SELECT COUNT(*) FROM digital_file_uploads WHERE state IN ('preparing','uploading','completing')),
  'confirmedPartialBytes',(SELECT CAST(COALESCE(SUM(p.size_bytes),0) AS TEXT) FROM digital_file_parts p JOIN digital_file_uploads u ON u.id=p.upload_id WHERE u.state IN ('preparing','uploading','completing')),
  'eligibleCleanup',(SELECT COUNT(*) FROM eligible),
  'dueCleanup',(SELECT COUNT(*) FROM eligible WHERE cleanup_retry_after IS NULL OR cleanup_retry_after<=?1),
  'deferredCleanup',(SELECT COUNT(*) FROM eligible WHERE cleanup_retry_after>?1),
  'unconfirmedCleanup',(SELECT COUNT(*) FROM digital_file_uploads WHERE state!='deleted' AND cleanup_error_code IS NOT NULL),
  'interruptedCleanup',(SELECT COUNT(*) FROM eligible WHERE state='deleting' AND cleanup_attempted_at IS NOT NULL AND cleanup_retry_after<=?1 AND cleanup_error_code IS NULL),
  'retainedUnavailable',(SELECT COUNT(*) FROM digital_file_uploads WHERE retained_at IS NOT NULL AND state!='ready'),
  'lastRun',json((SELECT json_object('state',state,'startedAt',started_at,'finishedAt',finished_at,'leaseUntil',lease_until,
    'selected',selected_count,'removed',removed_count,'failed',failed_count,'errorCode',error_code) FROM digital_file_maintenance WHERE singleton=1))
) AS report`;

export function digitalStorageWarnings(report){
  const warnings=[];const last=report.lastRun,now=Date.parse(report.observedAt);
  if(!last)warnings.push('maintenance_not_observed');
  else{
    if(now-Date.parse(last.startedAt)>2*3600000)warnings.push('maintenance_overdue');
    if(last.state==='running'&&Date.parse(last.leaseUntil)<=now)warnings.push('maintenance_interrupted');
    if(['partial','failed'].includes(last.state))warnings.push('maintenance_incomplete');
  }
  if(report.unconfirmedCleanup)warnings.push('cleanup_retries_pending');
  if(report.interruptedCleanup)warnings.push('cleanup_outcomes_unconfirmed');
  if(report.dueCleanup>5)warnings.push('cleanup_exceeds_hourly_batch');
  if(report.retainedUnavailable)warnings.push('retained_file_unavailable');
  return warnings;
}

export function digitalStorageReportStatement(now=new Date().toISOString()){
  return digitalStorageReportSql.replaceAll('?1',"'"+validTime(now)+"'");
}
