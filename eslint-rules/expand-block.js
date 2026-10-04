function getLineIndentCount(sourceCode, token) {
  const lineText = sourceCode.lines[token.loc.start.line - 1];
  const match = lineText.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

export function createExpandBlockVisitor({ context, getItems, requiresMultiline, messageIds }) {
  const { sourceCode } = context;

  return node => {
    const items = getItems(node);
    if (items.length === 0 || !requiresMultiline(node)) {
      return;
    }

    const openBrace = sourceCode.getFirstToken(node);
    const closeBrace = sourceCode.getLastToken(node);
    const lineIndentCount = getLineIndentCount(sourceCode, openBrace);
    const baseIndent = " ".repeat(lineIndentCount);
    const itemIndent = `${baseIndent}  `;

    const firstItem = items[0];
    if (openBrace.loc.end.line === firstItem.loc.start.line) {
      context.report({
        node,
        messageId: messageIds.afterOpenBrace,
        fix: fixer => fixer.insertTextAfter(openBrace, `\n${itemIndent}`)
      });
    }

    for (let itemIndex = 1; itemIndex < items.length; itemIndex++) {
      const previousItem = items[itemIndex - 1];
      const currentItem = items[itemIndex];
      if (previousItem.loc.end.line === currentItem.loc.start.line) {
        const tokenBeforeCurrent = sourceCode.getTokenBefore(currentItem);
        context.report({
          node: currentItem,
          messageId: messageIds.betweenItems,
          fix: fixer => fixer.insertTextAfter(tokenBeforeCurrent, `\n${itemIndent}`)
        });
      }
    }

    const lastItem = items[items.length - 1];
    if (closeBrace.loc.start.line === lastItem.loc.end.line) {
      context.report({
        node,
        messageId: messageIds.beforeCloseBrace,
        fix: fixer => fixer.insertTextBefore(closeBrace, `\n${baseIndent}`)
      });
    }
  };
}
