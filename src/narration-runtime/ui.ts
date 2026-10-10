import CardOverlay from "./CardOverlay.svelte";
import overlayCss from "./overlay.css?raw";
import pageCss from "./page.css?raw";
import type { PanelAction } from "./panel-action";
import panelCss from "./panel.css?raw";
import themeCss from "./theme.css?raw";
import TourPanel from "./TourPanel.svelte";
import { PlayerStatus } from "@/lib/player-status";
import { mount } from "svelte";

// An open root stays reachable through Element.shadowRoot, so a page's own script can find the panel;
// either mode keeps the page's CSS out
// https://developer.mozilla.org/docs/Web/API/Element/attachShadow
const SHADOW_MODE = "open";
// The overlay's frame and button are absolutely positioned, and only an ancestor whose position is not
// static forms their containing block - static being position's initial value
// https://developer.mozilla.org/docs/Web/CSS/CSS_display/Containing_block
const STATIC_POSITION = "static";
const RELATIVE_POSITION = "relative";
// Ours: page.css places and themes both hosts by this attribute
const HOST_ATTRIBUTE = "data-narration-host";
// Ours, and private to the panel's shadow tree - not part of the contract pages author against
const WORD_START_ATTRIBUTE = "data-start";

enum HostKind {
  Overlay = "overlay",
  Panel = "panel"
}

// The components carry no styles of their own: Svelte would put them in the document's head, which no
// shadow root reads, so each root adopts the hand-written sheet instead
// https://developer.mozilla.org/docs/Web/API/CSSStyleSheet/replaceSync
function createShadowHost({ css, kind }: {
  css: string;
  kind: HostKind;
}) {
  const elHost = document.createElement("span");
  elHost.setAttribute(HOST_ATTRIBUTE, kind);
  const shadowRoot = elHost.attachShadow({ mode: SHADOW_MODE });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(themeCss + css);
  shadowRoot.adoptedStyleSheets = [sheet];
  return {
    elHost,
    shadowRoot
  };
}

export function createCardOverlay({ elCard, onPlay }: {
  elCard: HTMLElement;
  onPlay: () => Promise<void>;
}) {
  const { elHost, shadowRoot } = createShadowHost({
    css: overlayCss,
    kind: HostKind.Overlay
  });
  const isStaticallyPositioned = getComputedStyle(elCard).position === STATIC_POSITION;
  if (isStaticallyPositioned) {
    elCard.style.position = RELATIVE_POSITION;
  }

  mount(CardOverlay, {
    target: shadowRoot,
    props: {
      onplay: onPlay
    }
  });
  elCard.prepend(elHost);

  return {
    setStatus(status: PlayerStatus) {
      elHost.dataset.status = status;
    }
  };
}

export function createTourPanel({ cardCount, onAction, onSeek }: {
  cardCount: number;
  onAction: (action: PanelAction) => Promise<void>;
  onSeek: (start: number) => Promise<void>;
}) {
  const { elHost, shadowRoot } = createShadowHost({
    css: panelCss,
    kind: HostKind.Panel
  });
  const panel = mount(TourPanel, {
    target: shadowRoot,
    props: {
      cardCount,
      onaction: onAction
    }
  });

  // One listener on the root rather than one per word: the subtitle is rewritten on every spoken word
  shadowRoot.addEventListener("click", async e => {
    const elWord = e.target instanceof Element ? e.target.closest(`[${WORD_START_ATTRIBUTE}]`) : null;
    if (!elWord) {
      return;
    }

    await onSeek(Number(elWord.getAttribute(WORD_START_ATTRIBUTE)));
  });
  document.body.append(elHost);
  const pageSheet = new CSSStyleSheet();
  pageSheet.replaceSync(pageCss);
  // Appended, never assigned, so a page that adopted sheets of its own keeps them
  // https://developer.mozilla.org/docs/Web/API/Document/adoptedStyleSheets
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageSheet];

  return { render: panel.render };
}
