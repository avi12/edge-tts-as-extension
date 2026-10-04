/**
 * Requires multi-line formatting for TypeScript type literals ({ ... }) when:
 * - The literal has 2 or more members, OR
 * - Any member's type annotation is itself a type literal (direct nesting), OR
 * - Any member's key name exceeds LONG_KEY_NAME_LENGTH characters
 *
 * Single-member leaf types with short keys may stay on one line:
 *   title: { simpleText: string }                    // OK - short key, leaf
 *   liveBroadcastDetails?: { isLiveNow: true; ... }  // expanded - 2 members
 *
 * Expanded due to long key:
 *   mediaUstreamerRequestConfig?: {
 *     videoPlaybackUstreamerConfig?: string;          // key > 20 chars
 *   };
 */

import { createExpandBlockVisitor } from "./expand-block.js";

const LONG_KEY_NAME_LENGTH = 20;

function memberHasDirectTypeLiteral(member) {
  return member.typeAnnotation?.typeAnnotation?.type === "TSTypeLiteral";
}

function memberHasLongKey(member) {
  return member.type === "TSPropertySignature"
    && (member.key?.name?.length ?? 0) > LONG_KEY_NAME_LENGTH;
}

function requiresMultiline(node) {
  return node.members.length >= 2
    || node.members.some(memberHasDirectTypeLiteral)
    || node.members.some(memberHasLongKey);
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "layout",
    fixable: "code",
    schema: [],
    messages: {
      expectedNewlineAfterOpenBrace: "Expected a newline after '{' in this type literal.",
      expectedNewlineBeforeCloseBrace: "Expected a newline before '}' in this type literal.",
      expectedNewlineBetweenMembers: "Expected each member to be on its own line."
    }
  },
  create(context) {
    return {
      TSTypeLiteral: createExpandBlockVisitor({
        context,
        getItems: node => node.members,
        requiresMultiline,
        messageIds: {
          afterOpenBrace: "expectedNewlineAfterOpenBrace",
          betweenItems: "expectedNewlineBetweenMembers",
          beforeCloseBrace: "expectedNewlineBeforeCloseBrace"
        }
      })
    };
  }
};
