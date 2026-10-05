import overlayCss from "./overlay.css?raw";
import pageCss from "./page.css?raw";
import panelCss from "./panel.css?raw";
import themeCss from "./theme.css?raw";
import { type PlayerState, PlayerStatus, type SpeakingState } from "@/lib/player-status";

export enum PanelAction {
  Tour = "tour",
  Previous = "previous",
  Back = "back",
  Pause = "pause",
  Resume = "resume",
  Next = "next",
  Stop = "stop"
}

const SHADOW_MODE = "open";
const STATIC_POSITION = "static";
const RELATIVE_POSITION = "relative";
const HOST_ATTRIBUTE = "data-narration-host";
const VOICE_NAME_SEPARATOR = "-";
const SUBTITLE_WORD = /\S+/g;
const WORD_START_ATTRIBUTE = "data-start";
const SPOKEN_ATTRIBUTE = "data-spoken";
const VOICE_NAME_SUFFIX = /(?:Multilingual)?Neural$/;

enum HostKind {
  Overlay = "overlay",
  Panel = "panel"
}

const PLAY_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const PAUSE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>`;
const SPEAKER_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>`;

// A hint popover renders in the top layer, so the chamfer clip-paths around it never cut it off
function hint({ id, text }: {
  id: string;
  text: string;
}) {
  return `<span class="hint" id="${id}" popover="hint">${text}</span>`;
}

const OVERLAY_TEMPLATE = `
  <span class="frame"></span>
  <button class="play" type="button" interestfor="hint-play" aria-labelledby="hint-play">
    <span class="icon icon-play">${SPEAKER_ICON}</span>
    <span class="icon icon-pause">${PAUSE_ICON}</span>
  </button>
  ${hint({
    id: "hint-play",
    text: "Narrate this card"
  })}`;

const PANEL_TEMPLATE = `
  <section class="panel">
    <header>
      <span class="label">Narration</span>
      <output class="title" dir="auto"></output>
      <output class="voice" aria-label="Voice"></output>
    </header>
    <p class="subtitle" dir="auto"></p>
    <p class="error"></p>
    <menu class="controls">
      <li><button type="button" data-action="${PanelAction.Tour}">${PLAY_ICON}<span class="tour-label"></span></button></li>
      <li>
        <button type="button" data-action="${PanelAction.Previous}" interestfor="hint-previous">Prev</button>
        ${hint({
          id: "hint-previous",
          text: "Previous card"
        })}
      </li>
      <li>
        <button type="button" data-action="${PanelAction.Back}" interestfor="hint-back">Back</button>
        ${hint({
          id: "hint-back",
          text: "Back to the start of the sentence"
        })}
      </li>
      <li>
        <button type="button" data-action="${PanelAction.Pause}" interestfor="hint-pause" aria-labelledby="hint-pause">${PAUSE_ICON}</button>
        ${hint({
          id: "hint-pause",
          text: "Pause"
        })}
      </li>
      <li>
        <button type="button" data-action="${PanelAction.Resume}" interestfor="hint-resume" aria-labelledby="hint-resume">${PLAY_ICON}</button>
        ${hint({
          id: "hint-resume",
          text: "Resume"
        })}
      </li>
      <li>
        <button type="button" data-action="${PanelAction.Next}" interestfor="hint-next">Next</button>
        ${hint({
          id: "hint-next",
          text: "Next card"
        })}
      </li>
      <li>
        <button type="button" data-action="${PanelAction.Stop}" interestfor="hint-stop">Stop</button>
        ${hint({
          id: "hint-stop",
          text: "Stop"
        })}
      </li>
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

// "en-GB-SoniaNeural" -> "Sonia"
function getVoiceName(voice: string) {
  return voice.split(VOICE_NAME_SEPARATOR).at(-1)?.replace(VOICE_NAME_SUFFIX, "") ?? voice;
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

// Every word is its own span, so clicking one jumps the narration there
function writeSubtitleWords({ elSubtitle, text }: {
  elSubtitle: HTMLElement;
  text: string;
}) {
  const nodes: (HTMLElement | string)[] = [];
  let iTextEnd = 0;
  for (const match of text.matchAll(SUBTITLE_WORD)) {
    const elWord = document.createElement("span");
    elWord.setAttribute(WORD_START_ATTRIBUTE, String(match.index));
    elWord.textContent = match[0];
    nodes.push(text.slice(iTextEnd, match.index), elWord);
    iTextEnd = match.index + match[0].length;
  }

  elSubtitle.replaceChildren(...nodes, text.slice(iTextEnd));
}

function highlightSpokenWord({ elSubtitle, state }: {
  elSubtitle: HTMLElement;
  state: PlayerState;
}) {
  const spokenStart = state.word?.start ?? -1;
  let elSpoken: HTMLElement | null = null;
  for (const elWord of elSubtitle.querySelectorAll<HTMLElement>(`[${WORD_START_ATTRIBUTE}]`)) {
    const wordStart = Number(elWord.getAttribute(WORD_START_ATTRIBUTE));
    const wordEnd = wordStart + (elWord.textContent?.length ?? 0);
    const isSpoken = wordStart <= spokenStart && spokenStart < wordEnd;
    elWord.toggleAttribute(SPOKEN_ATTRIBUTE, isSpoken);

    if (isSpoken) {
      elSpoken = elWord;
    }
  }

  if (!elSpoken) {
    return;
  }

  const centeredScrollTop = elSpoken.offsetTop - (elSubtitle.clientHeight - elSpoken.offsetHeight) / 2;
  elSubtitle.scrollTop = Math.max(centeredScrollTop, 0);
}

export function createTourPanel({ cardCount, onAction, onSeek }: {
  cardCount: number;
  onAction: (action: PanelAction) => void;
  onSeek: (start: number) => void;
}) {
  let subtitleText = "";
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
  const elVoice = queryRequired<HTMLOutputElement>({
    root: shadowRoot,
    selector: ".voice"
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
    const elWord = e.target instanceof Element ? e.target.closest(`[${WORD_START_ATTRIBUTE}]`) : null;
    if (elWord) {
      onSeek(Number(elWord.getAttribute(WORD_START_ATTRIBUTE)));
      return;
    }

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
      state: SpeakingState | null;
      title: string | null;
      iCard: number | null;
      locale: string | null;
    }) {
      elPanel.dataset.status = state?.status ?? PlayerStatus.Idle;
      elTitle.textContent = title === null || iCard === null ? "" : `${iCard + 1}/${cardCount} ${title}`;
      elVoice.textContent = state?.voice ? getVoiceName(state.voice) : "";
      elError.textContent = state?.error ?? "";
      elSubtitle.lang = locale ?? "";

      const text = !state || state.status === PlayerStatus.Error ? "" : state.text;
      if (text !== subtitleText) {
        subtitleText = text;
        writeSubtitleWords({
          elSubtitle,
          text
        });
      }

      if (!state) {
        return;
      }

      highlightSpokenWord({
        elSubtitle,
        state
      });
    }
  };
}
