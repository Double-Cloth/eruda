function installElementsEditor(eruda, container) {
  const elements = eruda.get('elements');
  const viewer = elements._domViewer;
  const root = container.shadowRoot;
  const tool = root.querySelector('.eruda-elements.eruda-tool');
  const controls = tool?.querySelector('.eruda-control');
  if (!viewer?.on || !controls) throw new Error('当前 Eruda 的 Elements 结构不兼容 DOM 编辑功能。');

  let selected = null;
  let target = null;
  let mode = 'html';
  let originalAttribute = '';
  let baseline;
  let disposed = false;
  const style = document.createElement('style');
  style.textContent = `
    .eruda-dom-edit-trigger { float:right; padding:0 12px; cursor:pointer; font:inherit; color:inherit; background:transparent; border:0; height:30px; }
    .eruda-dom-editor[hidden] { display:none !important; }
    .eruda-dom-editor { position:absolute; inset:0; z-index:10; display:flex; flex-direction:column; gap:10px; padding:12px; box-sizing:border-box; background:#fff; color:#222; font:14px/1.5 system-ui,sans-serif; overflow:auto; }
    .eruda-dom-editor[data-theme="dark"] { background:#202124; color:#e8eaed; color-scheme:dark; }
    .eruda-dom-editor header, .eruda-dom-editor nav, .eruda-dom-editor footer { display:flex; align-items:center; gap:8px; flex-wrap:wrap; flex-shrink:0; }
    .eruda-dom-editor header strong { flex:1; font-size:16px; }
    .eruda-dom-editor button { color:inherit; background:transparent; border:1px solid #888; border-radius:4px; padding:7px 12px; font:inherit; cursor:pointer; }
    .eruda-dom-editor button[aria-pressed="true"], .eruda-dom-editor button[type="submit"] { background:#1769d2; color:white; border-color:#1769d2; }
    .eruda-dom-editor button:disabled { opacity:.4; cursor:default; }
    .eruda-dom-editor input, .eruda-dom-editor textarea { display:block; width:100%; box-sizing:border-box; padding:8px; border:1px solid #888; border-radius:4px; background:transparent; color:inherit; font:16px/1.5 monospace; }
    .eruda-dom-editor .eruda-dom-edit-content { display:flex; flex-direction:column; flex:1; min-height:100px; }
    .eruda-dom-editor .eruda-dom-code { position:relative; flex:1; min-height:120px; --code-text:#222; --code-tag:#1756a9; --code-attribute:#854a00; --code-string:#13733c; --code-comment:#687078; --code-entity:#8e24aa; }
    .eruda-dom-editor[data-theme="dark"] .eruda-dom-code { --code-text:#e8eaed; --code-tag:#8ab4f8; --code-attribute:#fdd663; --code-string:#81c995; --code-comment:#a0a6ad; --code-entity:#d7aefb; }
    .eruda-dom-editor .eruda-dom-code textarea, .eruda-dom-editor .eruda-dom-code pre { position:absolute; inset:0; width:100%; height:100%; box-sizing:border-box; margin:0; padding:8px; font:16px/1.5 monospace; letter-spacing:normal; text-align:left; text-indent:0; text-transform:none; white-space:pre; overflow-wrap:normal; word-break:normal; tab-size:2; direction:ltr; }
    .eruda-dom-editor .eruda-dom-code pre { border:1px solid transparent; overflow:hidden; pointer-events:none; user-select:none; color:var(--code-text); background:transparent; }
    .eruda-dom-editor .eruda-dom-code code, .eruda-dom-editor .eruda-dom-code code span { font:inherit; letter-spacing:inherit; white-space:inherit; }
    .eruda-dom-editor .eruda-dom-code code { display:block; width:max-content; min-width:100%; color:inherit; transform-origin:top left; }
    .eruda-dom-editor .eruda-dom-code textarea { resize:none; overflow:auto; color:transparent; -webkit-text-fill-color:transparent; caret-color:var(--code-text); background:transparent; }
    .eruda-dom-editor .eruda-dom-code textarea::selection { background:rgba(80,140,220,.3); }
    .eruda-dom-editor .eruda-dom-code .syntax-tag { color:var(--code-tag); }
    .eruda-dom-editor .eruda-dom-code .syntax-attribute { color:var(--code-attribute); }
    .eruda-dom-editor .eruda-dom-code .syntax-string { color:var(--code-string); }
    .eruda-dom-editor .eruda-dom-code .syntax-comment { color:var(--code-comment); }
    .eruda-dom-editor .eruda-dom-code .syntax-entity { color:var(--code-entity); }
    @media (forced-colors:active) {
      .eruda-dom-editor .eruda-dom-code textarea { color:CanvasText; -webkit-text-fill-color:CanvasText; caret-color:CanvasText; }
      .eruda-dom-editor .eruda-dom-code pre { visibility:hidden; }
    }
    .eruda-dom-editor .eruda-dom-edit-node { overflow-wrap:anywhere; opacity:.75; }
    .eruda-dom-editor .eruda-dom-edit-hint { font-size:12px; opacity:.8; }
    .eruda-dom-editor [role="alert"] { color:#d93025; overflow-wrap:anywhere; }
  `.replaceAll('.eruda-dom-editor', '.eruda-container .eruda-dom-editor')
    .replaceAll('.eruda-dom-edit-trigger', '.eruda-container .eruda-dom-edit-trigger');
  root.appendChild(style);
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'eruda-dom-edit-trigger';
  trigger.textContent = '编辑';
  trigger.title = '编辑选中的 DOM 节点';
  controls.appendChild(trigger);
  const editor = document.createElement('form');
  editor.className = 'eruda-dom-editor';
  editor.setAttribute('aria-label', '编辑 DOM');
  editor.hidden = true;
  // 仅包含固定 UI 文本；用户 DOM 内容通过 value/textContent 写入。
  editor.innerHTML = `
    <header><strong>编辑 DOM</strong><button type="button" data-action="cancel">取消</button></header>
    <div class="eruda-dom-edit-node"></div>
    <nav aria-label="编辑类型">
      <button type="button" data-mode="html">HTML</button>
      <button type="button" data-mode="text">文本</button>
      <button type="button" data-mode="attribute">属性</button>
    </nav>
    <label class="eruda-dom-edit-name">属性名<input name="attributeName" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <label class="eruda-dom-edit-content"><span></span><div class="eruda-dom-code"><pre aria-hidden="true"><code></code></pre><textarea name="value" wrap="off" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea></div></label>
    <div class="eruda-dom-edit-hint"></div>
    <div role="alert"></div>
    <footer><button type="submit">应用修改</button><button type="button" data-action="delete">删除属性</button></footer>
  `;
  tool.appendChild(editor);
  const value = editor.querySelector('textarea');
  const highlighted = editor.querySelector('.eruda-dom-code code');
  const nameInput = editor.querySelector('input');
  const error = editor.querySelector('[role="alert"]');
  const nodeLabel = editor.querySelector('.eruda-dom-edit-node');
  const nameLabel = editor.querySelector('.eruda-dom-edit-name');
  const contentLabel = editor.querySelector('.eruda-dom-edit-content span');
  const hint = editor.querySelector('.eruda-dom-edit-hint');
  const removeButton = editor.querySelector('[data-action="delete"]');

  let highlightFrame = 0;
  function syncCodeScroll() {
    highlighted.style.transform = `translate(${-value.scrollLeft}px, ${-value.scrollTop}px)`;
  }
  function renderHighlight() {
    cancelAnimationFrame(highlightFrame);
    highlightFrame = 0;
    const source = value.value;
    const fragment = document.createDocumentFragment();
    function append(text, type) {
      if (!type) { fragment.appendChild(document.createTextNode(text)); return; }
      const span = document.createElement('span');
      span.className = `syntax-${type}`;
      span.textContent = text;
      fragment.appendChild(span);
    }
    // 只生成文本与固定颜色 span，不将待编辑 HTML 插入文档或下载高亮依赖。
    // 大节点保留完整可编辑内容，降低逐键着色的开销。
    if (source.length > 200_000 || mode === 'text') append(source);
    else if (mode === 'attribute') append(source, 'string');
    else {
      const outside = /<!--[\s\S]*?(?:-->|$)|<![^>]*(?:>|$)|<\/?[A-Za-z][^\s/>]*|&(?:#x[\da-f]+|#\d+|[a-z][\da-z]*);|[^<&]+|[<&]/giy;
      const inside = /\s+|\/?>|=|"[^"]*"?|'[^']*'?|[^\s=<>"'/]+|[\s\S]/gy;
      let inTag = false;
      let attributeValue = false;
      let position = 0;
      let rawTag = '';
      while (position < source.length) {
        // script/style 中的原始文本不按 HTML 标签解析，避免比较符号被误着色。
        if (rawTag && !inTag) {
          const end = new RegExp(`</${rawTag}(?=[\\s/>])`, 'gi');
          end.lastIndex = position;
          const match = end.exec(source);
          const next = match ? match.index : source.length;
          append(source.slice(position, next));
          position = next;
          rawTag = '';
          if (position === source.length) break;
        }
        const pattern = inTag ? inside : outside;
        pattern.lastIndex = position;
        const token = pattern.exec(source)[0];
        let type;
        if (!inTag) {
          if (token.startsWith('<!')) type = 'comment';
          else if (/^<\/?[A-Za-z]/.test(token)) {
            type = 'tag'; inTag = true; attributeValue = false;
            if (/^<(script|style)$/i.test(token)) rawTag = token.slice(1);
          } else if (token.startsWith('&') && token.endsWith(';')) type = 'entity';
        } else if (/^\/?>$/.test(token)) { type = 'tag'; inTag = false; }
        else if (token === '=') attributeValue = true;
        else if (!/^\s+$/.test(token)) {
          type = attributeValue || /^["']/.test(token) ? 'string' : 'attribute';
          attributeValue = false;
        }
        append(token, type);
        position = pattern.lastIndex;
      }
    }
    highlighted.replaceChildren(fragment);
    syncCodeScroll();
  }
  value.addEventListener('input', () => {
    if (!highlightFrame) highlightFrame = requestAnimationFrame(renderHighlight);
  });
  value.addEventListener('scroll', syncCodeScroll);

  const isElement = (node) => node?.nodeType === Node.ELEMENT_NODE;
  const structuralRoot = (node) => [document.documentElement, document.head, document.body].includes(node);
  const editable = (node) => node?.isConnected && [1, 3, 8].includes(node.nodeType)
    && node !== container && node !== document.getElementById('eruda-offline-bridge')
    && node.getRootNode() !== root;
  function read() {
    if (mode === 'attribute') return target.getAttribute(originalAttribute);
    if (mode === 'text') return target.textContent;
    return target.outerHTML;
  }
  function setMode(nextMode, attribute = '') {
    mode = nextMode;
    originalAttribute = attribute;
    nameInput.value = attribute;
    baseline = read();
    value.value = baseline ?? '';
    value.scrollTop = 0;
    value.scrollLeft = 0;
    renderHighlight();
    nameLabel.hidden = mode !== 'attribute';
    removeButton.hidden = mode !== 'attribute';
    removeButton.disabled = !originalAttribute || baseline === null;
    contentLabel.textContent = { html: '节点 HTML', text: '文本内容', attribute: '属性值（可为空）' }[mode];
    hint.textContent = {
      html: '替换整个节点。原节点及子节点上的事件绑定不会保留。',
      text: isElement(target) ? '替换元素内的全部内容，子元素将变为纯文本。' : '修改当前文本或注释，不替换其他节点。',
      attribute: '修改或新增属性，保留节点和事件绑定。',
    }[mode];
    for (const button of editor.querySelectorAll('[data-mode]')) {
      button.disabled = button.dataset.mode === 'attribute' ? !isElement(target)
        : structuralRoot(target) || (button.dataset.mode === 'html' && !isElement(target));
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }
    error.textContent = '';
  }
  function open(node, nextMode, attribute = '') {
    if (!editable(node)) return;
    target = node;
    nodeLabel.textContent = isElement(node) ? `<${node.localName}${node.id ? `#${node.id}` : ''}>`
      : node.nodeType === Node.COMMENT_NODE ? '#comment' : '#text';
    editor.dataset.theme = eruda.util.isDarkTheme() ? 'dark' : 'light';
    setMode(structuralRoot(node) ? 'attribute' : nextMode, attribute);
    editor.hidden = false;
    value.focus({ preventScroll: true });
  }
  function close() { editor.hidden = true; target = null; }
  function selectedNode(node) { selected = node; }
  viewer.on('select', selectedNode);
  elements.on('change', selectedNode);
  // 上游在选中节点被移除时调用了不存在的 set，导致观察器中断。
  // 选择仍在文档中的祖先；队列耗尽时回到根节点，避免动态页面留下失效选择。
  const originalBack = elements._back;
  const recoverSelection = () => {
    const parent = elements._curParentQueue?.find((node) => isElement(node) && node.isConnected);
    elements.select(parent || document.body || document.documentElement);
  };
  viewer.off('deselect', originalBack);
  viewer.on('deselect', recoverSelection);
  function findRowViewer(row) {
    // 按行对象匹配，支持无 id、重复属性、结束标签及 Shadow DOM 中的节点。
    const pending = [viewer];
    while (pending.length) {
      const current = pending.pop();
      if (current.$tag?.get(0) === row) return current;
      if (current.endTagDomViewer) pending.push(current.endTagDomViewer);
      for (const child of current.childNodeDomViewers || []) pending.push(child);
    }
    return null;
  }
  const onClick = (event) => {
    if (editor.contains(event.target) || event.target.closest('.luna-dom-viewer-toggle')) return;
    const row = event.target.closest('.luna-dom-viewer-tree-item');
    if (!row) return;
    const rowViewer = findRowViewer(row);
    const node = rowViewer?.getOption('node');
    if (!editable(node)) return;
    const attribute = event.target.closest('.luna-dom-viewer-attribute');
    const name = attribute?.querySelector('.luna-dom-viewer-attribute-name')?.textContent;
    // 捕获阶段统一处理，不依赖上游在触摸端 click、桌面端 mousedown 的事件差异。
    event.stopPropagation();
    rowViewer.select();
    selected = node;
    open(node, name ? 'attribute' : isElement(node) ? 'html' : 'text', name || '');
  };
  tool.addEventListener('click', onClick, true);
  trigger.addEventListener('click', () => open(selected || elements._curNode, isElement(selected || elements._curNode) ? 'html' : 'text'));
  editor.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (button?.dataset.action === 'cancel') close();
    if (button?.dataset.mode && button.dataset.mode !== mode) setMode(button.dataset.mode);
    if (button?.dataset.action === 'delete') apply(true);
  });
  editor.addEventListener('keydown', (event) => {
    // 输入时不要触发 DOM 树的方向键快捷操作。
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  });
  editor.addEventListener('submit', (event) => { event.preventDefault(); apply(false); });

  function apply(remove) {
    try {
      if (!editable(target)) throw new Error('该节点已被页面移除，请重新选择。');
      if (read() !== baseline) throw new Error('页面已更新该内容，请取消后重新打开编辑。');
      let nextSelection = target;
      if (mode === 'attribute') {
        if (remove) target.removeAttribute(originalAttribute);
        else {
          const name = nameInput.value.trim();
          if (!name) throw new Error('请输入属性名。');
          // 在未挂载节点上验证名称，避免改名失败后丢失原属性。
          document.createAttribute(name);
          target.setAttribute(name, value.value);
          const sameName = target.namespaceURI === 'http://www.w3.org/1999/xhtml'
            ? name.toLowerCase() === originalAttribute.toLowerCase() : name === originalAttribute;
          if (originalAttribute && !sameName) target.removeAttribute(originalAttribute);
        }
      } else {
        if (structuralRoot(target)) throw new Error('html、head、body 根节点请通过属性编辑或选择其子节点修改。');
        if (mode === 'text') target.textContent = value.value;
        else {
          // 在没有浏览上下文的文档中按父节点上下文解析，支持 table/SVG 且不进行网络预览。
          const inert = document.implementation.createHTMLDocument('');
          const parent = target.parentElement ? inert.importNode(target.parentElement, false) : inert.createElement('div');
          parent.innerHTML = value.value;
          const nodes = Array.from(parent.childNodes).filter((node) => node.nodeType !== Node.TEXT_NODE || node.textContent.trim());
          if (nodes.length !== 1 || !isElement(nodes[0])) throw new Error('HTML 必须包含一个完整的元素节点。');
          const replacement = document.importNode(nodes[0], true);
          // 先移开树中的选择，防止上游观察器在删除选中节点时留下失效引用。
          elements.select(target.parentElement || target.getRootNode().host);
          target.replaceWith(replacement);
          nextSelection = replacement;
        }
      }
      close();
      selected = nextSelection;
      setTimeout(() => {
        if (!disposed && nextSelection.isConnected) {
          if (isElement(nextSelection)) elements.select(nextSelection);
          eruda.get().notify('DOM 已修改', { icon: 'success' });
        }
      }, 0);
    } catch (reason) { error.textContent = reason.message || String(reason); }
  }
  return () => {
    disposed = true;
    cancelAnimationFrame(highlightFrame);
    viewer.off('select', selectedNode);
    elements.off('change', selectedNode);
    viewer.off('deselect', recoverSelection);
    viewer.on('deselect', originalBack);
    tool.removeEventListener('click', onClick, true);
    trigger.remove(); editor.remove(); style.remove();
  };
}
