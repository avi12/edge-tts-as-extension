// interestfor is a draft attribute, so it is not in the DOM's attribute types yet. Setting it on the
// element keeps the hints working without a component pretending the typing exists, and a browser
// without interest invokers simply never shows one
// https://open-ui.org/components/interest-invokers.explainer/
const INTEREST_ATTRIBUTE = "interestfor";

export function interest(hintId: string) {
  return (elInvoker: HTMLElement) => {
    elInvoker.setAttribute(INTEREST_ATTRIBUTE, hintId);
  };
}
