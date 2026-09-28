"""Build a self-contained, vector-text PDF and chart/CSV artifacts from frozen results."""
import json,csv,sys,math,html,shutil
from pathlib import Path
from collections import Counter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from PIL import Image
from charts import charts,C
ROOT=Path(__file__).parent;d=json.loads((ROOT/'results.json').read_text());s=d['summary'];rows=d['results'];meta=d['metadata']
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True);charts(d,out/'charts')
for name,file in [('Sans','LiberationSans-Regular.ttf'),('Bold','LiberationSans-Bold.ttf'),('Serif','LiberationSerif-Regular.ttf')]:pdfmetrics.registerFont(TTFont(name,'/usr/share/fonts/liberation/'+file))
W,H=595.276,841.89;M=42;CW=W-2*M
pdf=out/'Jev-Confidence-and-Accuracy-120-Cases.pdf';c=canvas.Canvas(str(pdf),pagesize=(W,H));c.setTitle('Jev — confidence and accuracy across 120 cases');c.setAuthor('Ezkart evaluation · agent-authored synthetic assessment')
page_no=0
labels={'clear':'No violation','needs_change':'Violation','escalate':'Human review'}
short={'clear':'CLEAR','needs_change':'CHANGE','escalate':'HUMAN'}
def esc(t):return html.escape(str(t))
def pct(n,den=120):return f'{n/den:.1%}' if den else 'n/a'
def txt(t,x,top,width=CW,size=10.5,color='ink',font='Sans',leading=None):
    st=ParagraphStyle('p',fontName=font,fontSize=size,leading=leading or size*1.4,textColor=HexColor(C.get(color,color)))
    p=Paragraph(t,st);_,h=p.wrap(width,900)
    assert top-h>43,f'Overflow page {page_no}: {t[:70]}'
    p.drawOn(c,x,top-h);return top-h

def line(y):c.setStrokeColor(HexColor('#D8DFE0'));c.setLineWidth(.7);c.line(M,y,W-M,y)
def page(title,kicker='JEV / EXPANDED DIAGNOSTIC',subtitle=''):
    global page_no
    if page_no:c.showPage()
    page_no+=1;c.setFillColor(HexColor('#F9F8F4'));c.rect(0,0,W,H,fill=1,stroke=0)
    c.setFillColor(HexColor(C['human']));c.rect(M,H-42,30,3,fill=1,stroke=0)
    txt(kicker,M,H-54,size=8.3,font='Bold',color='muted');txt(title,M,H-76,size=27,font='Serif',leading=31)
    if subtitle:txt(subtitle,M,H-116,size=10,color='muted')
    c.setFont('Sans',8);c.setFillColor(HexColor(C['muted']));c.drawString(M,24,'Ezkart · 28 September 2026 · Synthetic challenge set');c.drawRightString(W-M,24,str(page_no));line(39)

def fig(name,top,height):
    p=out/'charts'/(name+'.png');im=Image.open(p);iw,ih=im.size;w=min(CW,height*iw/ih);h=w*ih/iw;c.drawImage(str(p),M+(CW-w)/2,top-h,width=w,height=h,mask='auto');return top-h

def card(x,top,w,number,label,sub,color):
    c.setFillColor(white);c.roundRect(x,top-106,w,106,7,fill=1,stroke=0);c.setFillColor(HexColor(C[color]));c.rect(x,top-4,w,4,fill=1,stroke=0)
    txt(number,x+12,top-14,w-24,32,color,'Bold');txt(label,x+12,top-55,w-24,10,'ink','Bold');txt(sub,x+12,top-75,w-24,8.2,'muted')
def table(data,top,widths,fontsize=9,rowheight=None):
    sty=ParagraphStyle('table',fontName='Sans',fontSize=fontsize,leading=fontsize*1.2,textColor=HexColor(C['ink']))
    cells=[[Paragraph(esc(v),sty) for v in row] for row in data]
    tab=Table(cells,colWidths=widths,rowHeights=rowheight,repeatRows=1)
    tab.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#E4EAEC')),('ROWBACKGROUNDS',(0,1),(-1,-1),[white,HexColor('#F1F4F3')]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),4 if fontsize<8 else 6),('BOTTOMPADDING',(0,0),(-1,-1),4 if fontsize<8 else 6),('LINEBELOW',(0,0),(-1,0),.6,HexColor('#C3CED4'))]))
    _,h=tab.wrap(CW,1000);assert top-h>45,(page_no,h);tab.drawOn(c,M,top-h);return top-h

page('How much can we trust Jev?',subtitle='120 new cases · 60 English + 60 Indonesian · unchanged model and prompt')
auto=s['archiveEligible']+s['noArchive']
txt(f'<b>The larger sample found {s["wrongAutomatic"]} unsupported archive decisions that passed the current safeguards.</b> Confidence is useful to record, but it is not a reliable guarantee of correctness.',M,692,size=13,leading=18)
w=(CW-20)/3
card(M,627,w,pct(s['usableCorrect']),'Accepted + correct',f'{s["usableCorrect"]} of 120 model answers','good')
card(M+w+10,627,w,pct(s['acceptedWrong']),'Accepted but wrong',f'{s["acceptedWrong"]} of 120 model answers','bad')
card(M+2*(w+10),627,w,str(s['wrongAutomatic']),'Wrong automatic decisions',f'of {auto} automatic decisions ({pct(s["wrongAutomatic"],auto)})','bad')
fig('outcomes',499,210)
txt('<b>What “wrong” means here</b>',M,270,size=12,font='Bold')
txt('Each case had an expected answer fixed before the run: a supported violation, no violation, or human review. “Accepted + correct” means the application accepted the response and its verdict matched that expected answer. It does not certify every sentence in the explanation.',M,245,size=10.5)
txt(f'<b>Application result:</b> {s["archiveEligible"]} archive-eligible, {s["noArchive"]} no-archive, and {s["humanReview"]} human-review cases. These were simulated routing decisions; no seller page was changed.',M,176,size=11)
txt('This is a deliberately balanced synthetic challenge set, not a random sample of Ezkart traffic. The percentages describe these 120 cases, not a measured production error rate.',M,113,size=9.7,color='muted')

page('Model judgment vs. final routing',subtitle='The safeguards can correct routing without correcting the original answer.')
fig('confusion',697,302)
txt('Read each row as 40 cases with the same expected answer. A number on the diagonal is an exact match. A move into “Human review” is a safe deferral, but it still leaves work for a person.',M,382,size=10)
table([['Measure','Observed in this sample'],['Wrong archive-eligible decisions',f'{s["falseArchive"]} of {s["archiveEligible"]} ({pct(s["falseArchive"],s["archiveEligible"])})'],['Wrong no-archive decisions',f'{s["falseClear"]} of {s["noArchive"]} no-archive cases'],['Human review required by the gold labels','40 of 120 cases'],['Human review actually requested',f'{s["humanReview"]} of 120 cases'],['Extra human review on otherwise decidable cases',f'{s["unnecessaryHumanReview"]} cases'],['Exact final routing match',f'{s["routingExact"]} of 120 ({pct(s["routingExact"])})']],320,[CW*.63,CW*.37],9.2)
txt('The nine unsupported archives comprise four missing-permit cases, three missing-jurisdiction cases and two ambiguous-threat cases. Archive-eligible means the checks would permit a hold. Real actions also require authority and the unchanged revision; no page actions were performed.',M,98,size=9,color='muted')

page('Confidence is not accuracy',subtitle=f'Mean claimed confidence: {sum(x["confidence"] for x in rows)/120:.1%} · Observed verdict accuracy: {pct(s["usableCorrect"])}')
fig('calibration',697,259)
txt('The blue bars show what Jev claimed. Green shows how often the proposed verdict matched the fixed expected answer. Gold also requires an accepted response. Empty bins had no cases; they are not evidence of poor performance.',M,424,size=10)
fig('confidence-counts',358,187)
txt(f'<b>{s["hundredConfidence"]} answers claimed 100% confidence.</b> Of those, {s["hundredWrong"]} had the wrong verdict and {s["hundredRejected"]} were rejected by validation. Confidence was available for {s["parsedConfidence"]} of 120 responses.',M,154,size=11)
txt('Confidence in “human review” means Jev is confident that escalation is appropriate. It is not a confidence that the page violates policy. The charts assess the selected verdict, not a hidden probability of illegality.',M,92,size=9,color='muted')

page('Would a higher cutoff solve it?',subtitle='Replay of saved answers only — no additional model calls or prompt changes.')
fig('thresholds',697,237)
txt('Every answer claimed at least 85%, so the 80% cutoff alone filtered out none. Raising it retains the other safeguards, but even 100% leaves two unsupported archive decisions in this sample.',M,444,size=10.5)
table([['Minimum confidence','Automatic decisions','Wrong automatic','Human review']]+[[f'{t["threshold"]:.0%}',str(t['automatic']),str(t['wrongAutomatic']),str(t['humanReview'])] for t in d['thresholds']],375,[CW*.28,CW*.26,CW*.24,CW*.22],9)
txt('<b>Practical implication</b>',M,173,size=12,font='Bold')
txt('Keep human oversight for uncertain permission and jurisdiction. Do not treat missing permit information as proof of no permit. A higher numerical threshold may reduce volume, but it is not a substitute for establishing each required policy condition.',M,147,size=11)
txt('The replay is descriptive for this fixed sample. It is not a tuned or independently validated replacement policy.',M,76,size=9,color='muted')

page('Where the mistakes concentrate',subtitle='Four authored cases per family; related cases are not independent random samples.')
fig('families',696,581)
txt('Family counts are small. Use them to locate failure modes, not to rank languages, estimate legal accuracy, or certify an entire content category.',M,96,size=9.5,color='muted')

page('Language and the human workload',subtitle='Both languages contain the same mix of decision types and scenario families.')
fig('language',697,203)
langs=[]
for language in ['en','id']:
    rr=[x for x in rows if x['language']==language];langs.append([language.upper(),f'{sum(x["usableCorrect"] for x in rr)}/60',str(sum(x['state']=='accepted' and not x['verdictMatch'] for x in rr)),str(sum(x['humanReviewRequired'] for x in rr)),str(sum(x['automaticWrong'] for x in rr))])
table([['Language','Correct accepted','Wrong accepted','Human review','Wrong automatic']]+langs,471,[62,126,109,105,CW-402],9)
txt('Why some harmless pages reach a person',M,333,size=16,font='Serif')
txt('Jev sometimes returns “clear” while also attaching an “insufficient evidence” finding. The application treats that as unresolved and sends it to human review. This avoids accepting unsupported clearance, but also creates unnecessary work when the page is plainly harmless.',M,301,size=11)
fixed_by_guard=sum(x['state']=='accepted' and not x['verdictMatch'] and x['decisionVerdict']=='escalate' and x['expected']['verdict']=='escalate' for x in rows)
txt(f'<b>{fixed_by_guard} wrong model verdicts</b> on cases that needed human review were redirected to human review by the safeguards. <b>{s["unnecessaryHumanReview"]} otherwise decidable cases</b> were also deferred. Both counts matter: safety and workload are different measurements.',M,216,size=12)
txt('This sample has deliberately equal language counts and equal expected decision counts. Ezkart’s real traffic mix may be very different.',M,114,size=9.5,color='muted')

# Concrete, attributable evidence cards, chosen deterministically from the failure families.
page('Four examples worth reading',subtitle='Original model answers and evidence are preserved in the accompanying data.')
example_ids=['unknown-gambling-permit-2','unknown-jurisdiction-1','unknown-medicine-2','missing-threat-context-3']
example_rows=[next(x for x in rows if x['id']==i) for i in example_ids]
top=698
for i,r in enumerate(example_rows,1):
    txt(f'{i}. {esc(r["family"].replace("-"," ").capitalize())}',M,top,size=14,font='Bold');top-=29
    top=txt(f'<b>Page:</b> “{esc(r["input"]["sources"][0]["text"])}”',M,top,size=10.2)-9
    top=txt(f'<b>Expected:</b> {labels[r["expected"]["verdict"]]} · <b>Jev:</b> {labels.get(r["rawOutcome"]["verdict"],"Unknown")} at {r["confidence"]:.0%} · <b>Routing:</b> {labels[r["decisionVerdict"]]}',M,top,size=10.2)-9
    top=txt(f'<b>Why:</b> {esc(r["expected"]["rationale"])}',M,top,size=10.2)-9
    if i<=2:top=txt(f'<b>Jev’s explanation:</b> {esc(r["rawOutcome"]["findings"][0]["explanation"])}',M,top,size=9.4,color='muted')-13
    elif r['humanReviewRequired']:top=txt('The model’s original error remains recorded even when the application redirects it to a person.',M,top,size=9.4,color='muted')-13
    else:top=txt('The text does not specify physical harm or exposure of private information; an archive would be unsupported.',M,top,size=9.4,color='muted')-13
    line(top);top-=18

page('What this test establishes',subtitle='Frozen evaluation, transparent costs, and a specific next step.')
txt('A useful assistant; confidence alone is insufficient',M,695,size=19,font='Serif')
txt('The model can recognize the explicit starter-rule violations in this sample. It still confuses missing permit evidence with no permit, omits jurisdiction, and sometimes treats ambiguous wording as a direct threat. Those mistakes can pass a numerical confidence gate and exact-quotation validation.',M,657,size=11.5)
txt('Recommended next step',M,574,size=15,font='Bold')
txt('Require human review when permission, jurisdiction or threat meaning is unresolved. Verify these conditions before an archive can qualify. Fix that boundary, then run a separate held-out sample with expectations set before testing. Keep this run unchanged as the baseline. This report does not silently alter Jev’s policy or archive settings.',M,546,size=11)
txt('How the test was run',M,447,size=15,font='Bold')
method=[('Sample','120 new synthetic cases: 40 violations, 40 harmless, 40 needing human review; 30 families with four variations each.'),('Reference answers','Agent-authored against the existing owner-approved starter policy, frozen in git before calls; not independent owner grades.'),('Model','google/gemini-3.1-flash-lite via google-vertex/global; temperature 0; same application adapter and strict schema.'),('Controls','No retries, no fallback, no tools, no real seller/customer data, no page actions. 8,000 request bytes and 1,000 output tokens per call.'),('Limits','One run per case. Earlier six-/ten-case diagnostics excluded. Related synthetic cases; no production sampling, image/video inspection, independent legal review, or repeat-run stability estimate.')]
table([['Item','Method']]+method,419,[92,CW-92],9)
cost=meta.get('keyUsageDelta');costtext=f'${cost:.6f}' if cost is not None else 'not yet confirmed'
txt(f'<b>Cost:</b> {costtext} authenticated key-usage increase; ${s["roundedResponseCostUsd"]:.6f} summed rounded response costs. {s["unknownCosts"]} responses have unknown cost. The $1.20 reservation is a ceiling, not the amount spent.',M,143,size=10)
txt(f'Adapter SHA-256: {meta["adapterSha256"][:24]}…<br/>Benchmark SHA-256: {meta["benchmarkSha256"][:24]}…<br/>Full hashes, timestamps, original answers and inputs are in the accompanying JSON.',M,92,size=8.5,color='muted')

# Full case register: 30 rows per page, vocabulary kept consistent with the report.
for start in range(0,len(rows),30):
    page(f'Case register · {start+1}–{min(start+30,len(rows))}',kicker='APPENDIX / EVERY CASE INCLUDED',subtitle='CHANGE = violation · CLEAR = no violation · HUMAN = needs human review')
    data=[['Case / language','Expected','Jev','Conf.','Final route','Result']]
    for r in rows[start:start+30]:
        state='OK' if r['usableCorrect'] else 'WRONG' if r['state']=='accepted' else 'REJECT' if r['state']=='rejected' else 'UNKNOWN'
        data.append([r['id']+' / '+r['language'].upper(),short[r['expected']['verdict']],short.get((r['rawOutcome'] or {}).get('verdict'),'—'),f'{r["confidence"]:.0%}' if r['confidence'] is not None else '—',short[r['decisionVerdict']],state])
    table(data,696,[228,56,53,43,70,CW-450],7.5)
    txt('Result compares the accepted model verdict to the fixed expected answer. “Final route” is the application decision; it may defer a wrong model answer to human review. The CSV/JSON provide full evidence.',M,84,size=8.5,color='muted')
c.save()
# Shareable data mirrors the exact report inputs.
shutil.copy2(ROOT/'results.json',out/'Jev-120-Cases-Full-Results.json')
with (out/'Jev-120-Cases.csv').open('w',newline='') as f:
    fields=['case_id','family','language','expected','model_verdict','confidence','validation','final_route','model_correct','wrong_automatic','source_text','report','model_summary']
    w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
    for r in rows:w.writerow(dict(zip(fields,[r['id'],r['family'],r['language'],r['expected']['verdict'],(r['rawOutcome'] or {}).get('verdict'),r['confidence'],r['state'],r['decisionVerdict'],r['usableCorrect'],r['automaticWrong'],r['input']['sources'][0]['text'],r['input']['report']['text'],(r['rawOutcome'] or {}).get('summary')])))
print(json.dumps({'pdf':str(pdf),'pages':page_no,'bytes':pdf.stat().st_size},indent=2))
