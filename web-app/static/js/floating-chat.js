function escapeHtml(text){return text.replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}
async function askPostureAI(text){const res=await fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text})});return await res.json();}
function setupFloatingChat(){const fab=document.getElementById('chat-fab');const panel=document.getElementById('chat-panel');if(!fab||!panel)return;const close=document.getElementById('chat-close');const form=document.getElementById('float-chat-form');const input=document.getElementById('float-chat-input');const messages=document.getElementById('float-messages');fab.onclick=()=>{panel.classList.add('open');panel.setAttribute('aria-hidden','false');input.focus();};close.onclick=()=>{panel.classList.remove('open');panel.setAttribute('aria-hidden','true');};form.onsubmit=async(e)=>{e.preventDefault();const text=input.value.trim();if(!text)return;messages.insertAdjacentHTML('beforeend',`<div class="float-user">${escapeHtml(text)}</div>`);input.value='';messages.scrollTop=messages.scrollHeight;const typing=document.createElement('div');typing.className='float-bot';typing.textContent='Thinking...';messages.appendChild(typing);try{const data=await askPostureAI(text);typing.innerHTML=escapeHtml(data.error?('⚠️ '+data.error):data.reply).replace(/\n/g,'<br>');}catch(err){typing.textContent='Connection error. Check Flask and Ollama.';}messages.scrollTop=messages.scrollHeight;};}
document.addEventListener('DOMContentLoaded',setupFloatingChat);
function openFloatingChatbot() {
  document.getElementById("floatingChatPanel").classList.add("open");
}

function closeFloatingChatbot() {
  document.getElementById("floatingChatPanel").classList.remove("open");
}

async function sendFloatingMessage() {
  const input = document.getElementById("floatingChatInput");
  const messages = document.getElementById("floatingMessages");

  const text = input.value.trim();
  if (!text) return;

  messages.innerHTML += `<div class="float-user">${text}</div>`;
  input.value = "";

  const res = await fetch("/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message: text })
  });

  const data = await res.json();

  messages.innerHTML += `<div class="float-bot">${data.reply || data.error}</div>`;
  messages.scrollTop = messages.scrollHeight;
}