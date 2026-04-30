const Qs=[
  {n:1,q:"Where was Marie Curie born?",
   ch:["Paris","Warsaw","London","Berlin"],ans:1},
];

let done={},score=0;

function render(){
  const el=document.getElementById('qarea');
  el.innerHTML=Qs.map(q=>{
    return `<div class="qblock">
      <div class="qtext">${q.q}</div>
      ${q.ch.map((c,i)=>`
        <button class="ch" onclick="pick(${q.n},${i})">${c}</button>
      `).join('')}
    </div>`;
  }).join('');
}

function pick(qn,ci){
  const q=Qs.find(x=>x.n===qn);
  if(done[qn])return;
  done[qn]=true;

  const buttons=document.querySelectorAll(".ch");
  buttons.forEach((b,i)=>{
    if(i===q.ans) b.classList.add("correct");
    else if(i===ci) b.classList.add("wrong");
  });

  if(ci===q.ans) score++;
  document.getElementById('pf').style.width="100%";
  document.getElementById('pl').textContent="1 / 1";

  setTimeout(()=>{
    document.getElementById('scorearea').style.display='block';
    document.getElementById('snum').textContent=score+"/1";
  },800);
}

function restart(){ location.reload(); }

render();