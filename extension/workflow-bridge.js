// MAIN-world adapter for n8n 2.26.9 WorkflowCard.vue. Reads IDs only; no stores/APIs changed.
(() => {
  if (window.__n8nmeterWorkflowBridge) return;
  window.__n8nmeterWorkflowBridge = true;
  let scheduled = false;
  const diagnostic = {version: 'row-4', mounted: false, visited: 0, components: 0};
  const isCard = c => c?.type?.__name === 'WorkflowCard' || c?.type?.name === 'WorkflowCard' || c?.type?.__file?.endsWith('/WorkflowCard.vue');
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
  function productionCards() {
    // Vue production builds omit el.__vueParentComponent. The renderer still keeps
    // its root VNode on the mount container; follow component subtrees instead.
    const result = new Map(), seen = new Set();
    const mount = document.querySelector('#app');
    const queue = [mount?._vnode, mount?.__vue_app__?._container?._vnode];
    diagnostic.mounted = Boolean(queue.some(Boolean));
    diagnostic.components = 0;
    let visited = 0;
    while (queue.length && visited++ < 50000) {
      const node = queue.pop();
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      const component = node.component;
      if (isCard(component)) diagnostic.components++;
      if (isCard(component) && validId(component.props?.data?.id)) {
        const element = node.el || component.subTree?.el;
        if (element?.matches?.('.card, [data-test-id="workflow-card"]') && element.querySelector('[data-test-id="workflow-card-actions"]')) result.set(element, component.props.data.id);
      }
      if (component?.subTree) queue.push(component.subTree);
      if (Array.isArray(node.children)) queue.push(...node.children);
      if (node.suspense?.activeBranch) queue.push(node.suspense.activeBranch);
    }
    diagnostic.visited = visited;
    return result;
  }
  function scan() {
    scheduled = false;
    const vnodeCards = productionCards();
    for (const card of vnodeCards.keys()) {if(!card.hasAttribute('data-n8nmeter-card'))card.setAttribute('data-n8nmeter-card','');}
    for (const card of document.querySelectorAll('[data-n8nmeter-card], [data-test-id="workflow-card"]')) {
      let component = card.__vueParentComponent, id = vnodeCards.get(card) || null;
      for (let depth = 0; component && depth < 12; depth++, component = component.parent) {
        if (isCard(component)) {
          const value = component.props?.data?.id;
          if (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)) id = value;
          break;
        }
      }
      if (id) { if(card.dataset.n8nmeterWorkflowId !== id)card.dataset.n8nmeterWorkflowId = id; }
      else if(card.hasAttribute('data-n8nmeter-workflow-id'))card.removeAttribute('data-n8nmeter-workflow-id');
    }
  }
  const observer = new MutationObserver(() => { if(!scheduled){scheduled=true;requestAnimationFrame(scan);} });
  observer.observe(document.documentElement,{subtree:true,childList:true});
  // Vue may recycle a card while only props change, without replacing its root element.
  setInterval(scan,1500);
  scan();
})();
