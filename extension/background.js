const allowed = new Set(['http://127.0.0.1:7811','http://localhost:7811','http://localhost:15679','http://127.0.0.1:15679']);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'n8nmeter:summary' || !sender.tab || !allowed.has(new URL(sender.tab.url).origin)) return;
  fetch('http://127.0.0.1:7810/api/summary', {cache:'no-store', signal:AbortSignal.timeout(8000)})
    .then(response => { if(!response.ok)throw new Error('Collector unavailable');return response.json();})
    .then(data => respond({data}))
    .catch(() => respond({error:'수집기에 연결할 수 없습니다. 로컬 n8n Meter 컨테이너를 확인해 주세요.'}));
  return true;
});
