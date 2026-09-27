// The isolated beta shares the account's five free Cron Trigger slots with
// TEST. One minute trigger gives each dispatcher its own invocation/query budget.
export function betaScheduledTask(env, controller) {
  if (env.APP_ENVIRONMENT !== 'beta' || env.COMMERCE_SCHEDULE !== 'compact_v1') return null;
  if (controller.cron !== '* * * * *') return null;
  const time = controller.scheduledTime;
  if (!Number.isSafeInteger(time) || time < 0 || !Number.isFinite(new Date(time).getTime())) throw Error('Invalid beta schedule time');
  const minute = new Date(time).getUTCMinutes();
  if (minute === 17) return 'housekeeping';
  return ['notifications', 'email', 'campaigns', 'automations'][minute % 4];
}

export async function runBetaScheduledTask(task, controller, handlers, log = console) {
  const scheduledAt = new Date(controller.scheduledTime).toISOString();
  try {
    const result=await handlers[task](),counts={};
    for(const key of ['processed','failed','scanned','enrolled','skipped','published','needsReview','pending','weekly']) {
      if(Number.isSafeInteger(result?.[key])&&result[key]>=0)counts[key]=result[key];
    }
    const outcome=counts.failed>0||counts.needsReview>0?'attention':result?.held===true?'held':'ok';
    log.info('commerce_schedule', {deployment:'beta', task, scheduledAt, outcome, ...counts});
  } catch (error) {
    log.error('commerce_schedule', {deployment:'beta', task, scheduledAt, outcome:'error'});
    throw error;
  }
}
