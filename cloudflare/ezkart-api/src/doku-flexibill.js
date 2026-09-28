// Documented Account Billing Batch Upload envelope only, checked 2026-09-28:
// https://developers.doku.com/flexibill/account-billing/batch-upload
// Neither helper supplies authentication, a mandate, or payment evidence.
const filename=value=>typeof value==='string'&&/^TKN[A-Za-z0-9_.-]{1,120}\.TXT$/i.test(value)&&!value.includes('..');
export function flexibillBatchNotify(fileName){
 if(!filename(fileName))throw new TypeError('A safe TKN batch filename is required');
 return {method:'POST',path:'/batch-upload/v1/notify',body:{file_name:fileName}};
}
export function flexibillReportNotice(body){
 if(body?.service?.id!=='BATCH_UPLOAD'||body?.batch_file?.status!=='DONE'||!filename(body?.batch_file?.name)||typeof body?.batch_file?.date!=='string'||!Number.isFinite(Date.parse(body.batch_file.date)))throw new TypeError('Invalid FlexiBill report notice');
 return {fileName:body.batch_file.name,completedAt:new Date(body.batch_file.date).toISOString(),meaning:'report_available',paymentConfirmed:false};
}
