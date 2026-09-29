(() => {
 'use strict';
 const input=document.querySelector('[data-birth-date]');if(!input)return;
 const id=document.body.dataset.adminLanguage==='id',locale=id?'id-ID':'en-GB';
 const t=(en,ind)=>id?ind:en;
 const field=input.closest('.birth-date-field'),trigger=field.querySelector('button');
 const today=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Jakarta'})),year=today.getFullYear();
 let shownYear=year-18,month=today.getMonth(),focusDay=1;
 const dialog=document.createElement('dialog');dialog.className='birth-date-dialog';dialog.setAttribute('aria-labelledby','birth-date-title');
 dialog.innerHTML=`<header><h2 id="birth-date-title">${t('Choose your date of birth','Pilih tanggal lahirmu')}</h2><button type="button" data-close aria-label="${t('Close calendar','Tutup kalender')}">×</button></header><div class="birth-date-selectors"><label>${t('Month','Bulan')}<select data-month aria-label="${t('Birth month','Bulan lahir')}"></select></label><label>${t('Year','Tahun')}<select data-year aria-label="${t('Birth year','Tahun lahir')}"></select></label></div><div class="birth-date-weekdays" aria-hidden="true"></div><div class="birth-date-days" role="group" aria-label="${t('Choose a day','Pilih tanggal')}"></div><footer><button type="button" data-clear>${t('Clear date','Hapus tanggal')}</button><button type="button" data-cancel>${t('Cancel','Batal')}</button></footer>`;
 document.body.append(dialog);
 const months=dialog.querySelector('[data-month]'),years=dialog.querySelector('[data-year]'),days=dialog.querySelector('.birth-date-days');
 for(let m=0;m<12;m++)months.add(new Option(new Intl.DateTimeFormat(locale,{month:'long'}).format(new Date(2000,m,1)),String(m)));
 for(let y=year;y>=year-120;y--)years.add(new Option(String(y),String(y)));
 for(let d=0;d<7;d++){const span=document.createElement('span');span.textContent=new Intl.DateTimeFormat(locale,{weekday:'narrow'}).format(new Date(2024,0,1+d));dialog.querySelector('.birth-date-weekdays').append(span);}
 const iso=(y,m,d)=>`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
 function valid(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value;}
 function validate(){input.setCustomValidity(input.value&&!valid(input.value)?t('Enter a valid date as YYYY-MM-DD.','Masukkan tanggal yang valid dengan format YYYY-MM-DD.'):'');}
 function render(focus=false){months.value=String(month);years.value=String(shownYear);days.replaceChildren();const count=new Date(shownYear,month+1,0).getDate(),offset=(new Date(shownYear,month,1).getDay()+6)%7;focusDay=Math.min(focusDay,count);
  for(let n=0;n<offset;n++){const blank=document.createElement('span');days.append(blank);}
  for(let d=1;d<=count;d++){const date=iso(shownYear,month,d),button=document.createElement('button');button.type='button';button.textContent=String(d);button.dataset.day=String(d);button.disabled=date>iso(year,today.getMonth(),today.getDate());button.tabIndex=d===focusDay?0:-1;button.setAttribute('aria-label',new Intl.DateTimeFormat(locale,{day:'numeric',month:'long',year:'numeric'}).format(new Date(shownYear,month,d)));button.setAttribute('aria-pressed',String(input.value===date));button.addEventListener('click',()=>{input.value=date;validate();input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));close();});days.append(button);}
  if(focus)days.querySelector(`[data-day="${focusDay}"]`)?.focus();
 }
 function close(){dialog.close();trigger.setAttribute('aria-expanded','false');trigger.focus();}
 trigger.addEventListener('click',()=>{if(valid(input.value)){const parts=input.value.split('-').map(Number);shownYear=parts[0];month=parts[1]-1;focusDay=parts[2];}else{shownYear=year-18;month=today.getMonth();focusDay=1;}render();dialog.showModal();trigger.setAttribute('aria-expanded','true');});
 months.addEventListener('change',()=>{month=Number(months.value);render();});years.addEventListener('change',()=>{shownYear=Number(years.value);render();});
 days.addEventListener('keydown',event=>{const current=event.target.closest('[data-day]');if(!current)return;const moves={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};if(!(event.key in moves))return;event.preventDefault();const next=new Date(shownYear,month,Number(current.dataset.day)+moves[event.key]);if(next.getFullYear()<year-120||next>today)return;shownYear=next.getFullYear();month=next.getMonth();focusDay=next.getDate();render(true);});
 dialog.querySelector('[data-close]').addEventListener('click',close);dialog.querySelector('[data-cancel]').addEventListener('click',close);dialog.querySelector('[data-clear]').addEventListener('click',()=>{input.value='';validate();input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));close();});
 dialog.addEventListener('cancel',()=>trigger.setAttribute('aria-expanded','false'));dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}});input.addEventListener('input',validate);
})();
