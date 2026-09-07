document.getElementById('open').onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    const allowed=['http://127.0.0.1:7811','http://localhost:7811','http://localhost:15679','http://127.0.0.1:15679'];
    if(!tab?.url || !allowed.includes(new URL(tab.url).origin))throw new Error('연결된 로컬 n8n(http://127.0.0.1:7811)을 열어 주세요.');
    await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files:['workflow-bridge.js']});
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['workflow-usage.js','overlay.js']});
    window.close();
  }catch(error){document.getElementById('status').textContent=error.message;}
};
