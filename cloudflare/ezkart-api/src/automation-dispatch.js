import {automationReady} from './marketing-automations.js';
import {scanAutomationEvents} from './automation-processing.js';
import {publishAutomationBatch,skipAutomationEnrollments} from './automation-publication.js';

// Publication has its own bounded invocation. Sending keeps the existing
// campaign queue, retry, consent, investigation and provider evidence contract.
export async function processMarketingAutomations(env){
  const result={held:!automationReady(env),scanned:0,enrolled:0,skipped:0,published:0,needsReview:0,limited:false};
  if(result.held)return result;
  try{
    const scan=await scanAutomationEvents(env);result.scanned=scan.scanned;result.enrolled=scan.enrolled;
  }catch(error){
    if(error instanceof Response&&error.headers.get('x-ezkart-error-code')==='automation_source_invalid')result.needsReview++;
    else throw error;
  }
  result.skipped=(await skipAutomationEnrollments(env)).skipped;
  try{
    const publication=await publishAutomationBatch(env);result.published=publication.published;result.limited=Boolean(publication.limited);
  }catch(error){
    if(error instanceof Response&&error.headers.get('x-ezkart-error-code')==='automation_publication_invalid')result.needsReview++;
    else throw error;
  }
  return result;
}
