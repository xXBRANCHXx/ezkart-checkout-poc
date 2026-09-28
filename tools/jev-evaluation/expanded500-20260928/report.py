"""Independently grade frozen synthetic expectations; never modifies labels or sends requests."""
import argparse, csv, hashlib, html, json, math
from collections import Counter
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak, KeepTogether

LABELS=['clear','needs_change','escalate']; SHORT={'clear':'CLEAR','needs_change':'CHANGE','escalate':'HUMAN',None:'—'}
VIOLATIONS={'credential_request','explicit_threat','id_unlicensed_gambling_offer','id_unlawful_narcotics_sale'}
def parse(s):
    if isinstance(s,dict):return s
    try:return json.loads(s)
    except (ValueError,TypeError):return {}
def decision(o,s,t=.8):
    cov=s.get('coverage',{}); fs=o.get('findings',[]) if o else []
    conf=o.get('confidence') if o else None
    unsafe=(not o or not isinstance(conf,(int,float)) or not math.isfinite(conf) or conf<t or conf>1 or o.get('verdict')=='escalate' or o.get('uncertainties') or any(f.get('code') not in VIOLATIONS for f in fs))
    unsafe=unsafe or cov.get('truncated') is not False or not (cov.get('unreviewedMedia') is False or cov.get('unreviewedMedia')==[]) or not any(x.get('text','').strip() for x in s.get('sources',[]))
    if s.get('evidenceVersion')==2:
        unsafe=unsafe or bool(cov.get('missing')) or any(any(im.get('id')==f.get('sourceId') for im in s.get('images',[])) or any(x.get('id')==f.get('sourceId') and x.get('kind')!='visible_text' for x in s.get('sources',[])) for f in fs)
    return 'escalate' if unsafe else o['verdict']
def summarize(rs):
    n=len(rs)
    return {'cases':n,'accepted':sum(r['state']=='accepted' for r in rs),'rejected':sum(r['state']=='rejected' for r in rs),'unavailable':sum(r['state'] not in ('accepted','rejected') for r in rs),'rawVerdictAvailable':sum(r['modelVerdict'] in LABELS for r in rs),'rawVerdictCorrect':sum(r['modelCorrect'] for r in rs),'acceptedCorrect':sum(r['acceptedCorrect'] for r in rs),'acceptedWrong':sum(r['state']=='accepted' and not r['modelCorrect'] for r in rs),'routingCorrect':sum(r['routeCorrect'] for r in rs),'archiveEligible':sum(r['decisionVerdict']=='needs_change' for r in rs),'clear':sum(r['decisionVerdict']=='clear' for r in rs),'humanReview':sum(r['decisionVerdict']=='escalate' for r in rs),'wrongArchive':sum(r['wrongArchive'] for r in rs),'falseClear':sum(r['falseClear'] for r in rs),'expectedHuman':sum(r['expectedDecision']=='escalate' for r in rs),'extraHuman':sum(r['decisionVerdict']=='escalate' and r['expectedDecision']!='escalate' for r in rs),'missedHuman':sum(r['decisionVerdict']!='escalate' and r['expectedDecision']=='escalate' for r in rs)}
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--results',required=True,type=Path);ap.add_argument('--benchmark',type=Path,default=Path(__file__).with_name('benchmark.json'));ap.add_argument('--output',type=Path,default=Path('/home/branch/Documents/Ezkart/Jev-Evaluation-500-2026-09-28'));a=ap.parse_args()
    bbytes=a.benchmark.read_bytes();b=json.loads(bbytes);d=json.loads(a.results.read_text());assert len(b['cases'])==500;assert d.get('finishedAt'),'Run not finished'
    assert hashlib.sha256(bbytes).hexdigest()==d['benchmarkSha256'],'Frozen benchmark hash mismatch'
    attempts={r['caseId']:r for r in d['attempts']};assert len(attempts)==500,'Need all 500 attempts'
    rows=[]
    for case in b['cases']:
        x=attempts[case['id']];rawpath=Path(str(a.results)+'.responses')/(case['id']+'.json');raw={}
        if rawpath.exists():
            rb=rawpath.read_bytes();assert not x.get('rawResponseSha256') or hashlib.sha256(rb).hexdigest()==x['rawResponseSha256'];env=parse(rb)
            try:raw=parse(env['choices'][0]['message']['content'])
            except (KeyError,IndexError,TypeError):pass
        if not raw:raw=x.get('result',{}).get('outcome') or parse(x.get('diagnostic',{}).get('rawOutcome'))
        if not isinstance(raw,dict):raw={}
        mv=raw.get('verdict');conf=raw.get('confidence');conf=conf if isinstance(conf,(int,float)) and not isinstance(conf,bool) and math.isfinite(conf) and 0<=conf<=1 else None
        accepted=x.get('result',{}).get('outcome') if x['state']=='accepted' else None
        route=decision(accepted,case['input']);assert route==x['decision']['decisionVerdict'],f'Independent routing differs: {case["id"]}'
        expected=case['expected'];assert expected['verdict'] in LABELS and expected['decisionVerdict'] in LABELS
        row={'id':case['id'],'modality':case.get('modality',case.get('channel',case.get('category','unknown'))),'scenario':case.get('scenario',case.get('family','unknown')),'language':case.get('language','unknown'),'expectedVerdict':expected['verdict'],'expectedDecision':expected['decisionVerdict'],'modelVerdict':mv,'confidence':conf,'state':x['state'],'failureCode':x.get('failureCode'),'decisionVerdict':route,'modelCorrect':mv==expected['verdict'],'acceptedCorrect':x['state']=='accepted' and mv==expected['verdict'],'routeCorrect':route==expected['decisionVerdict'],'wrongArchive':route=='needs_change' and expected['decisionVerdict']!='needs_change','falseClear':route=='clear' and expected['decisionVerdict']!='clear','rawOutcome':raw,'expected':expected,'input':case['input'],'reportText':case.get('reportText'),'decisionReasons':x['decision'].get('decisionReasons',[]),'acceptedOutcome':accepted}
        rows.append(row)
    out=a.output;out.mkdir(parents=True,exist_ok=True);charts=out/'charts';charts.mkdir(exist_ok=True)
    summary=summarize(rows);groups={k:{v:summarize([r for r in rows if r[k]==v]) for v in sorted(set(r[k] for r in rows))} for k in ['modality','scenario','language']}
    thresholds=[]
    for t in [.8,.85,.9,.95,.99,1.0]:
        replay=[dict(r,decisionVerdict=decision(r['acceptedOutcome'],r['input'],t)) for r in rows]
        for r in replay:r.update(wrongArchive=r['decisionVerdict']=='needs_change' and r['expectedDecision']!='needs_change',falseClear=r['decisionVerdict']=='clear' and r['expectedDecision']!='clear',routeCorrect=r['decisionVerdict']==r['expectedDecision'])
        thresholds.append({'threshold':t,**summarize(replay)})
    bins=[]
    for lo,hi in [(0,.5),(.5,.8),(.8,.9),(.9,.95),(.95,1.000001)]:
        rr=[r for r in rows if r['confidence'] is not None and lo<=r['confidence']<hi];bins.append({'lower':lo,'upper':min(hi,1),'n':len(rr),'meanConfidence':sum(r['confidence'] for r in rr)/len(rr) if rr else None,'verdictAccuracy':sum(r['modelCorrect'] for r in rr)/len(rr) if rr else None,'acceptedCorrectRate':sum(r['acceptedCorrect'] for r in rr)/len(rr) if rr else None})
    cost=sum((x.get('result') or x.get('diagnostic') or {}).get('costMicrousd') or 0 for x in attempts.values())/1e6
    metrics={'summary':summary,'groups':groups,'thresholds':thresholds,'confidenceBins':bins,'benchmarkSha256':d['benchmarkSha256'],'adapterSha256':d['adapterSha256'],'model':d['model'],'policy':d['policy'],'startedAt':d['startedAt'],'finishedAt':d['finishedAt'],'keyUsageDelta':d.get('keyUsageAfter',0)-d.get('keyUsageBefore',0) if d.get('keyUsageAfter') is not None else None,'roundedResponseCostUsd':cost,'costUnknown':sum((x.get('result') or x.get('diagnostic') or {}).get('costMicrousd') is None for x in attempts.values()),'synthetic':True,'labelBasis':b.get('labelBasis'),'actions':d['actions']}
    (out/'Jev-500-Metrics.json').write_text(json.dumps(metrics,indent=2,ensure_ascii=False));(out/'Jev-500-Graded-Cases.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False))
    fields=['id','modality','scenario','language','expectedVerdict','expectedDecision','modelVerdict','confidence','state','failureCode','decisionVerdict','modelCorrect','acceptedCorrect','routeCorrect','wrongArchive','falseClear']
    with (out/'Jev-500-Cases.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows({k:r[k] for k in fields} for r in rows)
    plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False,'figure.facecolor':'white','savefig.facecolor':'white'})
    def save(name):plt.tight_layout();plt.savefig(charts/(name+'.png'),dpi=170,bbox_inches='tight');plt.close()
    fig,axs=plt.subplots(1,2,figsize=(11,4))
    for ax,key,expected,title,cols in [(axs[0],'modelVerdict','expectedVerdict','Original model verdict',LABELS+[None]),(axs[1],'decisionVerdict','expectedDecision','Effective application decision',LABELS)]:
        matrix=np.array([[sum(r[expected]==e and (r[key] if r[key] in LABELS else None)==p for r in rows) for p in cols] for e in LABELS]);ax.imshow(matrix,cmap='Blues');ax.set_xticks(range(len(cols)),[SHORT[z] for z in cols]);ax.set_yticks(range(3),[SHORT[z] for z in LABELS]);ax.set_title(title);ax.set_xlabel('Observed');ax.set_ylabel('Frozen expected')
        for (i,j),n in np.ndenumerate(matrix):ax.text(j,i,str(n),ha='center',va='center',color='white' if n>matrix.max()*.55 else '#162c3a')
    save('confusion')
    fig,ax=plt.subplots(figsize=(10,3.6));xx=np.arange(5);width=.25
    for j,(key,label,color) in enumerate([('meanConfidence','Mean claimed confidence','#4a6b95'),('verdictAccuracy','Raw verdict match','#2b8b76'),('acceptedCorrectRate','Accepted + verdict match','#cd9c37')]):ax.bar(xx+(j-1)*width,[x[key] or 0 for x in bins],width,label=label,color=color)
    ax.set_xticks(xx,[f'{z["lower"]:.0%}–{z["upper"]:.0%}\nn={z["n"]}' for z in bins]);ax.set_ylim(0,1.17);ax.legend(loc='upper left',ncols=3,fontsize=8);ax.set_ylabel('Proportion');save('reliability')
    fig,ax=plt.subplots(figsize=(10,3.4))
    for key,label,color in [('archiveEligible','Archive eligible','#4a6b95'),('clear','Clear','#2b8b76'),('humanReview','Human review','#cd9c37'),('wrongArchive','Wrong archive','#bb4040'),('falseClear','False clear','#714b8c')]:ax.plot([t['threshold']*100 for t in thresholds],[t[key] for t in thresholds],marker='o',label=label,color=color)
    ax.set_xlabel('Minimum claimed confidence (%)');ax.set_ylabel('Cases');ax.legend(ncols=3,fontsize=8);save('thresholds')
    styles=getSampleStyleSheet();styles.add(ParagraphStyle(name='SmallCell',fontName='Helvetica',fontSize=7,leading=9));styles.add(ParagraphStyle(name='CaptionX',fontSize=9,leading=12,textColor=colors.HexColor('#546675')))
    story=[]
    def p(s,style='BodyText'):story.append(Paragraph(s,styles[style]));story.append(Spacer(1,8))
    def title(s):p(s,'Heading1')
    def table(data,widths=None,small=False):
        style=styles['SmallCell' if small else 'BodyText'];cells=[[Paragraph(html.escape(str(v)),style) for v in row] for row in data];t=Table(cells,colWidths=widths,repeatRows=1,hAlign='LEFT');t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#dce7eb')),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f2f5f6')]),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]));story.append(t);story.append(Spacer(1,12))
    def image(name,w=510):
        from PIL import Image as PI
        im=PI.open(charts/(name+'.png'));story.append(Image(str(charts/(name+'.png')),width=w,height=w*im.height/im.width));story.append(Spacer(1,10))
    def page():story.append(PageBreak())
    def rate(x,n=500):return f'{x}/{n} ({x/n:.1%})' if n else '0/0 (n/a)'
    title('Jev · 500-case evidence evaluation');p('28 September 2026 · Frozen synthetic challenge set','CaptionX')
    p(f'<b>{rate(summary["acceptedCorrect"])} accepted model verdicts matched the authored reference. {rate(summary["routingCorrect"])} effective decisions matched their separate routing references.</b>')
    table([['Measure','Observed'],['Original verdict matches, including rejected JSON',rate(summary['rawVerdictCorrect'])],['Accepted / rejected / unavailable',f'{summary["accepted"]} / {summary["rejected"]} / {summary["unavailable"]}'],['Wrong archive / false clear',f'{summary["wrongArchive"]} / {summary["falseClear"]}'],['Human review load',rate(summary['humanReview'])],['Expected human / extra human / missed human',f'{summary["expectedHuman"]} / {summary["extraHuman"]} / {summary["missedHuman"]}']],[325,185])
    p('These are synthetic, agent-authored cases and labels, frozen before the calls. There was no independent human adjudication. These percentages are descriptive challenge-set match rates, not production accuracy, legal correctness, or proof that an explanation is sound. Related variations are not independent traffic samples.')
    p('Model judgment and application routing have separate references. A visual or source-code violation may correctly receive CHANGE from the model but HUMAN from the application. Rejected model JSON remains visible in original-verdict scoring; rejection is never silently changed into a correct model answer.')
    p(f'No seller page actions were taken (recorded actions: {d["actions"]}). The evaluation used one saved response per case without report-time model calls or label changes.')
    page();title('Judgment and routing are different tests');image('confusion')
    p('Rows are frozen expected labels; columns are observed labels. CLEAR = no supported violation; CHANGE = supported violation; HUMAN = human review. The original matrix includes recoverable validator-rejected answers; “—” is unavailable/unrecognized. Each matrix totals 500.','CaptionX')
    table([['Automatic decision risk','Count / denominator'],['Wrong archive: expected route was not CHANGE',rate(summary['wrongArchive'],summary['archiveEligible'])],['False clear: expected route was not CLEAR',rate(summary['falseClear'],summary['clear'])],['Additional human work on expected automatic cases',str(summary['extraHuman'])],['Expected human review incorrectly automated',str(summary['missedHuman'])]],[330,180])
    p('Wrong archive includes both reference-clear and mandatory-human cases. False clear includes both supported violations and mandatory-human cases. These definitions measure routing risk, not just disagreement between violation labels.')
    page();title('Confidence reliability and cutoff replay');image('reliability')
    p('Confidence is the model’s claim about its selected verdict. Bars include all recoverable valid numeric confidence values, even when application validation rejected the answer. Empty bins are no evidence. Accepted + match adds validation as a separate requirement.','CaptionX');image('thresholds')
    p('Replay changes only the confidence cutoff while retaining validation, uncertainty, coverage and visual/code safeguards. It reuses saved answers, does not tune a replacement policy, and cannot establish performance on new cases.','CaptionX')
    page();title('Cutoff tradeoffs and human workload')
    table([['Cutoff','Archive','Clear','Human','Wrong archive','False clear']]+[[f'{t["threshold"]:.0%}',t['archiveEligible'],t['clear'],t['humanReview'],t['wrongArchive'],t['falseClear']] for t in thresholds],[65,75,70,75,115,110])
    p(f'The frozen routing labels require human review for {summary["expectedHuman"]} cases. The application sent {summary["humanReview"]}; {summary["extraHuman"]} were extra deferrals on cases labeled decidable, while {summary["missedHuman"]} cases labeled HUMAN were automated. A larger human queue can reduce automation risk but is an operational workload, not an accuracy gain.')
    perfect=[r for r in rows if r['confidence']==1];p(f'{len(perfect)} answers claimed 100% confidence; {sum(not r["modelCorrect"] for r in perfect)} had a reference-mismatching verdict and {sum(r["state"]!="accepted" for r in perfect)} were not accepted. Confidence was recoverable for {sum(r["confidence"] is not None for r in rows)}/500 cases.')
    for field in ['modality','language','scenario']:
        page();title('Results by '+field)
        table([[field.title(),'N','Accepted correct','Route match','Human','Wrong archive','False clear']]+[[name,g['cases'],g['acceptedCorrect'],g['routingCorrect'],g['humanReview'],g['wrongArchive'],g['falseClear']] for name,g in groups[field].items()],[150,30,75,65,50,70,70],True)
        p('Counts describe authored cases in this run. Small or related groups cannot establish a reliable ranking or real-world subgroup disparity. Full labels and model output are supplied in the JSON.','CaptionX')
    page();title('Concrete errors and deferrals')
    examples=[]
    for pred in [lambda r:r['wrongArchive'],lambda r:r['falseClear'],lambda r:r['state']=='rejected',lambda r:not r['modelCorrect'],lambda r:r['decisionVerdict']=='escalate' and r['expectedDecision']!='escalate']:
        candidate=next((r for r in rows if pred(r) and r not in examples),None)
        if candidate:examples.append(candidate)
    if not examples:p('No cases met the error/extra-deferral selectors in this sample.')
    for r in examples:
        p(html.escape(r['id']),'Heading3');p(f'Expected model / route: {SHORT[r["expectedVerdict"]]} / {SHORT[r["expectedDecision"]]}. Observed: {SHORT.get(r["modelVerdict"],"—")} / {SHORT[r["decisionVerdict"]]}; validation {r["state"]}; confidence {r["confidence"]}.')
        p('<b>Authored rationale:</b> '+html.escape(str(r['expected'].get('rationale','See frozen benchmark.'))));p('<b>Original model summary:</b> '+html.escape(str(r['rawOutcome'].get('summary','Unavailable'))));p('<b>Routing reasons:</b> '+html.escape('; '.join(r['decisionReasons']) or 'None'))
    page();title('Method, provenance and limits')
    p(f'Model: {html.escape(d["model"])}. Policy: {html.escape(d["policy"])}. Provider restricted to google-vertex/global. Requests use temperature 0, strict JSON schema and up to 2,000 output tokens. The evidence package can include preserved text, page metadata, source code, resources and attached images. Code is read as source, not executed by the model.')
    p('The benchmark SHA-256 is checked against the run before grading. Each saved response hash is verified where recorded. This report independently parses the original saved provider content, compares verdicts to frozen expectations, and reimplements effective decision safeguards; all 500 reconstructed decisions must match the runner. It does not independently adjudicate the truth of the labels or validate every evidence citation.')
    p('The earlier 120-case run used a different sample and evidence adapter. It is a confounded historical diagnostic, not a controlled before/after baseline; no improvement percentage is claimed. No production sampling, repeat-run stability estimate, or independent legal/human review was performed.')
    p(f'Authenticated key usage delta: {metrics["keyUsageDelta"]}; summed rounded response costs: ${cost:.6f}; unknown response costs: {metrics["costUnknown"]}. Reservation is a ceiling, not actual spend.')
    p('Benchmark SHA-256: '+d['benchmarkSha256'],'CaptionX');p('Adapter SHA-256: '+d['adapterSha256'],'CaptionX');p(f'Run: {d["startedAt"]} to {d["finishedAt"]}','CaptionX')
    p('Companion artifacts: Jev-500-Cases.csv, Jev-500-Metrics.json, Jev-500-Graded-Cases.json and chart PNGs. The graded JSON preserves original parsed answers, expected rationales, page evidence and separate routing outcomes. These files are diagnostics; they are not automatic page-action instructions.')
    for start in range(0,500,25):
        page();title(f'Case register · {start+1}–{min(start+25,500)}');p('Expected = model / route; observed = original model / route. Result grades model validation separately.','CaptionX')
        data=[['Case / language','Expected','Observed','Conf.','Validation / model']]
        for r in rows[start:start+25]:data.append([r['id']+' / '+r['language'],SHORT[r['expectedVerdict']]+' / '+SHORT[r['expectedDecision']],SHORT.get(r['modelVerdict'],'—')+' / '+SHORT[r['decisionVerdict']],f'{r["confidence"]:.0%}' if r['confidence'] is not None else '—',r['state']+' / '+('match' if r['modelCorrect'] else 'mismatch')])
        table(data,[190,88,88,40,104],True)
    pdf=out/'Jev-500-Case-Evaluation.pdf'
    def footer(c,doc):c.setFont('Helvetica',8);c.setFillColor(colors.HexColor('#546675'));c.drawString(42,25,'Ezkart · Synthetic authored labels · 28 September 2026');c.drawRightString(553,25,str(doc.page))
    SimpleDocTemplate(str(pdf),pagesize=(595.28,841.89),rightMargin=42,leftMargin=42,topMargin=38,bottomMargin=45).build(story,onFirstPage=footer,onLaterPages=footer)
    print(json.dumps({'pdf':str(pdf),'summary':summary,'metrics':str(out/'Jev-500-Metrics.json')},indent=2))
if __name__=='__main__':main()
