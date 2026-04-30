const Qs=[
{q:"When Marie Curie was young, she",ch:["moved to Paris","was very good at science","did not study","won prize"],ans:1},
{q:"Why unusual?",ch:["far","language","women didn't study science","no science"],ans:2},
{q:"What discovered?",ch:["xray","elements","prize","math"],ans:1},
{q:"WW1?",ch:["book","element","xray machines","prize"],ans:2},
{q:"Main idea?",ch:["universities","scientist helped people","xray","nobel"],ans:1}
];

let current=0,score=0,selected=null;

function render(){
  const q=Qs[current];
  document.getElementById("qarea").innerHTML=
    `<div class="card">
      <div>${q.q}</div>
      ${q.ch.map((c,i)=>`<button class="ch" onclick="select(${i})">${c}</button>`).join("")}
    </div>`;
  updateProg();
}

function select(i){
  selected=i;
  document.querySelectorAll(".ch").forEach((b,idx)=>{
    b.classList.toggle("selected",idx===i);
  });
}

document.getElementById("checkBtn").onclick=()=>{
  if(selected===null) return;
  const q=Qs[current];
  const buttons=document.querySelectorAll(".ch");
  buttons[q.ans].classList.add("correct");
  if(selected!==q.ans) buttons[selected].classList.add("wrong");
  if(selected===q.ans) score++;

  setTimeout(()=>{
    current++;
    selected=null;
    if(current<Qs.length) render();
    else showScore();
  },800);
};

function updateProg(){
  document.getElementById("pf").style.width=((current)/Qs.length*100)+"%";
  document.getElementById("pl").textContent=(current+1)+" / "+Qs.length;
}

function showScore(){
  document.getElementById("scorearea").style.display="block";
  document.getElementById("snum").textContent=score+"/"+Qs.length;
}

function restart(){location.reload();}

render();
