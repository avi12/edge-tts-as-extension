/**
 * Requires multi-line formatting for object expressions ({ ... }) when:
 * - The object has 2 or more properties, OR
 * - Any property's value is itself an object expression (direct nesting), OR
 * - The object sits inside an `&&` / `||` logical expression (typically a
 *   conditional spread like `...cond && { ... }`); these read better fully
 *   expanded so the spread block is visually self-contained.
 *
 * Single-property leaf objects with primitive/identifier values may stay on one line:
 *   { signatureTimestamp }                              // OK - leaf
 *   { x: 1 }                                            // OK - leaf
 *
 * Expanded due to nested object:
 *   {
 *     contentPlaybackContext: { signatureTimestamp }    // parent expands; deepest stays inline
 *   }
 *
 * Expanded due to `&&` ancestor (every nested object also expands):
 *   ...byteOffset > 0 && {
 *     headers: {
 *       Range: ...
 *     }
 *   }
 */

import { createExpandBlockVisitor } from "./expand-block.js";

function propertyHasDirectObjectExpression(property) {
  return property.type === "Property" && property.value?.type === "ObjectExpression";
}

function isInsideLogicalExpression(node) {
  let current = node.parent;
  while (current) {
    if (current.type === "LogicalExpression" && (current.operator === "&&" || current.operator === "||")) {
      return true;
    }

    if (current.type === "FunctionDeclaration"
      || current.type === "FunctionExpression"
      || current.type === "ArrowFunctionExpression"
      || current.type === "Program") {
      return false;
    }

    current = current.parent;
  }

  return false;
}

function isPropertyValueInMultilineObject(node) {
  if (node.parent?.type !== "Property") {
    return false;
  }

  const parentObject = node.parent.parent;
  return parentObject?.type === "ObjectExpression" && requiresMultiline(parentObject);
}

function requiresMultiline(node) {
  return node.properties.length >= 2
    || node.properties.some(propertyHasDirectObjectExpression)
    || isInsideLogicalExpression(node)
    || isPropertyValueInMultilineObject(node);
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "layout",
    fixable: "code",
    schema: [],
    messages: {
      expectedNewlineAfterOpenBrace: "Expected a newline after '{' in this object literal.",
      expectedNewlineBeforeCloseBrace: "Expected a newline before '}' in this object literal.",
      expectedNewlineBetweenProperties: "Expected each property to be on its own line."
    }
  },
  create(context) {
    return {
      ObjectExpression: createExpandBlockVisitor({
        context,
        getItems: node => node.properties,
        requiresMultiline,
        messageIds: {
          afterOpenBrace: "expectedNewlineAfterOpenBrace",
          betweenItems: "expectedNewlineBetweenProperties",
          beforeCloseBrace: "expectedNewlineBeforeCloseBrace"
        }
      })
    };
  }
};
