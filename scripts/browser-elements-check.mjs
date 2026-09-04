import assert from 'node:assert/strict';

// 与完整离线验证共用浏览器、断网状态和 UI 入口，验证节点身份而不只比较 HTML。
export async function checkElements({ evaluate, waitFor, editor, rowById, expandRow, openEditor, editValue, applyEdit, cancelEdit, screenshot }) {
  const openElement = async (id) => {
    const ancestors = await evaluate(`(() => {
      const ids = []; let node = document.getElementById(${JSON.stringify(id)}).parentElement;
      while (node && node !== document.body) { if (node.id) ids.unshift(node.id); node = node.parentElement; }
      return ids;
    })()`);
    for (const ancestor of ancestors) { await waitFor(`!!(${rowById(ancestor)})`); await expandRow(rowById(ancestor)); }
    await waitFor(`!!(${rowById(id)})`);
    await openEditor(`(${rowById(id)}).querySelector('.luna-dom-viewer-tag-name')`);
    await waitFor(`!${editor}.hidden`);
  };
  const changeMode = (mode) => evaluate(`${editor}.querySelector('[data-mode="${mode}"]').click()`);
  const chooseAttribute = (name) => evaluate(`Array.from(${editor}.querySelectorAll('[data-attribute]')).find(button => button.dataset.attribute === ${JSON.stringify(name)}).click()`);
  const setName = (name) => evaluate(`${editor}.querySelector('input').value = ${JSON.stringify(name)}`);
  const expectApplied = async () => {
    await applyEdit();
    assert.equal(await evaluate(`${editor}.querySelector('[role="alert"]').textContent`), '');
    assert.equal(await evaluate(`${editor}.hidden`), true);
  };

  await openElement('event-target');
  await changeMode('attribute');
  assert.deepEqual(await evaluate(`Array.from(${editor}.querySelectorAll('[data-attribute]')).map(button => [button.dataset.attribute, button.textContent])`),
    [['id', 'id="event-target"'], ['data-note', 'data-note="原有属性"'], ['aria-label', 'aria-label="事件测试"'], ['', '+ 新增属性']]);
  assert.equal(await evaluate(`${editor}.querySelector('textarea').value`), 'event-target', '属性模式默认显示首个原有属性');
  await chooseAttribute('data-note');
  assert.equal(await evaluate(`${editor}.querySelector('textarea').value`), '原有属性');
  assert.equal(await evaluate(`(() => {
    const form = ${editor}; const footer = form.querySelector('footer').getBoundingClientRect();
    return footer.top >= form.getBoundingClientRect().top && footer.bottom <= innerHeight;
  })()`), true, '窄屏也保持应用按钮可见');
  await screenshot('elements-attributes');
  await setName('aria-label');
  await editValue('不能覆盖');
  await applyEdit();
  assert.match(await evaluate(`${editor}.querySelector('[role="alert"]').textContent`), /已存在/);
  assert.equal(await evaluate(`document.getElementById('event-target').getAttribute('aria-label')`), '事件测试');
  await chooseAttribute('');
  await setName('data-new');
  await editValue('新增值');
  await expectApplied();
  assert.equal(await evaluate(`document.getElementById('event-target').dataset.new`), '新增值');
  await openElement('event-target');
  await changeMode('attribute');
  await chooseAttribute('data-note');
  await evaluate(`document.getElementById('event-target').setAttribute('title', '页面更新')`);
  await editValue('过期属性');
  await applyEdit();
  assert.match(await evaluate(`${editor}.querySelector('[role="alert"]').textContent`), /页面已更新/);
  await cancelEdit();

  await evaluate(`(() => {
    window.eventRefs = Object.fromEntries(['event-target', 'event-a', 'event-b', 'event-input'].map(id => [id, document.getElementById(id)]));
    window.eventCounts = [0, 0, 0];
    eventRefs['event-target'].addEventListener('click', () => eventCounts[0]++);
    eventRefs['event-a'].addEventListener('click', () => eventCounts[1]++);
    eventRefs['event-b'].onclick = () => eventCounts[2]++;
    eventRefs['event-input'].value = '用户实时输入';
  })()`);
  await openElement('event-target');
  await editValue('<section id="event-target" data-note="修改后"><button id="event-b" type="button">乙改</button><em>新增</em><button id="event-a" type="button">甲改</button><input id="event-input" value="默认值"><!--新注释--></section>');
  await expectApplied();
  assert.equal(await evaluate(`Object.entries(eventRefs).every(([id, node]) => document.getElementById(id) === node)`), true, '更新和重排保留元素对象');
  await evaluate(`document.getElementById('event-a').click(); document.getElementById('event-b').click()`);
  assert.deepEqual(await evaluate('eventCounts'), [2, 1, 1], '保留父元素、addEventListener 和 onclick 绑定');
  assert.equal(await evaluate(`document.getElementById('event-input').value`), '用户实时输入');
  assert.equal(await evaluate(`document.getElementById('event-target').lastChild.nodeValue`), '新注释');
  await openElement('event-target');
  await editValue('<article id="event-target"><button id="event-a" type="button">甲换</button><button id="event-b" type="button">乙换</button><input id="event-input" value="新默认值"></article>');
  await expectApplied();
  assert.equal(await evaluate(`document.getElementById('event-target').tagName`), 'ARTICLE');
  assert.equal(await evaluate(`['event-a','event-b','event-input'].every(id => eventRefs[id] === document.getElementById(id))`), true, '更换父标签保留可复用子节点');
  assert.equal(await evaluate(`document.getElementById('event-input').value`), '新默认值');
  await evaluate(`document.getElementById('event-a').click(); document.getElementById('event-b').click()`);
  assert.deepEqual(await evaluate('eventCounts'), [2, 2, 2]);

  await openElement('event-target');
  await evaluate(`document.getElementById('event-a').replaceWith(document.getElementById('event-a').cloneNode(true))`);
  await applyEdit();
  assert.match(await evaluate(`${editor}.querySelector('[role="alert"]').textContent`), /页面已更新/, '相同 HTML 的外部替换也阻止覆盖');
  await cancelEdit();
  await evaluate(`window.anonymousRefs = Array.from(document.getElementById('edit-anonymous').children); window.anonymousClicks = 0; anonymousRefs[1].addEventListener('click', () => anonymousClicks++)`);
  await openElement('edit-anonymous');
  await editValue('<div id="edit-anonymous"><button type="button">新增按钮</button><button type="button">无 id 甲</button><button type="button">无 id 乙</button></div>');
  await expectApplied();
  assert.equal(await evaluate(`anonymousRefs.every((node, index) => node === document.getElementById('edit-anonymous').children[index + 1])`), true, '插入同类节点不夺走无 id 节点的绑定');
  await openElement('edit-anonymous');
  await editValue('<div id="edit-anonymous"><button type="button">新增按钮</button><button type="button">无 id 甲</button><button id="new-button-id" type="button">无 id 乙</button></div>');
  await expectApplied();
  assert.equal(await evaluate(`document.getElementById('new-button-id') === anonymousRefs[1]`), true, '新增 id 仍复用原节点');
  await evaluate('anonymousRefs[1].click()');
  assert.equal(await evaluate('anonymousClicks'), 1);

  await openElement('edit-convert');
  await editValue('<!--转换后的注释-->');
  await expectApplied();
  assert.equal(await evaluate(`document.getElementById('edit-mixed').firstChild.nodeType`), 8);
  await waitFor(`(${rowById('edit-mixed')}).nextElementSibling.textContent.includes('转换后的注释')`);
  await openEditor(`(${rowById('edit-mixed')}).nextElementSibling.querySelector('.luna-dom-viewer-tree-item')`);
  assert.equal(await evaluate(`${editor}.querySelector('.eruda-dom-edit-node').textContent`), '#comment');
  await changeMode('html');
  await editValue('转换后的纯文本 &amp; 内容');
  await expectApplied();
  assert.equal(await evaluate(`document.getElementById('edit-mixed').firstChild.nodeValue`), '转换后的纯文本 & 内容');
  assert.equal(await evaluate(`document.getElementById('edit-mixed').lastChild.textContent`), '保留同级');
  await openElement('edit-checkbox');
  await evaluate(`document.getElementById('edit-checkbox').checked = true`);
  await changeMode('attribute');
  await chooseAttribute('checked');
  assert.equal(await evaluate(`${editor}.querySelector('textarea').value`), '');
  await evaluate(`${editor}.querySelector('[data-action="delete"]').click()`);
  assert.equal(await evaluate(`document.getElementById('edit-checkbox').checked`), false);
  await openElement('event-input');
  await changeMode('attribute');
  await chooseAttribute('value');
  await evaluate(`document.getElementById('event-input').value = '再次输入'`);
  await editValue('属性模式更新');
  await expectApplied();
  assert.equal(await evaluate(`document.getElementById('event-input').value`), '属性模式更新');

  await openElement('edit-svg');
  await changeMode('attribute');
  await chooseAttribute('viewBox');
  await editValue('0 0 40 40');
  await expectApplied();
  assert.deepEqual(await evaluate(`Array.from(document.getElementById('edit-svg').attributes).map(attr => attr.name)`), ['id', 'viewBox']);
  assert.equal(await evaluate(`document.getElementById('edit-svg').viewBox.baseVal.width`), 40);
  await openElement('edit-circle');
  await changeMode('attribute');
  await chooseAttribute('');
  await setName('xlink:href');
  await editValue('#local');
  await expectApplied();
  assert.equal(await evaluate(`document.getElementById('edit-circle').getAttributeNS('http://www.w3.org/1999/xlink', 'href')`), '#local');

  for (const [id, html, expression, expected] of [
    ['edit-tr', '<tr id="edit-tr"><td id="edit-td">更新单元格</td><td>新增列</td></tr>', `document.getElementById('edit-tr').cells.length`, 2],
    ['edit-circle', '<circle id="edit-circle" cx="10" cy="5" r="4"></circle>', `document.getElementById('edit-circle').r.baseVal.value`, 4],
    ['edit-mi', '<mi id="edit-mi">y</mi>', `document.getElementById('edit-mi').namespaceURI`, 'http://www.w3.org/1998/Math/MathML'],
    ['edit-template', '<template id="edit-template"><button id="template-button">新模板</button></template>', `document.getElementById('edit-template').content.textContent`, '新模板'],
    ['edit-textarea', '<textarea id="edit-textarea">新文本</textarea>', `document.getElementById('edit-textarea').value`, '新文本'],
    ['edit-option', '<option id="edit-option" value="b" selected>新选项</option>', `document.getElementById('edit-select').value`, 'b'],
    ['edit-checkbox', '<input id="edit-checkbox" type="checkbox" checked>', `document.getElementById('edit-checkbox').checked && !document.getElementById('edit-checkbox').disabled`, true],
  ]) {
    await evaluate(`window.kindRef = document.getElementById(${JSON.stringify(id)}); window.kindClicks = 0; kindRef.addEventListener('click', () => kindClicks++)`);
    if (id === 'edit-template') await evaluate(`window.templateRef = kindRef.content.firstChild`);
    await openElement(id);
    await editValue(html);
    await expectApplied();
    assert.equal(await evaluate(expression), expected, `${id} 按对应上下文更新`);
    assert.equal(await evaluate(`kindRef === document.getElementById(${JSON.stringify(id)})`), true, `${id} 保留节点对象`);
    await evaluate(`kindRef.dispatchEvent(new Event('click'))`);
    assert.equal(await evaluate('kindClicks'), 1);
    if (id === 'edit-template') assert.equal(await evaluate('templateRef === kindRef.content.firstChild'), true);
  }

  await openElement('div-shadow');
  await cancelEdit();
  await expandRow(rowById('div-shadow'));
  const shadowRow = `(${rowById('div-shadow')}).nextElementSibling.querySelector('.luna-dom-viewer-tree-item')`;
  await evaluate(`window.shadowRef = document.getElementById('div-shadow').shadowRoot; window.shadowChild = shadowRef.firstChild; window.shadowClicks = 0; shadowChild.addEventListener('click', () => shadowClicks++)`);
  await openEditor(shadowRow);
  assert.equal(await evaluate(`${editor}.querySelector('.eruda-dom-edit-node').textContent`), '#shadow-root');
  await editValue('<div id="shadow-child">Shadow HTML 更新</div><span>新增影子节点</span>');
  await expectApplied();
  assert.equal(await evaluate(`shadowRef === document.getElementById('div-shadow').shadowRoot && shadowChild === shadowRef.firstChild && shadowRef.children.length === 2`), true);
  await evaluate('shadowChild.click()');
  assert.equal(await evaluate('shadowClicks'), 1);
}
