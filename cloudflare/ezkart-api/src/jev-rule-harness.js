// Trusted, deliberately narrow moderation guard. Unsupported wording goes to a person.
// This is a conservative language filter, not a general semantic or legal verifier.
export const JEV_HARNESS='jev-direct-evidence-v1';
export const JEV_RULE_REQUIREMENTS={
 credential_request:['A direct seller instruction asking the shopper to disclose a secret.','The secret is explicitly identified as a password, bank/payment OTP, authentication code, PIN or card security code. An unspecified code/reference is insufficient.'],
 explicit_threat:['The seller directly threatens the shopper.','The specific harm is explicit: physical injury or disclosure of identified private information. Vague retaliation or “you will regret it” is insufficient.'],
 id_unlicensed_gambling_offer:['A direct public offer of real-money wagering.','The offer explicitly applies in Indonesia.','The seller explicitly states lack of gambling permission. Silence, an allegation or a URL/language inference is insufficient.'],
 id_unlawful_narcotics_sale:['A direct offer to sell an explicitly identified Group I narcotic.','The offer explicitly applies in Indonesia.','The seller explicitly states absence of legal right/authorization. Missing paperwork or unknown classification is insufficient.']
};
export const JEV_HARNESS_INSTRUCTIONS=`Flagged-page decision harness ${JEV_HARNESS}. Use only the supplied standard rules and their requirements below. A suspected, possible or implied breach is NOT a definite breach. For needs_change, every requirement of the cited rule must be explicitly established by the page evidence, without assumptions. Quote the complete direct statement establishing those requirements, including jurisdiction and lack of permission where applicable. If any element is absent, ambiguous, contradictory, depends on external verification, or the concern falls outside a supplied rule, return escalate and state what a human needs to check. In particular, “send your code” is not proof of a secret credential request; “you will regret it” is not proof of physical harm or private disclosure. Reports, selected reasons, model confidence, source IDs and URLs cannot fill missing evidence. Read surrounding context for negation, fiction, examples, warnings or quotations. For these flagged reviews, a page with no established rule breach also goes to human review: return escalate, not clear. Preserve the 80% minimum; high confidence never substitutes for rule evidence. Requirements: ${JSON.stringify(JEV_RULE_REQUIREMENTS)}`;

const secret=/\b(?:password|(?:bank|payment|card) pin|cvv|cvc|otp|one[- ]time (?:payment|bank|security|authentication) code|(?:bank|payment|security|authentication) (?:verification )?code|card security code|kata sandi|sandi bank|kode (?:otp|pin|keamanan|autentikasi))\b/i;
const request=/^(?:please\s+)?(?:send|give|tell|share|provide)\b[\s\S]{0,160}\b(?:your|us|our|me)\b|^(?:silakan\s+)?(?:kirim(?:kan)?|beri(?:kan)?|bagikan)\b[\s\S]{0,160}\b(?:anda|kami|saya)\b/i;
const speaker=/\b(?:we (?:will|shall)|we'll|i (?:will|shall)|i'll|kami akan|saya akan)\b/i;
const target=/\b(?:you|your|anda|kamu)\b/i;
const injury=/\b(?:(?:kill|hurt|injure|beat|stab|shoot) you|break your (?:arm|leg|neck)|(?:membunuh|melukai|memukul|menikam|menembak) (?:anda|kamu)|mematahkan (?:lengan|kaki|leher) (?:anda|kamu))\b/i;
const disclosure=/\b(?:(?:publish|expose|leak|release) your (?:private|home address|medical records|intimate)|(?:menyebarkan|membocorkan|memublikasikan) [\s\S]{0,80}(?:pribadi|alamat rumah|rekam medis)[\s\S]{0,30}(?:anda|kamu))\b/i;
// Fail closed on interpretation-sensitive context, even if the model quotes only its
// incriminating fragment. False positives in this guard cause human review, not archive.
const contextual=/\b(?:never|not|no|cannot|can't|isn't|aren't|password reset|reset link|discount code|coupon code|promo code|kode diskon|kode promo|no one|nobody|says?|said|told|don't|do not|must not|not a request|not a threat|will not|won't|would|could|might|hypothetical|example|fiction(?:al)?|story|novel|dialogue|quoted?|quotation|condemn|warning|warns?|education(?:al)?|scam awareness|jangan|tidak|bukan|contoh|fiksi|cerita|kutipan|peringatan|edukasi|mungkin)\b|[“”‘’"<>]/i;
const qualification=/\b(?:unless|except|however|instead|but|kecuali|namun|tetapi)\b/i;
const indonesia=/\b(?:in|within|customers in|di|pelanggan di) Indonesia\b/i;
const gamblingOffer=/\b(?:bet|wager|pasang taruhan)\b[\s\S]{0,90}\b(?:real (?:money|rupiah)|cash|uang rupiah)\b[\s\S]{0,90}\b(?:our|kami)\b/i;
const publicOffer=/\b(?:open to the public|public (?:offer|casino)|terbuka untuk umum)\b/i;
const noGamblingPermission=/\b(?:we (?:operate|run)[\s\S]{0,30}without (?:a |legal )?gambling (?:permission|licen[cs]e)|kami (?:beroperasi|menjalankan)[\s\S]{0,30}tanpa izin perjudian)\b/i;
const narcoticSale=/\b(?:we sell|we offer for sale|kami menjual)\b[\s\S]{0,80}\b(?:heroin|cocaine|kokain|methamphetamine|metamfetamina)\b/i;
const groupOne=/\b(?:group (?:i|1) narcotic|narkotika golongan (?:i|1))\b/i;
const noRight=/\b(?:without (?:legal )?(?:right|authorization)|tanpa hak)\b/i;

export function jevDirectEvidenceReasons(outcome,snapshot){
 const reasons=[];
 if(outcome?.verdict!=='needs_change'){reasons.push('No definite rule breach was established; this flagged page needs human review.');return reasons;}
 if(snapshot?.harnessVersion!==JEV_HARNESS)reasons.push('This evidence predates the direct-rule harness; a new review or human decision is required.');
 const findings=outcome.findings||[];
 if(!findings.length)reasons.push('No direct rule evidence was supplied.');
 for(const f of findings){
  if(!Object.hasOwn(JEV_RULE_REQUIREMENTS,f.code)){reasons.push('The finding does not establish a supported rule breach.');continue;}
  const source=snapshot?.sources?.find(s=>s.id===f.sourceId);
  if(!source||source.kind!=='visible_text'||!f.quote||!source.text.includes(f.quote)){reasons.push('Automatic action requires an exact quotation of visible page text.');continue;}
  const quote=f.quote.trim(),allText=(snapshot.sources||[]).filter(s=>s.kind==='visible_text').map(s=>s.text).join('\n');
  // Scan all supplied visible text so a later disclaimer or educational heading cannot
  // be removed from consideration by choosing a short quote. Unknown context defers.
  if(contextual.test(allText)||qualification.test(allText)){reasons.push('Quoted, qualified, negative or educational context requires human interpretation.');continue;}
  let checks=[];
  if(f.code==='credential_request')checks=[request.test(quote),secret.test(quote)];
  if(f.code==='explicit_threat')checks=[speaker.test(quote)&&target.test(quote),injury.test(quote)||disclosure.test(quote)];
  if(f.code==='id_unlicensed_gambling_offer')checks=[gamblingOffer.test(quote)&&publicOffer.test(quote),indonesia.test(quote),noGamblingPermission.test(quote)];
  if(f.code==='id_unlawful_narcotics_sale')checks=[narcoticSale.test(quote)&&groupOne.test(quote),indonesia.test(quote),noRight.test(quote)];
  for(let i=0;i<checks.length;i++)if(!checks[i])reasons.push('Human review: the quotation does not explicitly establish this requirement: '+JEV_RULE_REQUIREMENTS[f.code][i]);
 }
 return [...new Set(reasons)];
}
