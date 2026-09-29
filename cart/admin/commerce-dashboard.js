(() => {
  const labels={creating:'Creating',pending:'Pending',paid:'Paid',failed:'Failed',expired:'Expired',cancelled:'Cancelled',partially_refunded:'Partially refunded',refunded:'Refunded'};
  const money=value=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(BigInt(value));
  const number=value=>Number(value).toLocaleString();
  const date=value=>window.EzkartAdminFormat.date(value,{time:false,calendar:true});
  const time=value=>window.EzkartAdminFormat.date(value);
  const el=(tag,text,cls='')=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node;};
  const dataEl=(tag,text)=>{const node=el(tag,text);node.setAttribute('translate','no');return node;};
  const svg=(tag,attrs={})=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));return node;};

  function drawChart(container,values,chart){
    container.replaceChildren();values.replaceChildren();
    const {buckets}=chart,maximum=buckets.reduce((n,b)=>BigInt(b.amount)>n?BigInt(b.amount):n,0n),divisor=maximum||1n;
    const style=getComputedStyle(container),width=Math.max(280,Math.round(container.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight))),left=85,right=width-15;
    const plot=svg('svg',{viewBox:`0 0 ${width} 228`,role:'img','aria-label':'Confirmed payments by order creation date. Exact values follow in the chart table.'});
    const points=buckets.map((b,i)=>[left+i/Math.max(1,buckets.length-1)*(right-left),180-Number(BigInt(b.amount)*15000n/divisor)/100]);
    for(let n=0;n<=3;n++){
      const y=30+n*50,amount=maximum*BigInt(3-n)/3n;
      plot.append(svg('line',{x1:left,x2:right,y1:y,y2:y,class:'chart-grid'}));
      const label=svg('text',{x:left-10,y:y+4,'text-anchor':'end',class:'chart-axis'});
      label.textContent=new Intl.NumberFormat('id-ID',{notation:'compact',maximumFractionDigits:1,style:'currency',currency:'IDR'}).format(amount);plot.append(label);
    }
    if(points.length===1)points.push([right,points[0][1]]);
    const path='M'+points.map(p=>p.join(' ')).join(' L');
    plot.append(svg('path',{d:path+` L${right} 180 L${left} 180 Z`,class:'chart-area'}),svg('path',{d:path,class:'chart-line'}));
    const count=Math.min(width<480?3:5,buckets.length),ticks=new Set(Array.from({length:count},(_,i)=>Math.round(i*(buckets.length-1)/Math.max(1,count-1))));
    buckets.forEach((b,i)=>{
      if(ticks.has(i)){
        const x=left+i/Math.max(1,buckets.length-1)*(right-left),label=svg('text',{x,y:205,'text-anchor':i===0?'start':i===buckets.length-1?'end':'middle',class:'chart-axis'});
        label.textContent=new Intl.DateTimeFormat(document.body.dataset.adminLanguage==='id'?'id-ID':'en-GB',{year:chart.group==='yearly'?'numeric':chart.group==='monthly'?'2-digit':undefined,month:chart.group==='yearly'?undefined:'short',day:['daily','weekly'].includes(chart.group)?'numeric':undefined,timeZone:'UTC'}).format(new Date(b.date+'T00:00:00Z'));plot.append(label);
      }
      const row=el('tr');row.append(el('td',date(b.date)),el('td',money(b.amount)),el('td',number(b.paidOrders)));values.append(row);
    });
    container.append(maximum===0n?el('p','No confirmed payments in this period.','commerce-dashboard-chart-empty'):plot);
  }

  function mount({request,products=[]}){
    const root=document.querySelector('[data-commerce-dashboard]');if(!root)return;
    const q=s=>root.querySelector(s),form=q('[data-dashboard-filters]'),report=q('[data-dashboard-report]'),preview=root.dataset.preview==='1';
    const photos=new Map();
    for(const product of products){const id=product.media?.[0]?.id;if(typeof id==='string'&&/^[a-zA-Z0-9_-]{1,96}$/.test(id))photos.set(product.id,id);}
    let version=0,applied={},last=null,chartWidth=0;
    const href=(options={})=>'?'+new URLSearchParams({page:'orders',...(preview?{'order-preview':'1'}:{}),...options});
    const status=text=>{q('[data-dashboard-status]').textContent=text;q('[data-dashboard-status]').hidden=!text;};
    function readUrl(){
      const url=new URL(location.href);for(const key of ['range','group']){
        const value=url.searchParams.get(key),select=form.elements[key];select.value=[...select.options].some(o=>o.value===value)?value:(key==='range'?'30':'daily');select.dispatchEvent(new Event('change',{bubbles:true}));
      }
      applied={range:form.elements.range.value,group:form.elements.group.value};
    }
    function writeUrl(push){
      const url=new URL(location.href);url.searchParams.set('range',applied.range);url.searchParams.set('group',applied.group);history[push?'pushState':'replaceState']({},'',url);
    }
    function list(container,items,empty,render){
      container.replaceChildren();for(const [i,item] of items.entries())container.append(render(item,i));if(!items.length)container.append(el('li',empty,'commerce-dashboard-empty'));
    }
    function amounts(container,items){container.replaceChildren();for(const [label,value] of items){const pair=el('div');pair.append(el('dt',label),el('dd',value));container.append(pair);}}
    function render(data){
      const {summary,period,operations,recent}=data,periodFilter={from:period.from,to:period.to};
      const enabled=data.enabled&&!preview;
      q('[data-dashboard-availability]').textContent=enabled?'':'Order processing is not enabled for this store yet.';q('[data-dashboard-availability]').hidden=enabled;
      for(const node of document.querySelectorAll('[data-order-total]'))node.textContent=number(operations.total);
      for(const node of root.querySelectorAll('[data-dashboard-orders]'))node.href=href();
      for(const node of root.querySelectorAll('[data-dashboard-period-orders]'))node.href=href(periodFilter);
      for(const node of root.querySelectorAll('[data-dashboard-queue]'))node.textContent=number(operations.queues[node.dataset.dashboardQueue]);
      for(const node of root.querySelectorAll('[data-dashboard-queue-link]'))node.href=href({queue:node.dataset.dashboardQueueLink});
      q('[data-dashboard-queue-note]').textContent=`${number(operations.total)} total orders · ${number(operations.queues.delivered)} delivered · ${number(operations.queues['not-required'])} delivery not required`;
      q('[data-dashboard-period]').textContent=`${date(period.from)} – ${date(period.to)} · ${data.environment==='sandbox'?'Sandbox':'Production'} · Order creation dates in Jakarta · Updated ${time(data.checkedAt)}`;
      for(const node of root.querySelectorAll('[data-dashboard-value]')){const key=node.dataset.dashboardValue;node.textContent=key.endsWith('Amount')?money(summary[key]):key==='paymentRate'?summary[key].toFixed(1)+'%':number(summary[key]);}
      q('[data-dashboard-chart-note]').textContent=`${data.chart.group[0].toUpperCase()+data.chart.group.slice(1)} totals by order date${data.chart.group!==data.chart.requestedGroup?' · Grouped for this history length':''}.`;
      const rows=q('[data-dashboard-recent]');rows.replaceChildren();
      for(const order of recent){
        const row=el('tr'),identity=el('td'),link=el('a',order.id);link.href=href({order:order.id});identity.append(link,dataEl('small',order.customerName||'Customer'));
        row.append(identity,dataEl('td',order.firstItem||'Order items'),el('td',labels[order.state]||order.state),el('td',money(order.total)),el('td',time(order.createdAt)));rows.append(row);
      }
      if(!recent.length){const row=el('tr'),cell=el('td','No orders in this period.','commerce-dashboard-empty');cell.colSpan=5;row.append(cell);rows.append(row);}
      const ranked=(item,i,showMoney)=>{const row=el('li'),info=el('div');info.append(dataEl('b',item.title),el('small',number(item.quantity)+' units'));row.append(el('span',i+1,'commerce-dashboard-rank'));
        if(photos.has(item.id)){const image=el('img');image.src='./?cloud='+encodeURIComponent('/v1/media/'+photos.get(item.id));image.alt='';image.title='Current catalog image';image.loading='lazy';image.width=36;image.height=36;image.addEventListener('error',()=>image.hidden=true);row.append(image);}
        row.append(info);if(showMoney)row.append(el('strong',money(item.amount)));return row;};
      list(q('[data-dashboard-products]'),data.topProducts,'No paid product sales in this period.',(item,i)=>ranked(item,i,true));
      list(q('[data-dashboard-catalog]'),data.catalogActivity,'No product orders in this period.',(item,i)=>ranked(item,i,false));
      q('[data-dashboard-paid-units]').textContent=number(summary.paidUnits)+' paid units';q('[data-dashboard-ordered-units]').textContent=number(summary.orderedUnits)+' units ordered';
      list(q('[data-dashboard-states]'),Object.entries(data.statuses),'No orders.',([state,count])=>{const row=el('li'),link=el('a'),bar=el('i'),fill=el('span');link.href=href({...periodFilter,state});link.append(el('span',labels[state]),el('b',number(count)));fill.style.width=(summary.orders?count/summary.orders*100:0)+'%';bar.append(fill);row.append(link,bar);return row;});
      amounts(q('[data-dashboard-amounts]'),[['Paid products',money(summary.productAmount)],['Paid shipping',money(summary.shippingAmount)],['Awaiting payment',money(summary.pendingAmount)],['Failed or expired',money(summary.failedAmount)],['Cancelled orders',money(summary.cancelledAmount)]]);
      list(q('[data-dashboard-activity]'),recent.slice(0,4),'No customer activity in this period.',order=>{const row=el('li'),link=dataEl('a',order.customerName||'Customer');link.href=href({order:order.id});row.append(link,el('small','Order placed · '+(labels[order.state]||order.state)),el('time',time(order.createdAt)));return row;});
      amounts(q('[data-dashboard-fulfillment]'),[['Orders in period',number(summary.orders)],['Orders with verified payment',number(summary.paidOrders)],['Courier bookings',number(summary.bookedOrders)],['Latest order destination',recent[0]?.destination||'No destination recorded']]);
      report.hidden=false;
      drawChart(q('[data-dashboard-chart]'),q('[data-dashboard-chart-values]'),data.chart);chartWidth=q('[data-dashboard-chart]').clientWidth;
    }
    async function load(push=false){
      const current=++version,params={...applied};root.setAttribute('aria-busy','true');status(last?'Updating performance…':'Loading performance…');
      try{
        const data=await request('GET','/v1/commerce/dashboard?'+new URLSearchParams(params),undefined,{timeoutMs:15000});if(current!==version)return;
        if(!data.summary||!Array.isArray(data.chart?.buckets)||!Array.isArray(data.recent))throw Error('The dashboard response was incomplete.');
        render(data);last=data;writeUrl(push);status('');
      }catch(error){if(current===version)status(error.message+' Use Refresh to try again.'+(last?' The last loaded report is still shown with its original dates.':''));}
      finally{if(current===version)root.setAttribute('aria-busy','false');}
    }
    form.addEventListener('submit',event=>{event.preventDefault();applied={range:form.elements.range.value,group:form.elements.group.value};void load(true);});
    q('[data-dashboard-refresh]').addEventListener('click',()=>void load());
    addEventListener('popstate',()=>{readUrl();void load();});
    if('ResizeObserver' in window)new ResizeObserver(()=>{
      const container=q('[data-dashboard-chart]');if(last&&Math.abs(chartWidth-container.clientWidth)>1){chartWidth=container.clientWidth;drawChart(container,q('[data-dashboard-chart-values]'),last.chart);}
    }).observe(q('[data-dashboard-chart]'));
    const search=document.getElementById('global-search');if(search){search.placeholder='Search orders · press Enter';search.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();location.href=href({q:search.value.trim()});}});}
    readUrl();void load();
  }
  globalThis.EzkartCommerceDashboard={mount};
})();
