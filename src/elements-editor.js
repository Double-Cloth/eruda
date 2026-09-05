function installElementsEditor(eruda, container) {
  const elements = eruda.get('elements');
  const viewer = elements._domViewer;
  const root = container.shadowRoot;
  const tool = root.querySelector('.eruda-elements.eruda-tool');
  const controls = tool?.querySelector('.eruda-control');
  if (!viewer?.on || !controls) throw new Error('当前 Eruda 的 Elements 结构不兼容 DOM 编辑功能。');

  let selected = null;
  let pendingEdit = null;
  let target = null;
  let operation = 'edit';
  let mode = 'html';
  let insertPosition = 'beforeend';
  let insertionBaseline = null;
  let originalAttribute = '';
  let baseline;
  let baselineNodes;
  let disposed = false;
  const style = document.createElement('style');
  style.textContent = `
    .eruda-dom-actions { float:right; display:flex; width:auto !important; height:30px; margin-right:72px; position:relative; z-index:1; }
    .eruda-dom-action-trigger { flex:0 0 auto; width:auto !important; min-width:40px; height:30px; padding:0 8px; box-sizing:border-box; cursor:pointer; font:12px/30px system-ui,sans-serif; white-space:nowrap; color:inherit; background:transparent; border:0; }
    .eruda-dom-editor[hidden] { display:none !important; }
    .eruda-dom-editor { position:absolute; inset:0; z-index:10; display:flex; flex-direction:column; gap:10px; padding:12px; box-sizing:border-box; background:#fff; color:#222; font:14px/1.5 system-ui,sans-serif; overflow:hidden; }
    .eruda-dom-editor[data-theme="dark"] { background:#202124; color:#e8eaed; color-scheme:dark; }
    .eruda-dom-editor header, .eruda-dom-editor nav, .eruda-dom-editor footer { display:flex; align-items:center; gap:8px; flex-wrap:wrap; flex-shrink:0; }
    .eruda-dom-editor header strong { flex:1; font-size:16px; }
    .eruda-dom-editor button { color:inherit; background:transparent; border:1px solid #888; border-radius:4px; padding:7px 12px; font:inherit; cursor:pointer; }
    .eruda-dom-editor button[aria-pressed="true"], .eruda-dom-editor button[type="submit"] { background:#1769d2; color:white; border-color:#1769d2; }
    .eruda-dom-editor button:disabled { opacity:.4; cursor:default; }
    .eruda-dom-editor input, .eruda-dom-editor textarea { display:block; width:100%; box-sizing:border-box; padding:8px; border:1px solid #888; border-radius:4px; background:transparent; color:inherit; font:16px/1.5 monospace; }
    .eruda-dom-editor .eruda-dom-edit-fields { display:flex; flex-direction:column; flex:1; min-height:0; gap:10px; overflow:auto; padding-bottom:2px; }
    .eruda-dom-editor .eruda-dom-edit-fields > * { flex-shrink:0; }
    .eruda-dom-editor .eruda-dom-edit-content { display:flex; flex-direction:column; flex:1 0 146px; min-height:146px; }
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
    .eruda-dom-editor .eruda-dom-edit-attributes { display:flex; flex-direction:column; gap:6px; max-height:150px; overflow:auto; flex-shrink:0; }
    .eruda-dom-editor .eruda-dom-edit-attributes button { text-align:left; overflow-wrap:anywhere; white-space:pre-wrap; }
    .eruda-dom-editor [hidden] { display:none !important; }
    .eruda-dom-editor .eruda-dom-edit-hint { font-size:12px; opacity:.8; }
    .eruda-dom-editor [role="alert"] { color:#d93025; overflow-wrap:anywhere; }
  `.replaceAll('.eruda-dom-editor', '.eruda-container .eruda-dom-editor')
    .replaceAll('.eruda-dom-actions', '.eruda-container .eruda-dom-actions')
    .replaceAll('.eruda-dom-action-trigger', '.eruda-container .eruda-dom-action-trigger');
  root.appendChild(style);
  const actions = document.createElement('div');
  actions.className = 'eruda-dom-actions';
  actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', 'DOM 操作');
  controls.appendChild(actions);
  function createTrigger(text, title, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `eruda-dom-action-trigger eruda-dom-${action}-trigger`;
    button.textContent = text;
    button.title = title;
    actions.appendChild(button);
    return button;
  }
  const editTrigger = createTrigger('编辑', '编辑选中的 DOM 节点', 'edit');
  const insertTrigger = createTrigger('插入', '在选中的 DOM 节点附近或内部插入内容', 'insert');
  const editor = document.createElement('form');
  editor.className = 'eruda-dom-editor';
  editor.setAttribute('aria-label', '编辑 DOM');
  editor.hidden = true;
  // 仅包含固定 UI 文本；用户 DOM 内容通过 value/textContent 写入。
  editor.innerHTML = `
    <header><strong>编辑 DOM</strong><button type="button" data-action="cancel">取消</button></header>
    <div class="eruda-dom-edit-fields">
    <div class="eruda-dom-edit-node"></div>
    <nav class="eruda-dom-edit-modes" aria-label="编辑类型">
      <button type="button" data-mode="html">HTML</button>
      <button type="button" data-mode="text">文本</button>
      <button type="button" data-mode="attribute">属性</button>
    </nav>
    <nav class="eruda-dom-insert-positions" aria-label="插入位置" hidden>
      <button type="button" data-position="beforebegin">之前</button>
      <button type="button" data-position="afterbegin">内部开头</button>
      <button type="button" data-position="beforeend">内部末尾</button>
      <button type="button" data-position="afterend">之后</button>
    </nav>
    <div class="eruda-dom-edit-attributes" role="group" aria-label="现有属性"></div>
    <label class="eruda-dom-edit-name">属性名<input name="attributeName" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <label class="eruda-dom-edit-content"><span></span><div class="eruda-dom-code"><pre aria-hidden="true"><code></code></pre><textarea name="value" wrap="off" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea></div></label>
    <div class="eruda-dom-edit-hint"></div>
    <div role="alert"></div>
    </div>
    <footer><button type="submit">应用修改</button><button type="button" data-action="delete">删除属性</button></footer>
  `;
  tool.appendChild(editor);
  const value = editor.querySelector('textarea');
  const heading = editor.querySelector('header strong');
  const highlighted = editor.querySelector('.eruda-dom-code code');
  const nameInput = editor.querySelector('input');
  const error = editor.querySelector('[role="alert"]');
  const nodeLabel = editor.querySelector('.eruda-dom-edit-node');
  const nameLabel = editor.querySelector('.eruda-dom-edit-name');
  const attributeList = editor.querySelector('.eruda-dom-edit-attributes');
  const contentLabel = editor.querySelector('.eruda-dom-edit-content span');
  const hint = editor.querySelector('.eruda-dom-edit-hint');
  const editModes = editor.querySelector('.eruda-dom-edit-modes');
  const insertPositions = editor.querySelector('.eruda-dom-insert-positions');
  const submitButton = editor.querySelector('button[type="submit"]');
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
    error.textContent = '';
    if (!highlightFrame) highlightFrame = requestAnimationFrame(renderHighlight);
  });
  value.addEventListener('scroll', syncCodeScroll);

  const isElement = (node) => node?.nodeType === Node.ELEMENT_NODE;
  const isShadow = (node) => node?.nodeType === Node.DOCUMENT_FRAGMENT_NODE && !!node.host;
  const content = (node) => node.namespaceURI === 'http://www.w3.org/1999/xhtml' && node.localName === 'template' ? node.content : node;
  const structuralRoot = (node) => [document.documentElement, document.head, document.body].includes(node);
  const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const canContain = (node) => isShadow(node) || (isElement(node)
    && !(node.namespaceURI === 'http://www.w3.org/1999/xhtml' && voidElements.has(node.localName)));
  const editable = (node) => node?.isConnected && ([1, 3, 8].includes(node.nodeType) || isShadow(node))
    && node !== container && node !== document.getElementById('eruda-offline-bridge')
    && node.getRootNode() !== root;
  function read() {
    if (mode === 'attribute') return JSON.stringify(Array.from(target.attributes, ({ name, value, namespaceURI }) => [name, value, namespaceURI]));
    if (mode === 'text') return content(target).textContent;
    if (isShadow(target)) return target.innerHTML;
    if (isElement(target)) return target.outerHTML;
    if (target.nodeType === Node.TEXT_NODE && ['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'].includes(target.parentElement?.localName)) return target.nodeValue;
    return new XMLSerializer().serializeToString(target);
  }
  function snapshotNodes(node) {
    const nodes = [];
    const pending = [node];
    while (pending.length) {
      const current = pending.pop();
      nodes.push(current);
      for (const child of content(current).childNodes) pending.push(child);
    }
    return nodes;
  }
  function setMode(nextMode, attribute) {
    mode = nextMode;
    originalAttribute = mode === 'attribute' ? (attribute ?? target.attributes[0]?.name ?? '') : '';
    nameInput.value = originalAttribute;
    baseline = read();
    baselineNodes = mode === 'attribute' ? null : snapshotNodes(target);
    value.value = mode === 'attribute' ? target.getAttribute(originalAttribute) ?? '' : baseline ?? '';
    value.scrollTop = 0;
    value.scrollLeft = 0;
    renderHighlight();
    nameLabel.hidden = mode !== 'attribute';
    attributeList.hidden = mode !== 'attribute';
    attributeList.replaceChildren();
    if (mode === 'attribute') {
      for (const attribute of target.attributes) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.attribute = attribute.name;
        button.textContent = `${attribute.name}="${attribute.value}"`;
        button.setAttribute('aria-pressed', String(attribute.name === originalAttribute));
        attributeList.appendChild(button);
      }
      const add = document.createElement('button');
      add.type = 'button';
      add.dataset.attribute = '';
      add.textContent = target.attributes.length ? '+ 新增属性' : '暂无属性，点击新增';
      attributeList.appendChild(add);
    }
    removeButton.hidden = mode !== 'attribute';
    removeButton.disabled = !originalAttribute || !target.hasAttribute(originalAttribute);
    contentLabel.textContent = { html: '节点 HTML', text: '文本内容', attribute: '属性值（可为空）' }[mode];
    hint.textContent = {
      html: isShadow(target) ? '编辑 ShadowRoot 内的 HTML，可包含多个节点；尽量复用原节点和事件绑定。'
        : '按差异更新并尽量保留事件绑定；更换标签或节点类型时，该节点自身的绑定无法保留。',
      text: isElement(target) || isShadow(target) ? '替换内部全部内容，子元素将变为纯文本。' : '修改当前文本或注释，不替换其他节点。',
      attribute: '选择已有属性修改，或点击新增。空值保留属性，删除请用“删除属性”；布尔属性以是否存在为准。',
    }[mode];
    for (const button of editor.querySelectorAll('[data-mode]')) {
      button.disabled = button.dataset.mode === 'attribute' ? !isElement(target)
        : structuralRoot(target);
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }
    error.textContent = '';
  }
  function labelNode(node) {
    nodeLabel.textContent = isElement(node) ? `<${node.localName}${node.id ? `#${node.id}` : ''}>`
      : isShadow(node) ? '#shadow-root' : node.nodeType === Node.COMMENT_NODE ? '#comment' : '#text';
  }
  function openEdit(node, nextMode, attribute) {
    pendingEdit = null;
    if (!editable(node)) return;
    target = node;
    operation = 'edit';
    labelNode(node);
    editor.dataset.theme = eruda.util.isDarkTheme() ? 'dark' : 'light';
    editor.setAttribute('aria-label', '编辑 DOM');
    heading.textContent = '编辑 DOM';
    submitButton.textContent = '应用修改';
    editModes.hidden = false;
    insertPositions.hidden = true;
    setMode(structuralRoot(node) ? 'attribute' : nextMode, attribute);
    editor.querySelector('.eruda-dom-edit-fields').scrollTop = 0;
    editor.hidden = false;
    value.focus({ preventScroll: true });
  }
  function canInsertAt(node, position) {
    if (!editable(node)) return false;
    if (position === 'afterbegin' || position === 'beforeend') return canContain(node);
    return !isShadow(node) && !!node.parentNode && node.parentNode.nodeType !== Node.DOCUMENT_NODE;
  }
  function insertionPoint(position) {
    if (!canInsertAt(target, position)) return null;
    if (position === 'beforebegin') return { parent: target.parentNode, reference: target };
    if (position === 'afterend') return { parent: target.parentNode, reference: target.nextSibling };
    const parent = content(target);
    return { parent, reference: position === 'afterbegin' ? parent.firstChild : null };
  }
  function setInsertPosition(position) {
    if (!canInsertAt(target, position)) return;
    insertPosition = position;
    insertionBaseline = insertionPoint(position);
    for (const button of insertPositions.querySelectorAll('[data-position]')) {
      button.disabled = !canInsertAt(target, button.dataset.position);
      button.setAttribute('aria-pressed', String(button.dataset.position === position));
    }
    error.textContent = '';
  }
  function openInsert(node) {
    pendingEdit = null;
    if (!editable(node)) return;
    const defaultPosition = canContain(node) ? 'beforeend' : 'afterend';
    if (!canInsertAt(node, defaultPosition)) return;
    target = node;
    operation = 'insert';
    labelNode(node);
    editor.dataset.theme = eruda.util.isDarkTheme() ? 'dark' : 'light';
    editor.setAttribute('aria-label', '插入 DOM');
    heading.textContent = '插入 DOM';
    submitButton.textContent = '插入 DOM';
    editModes.hidden = true;
    insertPositions.hidden = false;
    nameLabel.hidden = true;
    attributeList.hidden = true;
    removeButton.hidden = true;
    contentLabel.textContent = 'DOM HTML';
    hint.textContent = '可插入一个或多个元素、文本或注释；将按目标上下文保留表格、SVG 和 MathML 语义。';
    mode = 'html';
    value.value = '';
    value.scrollTop = 0;
    value.scrollLeft = 0;
    renderHighlight();
    setInsertPosition(defaultPosition);
    editor.querySelector('.eruda-dom-edit-fields').scrollTop = 0;
    editor.hidden = false;
    value.focus({ preventScroll: true });
  }
  function close() {
    editor.hidden = true;
    target = null;
    baselineNodes = null;
    baseline = null;
    insertionBaseline = null;
  }
  function selectedNode(node) {
    if (selected !== node) pendingEdit = null;
    selected = node;
  }
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
    if (!tool.contains(event.target) || editor.contains(event.target) || event.target.closest('.luna-dom-viewer-toggle')) {
      pendingEdit = null;
      return;
    }
    const row = event.target.closest('.luna-dom-viewer-tree-item');
    if (!row) { pendingEdit = null; return; }
    const rowViewer = findRowViewer(row);
    const node = rowViewer?.getOption('node');
    if (!editable(node)) { pendingEdit = null; return; }
    const attribute = event.target.closest('.luna-dom-viewer-attribute');
    const name = attribute?.querySelector('.luna-dom-viewer-attribute-name')?.textContent;
    // 捕获阶段统一处理，不依赖上游在触摸端 click、桌面端 mousedown 的事件差异。
    event.stopPropagation();
    rowViewer.select();
    selected = node;
    // 第一次只选中；再次点击同一行的同一编辑位置才打开，兼容手机两次点按。
    if (pendingEdit?.row !== row || pendingEdit.node !== node || pendingEdit.name !== name) {
      pendingEdit = { row, node, name };
      return;
    }
    openEdit(node, name ? 'attribute' : isElement(node) || isShadow(node) ? 'html' : 'text', name);
  };
  root.addEventListener('click', onClick, true);
  editTrigger.addEventListener('click', () => {
    const node = selected || elements._curNode;
    openEdit(node, isElement(node) || isShadow(node) ? 'html' : 'text');
  });
  insertTrigger.addEventListener('click', () => openInsert(selected || elements._curNode));
  editor.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (button?.dataset.action === 'cancel') close();
    if (operation === 'edit' && button?.dataset.mode && button.dataset.mode !== mode) setMode(button.dataset.mode);
    if (operation === 'edit' && button?.dataset.attribute !== undefined) setMode('attribute', button.dataset.attribute);
    if (operation === 'insert' && button?.dataset.position) setInsertPosition(button.dataset.position);
    if (operation === 'edit' && button?.dataset.action === 'delete') apply(true);
  });
  editor.addEventListener('keydown', (event) => {
    // 输入时不要触发 DOM 树的方向键快捷操作。
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  });
  editor.addEventListener('submit', (event) => {
    event.preventDefault();
    if (operation === 'insert') insert();
    else apply(false);
  });

  function attributeFor(name) {
    const existing = target.getAttributeNode(name);
    const namespaces = { xlink: 'http://www.w3.org/1999/xlink', xml: 'http://www.w3.org/XML/1998/namespace', xmlns: 'http://www.w3.org/2000/xmlns/' };
    const prefix = name.includes(':') ? name.split(':')[0] : name === 'xmlns' ? 'xmlns' : '';
    const namespace = existing?.namespaceURI || (Object.hasOwn(namespaces, prefix) && namespaces[prefix]) || (prefix && target.lookupNamespaceURI(prefix));
    // 先验证名称和命名空间；未知前缀沿用普通属性的浏览器行为。
    if (namespace) return target.ownerDocument.createAttributeNS(namespace, name);
    return target.namespaceURI !== 'http://www.w3.org/1999/xhtml' && !prefix
      ? target.ownerDocument.createAttributeNS(null, name) : target.ownerDocument.createAttribute(name);
  }
  function sameType(a, b) {
    return a.nodeType === b.nodeType && (!isElement(a) || (a.namespaceURI === b.namespaceURI && a.localName === b.localName));
  }
  function equalNode(a, b) {
    // isEqualNode 不比较 template.content，outerHTML 补齐模板内容比较。
    return a.isEqualNode(b) && (!isElement(a) || a.outerHTML === b.outerHTML);
  }
  function syncAttributes(node, desired) {
    for (const attribute of Array.from(node.attributes)) {
      if (!desired.hasAttributeNS(attribute.namespaceURI, attribute.localName)) node.removeAttributeNode(attribute);
    }
    for (const attribute of desired.attributes) {
      const current = node.getAttributeNodeNS(attribute.namespaceURI, attribute.localName);
      // 不重复写入未改变的 onclick、src 等属性，保留运行状态并避免资源重载。
      if (current?.value !== attribute.value || current?.name !== attribute.name) {
        node.setAttributeNodeNS(node.ownerDocument.importNode(attribute, true));
      }
    }
  }
  function readFormState(node) {
    if (!isElement(node) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') return null;
    return { value: node.getAttribute('value'), checked: node.hasAttribute('checked'), selected: node.hasAttribute('selected'),
      text: node.localName === 'textarea' ? node.textContent : null };
  }
  function syncFormState(node, previous) {
    if (!previous) return;
    // 只同步明确编辑的默认值，其余用户实时输入和选择继续保留。
    if (node.localName === 'input') {
      if (node.type !== 'file' && previous.value !== node.getAttribute('value')) node.value = node.getAttribute('value') || '';
      if (previous.checked !== node.hasAttribute('checked')) node.checked = node.hasAttribute('checked');
    }
    if (node.localName === 'option' && previous.selected !== node.hasAttribute('selected')) node.selected = node.hasAttribute('selected');
    if (node.localName === 'textarea' && previous.text !== node.textContent) node.value = node.textContent;
  }
  function patchChildren(parent, desired, source = parent) {
    const oldChildren = Array.from(source.childNodes);
    const newChildren = Array.from(desired.childNodes);
    const used = new Set();
    const key = (node) => isElement(node) ? node.getAttribute('id') || '' : '';
    const newKeys = new Set(newChildren.map(key).filter(Boolean));
    const keyed = new Map();
    for (const child of oldChildren) {
      const id = key(child);
      if (id) keyed.set(id, keyed.has(id) ? null : child);
    }
    // 先预留可精确对应的节点，避免插入同类节点时夺走后面节点的事件绑定。
    const matches = newChildren.map((child) => {
      const id = key(child);
      const match = id ? keyed.get(id) : oldChildren.find((old) => !used.has(old) && !key(old) && equalNode(old, child));
      if (!match || used.has(match)) return null;
      used.add(match);
      return match;
    });
    let cursor = parent.firstChild;
    newChildren.forEach((child, index) => {
      const match = matches[index] || ((!key(child) || !keyed.has(key(child))) && oldChildren.find((old) =>
        !used.has(old) && (!key(old) || !newKeys.has(key(old))) && sameType(old, child)));
      if (match) used.add(match);
      const next = match ? patchNode(match, child) : parent.ownerDocument.importNode(child, true);
      if (match === cursor) cursor = next;
      if (next !== cursor) parent.insertBefore(next, cursor);
      cursor = next.nextSibling;
    });
    for (const child of oldChildren) {
      if (!used.has(child)) child.remove();
    }
  }
  function patchNode(node, desired) {
    if (equalNode(node, desired)) return node;
    if (!sameType(node, desired)) {
      const replacement = node.ownerDocument.importNode(desired, false);
      // 更换容器标签仍复用可匹配的子节点；根节点自身的监听器无法枚举或转移。
      if (isElement(desired)) patchChildren(content(replacement), content(desired), content(node));
      else replacement.nodeValue = desired.nodeValue;
      node.replaceWith(replacement);
      return replacement;
    }
    if (!isElement(node)) { node.nodeValue = desired.nodeValue; return node; }
    const formState = readFormState(node);
    syncAttributes(node, desired);
    patchChildren(content(node), content(desired));
    syncFormState(node, formState);
    return node;
  }
  function parseHtml(source) {
    // 无浏览上下文的文档不会下载输入中的资源；父节点上下文保留表格和 SVG/MathML 语义。
    const inert = document.implementation.createHTMLDocument('');
    const context = isShadow(target) ? null : target.parentElement;
    const parent = context ? inert.importNode(context, false) : inert.createElement('div');
    parent.innerHTML = source;
    const parsed = content(parent);
    if (isShadow(target)) return parsed;
    const nodes = Array.from(parsed.childNodes);
    // 元素或注释周围的排版空白不作为额外根节点；纯文本保留完整空白。
    const meaningful = nodes.some((node) => node.nodeType !== Node.TEXT_NODE)
      ? nodes.filter((node) => node.nodeType !== Node.TEXT_NODE || node.textContent.trim()) : nodes;
    if (meaningful.length !== 1 || ![1, 3, 8].includes(meaningful[0].nodeType)) {
      throw new Error('HTML 必须包含一个完整的元素、文本或注释节点。');
    }
    return meaningful[0];
  }
  function parseInsertion(source) {
    if (!source) throw new Error('请输入要插入的 DOM。');
    // 在无浏览上下文的文档中按插入位置的父级解析，既保留命名空间，也不预加载资源。
    const inert = document.implementation.createHTMLDocument('');
    const point = insertionPoint(insertPosition);
    const context = point?.parent === content(target) && isElement(target) ? target
      : isElement(point?.parent) ? point.parent : null;
    const parent = context ? inert.importNode(context, false) : inert.createElement('div');
    parent.innerHTML = source;
    const nodes = Array.from(content(parent).childNodes);
    const meaningful = nodes.some((node) => node.nodeType !== Node.TEXT_NODE)
      ? nodes.filter((node) => node.nodeType !== Node.TEXT_NODE || node.textContent.trim()) : nodes;
    if (!meaningful.length) throw new Error('请输入要插入的 DOM。');
    return meaningful;
  }
  function insert() {
    try {
      if (!editable(target)) throw new Error('该节点已被页面移除，请重新选择。');
      const point = insertionPoint(insertPosition);
      if (!point || point.parent !== insertionBaseline?.parent || point.reference !== insertionBaseline.reference) {
        throw new Error('页面已更新插入位置，请取消后重新打开插入。');
      }
      const desired = parseInsertion(value.value);
      const fragment = target.ownerDocument.createDocumentFragment();
      const inserted = desired.map((node) => target.ownerDocument.importNode(node, true));
      fragment.append(...inserted);
      point.parent.insertBefore(fragment, point.reference);
      const insertedElement = inserted.find(isElement);
      const nextSelection = insertedElement?.isConnected ? insertedElement
        : isElement(target) ? target : isElement(point.parent) ? point.parent : point.parent.host;
      close();
      selected = nextSelection;
      setTimeout(() => {
        if (!disposed && nextSelection?.isConnected) {
          if (isElement(nextSelection)) elements.select(nextSelection);
          eruda.get().notify('DOM 已插入', { icon: 'success' });
        }
      }, 0);
    } catch (reason) {
      error.textContent = reason.message || String(reason);
      error.scrollIntoView({ block: 'nearest' });
    }
  }
  function apply(remove) {
    try {
      if (!editable(target)) throw new Error('该节点已被页面移除，请重新选择。');
      if (read() !== baseline) throw new Error('页面已更新该内容，请取消后重新打开编辑。');
      if (baselineNodes) {
        const current = snapshotNodes(target);
        if (current.length !== baselineNodes.length || current.some((node, index) => node !== baselineNodes[index])) {
          throw new Error('页面已更新该内容，请取消后重新打开编辑。');
        }
      }
      let nextSelection = target;
      const formState = mode === 'html' ? null : readFormState(target);
      if (mode === 'attribute') {
        if (remove) target.removeAttribute(originalAttribute);
        else {
          const name = nameInput.value.trim();
          if (!name) throw new Error('请输入属性名。');
          // 在未挂载节点上验证名称，避免改名失败后丢失原属性。
          const attribute = attributeFor(name);
          const previous = target.getAttributeNode(originalAttribute);
          const existing = target.getAttributeNodeNS(attribute.namespaceURI, attribute.localName);
          if (existing && existing !== previous) throw new Error('该属性已存在，请从现有属性列表中选择，避免覆盖。');
          attribute.value = value.value;
          if (!previous || previous.name !== attribute.name || previous.value !== attribute.value || previous.namespaceURI !== attribute.namespaceURI) {
            target.setAttributeNodeNS(attribute);
          }
          if (previous?.ownerElement === target && previous !== target.getAttributeNodeNS(attribute.namespaceURI, attribute.localName)) target.removeAttributeNode(previous);
        }
      } else {
        if (structuralRoot(target)) throw new Error('html、head、body 根节点请通过属性编辑或选择其子节点修改。');
        if (mode === 'text') {
          if (value.value !== baseline) content(target).textContent = value.value;
        } else if (value.value !== baseline) {
          const desired = parseHtml(value.value);
          if (isShadow(target)) patchChildren(target, desired);
          else {
            if (!sameType(target, desired)) elements.select(target.parentElement || target.getRootNode().host);
            nextSelection = patchNode(target, desired);
          }
        }
      }
      syncFormState(target, formState);
      close();
      selected = nextSelection;
      setTimeout(() => {
        if (!disposed && nextSelection.isConnected) {
          if (isElement(nextSelection)) elements.select(nextSelection);
          eruda.get().notify('DOM 已修改', { icon: 'success' });
        }
      }, 0);
    } catch (reason) {
      error.textContent = reason.message || String(reason);
      error.scrollIntoView({ block: 'nearest' });
    }
  }
  return () => {
    disposed = true;
    cancelAnimationFrame(highlightFrame);
    viewer.off('select', selectedNode);
    elements.off('change', selectedNode);
    viewer.off('deselect', recoverSelection);
    viewer.on('deselect', originalBack);
    root.removeEventListener('click', onClick, true);
    actions.remove(); editor.remove(); style.remove();
  };
}
