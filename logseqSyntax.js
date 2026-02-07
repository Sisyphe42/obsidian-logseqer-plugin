// 检查DOM中的Logseq语法（列表元素）
export function checkLogseqSyntaxDOM() {
  const lines = document.querySelectorAll('.cm-content > .cm-line');
  let invalidCount = 0;

  lines.forEach(line => {
    // 跳过空行（只包含<br>的行）
    if (
      line.childNodes.length === 1 &&
      line.firstChild.nodeName === 'BR'
    ) {
      return;
    }

    // 判断是否是列表节点
    const isList = line.classList.contains('HyperMD-list-line');

    if (!isList) {
      invalidCount++;
    }
  });

  return invalidCount;
}

// 更新状态栏显示
export function updateStatusBar(count) {
  const statusBar = document.querySelector("body > div.app-container > div.status-bar");
  if (!statusBar) return;

  let tip = document.getElementById("logseq-syntax-tip");
  if (!tip) {
    tip = document.createElement("span");
    tip.id = "logseq-syntax-tip";
    tip.style.marginLeft = "0px";
    tip.style.fontSize = "var(--text-xs, 12px)";
    tip.style.cursor = "default";
    tip.style.display = "inline-flex";
    tip.style.alignItems = "center";
    statusBar.appendChild(tip);
  }

  tip.textContent = count === 0 ? "✅" : count;
  tip.style.color = count === 0 ? "var(--text-success, #4caf50)" : "var(--text-error, #f44336)";
  tip.title = `LS语法检查 (${count}个不符合)`;
}