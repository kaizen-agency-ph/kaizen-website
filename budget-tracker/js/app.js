// ============================================================
// Budget Buddy — the tracker app.
// Exposed as window.startBudgetApp() and called by the auth module in
// dashboard.html AFTER the account is verified and its cloud data has been
// seeded into localStorage. save() mirrors every change up to Firestore via
// window.__cloudSaveBudget (set by the auth module).
// ============================================================
window.startBudgetApp = function(){
  "use strict";
  const LS_KEY = "kaizen_budget_tracker_v1";
  const CURRENCIES = [
    {code:"USD",sym:"$",name:"US Dollar"},
    {code:"PHP",sym:"₱",name:"Philippine Peso"},
    {code:"EUR",sym:"€",name:"Euro"},
    {code:"GBP",sym:"£",name:"British Pound"},
    {code:"JPY",sym:"¥",name:"Japanese Yen"},
    {code:"INR",sym:"₹",name:"Indian Rupee"},
    {code:"CAD",sym:"C$",name:"Canadian Dollar"},
    {code:"AUD",sym:"A$",name:"Australian Dollar"}
  ];
  const DEFAULT_CATS = ["Groceries","Rent","Utilities","Transport","Dining","Health","Shopping","Entertainment","Salary","Other"];
  const CAT_ICONS = {groceries:"🛒",rent:"🏠",mortgage:"🏠",utilities:"💡",electric:"💡",water:"💧",internet:"🌐",phone:"📱",transport:"🚌",gas:"⛽",fuel:"⛽",car:"🚗",dining:"🍽️",food:"🍔",coffee:"☕",health:"💊",medical:"🏥",gym:"🏋️",fitness:"🏋️",shopping:"🛍️",clothes:"👕",entertainment:"🎬",games:"🎮",music:"🎵",salary:"💰",income:"💰",freelance:"💻",savings:"🌱",travel:"✈️",education:"📚",books:"📚",gifts:"🎁",gift:"🎁",subscriptions:"🔁",pets:"🐾",kids:"🧸",home:"🛋️",insurance:"🛡️",tax:"🧾",taxes:"🧾",other:"📦"};
  const CAT_PALETTE = ["#6C63FF","#FF8A5B","#2FB89B","#F5B14C","#FF6B6B","#A78BFA","#22C7E0","#FF9EC4","#5CC98A","#9AA6C4","#F58BB0","#4FB0FF"];

  const CHANGE_THRESHOLD = 8;
  let state = load() || { currency:null, theme:"light", transactions:[], budgets:{}, recurring:[], hiddenCategories:[], members:[], banks:[], savings:[], bills:[], billsPaid:{}, changesSinceBackup:0, lastFilter:null, lastBackup:null };
  if(!state.theme) state.theme="light";
  if(!Array.isArray(state.recurring)) state.recurring=[];
  if(!Array.isArray(state.hiddenCategories)) state.hiddenCategories=[];
  if(!Array.isArray(state.members)) state.members=[];
  if(!Array.isArray(state.banks)) state.banks=[];
  if(!Array.isArray(state.savings)) state.savings=[];
  if(!Array.isArray(state.bills)) state.bills=[];
  if(!state.billsPaid||typeof state.billsPaid!=="object") state.billsPaid={};
  if(typeof state.onboarded!=="boolean") state.onboarded = !!state.currency;
  if(typeof state.changesSinceBackup!=="number") state.changesSinceBackup=0;
  let editingId=null, pendingType="expense", pendingKind="deposit", flowChart, catChart, savingsChart, nudgeDismissed=false, lastDeleted=null, obBanks=[], trivialSave=false, ready=false;

  function load(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)); }catch(e){ return null; } }
  function save(){
    if(!trivialSave){ state.changesSinceBackup=(state.changesSinceBackup||0)+1; }
    const json=JSON.stringify(state);
    localStorage.setItem(LS_KEY, json);
    if(window.__cloudSaveBudget) window.__cloudSaveBudget(json); // sync to Firestore
    if(ready && !trivialSave) renderNudge();
  }
  function saveMeta(){ const p=trivialSave; trivialSave=true; save(); trivialSave=p; }
  function cur(){ return CURRENCIES.find(c=>c.code===state.currency) || CURRENCIES[0]; }
  function fmt(n){
    const c=cur(), v=Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
    return (n<0?"-":"") + c.sym + v;
  }
  function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
  function monthKey(d){ return d.slice(0,7); }
  function monthName(key){ const [y,m]=key.split("-"); return new Date(y,m-1,1).toLocaleString(undefined,{month:"short",year:"numeric"}); }
  const el = id => document.getElementById(id);
  function esc(s){ return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
  function toISO(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }

  function toast(msg, actionLabel, actionFn){
    const t=el("toast");
    t.innerHTML = "<span>"+esc(msg)+"</span>";
    if(actionLabel){
      const b=document.createElement("button"); b.textContent=actionLabel;
      b.onclick=()=>{ t.classList.remove("show"); actionFn&&actionFn(); };
      t.appendChild(b);
    }
    t.classList.add("show");
    clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove("show"), actionLabel?5200:2200);
  }

  // ---- Category helpers ----
  function iconFor(cat){
    const k=cat.toLowerCase().trim();
    if(CAT_ICONS[k]) return CAT_ICONS[k];
    for(const key in CAT_ICONS){ if(k.includes(key)) return CAT_ICONS[key]; }
    return "📦";
  }
  function colorFor(cat){
    let h=0; const s=cat.toLowerCase();
    for(let i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))>>>0; }
    return CAT_PALETTE[h%CAT_PALETTE.length];
  }
  function knownCategories(){
    const used=new Set();
    state.transactions.forEach(t=>used.add(t.category));
    Object.keys(state.budgets).forEach(c=>used.add(c));
    state.recurring.forEach(r=>used.add(r.category));
    const hidden=new Set((state.hiddenCategories||[]).map(c=>c.toLowerCase()));
    const set=new Set(used);
    DEFAULT_CATS.forEach(c=>{ if(!hidden.has(c.toLowerCase())) set.add(c); });
    return [...set];
  }
  function unhide(cat){
    if(!state.hiddenCategories) return;
    state.hiddenCategories=state.hiddenCategories.filter(c=>c.toLowerCase()!==cat.toLowerCase());
  }
  function canonicalCategory(name){
    const t=(name||"").trim(); if(!t) return "Other";
    const match=knownCategories().find(c=>c.toLowerCase()===t.toLowerCase());
    return match||t;
  }
  function allCategories(){ return [...new Set(knownCategories())].sort(); }

  // ---- Recurring generation ----
  function nextDate(rule){
    const d=new Date(rule.lastDate+"T00:00:00");
    if(rule.freq==="weekly"){ d.setDate(d.getDate()+7); return d; }
    if(rule.freq==="biweekly"){ d.setDate(d.getDate()+14); return d; }
    let y=d.getFullYear(), m=d.getMonth()+1;
    if(m>11){ m-=12; y++; }
    const dim=new Date(y,m+1,0).getDate();
    return new Date(y,m,Math.min(rule.anchorDay||d.getDate(),dim));
  }
  function runRecurring(){
    const today=new Date(); today.setHours(0,0,0,0);
    let added=false;
    state.recurring.forEach(rule=>{
      let guard=0;
      while(guard++<600){
        const nd=nextDate(rule); nd.setHours(0,0,0,0);
        if(nd<=today){
          state.transactions.push({id:uid(),type:rule.type,amount:rule.amount,category:rule.category,note:rule.note||"",date:toISO(nd),created:Date.now(),recurringId:rule.id});
          rule.lastDate=toISO(nd); added=true;
        } else break;
      }
    });
    if(added) saveMeta();
  }

  // ---- Filters (persisted) ----
  function currentFilters(){
    return { search:el("search").value.trim().toLowerCase(), month:el("filterMonth").value, type:el("filterType").value, cat:el("filterCat").value };
  }
  function saveFilters(){
    state.lastFilter={ search:el("search").value, month:el("filterMonth").value, type:el("filterType").value, cat:el("filterCat").value };
    saveMeta();
  }
  function restoreFilters(){
    const f=state.lastFilter; if(!f) return;
    if(el("filterMonth").querySelector(`option[value="${f.month}"]`)) el("filterMonth").value=f.month;
    if(el("filterCat").querySelector(`option[value="${CSS.escape?CSS.escape(f.cat):f.cat}"]`)) el("filterCat").value=f.cat;
    el("filterType").value=f.type||"";
    el("search").value=f.search||"";
  }
  function filtered(){
    const f=currentFilters();
    return state.transactions.filter(t=>{
      if(f.month && monthKey(t.date)!==f.month) return false;
      if(f.type && t.type!==f.type) return false;
      if(f.cat && t.category!==f.cat) return false;
      if(f.search){ if(!((t.category+" "+(t.note||"")).toLowerCase().includes(f.search))) return false; }
      return true;
    }).sort((a,b)=> b.date.localeCompare(a.date) || b.created-a.created);
  }

  // ---- Totals over a specific month key ----
  function monthTotals(mk){
    let inc=0, exp=0;
    state.transactions.forEach(t=>{ if(monthKey(t.date)===mk){ if(t.type==="income")inc+=t.amount; else exp+=t.amount; } });
    return {inc,exp};
  }
  function prevMonthKey(mk){ const [y,m]=mk.split("-").map(Number); const d=new Date(y,m-2,1); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); }

  // ---- Mood buddy ----
  function setMood(rate, hasData){
    const mouth=el("buddyMouth"), greet=el("greeting"), line=el("moodLine");
    const hour=new Date().getHours();
    const tod=hour<12?"Good morning":hour<18?"Good afternoon":"Good evening";
    if(!hasData){ mouth.setAttribute("d","M50 90 Q60 96 70 90"); greet.textContent=tod+" 👋"; line.textContent="Let's start tracking your money."; return; }
    if(rate>=20){ mouth.setAttribute("d","M48 88 Q60 100 72 88"); greet.textContent=tod+"!"; line.textContent="Nice — you're saving well. 🌱"; }
    else if(rate>=0){ mouth.setAttribute("d","M50 91 Q60 96 70 91"); greet.textContent=tod+"."; line.textContent="Steady as you go. Keep it up."; }
    else { mouth.setAttribute("d","M50 94 Q60 86 70 94"); greet.textContent="Heads up 👀"; line.textContent="Spending's ahead of income this period."; }
  }

  // ---- Renders ----
  function renderStats(){
    const list=filtered();
    let inc=0, exp=0, incN=0, expN=0;
    list.forEach(t=>{ if(t.type==="income"){inc+=t.amount;incN++;} else {exp+=t.amount;expN++;} });
    const savingsOut=savingsOutflow(el("filterMonth").value||null);
    const bal=inc-exp-savingsOut;
    el("balance").textContent=fmt(bal);
    el("balance").style.color = bal>=0 ? "var(--ink)" : "var(--coral)";
    el("income").textContent=fmt(inc);
    el("expenses").textContent=fmt(exp);
    el("incomeCount").textContent=incN+" transaction"+(incN===1?"":"s");
    el("expenseCount").textContent=expN+" transaction"+(expN===1?"":"s");
    const rate=inc>0?Math.round((bal/inc)*100):0;
    el("savings").textContent=inc>0?rate+"%":"—";
    el("savings").className="value num "+(rate>=0?"up":"down");
    const f=currentFilters();
    el("periodLabel").textContent=f.month?monthName(f.month):"All time";
    el("balLabel").textContent=f.month?monthName(f.month)+" balance":"Balance";
    setMood(rate, list.length>0);
    renderTrends();
  }

  function renderTrends(){
    const f=currentFilters();
    const mk = f.month || new Date().toISOString().slice(0,7);
    const pk = prevMonthKey(mk);
    const now=monthTotals(mk), prev=monthTotals(pk);
    setTrend("incomeTrend", now.inc, prev.inc, true);
    setTrend("expenseTrend", now.exp, prev.exp, false);
  }
  function setTrend(id, cur, prev, upIsGood){
    const node=el(id);
    if(prev<=0){ node.textContent=""; node.className="trend"; return; }
    const pct=Math.round((cur-prev)/prev*100);
    if(pct===0){ node.textContent="0% vs last mo"; node.className="trend flat"; return; }
    const up=pct>0;
    const good = upIsGood ? up : !up;
    node.textContent=(up?"↑":"↓")+Math.abs(pct)+"% vs last mo";
    node.className="trend "+(good?"good":"bad");
  }

  function renderSafeToSpend(){
    const line=el("safeLine");
    const totalBudget=Object.values(state.budgets).reduce((a,b)=>a+b,0);
    if(totalBudget<=0){ line.hidden=true; return; }
    const now=new Date();
    const mk=now.toISOString().slice(0,7);
    let spent=0;
    state.transactions.forEach(t=>{ if(t.type==="expense" && monthKey(t.date)===mk) spent+=t.amount; });
    const remaining=totalBudget-spent;
    const daysInMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    const daysLeft=Math.max(1, daysInMonth-now.getDate()+1);
    line.hidden=false;
    if(remaining<0){
      line.classList.add("tight");
      line.innerHTML=`⚠️ You're <span class="amt">${fmt(Math.abs(remaining))}</span> over this month's budgets`;
      return;
    }
    // Cap what's "safe" by the money actually available (overall balance, net of savings set aside)
    let inc=0, exp=0;
    state.transactions.forEach(t=>{ if(t.type==="income") inc+=t.amount; else exp+=t.amount; });
    const balance=inc-exp-savingsOutflow(null);
    const safe=Math.max(0, Math.min(remaining, balance));
    const daily=safe>0?safe/daysLeft:0;
    const capped=balance<remaining;
    line.classList.toggle("tight", safe===0);
    if(safe===0){
      line.innerHTML=`⚠️ No balance left to spend safely this month`;
    }else{
      line.innerHTML=`💸 Safe to spend this month: <span class="amt">${fmt(safe)}</span><span class="sep">·</span> about <span class="amt">${fmt(daily)}</span>/day${capped?` <span class="sep">·</span> <span style="color:var(--muted);font-weight:600">capped to your balance</span>`:""}`;
    }
  }

  function renderTx(){
    const list=filtered();
    el("txCount").textContent=list.length?list.length+" shown":"";
    const box=el("txContainer");
    if(!list.length){ box.innerHTML='<div class="empty"><span class="em">🗒️</span>No transactions yet.<br>Tap “＋ Add” to log your first one.</div>'; return; }
    const rows=list.map(t=>{
      const sign=t.type==="income"?"+":"-";
      const cls=t.type==="income"?"up":"down";
      const d=new Date(t.date).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});
      const rec=t.recurringId?'<span class="rec" title="Recurring">🔁</span>':"";
      return `<tr>
        <td data-label="Date">${d}</td>
        <td data-label="Category"><span class="pill"><span class="pdot" style="background:${colorFor(t.category)}"></span>${iconFor(t.category)} ${esc(t.category)} ${rec}</span>${t.note?`<div style="font-size:12px;color:var(--muted);margin-top:4px;font-weight:600">${esc(t.note)}</div>`:""}</td>
        <td class="amt ${cls}" data-label="Amount">${sign}${fmt(t.amount).replace("-","")}</td>
        <td data-label="Actions" style="text-align:right;white-space:nowrap">
          <button class="row-btn" data-edit="${t.id}">Edit</button>
          <button class="row-btn del" data-del="${t.id}">✕</button>
        </td>
      </tr>`;
    }).join("");
    box.innerHTML=`<table><thead><tr><th>Date</th><th>Category</th><th style="text-align:right">Amount</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    box.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>delTx(b.dataset.del));
    box.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openTxModal(b.dataset.edit));
  }

  function renderBudgets(){
    const f=currentFilters();
    const mk=f.month || new Date().toISOString().slice(0,7);
    el("budgetMonthLabel").textContent=monthName(mk);
    const spent={};
    state.transactions.forEach(t=>{ if(t.type==="expense" && monthKey(t.date)===mk){ spent[t.category]=(spent[t.category]||0)+t.amount; } });
    const cats=Object.keys(state.budgets);
    const box=el("budgetContainer");
    if(!cats.length){ box.innerHTML='<div class="empty"><span class="em">🎯</span>No budgets yet.<br>Tap “🎯 Budgets” to set limits.</div>'; return; }
    box.innerHTML=cats.map(c=>{
      const limit=state.budgets[c], used=spent[c]||0;
      const pct=limit>0?Math.min(100,(used/limit)*100):0;
      const over=used>limit;
      const color=over?"var(--coral)":pct>80?"var(--honey)":"var(--mint)";
      const note = over
        ? `<div class="budget-note over">Over by ${fmt(used-limit)}</div>`
        : `<div class="budget-note ok">${fmt(limit-used)} left · ${Math.round(pct)}% used</div>`;
      return `<div class="budget-row">
        <div class="top">
          <span class="cat-name"><span class="ico">${iconFor(c)}</span>${esc(c)}</span>
          <span class="${over?"over":""}">${fmt(used)} / ${fmt(limit)}</span>
        </div>
        <div class="bar"><span style="width:${pct}%;background:${color}"></span></div>
        ${note}
      </div>`;
    }).join("");
  }

  function renderCharts(){
    const f=currentFilters();
    const byMonth={};
    state.transactions.forEach(t=>{ const k=monthKey(t.date); byMonth[k]=byMonth[k]||{income:0,expense:0}; byMonth[k][t.type]+=t.amount; });
    let months=Object.keys(byMonth).sort();
    if(f.month) months=months.filter(m=>m===f.month);
    months=months.slice(-6);
    const flowData={ labels:months.map(monthName), income:months.map(m=>byMonth[m].income), expense:months.map(m=>byMonth[m].expense) };
    el("flowLabel").textContent=months.length?`last ${months.length} mo`:"no data";

    const css=getComputedStyle(document.body);
    const txt=css.getPropertyValue("--muted").trim();
    const grid=css.getPropertyValue("--border").trim();
    const incC=css.getPropertyValue("--mint").trim();
    const expC=css.getPropertyValue("--coral").trim();
    Chart.defaults.font.family="'Plus Jakarta Sans', sans-serif";

    if(flowChart) flowChart.destroy();
    flowChart=new Chart(el("flowChart"),{
      type:"bar",
      data:{ labels:flowData.labels, datasets:[
        {label:"Income",data:flowData.income,backgroundColor:incC,borderRadius:8,maxBarThickness:26},
        {label:"Expense",data:flowData.expense,backgroundColor:expC,borderRadius:8,maxBarThickness:26}
      ]},
      options:{responsive:true,plugins:{legend:{labels:{color:txt,usePointStyle:true,pointStyle:"circle",boxWidth:8,font:{weight:700}}},
        tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${fmt(c.parsed.y)}`}}},
        scales:{x:{ticks:{color:txt,font:{weight:700}},grid:{display:false}},
          y:{ticks:{color:txt,callback:v=>cur().sym+v},grid:{color:grid}}}}
    });

    const catTotals={};
    filtered().forEach(t=>{ if(t.type==="expense") catTotals[t.category]=(catTotals[t.category]||0)+t.amount; });
    const cats=Object.keys(catTotals).sort((a,b)=>catTotals[b]-catTotals[a]);

    const totalExp=cats.reduce((a,c)=>a+catTotals[c],0);
    el("catChart").setAttribute("aria-label", cats.length
      ? `Spending by category. Largest: ${cats[0]} at ${fmt(catTotals[cats[0]])} of ${fmt(totalExp)} total.`
      : "Spending by category. No expenses in view yet.");
    const lastM=months[months.length-1];
    el("flowChart").setAttribute("aria-label", months.length
      ? `Cash flow over ${months.length} month${months.length>1?"s":""}. ${monthName(lastM)}: income ${fmt(byMonth[lastM].income)}, expenses ${fmt(byMonth[lastM].expense)}.`
      : "Cash flow chart. No data yet.");

    if(catChart) catChart.destroy();
    if(cats.length){
      catChart=new Chart(el("catChart"),{
        type:"doughnut",
        data:{labels:cats,datasets:[{data:cats.map(c=>catTotals[c]),backgroundColor:cats.map(colorFor),borderWidth:3,borderColor:css.getPropertyValue("--surface").trim()}]},
        options:{responsive:true,cutout:"64%",plugins:{legend:{position:"right",labels:{color:txt,boxWidth:11,padding:11,font:{size:11.5,weight:700}}},
          tooltip:{callbacks:{label:c=>` ${c.label}: ${fmt(c.parsed)}`}}}}
      });
    } else {
      const cv=el("catChart"); cv.getContext("2d").clearRect(0,0,cv.width,cv.height);
    }
  }

  function refreshFilterOptions(){
    const months=[...new Set(state.transactions.map(t=>monthKey(t.date)))].sort().reverse();
    const cats=[...new Set(state.transactions.map(t=>t.category))].sort();
    const fm=el("filterMonth"), fc=el("filterCat");
    const mv=fm.value, cv=fc.value;
    fm.innerHTML='<option value="">All months</option>'+months.map(m=>`<option value="${m}">${monthName(m)}</option>`).join("");
    fc.innerHTML='<option value="">All categories</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
    fm.value=mv; fc.value=cv;
    el("catList").innerHTML=allCategories().map(c=>`<option value="${esc(c)}">`).join("");
  }

  function renderNudge(){
    const has=state.transactions.length>0;
    const days = state.lastBackup ? (Date.now()-state.lastBackup)/86400000 : Infinity;
    const changes = state.changesSinceBackup||0;
    const byChanges = has && changes>=CHANGE_THRESHOLD;
    const byTime = has && !nudgeDismissed && days>=14;
    const show = byChanges || byTime;
    el("nudge").hidden=!show;
    if(show){
      el("nudgeTxt").textContent = byChanges
        ? `You've made ${changes} changes. Your data is saved to your account — Export is an optional local copy.`
        : "Want an offline copy? Export a local backup any time.";
    }
  }

  function renderAll(){ refreshFilterOptions(); renderStats(); renderSafeToSpend(); renderTx(); renderBudgets(); renderCharts(); renderContrib(); renderSavings(); renderBills(); renderBillIndicator(); renderNudge(); }

  // ---- Tabs ----
  function switchTab(name){
    document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active", t.dataset.tab===name));
    document.querySelectorAll(".tab-panel").forEach(p=>{ p.hidden = (p.id!=="tab-"+name); });
    if(name==="dashboard"){ renderCharts(); renderSavingsChart(); }
    window.scrollTo({top:0,behavior:"smooth"});
  }

  // ---- Compact bill indicator on the dashboard ----
  function renderBillIndicator(){
    const card=el("billIndicatorCard"); if(!card) return;
    const badge=el("billsTabBadge");
    const items=trackerItems(), now=new Date();
    const gobtn='<button class="btn primary" data-gobills>View bills →</button>';
    if(!items.length){
      card.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap"><div><div style="font-family:var(--display);font-weight:600;font-size:16px">🧾 Bills</div><div style="color:var(--muted);font-weight:600;margin-top:4px">No bills tracked yet.</div></div><button class="btn" data-gobills>Set up bills →</button></div>`;
      if(badge) badge.hidden=true;
      card.querySelectorAll("[data-gobills]").forEach(b=>b.onclick=()=>switchTab("bills"));
      return;
    }
    let remaining=0, overdue=0, dueSoon=0; const unpaid=[];
    items.forEach(it=>{
      if(billPaid(it.id,itemPeriodKey(it,now))) return;
      unpaid.push(it); remaining+=it.amount;
      const info=dueInfo(it,now);
      if(info.label==="Overdue") overdue++;
      else if(info.label==="Due today"||info.label==="Due now") dueSoon++;
      else if(it.freq==="monthly"){ const dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate(); const due=Math.min(it.dueDay||1,dim); if(due-now.getDate()<=3) dueSoon++; }
    });
    if(badge){
      if(unpaid.length){ badge.hidden=false; badge.textContent=unpaid.length; badge.style.background=overdue?"var(--coral)":"var(--brand)"; }
      else badge.hidden=true;
    }
    if(!unpaid.length){
      card.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap"><div><div style="font-family:var(--display);font-weight:600;font-size:16px">🧾 Bills this period</div><div style="color:var(--mint);font-weight:700;margin-top:4px">🎉 All paid — nice work!</div></div><button class="btn" data-gobills>View bills →</button></div>`;
      card.querySelectorAll("[data-gobills]").forEach(b=>b.onclick=()=>switchTab("bills"));
      return;
    }
    const urgent=[...unpaid].sort((a,b)=>dueSortVal(a,now)-dueSortVal(b,now))[0];
    const ui=dueInfo(urgent,now);
    const parts=[];
    if(overdue) parts.push(`<span style="color:var(--coral);font-weight:800">${overdue} overdue</span>`);
    if(dueSoon) parts.push(`<span style="color:var(--brand);font-weight:800">${dueSoon} due soon</span>`);
    parts.push(`${unpaid.length} unpaid · ${fmt(remaining)} to pay`);
    card.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
      <div style="min-width:0">
        <div style="font-family:var(--display);font-weight:600;font-size:16px">🧾 Bills this period</div>
        <div style="color:var(--muted);font-weight:600;margin-top:5px">${parts.join(' <span style="opacity:.4">·</span> ')}</div>
        <div style="margin-top:7px;font-weight:700">Next up: ${esc(urgent.name)} <span class="bill-status ${ui.cls}" style="margin-left:4px">${ui.label}</span></div>
      </div>
      ${gobtn}
    </div>`;
    card.querySelectorAll("[data-gobills]").forEach(b=>b.onclick=()=>switchTab("bills"));
  }

  // ---- Recurring bills checklist ----
  const ord=n=>{ const s=["th","st","nd","rd"], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };
  const WEEKDAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const WEEKDAYS_SHORT=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  let editingBillId=null, editingRecId=null;
  function billKey(id,pk){ return id+"|"+pk; }
  function billPaid(id,pk){ return !!state.billsPaid[billKey(id,pk)]; }
  function isoWeek(d){
    const dt=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
    const day=dt.getUTCDay()||7; dt.setUTCDate(dt.getUTCDate()+4-day);
    const ys=new Date(Date.UTC(dt.getUTCFullYear(),0,1));
    const wk=Math.ceil((((dt-ys)/86400000)+1)/7);
    return dt.getUTCFullYear()+"-W"+String(wk).padStart(2,"0");
  }
  function periodKey(freq,d){ d=d||new Date(); return freq==="weekly"?isoWeek(d):d.toISOString().slice(0,7); }
  function biweeklyCycleStart(anchorISO, now){
    const a=new Date((anchorISO||new Date().toISOString().slice(0,10))+"T00:00:00"); a.setHours(0,0,0,0);
    const t=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const cycle=Math.floor((t-a)/86400000/14);
    const start=new Date(a); start.setDate(a.getDate()+cycle*14);
    return {cycle,start};
  }
  function itemPeriodKey(it, now){
    if(it.freq==="weekly") return isoWeek(now);
    if(it.freq==="biweekly") return "BW"+it.anchor+"#"+biweeklyCycleStart(it.anchor,now).cycle;
    return now.toISOString().slice(0,7);
  }
  function trackerItems(){
    const todayISO=new Date().toISOString().slice(0,10);
    const items=[];
    state.bills.forEach(b=>items.push({ id:"bill:"+b.id, refId:b.id, source:"bill", name:b.name, amount:b.amount, freq:b.freq||"monthly", dueDay:b.dueDay||1, weekday:(typeof b.weekday==="number"?b.weekday:1), anchor:b.anchorDate||todayISO }));
    state.recurring.forEach(r=>{ if(r.type==="expense") items.push({ id:"rec:"+r.id, refId:r.id, source:"recurring", name:(r.note||r.category||"Recurring"), amount:r.amount, freq:r.freq||"monthly", dueDay:r.anchorDay||1, weekday:(function(){ try{ return new Date(r.lastDate+"T00:00:00").getDay(); }catch(e){ return 1; } })(), anchor:r.anchor||r.lastDate||todayISO }); });
    return items;
  }
  function dueInfo(it, now){
    if(it.freq==="biweekly"){
      const c=biweeklyCycleStart(it.anchor,now), t=new Date(now.getFullYear(),now.getMonth(),now.getDate());
      return (+c.start===+t) ? {cls:"due",label:"Due today"} : {cls:"due",label:"Due now"};
    }
    if(it.freq==="weekly"){
      const wd=now.getDay();
      if(it.weekday<wd) return {cls:"over",label:"Overdue"};
      if(it.weekday===wd) return {cls:"due",label:"Due today"};
      return {cls:"due",label:"Due "+WEEKDAYS_SHORT[it.weekday]};
    }
    const today=now.getDate(), dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    const due=Math.min(it.dueDay||1,dim);
    if(due<today) return {cls:"over",label:"Overdue"};
    if(due===today) return {cls:"due",label:"Due today"};
    return {cls:"due",label:"Due in "+(due-today)+"d"};
  }
  function dueSubtitle(it){
    if(it.freq==="weekly") return "Weekly · "+WEEKDAYS[it.weekday];
    if(it.freq==="biweekly") return "Every 2 weeks · "+biweeklyCycleStart(it.anchor,new Date()).start.toLocaleDateString(undefined,{month:"short",day:"numeric"});
    return "Monthly · due "+ord(it.dueDay||1);
  }
  function dueSortVal(it, now){
    if(it.freq==="weekly") return it.weekday - now.getDay();
    if(it.freq==="biweekly") return 0;
    return Math.min(it.dueDay||1,28) - now.getDate();
  }
  function renderBills(){
    const box=el("billsContainer");
    const items=trackerItems();
    if(!items.length){ box.innerHTML='<div class="empty"><span class="em">🧾</span>No bills yet.<br>Tap “Manage” to add bills, or add expenses under 🔁 Recurring.</div>'; return; }
    const now=new Date();
    let paidCount=0, remaining=0;
    items.forEach(it=>{ if(billPaid(it.id,itemPeriodKey(it,now))) paidCount++; else remaining+=it.amount; });
    const sorted=[...items].sort((a,b)=>{
      const pa=billPaid(a.id,itemPeriodKey(a,now)), pb=billPaid(b.id,itemPeriodKey(b,now));
      if(pa!==pb) return pa?1:-1;
      return dueSortVal(a,now)-dueSortVal(b,now);
    });
    const summary=`<div class="bills-summary">This period · <b>${paidCount} of ${items.length} paid</b> · ${fmt(remaining)} left to pay</div>`;
    const rows=sorted.map(it=>{
      const pk=itemPeriodKey(it,now), paid=billPaid(it.id,pk);
      const di = paid ? {cls:"paid",label:"Paid"} : dueInfo(it,now);
      const tag = it.source==="recurring" ? ' <span title="From Recurring" style="opacity:.7">🔁</span>' : "";
      return `<div class="bill-row">
        <button class="check ${paid?'on':''}" data-bill="${it.id}" data-period="${pk}" aria-label="Mark ${esc(it.name)} ${paid?'unpaid':'paid'}">${paid?'✓':''}</button>
        <div class="bill-main"><div class="bill-name ${paid?'paid':''}">${esc(it.name)}${tag}</div><div class="bill-sub">${dueSubtitle(it)}</div></div>
        <span class="bill-status ${di.cls}">${di.label}</span>
        <span class="bill-amt">${fmt(it.amount)}</span>
        <button class="row-btn" data-edit${it.source}="${it.refId}">Edit</button>
      </div>`;
    }).join("");
    box.innerHTML=summary+rows;
    box.querySelectorAll("[data-bill]").forEach(btn=>btn.onclick=()=>toggleBill(btn.dataset.bill, btn.dataset.period));
    box.querySelectorAll("[data-editbill]").forEach(btn=>btn.onclick=()=>openBillsModal(btn.dataset.editbill));
    box.querySelectorAll("[data-editrecurring]").forEach(btn=>btn.onclick=()=>openRecModal(btn.dataset.editrecurring));
  }
  function toggleBill(id, pk){
    const k=billKey(id,pk);
    if(state.billsPaid[k]) delete state.billsPaid[k]; else state.billsPaid[k]=true;
    save(); renderBills();
  }
  function billFreqUI(){
    const f = el("newBillFreq").value;
    el("billDayField").style.display = f==="monthly" ? "block" : "none";
    el("billWeekdayField").style.display = f==="weekly" ? "block" : "none";
    el("billBiweeklyField").style.display = f==="biweekly" ? "block" : "none";
  }
  function openBillsModal(editId){
    editingBillId = (typeof editId==="string") ? editId : null;
    const box=el("billList");
    box.innerHTML = state.bills.length
      ? state.bills.map(b=>`<div class="rec-item"><span class="r-ico">🧾</span><div class="r-main"><div class="r-title">${esc(b.name)} · ${fmt(b.amount)}</div><div class="r-sub">${billFreqLabel(b)}</div></div><button class="row-btn" data-editb="${b.id}">Edit</button><button class="row-btn del" data-delbill="${b.id}">Remove</button></div>`).join("")
      : '<div class="empty"><span class="em">🧾</span>No standalone bills yet.</div>';
    box.querySelectorAll("[data-delbill]").forEach(b=>b.onclick=()=>{ state.bills=state.bills.filter(x=>x.id!==b.dataset.delbill); save(); openBillsModal(); renderBills(); toast("Bill removed"); });
    box.querySelectorAll("[data-editb]").forEach(b=>b.onclick=()=>openBillsModal(b.dataset.editb));
    if(editingBillId){
      const b=state.bills.find(x=>x.id===editingBillId);
      if(b){
        el("newBillName").value=b.name; el("newBillAmount").value=b.amount;
        el("newBillFreq").value=b.freq||"monthly"; el("newBillDay").value=b.dueDay||"";
        el("newBillWeekday").value=String(typeof b.weekday==="number"?b.weekday:1);
        el("newBillStart").value=b.anchorDate||new Date().toISOString().slice(0,10);
        el("billFormTitle").textContent="Edit bill"; el("newBillAdd").textContent="Save changes";
      }
    } else {
      el("newBillName").value=""; el("newBillAmount").value=""; el("newBillFreq").value="monthly"; el("newBillDay").value=""; el("newBillWeekday").value="1"; el("newBillStart").value=new Date().toISOString().slice(0,10);
      el("billFormTitle").textContent="Add a bill"; el("newBillAdd").textContent="Add bill";
    }
    billFreqUI(); el("billsModal").classList.add("show");
  }
  function billFreqLabel(b){
    const f=b.freq||"monthly";
    if(f==="weekly") return "Weekly · "+WEEKDAYS[(typeof b.weekday==="number"?b.weekday:1)];
    if(f==="biweekly") return "Every 2 weeks · from "+new Date((b.anchorDate||new Date().toISOString().slice(0,10))+"T00:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric"});
    return "Monthly · due "+ord(b.dueDay||1);
  }
  function saveBill(){
    const name=el("newBillName").value.trim();
    const amount=parseFloat(el("newBillAmount").value);
    const freq=el("newBillFreq").value;
    let day=parseInt(el("newBillDay").value,10);
    const weekday=parseInt(el("newBillWeekday").value,10)||0;
    const anchorDate=el("newBillStart").value||new Date().toISOString().slice(0,10);
    if(!name){ toast("Enter a bill name"); return; }
    if(!amount||amount<=0){ toast("Enter an amount"); return; }
    if(!day||day<1) day=1; if(day>31) day=31;
    const fields={name,amount,freq,dueDay:day,weekday,anchorDate};
    if(editingBillId){
      const b=state.bills.find(x=>x.id===editingBillId);
      if(b) Object.assign(b,fields);
      editingBillId=null; toast("Bill updated ✓");
    } else {
      state.bills.push(Object.assign({id:uid()},fields)); toast("Bill added ✓");
    }
    save(); openBillsModal(); renderBills();
  }

  // ---- Household members / contributions ----
  function memberName(id){ const m=state.members.find(x=>x.id===id); return m?m.name:null; }
  function renderContrib(){
    const box=el("contribContainer");
    if(!state.members.length){ box.innerHTML='<div class="empty"><span class="em">👥</span>No members yet.<br>Tap “Manage” to add who contributes income.</div>'; return; }
    const list=filtered();
    const totals={}; let unassigned=0, totalInc=0;
    list.forEach(t=>{
      if(t.type==="income"){
        totalInc+=t.amount;
        if(t.memberId && memberName(t.memberId)) totals[t.memberId]=(totals[t.memberId]||0)+t.amount;
        else unassigned+=t.amount;
      }
    });
    if(totalInc<=0){ box.innerHTML='<div class="empty"><span class="em">💸</span>No income in this view yet.</div>'; return; }
    let html=`<div style="font-weight:700;margin-bottom:14px">Combined income: <span style="color:var(--brand)">${fmt(totalInc)}</span></div>`;
    html+=state.members.map(m=>{
      const amt=totals[m.id]||0, pct=totalInc>0?(amt/totalInc*100):0, color=colorFor(m.name);
      return `<div class="budget-row">
        <div class="top"><span class="cat-name"><span class="pdot" style="width:10px;height:10px;border-radius:50%;background:${color}"></span>${esc(m.name)}</span><span>${fmt(amt)} · ${Math.round(pct)}%</span></div>
        <div class="bar"><span style="width:${pct}%;background:${color}"></span></div>
      </div>`;
    }).join("");
    if(unassigned>0){
      const pct=unassigned/totalInc*100;
      html+=`<div class="budget-row">
        <div class="top"><span class="cat-name" style="color:var(--muted)">Unassigned</span><span>${fmt(unassigned)} · ${Math.round(pct)}%</span></div>
        <div class="bar"><span style="width:${pct}%;background:var(--muted)"></span></div>
      </div>`;
    }
    box.innerHTML=html;
  }
  function openMemberModal(){
    const box=el("memberList");
    box.innerHTML = state.members.length
      ? state.members.map(m=>`<div class="rec-item"><span class="r-ico" style="width:20px;height:20px;border-radius:50%;background:${colorFor(m.name)}"></span><div class="r-main"><div class="r-title">${esc(m.name)}</div></div><button class="row-btn del" data-delmem="${m.id}">Remove</button></div>`).join("")
      : '<div class="empty"><span class="em">👥</span>No members yet.</div>';
    box.querySelectorAll("[data-delmem]").forEach(b=>b.onclick=()=>{
      state.members=state.members.filter(m=>m.id!==b.dataset.delmem); save(); openMemberModal(); renderAll(); toast("Member removed");
    });
    el("newMemberName").value=""; el("memberModal").classList.add("show");
  }
  function addMember(){
    const name=el("newMemberName").value.trim();
    if(!name){ toast("Enter a name"); return; }
    if(state.members.some(m=>m.name.toLowerCase()===name.toLowerCase())){ toast("That member already exists"); return; }
    state.members.push({id:uid(),name}); save(); openMemberModal(); renderAll(); toast("Member added ✓");
  }

  // ---- Savings / banks ----
  function bankById(id){ return state.banks.find(b=>b.id===id); }
  function bankBalance(id){ let s=0; state.savings.forEach(e=>{ if(e.bankId===id) s += e.kind==="withdrawal" ? -e.amount : e.amount; }); return s; }
  function totalSavings(){ let s=0; state.savings.forEach(e=>{ s += e.kind==="withdrawal" ? -e.amount : e.amount; }); return s; }
  function savingsOutflow(mk){
    let s=0;
    state.savings.forEach(e=>{
      if(e.kind==="interest"||e.kind==="opening") return;
      if(mk && e.date.slice(0,7)!==mk) return;
      s += e.kind==="withdrawal" ? -e.amount : e.amount;
    });
    return s;
  }

  function renderSavings(){
    el("savingsTotalMini").textContent = state.savings.length ? fmt(totalSavings())+" saved" : "";
    const ind=el("bankIndicator");
    if(state.banks.length){ const n=state.banks.length; ind.hidden=false; ind.innerHTML=`🏦 <b>${fmt(totalSavings())}</b> in savings${n>1?` · ${n} banks`:""}`; }
    else { ind.hidden=true; }
    const box=el("bankList");
    if(!state.banks.length){ box.innerHTML='<div class="empty"><span class="em">🏦</span>No banks yet.<br>Tap “🏦 Savings” to add one.</div>'; }
    else {
      box.innerHTML=state.banks.map(b=>{
        const bal=bankBalance(b.id);
        const est = bal>0 && b.rate>0 ? bal*(b.rate/100)/12 : 0;
        return `<div class="bank-line">
          <span class="cat-name"><span class="pdot" style="width:10px;height:10px;border-radius:50%;background:${colorFor(b.name)}"></span>${esc(b.name)}${b.rate?` <span class="rate">${b.rate}% APY</span>`:""}</span>
          <span class="bank-bal">${fmt(bal)}${est>0?`<span class="est">≈ ${fmt(est)}/mo</span>`:""}</span>
        </div>`;
      }).join("");
    }
    renderSavingsChart();
  }
  function renderSavingsChart(){
    const css=getComputedStyle(document.body);
    const txt=css.getPropertyValue("--muted").trim();
    const grid=css.getPropertyValue("--border").trim();
    const brand=css.getPropertyValue("--brand").trim();
    const entries=[...state.savings].sort((a,b)=>a.date.localeCompare(b.date));
    if(savingsChart) savingsChart.destroy();
    if(!entries.length){ const cv=el("savingsChart"); cv.getContext("2d").clearRect(0,0,cv.width,cv.height); el("savingsChart").setAttribute("aria-label","Savings growth chart. No savings logged yet."); return; }
    const byMonth={};
    entries.forEach(e=>{ const k=e.date.slice(0,7); byMonth[k]=(byMonth[k]||0)+(e.kind==="withdrawal"?-e.amount:e.amount); });
    const months=Object.keys(byMonth).sort();
    let running=0; const data=months.map(m=>{ running+=byMonth[m]; return running; });
    el("savingsChart").setAttribute("aria-label", `Savings growth. Current total ${fmt(running)} across ${months.length} month${months.length>1?"s":""}.`);
    savingsChart=new Chart(el("savingsChart"),{
      type:"line",
      data:{ labels:months.map(m=>{ const [y,mo]=m.split("-"); return new Date(y,mo-1,1).toLocaleString(undefined,{month:"short",year:"numeric"}); }),
        datasets:[{data,label:"Total saved",borderColor:brand,backgroundColor:"rgba(108,99,255,.12)",fill:true,tension:.35,pointRadius:3,pointBackgroundColor:brand,borderWidth:3}] },
      options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>` ${fmt(c.parsed.y)}`}}},
        scales:{x:{ticks:{color:txt,font:{weight:700}},grid:{display:false}},y:{ticks:{color:txt,callback:v=>cur().sym+v},grid:{color:grid}}}}
    });
  }

  function refreshSavingsModal(){
    const sel=el("svBank");
    sel.innerHTML = state.banks.length
      ? state.banks.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join("")
      : '<option value="">Add a bank first ↓</option>';
    el("svBankManage").innerHTML = state.banks.length
      ? state.banks.map(b=>`<div class="rec-item"><span class="r-ico">🏦</span><div class="r-main"><div class="r-title">${esc(b.name)}</div><div class="r-sub">${b.rate?b.rate+"% APY · ":""}Balance ${fmt(bankBalance(b.id))}</div></div><button class="row-btn del" data-delbank="${b.id}">Remove</button></div>`).join("")
      : '<div class="empty" style="padding:20px 0"><span class="em">🏦</span>No banks yet.</div>';
    el("svBankManage").querySelectorAll("[data-delbank]").forEach(b=>b.onclick=()=>removeBank(b.dataset.delbank));
    const recent=[...state.savings].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6);
    el("svRecent").innerHTML = recent.length
      ? '<div style="font-size:12.5px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Recent entries</div>'+recent.map(e=>{
          const bk=bankById(e.bankId); const sign=e.kind==="withdrawal"?"-":"+";
          const kindLabel=e.kind.charAt(0).toUpperCase()+e.kind.slice(1);
          const d=new Date(e.date).toLocaleDateString(undefined,{month:"short",day:"numeric"});
          return `<div class="rec-item"><span class="r-ico">${e.kind==="withdrawal"?"↙":e.kind==="interest"?"✨":"↗"}</span><div class="r-main"><div class="r-title">${sign}${fmt(e.amount).replace("-","")} · ${bk?esc(bk.name):"—"}</div><div class="r-sub">${kindLabel} · ${d}${e.note?" · "+esc(e.note):""}</div></div><button class="row-btn del" data-delsv="${e.id}">✕</button></div>`;
        }).join("")
      : "";
    el("svRecent").querySelectorAll("[data-delsv]").forEach(b=>b.onclick=()=>{
      state.savings=state.savings.filter(e=>e.id!==b.dataset.delsv); save(); refreshSavingsModal(); renderAll(); toast("Entry removed");
    });
  }
  function openSavingsModal(){
    pendingKind="deposit";
    document.querySelectorAll("#svKindToggle button").forEach(x=>x.classList.toggle("active",x.dataset.k==="deposit"));
    el("svAmount").value=""; el("svNote").value=""; el("svDate").value=new Date().toISOString().slice(0,10);
    refreshSavingsModal(); el("savingsModal").classList.add("show");
  }
  function addSavingsEntry(){
    if(!state.banks.length){ toast("Add a bank first"); return; }
    const bankId=el("svBank").value;
    const amount=parseFloat(el("svAmount").value);
    const date=el("svDate").value||new Date().toISOString().slice(0,10);
    const note=el("svNote").value.trim();
    if(!bankId){ toast("Pick a bank"); return; }
    if(!amount||amount<=0){ toast("Enter an amount"); el("svAmount").focus(); return; }
    state.savings.push({id:uid(),bankId,amount,date,kind:pendingKind,note});
    save(); refreshSavingsModal(); renderAll();
    el("svAmount").value=""; el("svNote").value="";
    toast(pendingKind==="withdrawal"?"Withdrawal logged ✓":pendingKind==="interest"?"Interest logged ✓":"Deposit logged ✓");
  }
  function addBank(){
    const name=el("newBankName").value.trim();
    const rate=parseFloat(el("newBankRate").value)||0;
    if(!name){ toast("Enter a bank name"); return; }
    if(state.banks.some(b=>b.name.toLowerCase()===name.toLowerCase())){ toast("That bank already exists"); return; }
    state.banks.push({id:uid(),name,rate}); save();
    el("newBankName").value=""; el("newBankRate").value="";
    refreshSavingsModal(); renderAll(); toast("Bank added ✓");
  }
  function removeBank(id){
    const n=state.savings.filter(e=>e.bankId===id).length;
    const bk=bankById(id);
    if(n>0 && !confirm(`"${bk?bk.name:"This bank"}" has ${n} saved ${n>1?"entries":"entry"}. Remove the bank and ${n>1?"those entries":"that entry"}? This can't be undone.`)) return;
    state.savings=state.savings.filter(e=>e.bankId!==id);
    state.banks=state.banks.filter(b=>b.id!==id);
    save(); refreshSavingsModal(); renderAll(); toast("Bank removed");
  }

  // ---- Transactions ----
  function populateMemberSelect(selected){
    el("txMember").innerHTML='<option value="">Unassigned</option>'+state.members.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join("");
    el("txMember").value=selected||"";
  }
  function updateContribVisibility(){
    el("contribField").style.display = (pendingType==="income" && state.members.length) ? "block" : "none";
  }
  function openTxModal(id){
    editingId=id||null;
    el("repeatField").style.display = id ? "none" : "block";
    if(id){
      const t=state.transactions.find(x=>x.id===id);
      pendingType=t.type; el("txAmount").value=t.amount; el("txCategory").value=t.category;
      el("txDate").value=t.date; el("txNote").value=t.note||""; el("txRepeat").value="none"; el("txModalTitle").textContent="Edit transaction";
      populateMemberSelect(t.memberId);
    } else {
      pendingType="expense"; el("txAmount").value=""; el("txCategory").value="";
      el("txDate").value=new Date().toISOString().slice(0,10); el("txNote").value=""; el("txRepeat").value="none"; el("txModalTitle").textContent="Add a transaction";
      populateMemberSelect("");
    }
    updateTypeToggle(); updateContribVisibility(); el("txModal").classList.add("show"); el("txAmount").focus();
  }
  function updateTypeToggle(){ document.querySelectorAll("#typeToggle button").forEach(b=>b.classList.toggle("active",b.dataset.t===pendingType)); updateContribVisibility(); }
  function saveTx(){
    const amount=parseFloat(el("txAmount").value);
    const category=canonicalCategory(el("txCategory").value);
    const date=el("txDate").value||new Date().toISOString().slice(0,10);
    const note=el("txNote").value.trim();
    if(!amount||amount<=0){ toast("Enter an amount first"); el("txAmount").focus(); return; }
    const memberId = pendingType==="income" ? (el("txMember").value||"") : "";
    if(editingId){
      Object.assign(state.transactions.find(x=>x.id===editingId),{type:pendingType,amount,category,date,note,memberId});
      toast("Updated ✓");
    } else {
      unhide(category);
      state.transactions.push({id:uid(),type:pendingType,amount,category,date,note,memberId,created:Date.now()});
      const rep=el("txRepeat").value;
      if(rep!=="none"){
        const anchorDay=parseInt(date.slice(8,10),10);
        state.recurring.push({id:uid(),type:pendingType,amount,category,note,freq:rep,anchorDay,anchor:date,lastDate:date});
        toast(rep==="weekly"?"Added ✓ Repeats weekly":rep==="biweekly"?"Added ✓ Repeats every 2 weeks":"Added ✓ Repeats monthly");
      } else {
        toast("Added ✓");
      }
    }
    save(); renderAll(); el("txModal").classList.remove("show");
  }
  function delTx(id){
    const t=state.transactions.find(x=>x.id===id); if(!t) return;
    lastDeleted=t;
    state.transactions=state.transactions.filter(x=>x.id!==id);
    save(); renderAll();
    toast("Transaction deleted", "Undo", ()=>{
      if(lastDeleted){ state.transactions.push(lastDeleted); lastDeleted=null; save(); renderAll(); toast("Restored ✓"); }
    });
  }

  // ---- Recurring manager ----
  function openRecModal(editId){
    editingRecId = (typeof editId==="string") ? editId : null;
    const box=el("recList");
    if(!state.recurring.length){ box.innerHTML='<div class="empty"><span class="em">🔁</span>No recurring transactions yet.</div>'; }
    else {
      box.innerHTML=state.recurring.map(r=>`
        <div class="rec-item">
          <span class="r-ico">${iconFor(r.category)}</span>
          <div class="r-main">
            <div class="r-title">${r.type==="income"?"+":"-"}${esc(fmt(r.amount).replace("-",""))} · ${esc(r.category)}</div>
            <div class="r-sub">${r.freq==="weekly"?"Every week":r.freq==="biweekly"?"Every 2 weeks":"Every month"}${r.note?" · "+esc(r.note):""}</div>
          </div>
          <button class="row-btn" data-recedit="${r.id}">Edit</button>
          <button class="row-btn del" data-rec="${r.id}">Remove</button>
        </div>`).join("");
      box.querySelectorAll("[data-rec]").forEach(b=>b.onclick=()=>{
        state.recurring=state.recurring.filter(r=>r.id!==b.dataset.rec); save(); openRecModal(); renderBills(); toast("Recurring removed");
      });
      box.querySelectorAll("[data-recedit]").forEach(b=>b.onclick=()=>openRecModal(b.dataset.recedit));
    }
    const ef=el("recEdit");
    if(editingRecId){
      const r=state.recurring.find(x=>x.id===editingRecId);
      if(r){
        el("recAmount").value=r.amount; el("recNote").value=r.note||""; el("recDay").value=r.anchorDay||"";
        el("recDayField").style.display=(r.freq==="monthly")?"block":"none";
        ef.style.display="block";
      } else ef.style.display="none";
    } else ef.style.display="none";
    el("recModal").classList.add("show");
  }
  function saveRecEdit(){
    const r=state.recurring.find(x=>x.id===editingRecId); if(!r) return;
    const amount=parseFloat(el("recAmount").value);
    const note=el("recNote").value.trim();
    let day=parseInt(el("recDay").value,10);
    if(!amount||amount<=0){ toast("Enter an amount"); return; }
    r.amount=amount; r.note=note;
    if(r.freq!=="weekly"){ if(!day||day<1)day=1; if(day>31)day=31; r.anchorDay=day; }
    editingRecId=null; save(); openRecModal(); renderBills(); toast("Recurring updated ✓");
  }

  // ---- Budgets ----
  function openBudgetModal(){
    const set=new Set([...allCategories(),...Object.keys(state.budgets)]);
    el("budgetInputs").innerHTML=[...set].sort().map(c=>`
      <div class="field" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;gap:8px">
          <label style="margin:0">${iconFor(c)} ${esc(c)}</label>
          <button type="button" class="row-btn del" data-delcat="${esc(c)}">Delete</button>
        </div>
        <input type="number" inputmode="decimal" min="0" step="0.01" data-bcat="${esc(c)}" value="${state.budgets[c]||""}" placeholder="No limit">
      </div>`).join("");
    el("budgetInputs").querySelectorAll("[data-delcat]").forEach(b=>b.onclick=()=>deleteCategory(b.dataset.delcat));
    el("newBudgetCat").value=""; el("budgetModal").classList.add("show");
  }
  function commitBudgetInputs(){
    const nb={};
    el("budgetInputs").querySelectorAll("[data-bcat]").forEach(inp=>{ const v=parseFloat(inp.value); if(v>0) nb[inp.dataset.bcat]=v; });
    state.budgets=nb;
  }
  function deleteCategory(c){
    const n=state.transactions.filter(t=>t.category===c).length;
    if(n>0){
      const ok=confirm(`"${c}" has ${n} transaction${n>1?"s":""}. Delete this category and ${n>1?"those "+n+" transactions":"that transaction"}? This can't be undone.`);
      if(!ok) return;
      state.transactions=state.transactions.filter(t=>t.category!==c);
    }
    commitBudgetInputs();
    delete state.budgets[c];
    state.recurring=state.recurring.filter(r=>r.category!==c);
    state.hiddenCategories=state.hiddenCategories||[];
    if(!state.hiddenCategories.some(x=>x.toLowerCase()===c.toLowerCase())) state.hiddenCategories.push(c);
    save(); openBudgetModal(); renderAll(); toast(`Removed "${c}"`);
  }
  function saveBudgets(){
    const nb={};
    el("budgetInputs").querySelectorAll("[data-bcat]").forEach(inp=>{ const v=parseFloat(inp.value); if(v>0) nb[inp.dataset.bcat]=v; });
    const newCat=el("newBudgetCat").value.trim();
    if(newCat){ const c=canonicalCategory(newCat); unhide(c); if(!(c in nb)) nb[c]=0; }
    Object.keys(nb).forEach(unhide);
    state.budgets=nb; save(); renderAll(); el("budgetModal").classList.remove("show"); toast("Budgets saved ✓");
  }

  // ---- Currency ----
  function openCurrencyPicker(){
    el("curGrid").innerHTML=CURRENCIES.map(c=>`
      <button class="cur-opt" data-cur="${c.code}"><span class="sym">${c.sym}</span><span class="nm">${c.code} · ${c.name}</span></button>`).join("");
    el("curGrid").querySelectorAll("[data-cur]").forEach(b=>b.onclick=()=>{
      state.currency=b.dataset.cur; save(); el("curModal").classList.remove("show"); renderAll();
      if(!state.onboarded) openOnboarding(); else toast("Currency set to "+state.currency);
    });
    el("curModal").classList.add("show");
  }

  // ---- Settings (edit starting cash + savings + currency) ----
  function openingCashTx(){ return state.transactions.find(t=>t.category==="Opening balance"); }
  function openingForBank(bankId){ let s=0; state.savings.forEach(e=>{ if(e.kind==="opening" && e.bankId===bankId) s+=e.amount; }); return s; }
  function openSettings(){
    el("setCurrency").innerHTML=CURRENCIES.map(c=>`<option value="${c.code}">${c.sym} · ${c.code} — ${c.name}</option>`).join("");
    el("setCurrency").value=state.currency||"USD";
    const oc=openingCashTx();
    el("setCash").value = oc ? oc.amount : "";
    const box=el("setSavings");
    if(state.banks.length){
      el("setNoBanks").style.display="none";
      box.innerHTML=state.banks.map(b=>`<div class="field" style="margin-bottom:10px"><label>${iconFor(b.name)} ${esc(b.name)}${b.rate?` · ${b.rate}% APY`:""}</label><input type="number" inputmode="decimal" min="0" step="0.01" data-setbank="${b.id}" value="${openingForBank(b.id)||""}" placeholder="0.00"></div>`).join("");
    } else {
      box.innerHTML=""; el("setNoBanks").style.display="block";
    }
    el("settingsModal").classList.add("show");
  }
  function saveSettings(){
    state.currency = el("setCurrency").value || state.currency;
    const today=new Date().toISOString().slice(0,10);
    const cash=parseFloat(el("setCash").value)||0;
    let oc=openingCashTx();
    if(cash>0){
      if(oc) oc.amount=cash;
      else state.transactions.push({id:uid(),type:"income",amount:cash,category:"Opening balance",date:today,note:"Starting cash on hand",memberId:"",created:Date.now()});
    } else if(oc){
      state.transactions=state.transactions.filter(t=>t.id!==oc.id);
    }
    state.savings=state.savings.filter(e=>e.kind!=="opening");
    el("setSavings").querySelectorAll("[data-setbank]").forEach(inp=>{
      const v=parseFloat(inp.value)||0;
      if(v>0) state.savings.push({id:uid(),bankId:inp.dataset.setbank,amount:v,date:today,kind:"opening",note:"Starting balance"});
    });
    save(); renderAll(); el("settingsModal").classList.remove("show"); toast("Settings saved ✓");
  }

  // ---- First-run onboarding (starting cash + existing savings) ----
  function openOnboarding(){
    obBanks=[];
    el("obCash").value=""; el("obBankName").value=""; el("obBankBal").value=""; el("obBankRate").value="";
    renderObBanks(); el("onboardModal").classList.add("show");
  }
  function renderObBanks(){
    el("obBankList").innerHTML = obBanks.length
      ? obBanks.map((b,i)=>`<div class="rec-item"><span class="r-ico">🏦</span><div class="r-main"><div class="r-title">${esc(b.name)} · ${fmt(b.bal)}</div><div class="r-sub">${b.rate?b.rate+"% APY":"No rate"}</div></div><button class="row-btn del" data-obdel="${i}">Remove</button></div>`).join("")
      : "";
    el("obBankList").querySelectorAll("[data-obdel]").forEach(x=>x.onclick=()=>{ obBanks.splice(+x.dataset.obdel,1); renderObBanks(); });
  }
  function obAddBank(){
    const name=el("obBankName").value.trim(), bal=parseFloat(el("obBankBal").value)||0, rate=parseFloat(el("obBankRate").value)||0;
    if(!name){ toast("Enter a bank name"); return; }
    obBanks.push({name,bal,rate});
    el("obBankName").value=""; el("obBankBal").value=""; el("obBankRate").value="";
    renderObBanks(); el("obBankName").focus();
  }
  function finishOnboarding(){
    const cash=parseFloat(el("obCash").value)||0;
    const today=new Date().toISOString().slice(0,10);
    if(cash>0) state.transactions.push({id:uid(),type:"income",amount:cash,category:"Opening balance",date:today,note:"Starting cash on hand",memberId:"",created:Date.now()});
    obBanks.forEach(b=>{
      const id=uid(); state.banks.push({id,name:b.name,rate:b.rate});
      if(b.bal>0) state.savings.push({id:uid(),bankId:id,amount:b.bal,date:today,kind:"opening",note:"Starting balance"});
    });
    state.onboarded=true; save(); renderAll(); el("onboardModal").classList.remove("show"); toast("You're all set ✓");
  }

  // ---- Import / Export (optional local backup on top of cloud sync) ----
  let backupHandle=null;
  const IDB_NAME="kaizen_bt", IDB_STORE="handles";
  function idbOpen(){ return new Promise((res,rej)=>{ const r=indexedDB.open(IDB_NAME,1); r.onupgradeneeded=()=>r.result.createObjectStore(IDB_STORE); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
  async function idbGet(k){ try{ const db=await idbOpen(); return await new Promise((res,rej)=>{ const t=db.transaction(IDB_STORE,"readonly").objectStore(IDB_STORE).get(k); t.onsuccess=()=>res(t.result); t.onerror=()=>rej(t.error); }); }catch(e){ return null; } }
  async function idbSet(k,v){ try{ const db=await idbOpen(); await new Promise((res,rej)=>{ const t=db.transaction(IDB_STORE,"readwrite").objectStore(IDB_STORE).put(v,k); t.onsuccess=()=>res(); t.onerror=()=>rej(t.error); }); }catch(e){} }
  async function ensurePermission(handle){
    if(!handle) return false;
    const opts={mode:"readwrite"};
    try{
      if((await handle.queryPermission(opts))==="granted") return true;
      if((await handle.requestPermission(opts))==="granted") return true;
    }catch(e){}
    return false;
  }
  async function exportData(){
    const json=JSON.stringify(state,null,2);
    const done=()=>{ state.lastBackup=Date.now(); state.changesSinceBackup=0; nudgeDismissed=false; saveMeta(); renderNudge(); };
    if(window.showSaveFilePicker){
      try{
        let handle = backupHandle || await idbGet("backup");
        if(handle && !(await ensurePermission(handle))) handle=null;
        if(!handle){
          handle = await window.showSaveFilePicker({ suggestedName:"budget-buddy-backup.json", types:[{description:"Budget Buddy backup",accept:{"application/json":[".json"]}}] });
        }
        const w=await handle.createWritable(); await w.write(json); await w.close();
        backupHandle=handle; idbSet("backup",handle);
        done(); toast("Backup saved ✓");
        return;
      }catch(err){
        if(err && err.name==="AbortError") return;
      }
    }
    const blob=new Blob([json],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob); a.download="budget-buddy-backup.json";
    a.click(); URL.revokeObjectURL(a.href);
    done(); toast("Backup exported ✓");
  }
  function importData(file){
    const r=new FileReader();
    r.onload=e=>{
      try{
        const data=JSON.parse(e.target.result);
        if(!data.transactions||!Array.isArray(data.transactions)) throw new Error("bad");
        state=Object.assign({currency:state.currency,theme:state.theme,budgets:{},recurring:[],hiddenCategories:[],members:[],banks:[],savings:[],bills:[],billsPaid:{},onboarded:true,changesSinceBackup:0,lastFilter:null,lastBackup:null},data);
        if(!state.currency) state.currency="USD";
        if(!state.theme) state.theme="light";
        if(!Array.isArray(state.recurring)) state.recurring=[];
        if(!Array.isArray(state.hiddenCategories)) state.hiddenCategories=[];
        if(!Array.isArray(state.members)) state.members=[];
        if(!Array.isArray(state.banks)) state.banks=[];
        if(!Array.isArray(state.savings)) state.savings=[];
        if(!Array.isArray(state.bills)) state.bills=[];
        if(!state.billsPaid||typeof state.billsPaid!=="object") state.billsPaid={};
        if(typeof state.onboarded!=="boolean") state.onboarded=true;
        runRecurring(); save(); applyTheme(); renderAll(); restoreFilters(); renderAll();
        toast("Imported "+state.transactions.length+" transactions ✓");
      }catch(err){ toast("That file didn't look right"); }
    };
    r.readAsText(file);
  }

  // ---- Theme ----
  function applyTheme(){
    document.documentElement.setAttribute("data-theme",state.theme);
    el("themeKnob").textContent = state.theme==="dark"?"🌙":"☀️";
  }
  function toggleTheme(){ state.theme=state.theme==="dark"?"light":"dark"; saveMeta(); applyTheme(); renderCharts(); renderSavingsChart(); }

  // ---- Events ----
  document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>switchTab(t.dataset.tab));
  el("addBtn").onclick=()=>openTxModal();
  el("txCancel").onclick=()=>el("txModal").classList.remove("show");
  el("txSave").onclick=saveTx;
  document.querySelectorAll("#typeToggle button").forEach(b=>b.onclick=()=>{pendingType=b.dataset.t;updateTypeToggle();});
  el("txAmount").addEventListener("keydown",e=>{if(e.key==="Enter")saveTx();});
  el("txNote").addEventListener("keydown",e=>{if(e.key==="Enter")saveTx();});
  el("setBudgetsBtn").onclick=openBudgetModal;
  el("budgetCancel").onclick=()=>el("budgetModal").classList.remove("show");
  el("budgetSave").onclick=saveBudgets;
  el("recurringBtn").onclick=()=>openRecModal();
  el("recClose").onclick=()=>el("recModal").classList.remove("show");
  el("settingsBtn").onclick=openSettings;
  el("settingsClose").onclick=()=>el("settingsModal").classList.remove("show");
  el("settingsSave").onclick=saveSettings;
  el("savingsBtn").onclick=openSavingsModal;
  el("savingsClose").onclick=()=>el("savingsModal").classList.remove("show");
  el("svAdd").onclick=addSavingsEntry;
  el("newBankAdd").onclick=addBank;
  el("svAmount").addEventListener("keydown",e=>{if(e.key==="Enter")addSavingsEntry();});
  el("newBankName").addEventListener("keydown",e=>{if(e.key==="Enter")addBank();});
  el("newBankRate").addEventListener("keydown",e=>{if(e.key==="Enter")addBank();});
  document.querySelectorAll("#svKindToggle button").forEach(b=>b.onclick=()=>{ pendingKind=b.dataset.k; document.querySelectorAll("#svKindToggle button").forEach(x=>x.classList.toggle("active",x.dataset.k===pendingKind)); });
  el("manageMembersBtn").onclick=openMemberModal;
  el("memberClose").onclick=()=>el("memberModal").classList.remove("show");
  el("newMemberAdd").onclick=addMember;
  el("newMemberName").addEventListener("keydown",e=>{if(e.key==="Enter")addMember();});
  el("manageBillsBtn").onclick=()=>openBillsModal();
  el("billsClose").onclick=()=>el("billsModal").classList.remove("show");
  el("newBillAdd").onclick=saveBill;
  el("newBillFreq").addEventListener("change",billFreqUI);
  el("newBillDay").addEventListener("keydown",e=>{if(e.key==="Enter")saveBill();});
  el("newBillAmount").addEventListener("keydown",e=>{if(e.key==="Enter")saveBill();});
  el("recEditCancel").onclick=()=>{ editingRecId=null; el("recEdit").style.display="none"; };
  el("recEditSave").onclick=saveRecEdit;
  el("obAddBank").onclick=obAddBank;
  el("obSkip").onclick=()=>{ state.onboarded=true; save(); el("onboardModal").classList.remove("show"); toast("You can set these up anytime"); };
  el("obFinish").onclick=finishOnboarding;
  el("obBankName").addEventListener("keydown",e=>{if(e.key==="Enter")obAddBank();});
  el("obBankBal").addEventListener("keydown",e=>{if(e.key==="Enter")obAddBank();});
  el("obBankRate").addEventListener("keydown",e=>{if(e.key==="Enter")obAddBank();});
  el("themeBtn").onclick=toggleTheme;
  el("themeBtn").addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){e.preventDefault();toggleTheme();} });
  el("nudgeExport").onclick=exportData;
  el("nudgeDismiss").onclick=()=>{ nudgeDismissed=true; state.changesSinceBackup=0; saveMeta(); renderNudge(); };
  ["search","filterMonth","filterType","filterCat"].forEach(id=>{
    el(id).addEventListener("input",()=>{ saveFilters(); renderStats(); renderSafeToSpend(); renderTx(); renderBudgets(); renderCharts(); });
  });
  const stickyModals={curModal:1,onboardModal:1};
  document.querySelectorAll(".overlay").forEach(o=>{ o.addEventListener("click",e=>{ if(e.target===o && !stickyModals[o.id]) o.classList.remove("show"); }); });
  document.addEventListener("keydown",e=>{ if(e.key==="Escape") document.querySelectorAll(".overlay.show").forEach(o=>{if(!stickyModals[o.id])o.classList.remove("show");}); });

  // ---- Interactive mascot ----
  (function mascot(){
    const buddy=el("buddy"), bounce=el("buddyBounce"), coin=el("coin"), pop=el("pop"),
          happy=el("happyEyes"), eyeL=el("eyeL"), eyeR=el("eyeR"),
          pupL=el("pupL"), pupR=el("pupR"), mouth=el("buddyMouth");
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches;
    let animating=false;
    let rafPending=false, lastX=0, lastY=0;
    function apply(){
      rafPending=false;
      const r=buddy.getBoundingClientRect();
      if(!r.width) return;
      const cx=r.left+r.width*0.5, cy=r.top+r.height*0.48;
      const dx=lastX-cx, dy=lastY-cy, d=Math.hypot(dx,dy)||1;
      const k=Math.min(1, d/120);
      const ox=(dx/d)*2.4*k, oy=(dy/d)*2.0*k;
      const t=`translate(${ox.toFixed(2)} ${oy.toFixed(2)})`;
      pupL.setAttribute("transform",t); pupR.setAttribute("transform",t);
    }
    window.addEventListener("mousemove",e=>{
      lastX=e.clientX; lastY=e.clientY;
      if(!rafPending){ rafPending=true; requestAnimationFrame(apply); }
    },{passive:true});
    function chomp(){
      if(animating) return;
      animating=true;
      const restoreD=mouth.getAttribute("d");
      eyeL.style.opacity=eyeR.style.opacity="0";
      happy.setAttribute("opacity","1");
      pop.setAttribute("opacity","1");
      if(reduce){
        setTimeout(()=>{ pop.setAttribute("opacity","0"); eyeL.style.opacity=eyeR.style.opacity="1"; happy.setAttribute("opacity","0"); animating=false; },600);
        return;
      }
      bounce.animate([
        {transform:'scale(1,1)'},{transform:'scale(1.12,0.9)'},
        {transform:'scale(0.95,1.07)'},{transform:'scale(1.03,0.98)'},{transform:'scale(1,1)'}
      ],{duration:640,easing:'ease-out'});
      coin.setAttribute("opacity","1");
      coin.animate([
        {transform:'translate(0px,46px) scale(1)',opacity:1},
        {transform:'translate(0px,6px) scale(1)',opacity:1,offset:.6},
        {transform:'translate(0px,0px) scale(0.15)',opacity:0}
      ],{duration:520,easing:'cubic-bezier(.4,0,.7,1)',fill:'forwards'});
      setTimeout(()=>mouth.setAttribute("d","M48 88 Q60 104 72 88"),330);
      setTimeout(()=>mouth.setAttribute("d",restoreD),560);
      pop.animate([
        {transform:'translate(0px,0px)',opacity:0},
        {transform:'translate(0px,-4px)',opacity:1,offset:.3},
        {transform:'translate(0px,-16px)',opacity:0}
      ],{duration:760,easing:'ease-out',fill:'forwards'});
      setTimeout(()=>{
        coin.setAttribute("opacity","0");
        pop.setAttribute("opacity","0");
        eyeL.style.opacity=eyeR.style.opacity="1";
        happy.setAttribute("opacity","0");
        animating=false;
      },770);
    }
    buddy.addEventListener("click",chomp);
    buddy.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); chomp(); } });
  })();

  // ---- Init ----
  runRecurring();
  applyTheme();
  refreshFilterOptions();
  restoreFilters();
  renderAll();
  ready=true;
  if(!state.currency) openCurrencyPicker();
};
