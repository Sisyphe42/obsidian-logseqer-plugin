(function () {
  // 定义检测函数
  function checkLogseqSyntax() {
    const noteContentElement = document.querySelector(
      "body > div.app-container > div.horizontal-main-container > div > div.workspace-split.mod-vertical.mod-root > div > div.workspace-tab-container > div > div > div.view-content > div.markdown-source-view.cm-s-obsidian.mod-cm6.node-insert-event.is-folding.show-properties.is-live-preview > div > div.cm-scroller > div.cm-sizer > div.cm-contentContainer > div.cm-content.cm-lineWrapping"
    );

    if (!noteContentElement) return;

    const text = noteContentElement.innerText;
    const paragraphs = text.split("\n").filter((line) => line.trim() !== "");
    const ruleRegExp = /^- /;
    let invalidCount = 0;

    paragraphs.forEach((paragraph) => {
      if (!ruleRegExp.test(paragraph)) {
        invalidCount++;
      }
    });

    updateStatusBar(invalidCount);
  }

  // 定义状态栏更新函数
  function updateStatusBar(count) {
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
    tip.title = "LS语法检查";
  }

  // 初始化检测
  checkLogseqSyntax();

  // 设置 MutationObserver 监听笔记内容区域的变化
  const observer = new MutationObserver(() => {
    checkLogseqSyntax();
  });

  const noteContentElement = document.querySelector(
    "body > div.app-container > div.horizontal-main-container > div > div.workspace-split.mod-vertical.mod-root > div > div.workspace-tab-container > div > div > div.view-content > div.markdown-source-view.cm-s-obsidian.mod-cm6.node-insert-event.is-folding.show-properties.is-live-preview > div > div.cm-scroller > div.cm-sizer > div.cm-contentContainer > div.cm-content.cm-lineWrapping"
  );

  if (noteContentElement) {
    observer.observe(noteContentElement, { childList: true, subtree: true });
  }
})();
