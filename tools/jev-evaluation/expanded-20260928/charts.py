import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from pathlib import Path
C={'good':'#187E78','bad':'#CF5145','human':'#C89131','ink':'#172E45','light':'#DCE6EA','muted':'#687987','blue':'#547BA3'}
plt.rcParams.update({'font.family':'Liberation Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'axes.edgecolor':'#BCC8CE','axes.labelcolor':C['ink'],'text.color':C['ink'],'xtick.color':C['muted'],'ytick.color':C['muted'],'figure.facecolor':'white','axes.facecolor':'white','savefig.facecolor':'white'})
def charts(d,out):
    out=Path(out);out.mkdir(parents=True,exist_ok=True);r=d['results'];s=d['summary']
    def save(name,fig):
        fig.savefig(out/(name+'.png'),dpi=190,bbox_inches='tight');fig.savefig(out/(name+'.pdf'),bbox_inches='tight');plt.close(fig)
    fig,ax=plt.subplots(figsize=(8,2.6));vals=[s['usableCorrect'],s['acceptedWrong'],s['rejected'],s['unconfirmed']];labs=['Accepted + correct','Accepted but wrong','Rejected answer','Unknown outcome'];colors=[C['good'],C['bad'],C['human'],C['muted']]
    y=np.arange(4);ax.barh(y,vals,color=colors,height=.62);ax.set_yticks(y,labs);ax.invert_yaxis();ax.set_xlim(0,max(vals)*1.2+1);ax.set_xlabel('Cases out of 120')
    for i,v in enumerate(vals):ax.text(v+.8,i,f'{v}  ({v/120:.1%})',va='center',fontsize=10,fontweight='bold')
    ax.grid(axis='x',alpha=.15);ax.set_axisbelow(True);fig.tight_layout();save('outcomes',fig)
    labels=['No violation','Violation','Human review'];vs=['clear','needs_change','escalate'];fig,axes=plt.subplots(1,2,figsize=(9,4.3))
    for ax,key,title in [(axes[0],'raw','Accepted model answers'),(axes[1],'decision','Application routing')]:
        cols=vs+(['rejected'] if key=='raw' else []);mat=np.zeros((3,len(cols)),dtype=int)
        for x in r:
            col=(x['rawOutcome']['verdict'] if x['state']=='accepted' else 'rejected') if key=='raw' else x['decisionVerdict'];mat[vs.index(x['expected']['verdict']),cols.index(col)]+=1
        ax.imshow(mat,cmap='Blues',vmin=0,vmax=40);ax.set_xticks(range(len(cols)),labels+(['Rejected /\nunknown'] if key=='raw' else []),rotation=30,ha='right',fontsize=8);ax.set_yticks(range(3),labels,fontsize=9);ax.set_ylabel('Expected answer' if key=='raw' else '');ax.set_title(title,fontsize=12,pad=12)
        for i in range(3):
            for j in range(len(cols)):ax.text(j,i,str(mat[i,j]),ha='center',va='center',color='white' if mat[i,j]>20 else C['ink'],fontsize=15,fontweight='bold')
    fig.tight_layout(w_pad=2);save('confusion',fig)
    fig,ax=plt.subplots(figsize=(8.5,3.6));bins=d['bins'];x=np.arange(len(bins));width=.25
    for delta,key,label,color in [(-width,'meanConfidence','Average claimed confidence',C['blue']),(0,'rawAgreement','Verdict matches expected answer',C['good']),(width,'usableCorrect','Accepted + correct answer',C['human'])]:
        vals=[100*(b[key] or 0) for b in bins];ax.bar(x+delta,vals,width,label=label,color=color)
        for xx,val,b in zip(x+delta,vals,bins):
            if b['n']:ax.text(xx,val+1.5,f'{val:.0f}',ha='center',fontsize=7)
    ax.set_xticks(x,[f"{b['label']}\nn = {b['n']}" for b in bins]);ax.set_ylim(0,117);ax.set_ylabel('Percent');ax.legend(loc='lower center',bbox_to_anchor=(.5,1.01),ncol=3,fontsize=8,frameon=False);ax.grid(axis='y',alpha=.15);ax.set_axisbelow(True);fig.tight_layout();save('calibration',fig)
    fig,ax=plt.subplots(figsize=(8.5,2.5));distinct=sorted(set(x['confidence'] for x in r if x['confidence'] is not None));x=np.arange(len(distinct));bottom=np.zeros(len(x))
    for label,fn,col in [('Accepted + correct',lambda r:r['usableCorrect'],C['good']),('Accepted but wrong',lambda r:r['state']=='accepted' and not r['verdictMatch'],C['bad']),('Rejected / unknown',lambda r:r['state']!='accepted',C['human'])]:
        vals=np.array([sum(t['confidence']==p and fn(t) for t in r) for p in distinct]);ax.bar(x,vals,bottom=bottom,label=label,color=col,width=.65);bottom+=vals
    ax.set_xticks(x,[f'{p:.0%}' for p in distinct]);ax.set_xlabel('Confidence returned by Jev');ax.set_ylabel('Cases');ax.legend(ncol=3,fontsize=8,frameon=False,loc='upper center',bbox_to_anchor=(.5,1.15));ax.grid(axis='y',alpha=.15);ax.set_axisbelow(True);fig.tight_layout();save('confidence-counts',fig)
    fig,ax=plt.subplots(figsize=(8.5,2.9));th=d['thresholds'];x=np.arange(len(th));ax.bar(x-.22,[t['automatic'] for t in th],.4,label='Automatic decisions',color=C['good']);ax.bar(x+.22,[t['humanReview'] for t in th],.4,label='Human review',color=C['human']);ax.plot(x,[t['wrongAutomatic'] for t in th],color=C['bad'],marker='o',label='Wrong automatic decisions')
    for i,t in enumerate(th):
        ax.text(i-.22,t['automatic']+2,str(t['automatic']),ha='center',fontsize=9);ax.text(i+.22,t['humanReview']+2,str(t['humanReview']),ha='center',fontsize=9)
    ax.set_xticks(x,[f"{t['threshold']:.0%}" for t in th]);ax.set_xlabel('Minimum confidence, keeping all other safeguards');ax.set_ylabel('Cases');ax.set_ylim(0,130);ax.legend(ncol=3,fontsize=8,frameon=False,loc='upper center',bbox_to_anchor=(.5,1.17));ax.grid(axis='y',alpha=.15);ax.set_axisbelow(True);fig.tight_layout();save('thresholds',fig)
    fig,ax=plt.subplots(figsize=(8.5,2.8));langs=['en','id'];x=np.arange(2);bottom=np.zeros(2)
    for label,fn,col in [('Accepted + correct',lambda r:r['usableCorrect'],C['good']),('Accepted but wrong',lambda r:r['state']=='accepted' and not r['verdictMatch'],C['bad']),('Rejected / unknown',lambda r:r['state']!='accepted',C['human'])]:
        vals=np.array([sum(t['language']==l and fn(t) for t in r) for l in langs]);ax.barh(x,vals,left=bottom,label=label,color=col,height=.48)
        for i,v in enumerate(vals):
            if v:ax.text(bottom[i]+v/2,i,str(v),ha='center',va='center',color='white',fontweight='bold')
        bottom+=vals
    ax.set_yticks(x,['English (60)','Indonesian (60)']);ax.invert_yaxis();ax.set_xlim(0,60);ax.set_xlabel('Cases');ax.legend(ncol=3,fontsize=8,frameon=False,loc='upper center',bbox_to_anchor=(.5,1.2));fig.tight_layout();save('language',fig)
    families=list(dict.fromkeys(t['family'] for t in r));families.sort(key=lambda f:(next(x['expected']['verdict'] for x in r if x['family']==f),f));fig,ax=plt.subplots(figsize=(8.5,8));y=np.arange(len(families));bottom=np.zeros(len(y))
    for label,fn,col in [('Accepted + correct',lambda r:r['usableCorrect'],C['good']),('Accepted but wrong',lambda r:r['state']=='accepted' and not r['verdictMatch'],C['bad']),('Rejected / unknown',lambda r:r['state']!='accepted',C['human'])]:
        vals=np.array([sum(t['family']==f and fn(t) for t in r) for f in families]);ax.barh(y,vals,left=bottom,label=label,color=col,height=.64);bottom+=vals
    ax.set_yticks(y,[f.replace('-',' ').capitalize() for f in families],fontsize=8);ax.invert_yaxis();ax.set_xticks(range(5));ax.set_xlabel('Four cases per family');ax.legend(ncol=3,fontsize=8,frameon=False,loc='upper center',bbox_to_anchor=(.5,1.05));fig.tight_layout();save('families',fig)
