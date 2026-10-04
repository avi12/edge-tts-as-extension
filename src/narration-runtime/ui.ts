import overlayCss from "./overlay.css?raw";
import pageCss from "./page.css?raw";
import panelCss from "./panel.css?raw";
import themeCss from "./theme.css?raw";
import { type PlayerState, PlayerStatus } from "@/lib/player-status";

export enum PanelAction {
  Tour = "tour",
  Previous = "previous",
  Pause = "pause",
  Resume = "resume",
  Next = "next",
  Stop = "stop"
}

const SHADOW_MODE = "open";
const STATIC_POSITION = "static";
const RELATIVE_POSITION = "relative";
const HOST_ATTRIBUTE = "data-narration-host";

enum HostKind {
  Overlay = "overlay",
  Panel = "panel"
}

const PLAY_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const PAUSE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>`;
const SPEAKER_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>`;

const OVERLAY_TEMPLATE = `
  <span class="frame"></span>
  <button class="play" type="button" title="Narrate this card">
    <span class="icon icon-play">${SPEAKER_ICON}</span>
    <span class="icon icon-pause">${PAUSE_ICON}</span>
  </button>`;

const PANEL_TEMPLATE = `
  <section class="panel">
    <header>
      <span class="label">Narration</span>
      <output class="title" dir="auto"></output>
    </header>
    <p class="subtitle" dir="auto"></p>
    <p class="error"></p>
    <menu class="controls">
      <li><button type="button" data-action="${PanelAction.Tour}">${PLAY_ICON}<span class="tour-label"></span></button></li>
      <li><button type="button" data-action="${PanelAction.Previous}" title="Previous card">Prev</button></li>
      <li><button type="button" data-action="${PanelAction.Pause}" title="Pause">${PAUSE_ICON}</button></li>
      <li><button type="button" data-action="${PanelAction.Resume}" title="Resume">${PLAY_ICON}</button></li>
      <li><button type="button" data-action="${PanelAction.Next}" title="Next card">Next</button></li>
      <li><button type="button" data-action="${PanelAction.Stop}" title="Stop">Stop</button></li>
    </menu>
  </section>`;

const panelActionValues = new Set<string>(Object.values(PanelAction));

function isPanelAction(value: string | undefined): value is PanelAction {
  return value !== undefined && panelActionValues.has(value);
}

function createShadowHost({ css, template, kind }: {
  css: string;
  template: string;
  kind: HostKind;
}) {
  const elHost = document.createElement("span");
  elHost.setAttribute(HOST_ATTRIBUTE, kind);
  const shadowRoot = elHost.attachShadow({ mode: SHADOW_MODE });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(themeCss + css);
  shadowRoot.adoptedStyleSheets = [sheet];
  shadowRoot.innerHTML = template;
  return {
    elHost,
    shadowRoot
  };
}

function queryRequired<TElement extends Element>({ root, selector }: {
  root: ParentNode;
  selector: string;
}) {
  const elFound = root.querySelector<TElement>(selector);
  if (!elFound) {
    throw new Error(`Missing ${selector}`);
  }

  return elFound;
}

export function createCardOverlay({ elCard, onPlay }: {
  elCard: HTMLElement;
  onPlay: () => void;
}) {
  const { elHost, shadowRoot } = createShadowHost({
    css: overlayCss,
    template: OVERLAY_TEMPLATE,
    kind: HostKind.Overlay
  });
  const isStaticallyPositioned = getComputedStyle(elCard).position === STATIC_POSITION;
  if (isStaticallyPositioned) {
    elCard.style.position = RELATIVE_POSITION;
  }

  queryRequired<HTMLButtonElement>({
    root: shadowRoot,
    selector: ".play"
  }).addEventListener("click", onPlay);
  elCard.prepend(elHost);

  return {
    setStatus(status: PlayerStatus) {
      elHost.dataset.status = status;
    }
  };
}

function renderSubtitle({ elSubtitle, state }: {
  elSubtitle: HTMLElement;
  state: PlayerState;
}) {
  const { text, word } = state;
  if (!word) {
    elSubtitle.textContent = text;
    return;
  }

  const elMark = document.createElement("mark");
  elMark.textContent = text.slice(word.start, word.start + word.length);
  elSubtitle.replaceChildren(text.slice(0, word.start), elMark, text.slice(word.start + word.length));
  const centeredScrollTop = elMark.offsetTop - (elSubtitle.clientHeight - elMark.offsetHeight) / 2;
  elSubtitle.scrollTop = Math.max(centeredScrollTop, 0);
}

export function createTourPanel({ cardCount, onAction }: {
  cardCount: number;
  onAction: (action: PanelAction) => void;
}) {
  const { elHost, shadowRoot } = createShadowHost({
    css: panelCss,
    template: PANEL_TEMPLATE,
    kind: HostKind.Panel
  });
  const elPanel = queryRequired<HTMLElement>({
    root: shadowRoot,
    selector: ".panel"
  });
  const elTitle = queryRequired<HTMLOutputElement>({
    root: shadowRoot,
    selector: ".title"
  });
  const elSubtitle = queryRequired<HTMLElement>({
    root: shadowRoot,
    selector: ".subtitle"
  });
  const elError = queryRequired<HTMLElement>({
    root: shadowRoot,
    selector: ".error"
  });
  queryRequired<HTMLElement>({
    root: shadowRoot,
    selector: ".tour-label"
  }).textContent = `Play tour · ${cardCount} ${cardCount === 1 ? "card" : "cards"}`;

  shadowRoot.addEventListener("click", e => {
    const elButton = e.target instanceof Element ? e.target.closest<HTMLButtonElement>("button[data-action]") : null;
    const action = elButton?.dataset.action;
    if (isPanelAction(action)) {
      onAction(action);
    }
  });
  document.body.append(elHost);
  const pageSheet = new CSSStyleSheet();
  pageSheet.replaceSync(pageCss);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageSheet];

  return {
    render({ state, title, iCard, locale }: {
      state: PlayerState | null;
      title: string | null;
      iCard: number | null;
      locale: string | null;
    }) {
      elPanel.dataset.status = state?.status ?? PlayerStatus.Idle;
      elTitle.textContent = title === null || iCard === null ? "" : `${iCard + 1}/${cardCount} ${title}`;
      elError.textContent = state?.error ?? "";
      elSubtitle.lang = locale ?? "";

      if (!state || state.status === PlayerStatus.Error) {
        elSubtitle.textContent = "";
        return;
      }

      renderSubtitle({
        elSubtitle,
        state
      });
    }
  };
}
