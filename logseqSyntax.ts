// Check Logseq syntax in the document
export function checkLogseqSyntaxDOM(): number {
  const noteContentElement = document.querySelector(
    "body > div.app-container > div.horizontal-main-container > div > div.workspace-split.mod-vertical.mod-root > div > div.workspace-tab-container > div > div > div.view-content > div.markdown-source-view.cm-s-obsidian.mod-cm6.node-insert-event.is-folding.show-properties.is-live-preview > div > div.cm-scroller > div.cm-sizer > div.cm-contentContainer > div.cm-content.cm-lineWrapping"
  ) as HTMLElement | null;

  if (!noteContentElement) return 0;

  const text = (noteContentElement as HTMLElement).innerText || '';
  const paragraphs = text.split("\n").filter((line: string) => line.trim() !== "");
  const ruleRegExp = /^(\t)*- /;
  let invalidCount = 0;

  paragraphs.forEach((paragraph: string) => {
    if (!ruleRegExp.test(paragraph)) {
      invalidCount++;
    }
  });

  return invalidCount;
}
