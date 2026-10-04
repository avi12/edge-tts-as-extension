import { createCardOverlay, createTourPanel, PanelAction } from "./ui";
import {
  Command,
  type ControlRequest,
  type PlayerState,
  PlayerStatus,
  stateEventSchema
} from "@/lib/messages";
import {
  getReachedCueNames,
  NARRATION_MESSAGE_SOURCE,
  NARRATION_MESSAGE_TYPE,
  NarrationAttribute,
  parseNarrationScript
} from "@/lib/narration";

// Artifact frames, from the claude.ai frame-shell and chat renderer bundles: published artifacts render in
// {uuid}.frame.claudeusercontent.com/_f/..., chat artifacts in an about:srcdoc child of www.claudeusercontent.com.
// The /_t token and /_warmup frames on the same host are hidden helpers
const HELPER_FRAME_PATHS = ["/_t", "/_warmup"];
const FALLBACK_CAPTION_SELECTOR = "figcaption, .caption";
const FALLBACK_CARD_SELECTOR = "figure, section, article, .card";
const HEADING_SELECTOR = "h1, h2, h3, h4, .card-head";
const ANY_PAGE_ORIGIN = "*";
const SCROLL_BLOCK = "center";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const ACTIVE_STATUSES = new Set([PlayerStatus.Loading, PlayerStatus.Playing, PlayerStatus.Paused]);

interface NarratedCard {
  elCard: HTMLElement;
  title: string;
  script: ReturnType<typeof parseNarrationScript>;
  overlay: ReturnType<typeof createCardOverlay>;
}

function getCardTitle({ elCard, iCard }: {
  elCard: HTMLElement;
  iCard: number;
}) {
  const explicitTitle = elCard.getAttribute(NarrationAttribute.Title);
  const headingText = elCard.querySelector(HEADING_SELECTOR)?.textContent?.trim();
  return explicitTitle ?? headingText ?? `Card ${iCard + 1}`;
}

function findScriptedCards() {
  const cards: {
    elCard: HTMLElement;
    script: string;
  }[] = [];
  for (const elCard of document.querySelectorAll<HTMLElement>(`[${NarrationAttribute.Script}]`)) {
    cards.push({
      elCard,
      script: elCard.getAttribute(NarrationAttribute.Script) ?? ""
    });
  }

  return cards;
}

function findCaptionedCards() {
  const cardScripts = new Map<HTMLElement, string>();
  for (const elCaption of document.querySelectorAll<HTMLElement>(FALLBACK_CAPTION_SELECTOR)) {
    const elCard = elCaption.closest<HTMLElement>(FALLBACK_CARD_SELECTOR) ?? elCaption.parentElement;
    const isNewCard = elCard !== null && !cardScripts.has(elCard);
    if (!isNewCard) {
      continue;
    }

    const heading = elCard.querySelector(HEADING_SELECTOR)?.textContent?.trim();
    const caption = elCaption.textContent?.trim() ?? "";
    cardScripts.set(elCard, heading ? `${heading}. ${caption}` : caption);
  }

  return [...cardScripts].map(([elCard, script]) => ({
    elCard,
    script
  }));
}

function findCards() {
  const scriptedCards = findScriptedCards();
  return scriptedCards.length > 0 ? scriptedCards : findCaptionedCards();
}

function postToPage(message: object) {
  postMessage({
    source: NARRATION_MESSAGE_SOURCE,
    type: NARRATION_MESSAGE_TYPE,
    ...message
  }, ANY_PAGE_ORIGIN);
}

function startNarrator(foundCards: ReturnType<typeof findCards>) {
  let iActive: number | null = null;
  let isTouring = false;
  let lastState: PlayerState | null = null;

  const panel = createTourPanel({
    cardCount: foundCards.length,
    onAction: action => void handlePanelAction(action)
  });

  const cards: NarratedCard[] = foundCards.map(({ elCard, script }, iCard) => ({
    elCard,
    title: getCardTitle({
      elCard,
      iCard
    }),
    script: parseNarrationScript(script),
    overlay: createCardOverlay({
      elCard,
      onPlay: () => void handleCardButton(iCard)
    })
  }));

  function getActiveCard() {
    return iActive === null ? undefined : cards[iActive];
  }

  function releaseActiveCard() {
    const card = getActiveCard();
    if (card) {
      card.elCard.removeAttribute(NarrationAttribute.Narrating);
      card.elCard.removeAttribute(NarrationAttribute.Cued);
      card.overlay.setStatus(PlayerStatus.Idle);
    }

    iActive = null;
  }

  function markReachedCues({ card, state }: {
    card: NarratedCard;
    state: PlayerState;
  }) {
    if (!state.word) {
      return;
    }

    const previouslyCued = new Set(card.elCard.getAttribute(NarrationAttribute.Cued)?.split(" ").filter(Boolean));
    const reachedCueNames = getReachedCueNames({
      cues: card.script.cues,
      iSpokenWord: state.word.start
    });
    const newCueNames = reachedCueNames.filter(name => !previouslyCued.has(name));
    if (newCueNames.length === 0) {
      return;
    }

    card.elCard.setAttribute(NarrationAttribute.Cued, reachedCueNames.join(" "));
    for (const cue of newCueNames) {
      postToPage({
        card: iActive,
        cue,
        status: state.status
      });
    }
  }

  function applyState(state: PlayerState) {
    lastState = state;
    const card = getActiveCard();
    const isOurs = card !== undefined && state.text === card.script.text;
    if (!card || !isOurs) {
      const isSomeoneElseSpeaking = card !== undefined && ACTIVE_STATUSES.has(state.status);
      if (isSomeoneElseSpeaking) {
        releaseActiveCard();
        isTouring = false;
      }

      panel.render({
        state: null,
        title: null,
        iCard: null
      });
      return;
    }

    const iCard = iActive;
    card.overlay.setStatus(state.status);
    markReachedCues({
      card,
      state
    });
    postToPage({
      card: iCard,
      status: state.status
    });

    const isStillActive = ACTIVE_STATUSES.has(state.status);
    if (isStillActive) {
      panel.render({
        state,
        title: card.title,
        iCard
      });
      return;
    }

    releaseActiveCard();
    const iNext = (iCard ?? 0) + 1;
    const isTourContinuing = state.status === PlayerStatus.Finished && isTouring && iNext < cards.length;
    if (isTourContinuing) {
      void narrateCard(iNext);
      return;
    }

    isTouring = false;
    panel.render({
      state: state.status === PlayerStatus.Error ? state : null,
      title: null,
      iCard: null
    });
  }

  async function narrateCard(iCard: number) {
    const card = cards[iCard];
    if (!card) {
      return;
    }

    releaseActiveCard();
    iActive = iCard;
    card.elCard.setAttribute(NarrationAttribute.Narrating, "");
    card.elCard.setAttribute(NarrationAttribute.Cued, "");
    card.elCard.scrollIntoView({
      block: SCROLL_BLOCK,
      behavior: matchMedia(REDUCED_MOTION_QUERY).matches ? "instant" : "smooth"
    });
    const state: PlayerState = await browser.runtime.sendMessage({
      type: Command.Speak,
      text: card.script.text
    });
    applyState(state);
  }

  async function sendControl(type: ControlRequest["type"]) {
    const request: ControlRequest = { type };
    const state: PlayerState = await browser.runtime.sendMessage(request);
    applyState(state);
  }

  async function handleCardButton(iCard: number) {
    isTouring = false;
    const isThisCardActive = iActive === iCard;
    if (isThisCardActive && lastState?.status === PlayerStatus.Playing) {
      await sendControl(Command.Pause);
      return;
    }

    if (isThisCardActive && lastState?.status === PlayerStatus.Paused) {
      await sendControl(Command.Resume);
      return;
    }

    await narrateCard(iCard);
  }

  async function handlePanelAction(action: PanelAction) {
    switch (action) {
      case PanelAction.Tour:
        isTouring = true;
        await narrateCard(0);
        return;
      case PanelAction.Previous:
        await narrateCard(Math.max((iActive ?? 0) - 1, 0));
        return;
      case PanelAction.Next:
        await narrateCard((iActive ?? -1) + 1);
        return;
      case PanelAction.Pause:
        await sendControl(Command.Pause);
        return;
      case PanelAction.Resume:
        await sendControl(Command.Resume);
        return;
      case PanelAction.Stop:
        isTouring = false;
        await sendControl(Command.Stop);
    }
  }

  browser.runtime.onMessage.addListener(message => {
    const parsed = stateEventSchema.safeParse(message);
    if (parsed.success) {
      applyState(parsed.data.state);
    }
  });
}

function waitForCards() {
  const cards = findCards();
  if (cards.length > 0) {
    startNarrator(cards);
    return;
  }

  const observer = new MutationObserver(() => {
    const lateCards = findCards();
    if (lateCards.length === 0) {
      return;
    }

    observer.disconnect();
    startNarrator(lateCards);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

export default defineContentScript({
  matches: ["https://*.frame.claudeusercontent.com/*", "https://www.claudeusercontent.com/*"],
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  runAt: "document_idle",
  main() {
    const isHelperFrame = HELPER_FRAME_PATHS.some(path => location.pathname.startsWith(path));
    if (isHelperFrame) {
      return;
    }

    waitForCards();
  }
});
